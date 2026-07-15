import { NextFunction, Request, Response, Router } from 'express';
import fs from 'fs/promises';
import { DashboardData, DashboardAction, SettingsData, ViewName, ReportData, PlatformBreakdown, HealthScore, TopErrorEntry, ChecklistItem, ChecklistScenario, AppStatusRow, IncidentRow, IncidentWorkflowStatus } from '@efm/shared';
import { config } from '../config.js';
import { normalizeStatus } from '../engines/normalization.js';
import { buildIncidents, buildEnrollmentIncidents } from '../engines/incidents.js';
import { getDataBundle } from '../graph/provider.js';
import { TokenExpiredError } from '../graph/graphClient.js';
import { logger } from '../utils/logger.js';
import { PrismaIncidentRepository } from '../storage/incidentRepository.js';
import { prisma } from '../storage/prisma.js';
import { enrollmentErrorCatalog } from '../catalog/enrollmentErrors.js';
import { z } from 'zod';

const incidentRepo = new PrismaIncidentRepository();

const ADMIN_UPNS = ['menahem@365-poc.com', 'menahem@modernendpoint.tech'];

function ensureAdmin(req: Request): void {
  const upn = String((req.session as any)?.account?.username ?? '').toLowerCase().trim();
  if (!ADMIN_UPNS.includes(upn)) {
    throw new Error('Forbidden');
  }
}

const workflowSchema = z.object({
  owner: z.string().trim().max(120).default('Unassigned'),
  status: z.enum(['New', 'Investigating', 'Mitigating', 'Resolved']),
  notes: z.string().trim().max(4000).default('')
});

const bulkDeviceActionSchema = z.object({
  deviceIds: z.array(z.string().trim().min(1)).min(1).max(100),
  action: z.enum(['sync', 'reboot', 'autopilotReset'])
});

function getSessionTenantId(req: Request): string | null {
  const tenantId = String((req.session as any)?.account?.tenantId ?? '').trim();
  return tenantId || null;
}

function ensureTenantBound(req: Request): void {
  if (config.mockMode) return;
  const tenantId = getSessionTenantId(req);
  if (!tenantId) {
    throw new Error('Session is missing tenant context. Sign in again.');
  }
}

async function getScopedData(req: Request) {
  ensureTenantBound(req);
  return getViewData(req.session?.accessToken);
}

async function assertKnownDeviceId(req: Request, deviceId: string): Promise<void> {
  const data = await getScopedData(req);
  const exists = data.devices.some((device) => device.id === deviceId);
  if (!exists) {
    throw new Error('Unknown device or device not accessible in this tenant context.');
  }
}

async function assertKnownIncidentSignature(req: Request, signature: string): Promise<void> {
  const data = await getScopedData(req);
  const exists = data.incidents.some((incident) => !incident.isPlaceholder && incident.signature === signature);
  if (!exists) {
    throw new Error('Unknown incident or incident not accessible in this tenant context.');
  }
}


async function mergeIncidentWorkflows(rows: IncidentRow[]): Promise<IncidentRow[]> {
  const workflows = await incidentRepo.listWorkflows().catch(() => []);
  const workflowMap = new Map(workflows.map((workflow) => [workflow.signature, workflow]));

  return rows.map((row) => {
    const workflow = workflowMap.get(row.signature);
    if (!workflow) return row;
    return {
      ...row,
      owner: workflow.owner,
      status: workflow.status,
      notes: workflow.notes,
      workflowUpdatedAt: workflow.updatedAt
    };
  });
}

// ── Token expiry helper ───────────────────────────────────────────────────────
function isTokenExpired(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    error.name === 'TokenExpiredError' ||
    msg.includes('(401)') ||
    msg.includes('unauthorized') ||
    msg.includes('invalidauthenticationtoken') ||
    msg.includes('lifetime validation failed') ||
    msg.includes('compacttoken') ||
    msg.includes('token') && msg.includes('expired')
  );
}

function handleTokenExpiry(req: any, res: any): boolean {
  if (!isTokenExpired({ message: 'token expired' } as any)) return false;
  req.session?.destroy?.(() => {});
  res.status(401).json({ message: 'Session expired. Please sign in again.', expired: true });
  return true;
}

function handleError(req: any, res: any, error: any, fallbackMsg: string): void {
  if (isTokenExpired(error)) {
    req.session?.destroy?.(() => {});
    res.status(401).json({ message: 'Session expired. Please sign in again.', expired: true });
  } else {
    res.status(500).json({ message: error?.message ?? fallbackMsg });
  }
}


function ensureConnected(req: Request, res: Response, next: NextFunction): void {
  if (config.mockMode || req.session?.accessToken) return next();
  res.status(401).json({ message: 'Session expired. Please sign in again.', expired: true });
}

async function getViewData(accessToken?: string) {
  const bundle = await getDataBundle(accessToken);

  const statuses = [] as typeof bundle.appStatuses;
  for (const row of bundle.appStatuses ?? []) {
    const normalized = await normalizeStatus(row);
    statuses.push({
      ...row,
      normalizedCategory: normalized.normalizedCategory,
      cause: normalized.cause,
      confidence: normalized.confidence,
      recommendedActions: normalized.recommendedActions
    });
  }

  const incidents = buildIncidents(statuses);
  try {
    await incidentRepo.upsertMany(incidents);
  } catch (error) {
    logger.warn({ err: error }, 'Incident persistence failed; continuing with in-memory incidents.');
  }

  return {
    apps: bundle.apps ?? [],
    devices: bundle.devices ?? [],
    users: bundle.users ?? [],
    statuses,
    incidents,
    diagnostics: bundle.diagnostics ?? {
      devicesAvailable: true
    }
  };
}

function buildDashboard(data: Awaited<ReturnType<typeof getViewData>>): DashboardData {
  const windowsDevices = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('windows'));
  const linuxDevices = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('linux'));

  const mobileDevices = data.devices.filter((d) => {
    const os = (d.operatingSystem ?? '').toLowerCase();
    return os.includes('ios') || os.includes('android') || os.includes('ipados');
  });

  const macDevices = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('mac'));

  const compliantDevices = data.devices.filter((d) => (d.complianceState ?? '').toLowerCase() === 'compliant');
  const nonCompliantDevices = data.devices.filter((d) => (d.complianceState ?? '').toLowerCase().includes('non'));
  const userDriven = windowsDevices.filter((d) => (d.userPrincipalName ?? '').includes('@'));
  const automatic = windowsDevices.filter((d) => !(d.userPrincipalName ?? '').includes('@'));

  const stale = data.devices.filter((d) => {
    const stamp = Date.parse(d.lastSyncDateTime ?? '');
    if (Number.isNaN(stamp)) return false;
    return (Date.now() - stamp) / (1000 * 60 * 60 * 24) > 7;
  }).length;

  const activeIncidents = data.incidents.filter((incident) => !incident.isPlaceholder);
  const activeCriticalIssues = activeIncidents.filter((incident) => incident.severity === 'Critical' || incident.priority === 'P1').length;
  const readinessRisks = stale + nonCompliantDevices.length + activeCriticalIssues;
  const complianceRate = data.devices.length > 0 ? compliantDevices.length / data.devices.length : 1;
  const incidentPenalty = Math.min(30, activeIncidents.length * 6 + activeCriticalIssues * 8);
  const readinessPenalty = Math.min(20, readinessRisks * 1.5);
  const healthScore = Math.max(0, Math.min(100, Math.round(complianceRate * 100 - incidentPenalty - readinessPenalty + 20)));

  const causeMap = new Map<string, number>();
  for (const incident of activeIncidents) {
    causeMap.set(incident.normalizedCategory, (causeMap.get(incident.normalizedCategory) ?? 0) + incident.impactedCount);
  }
  const topRootCauses = Array.from(causeMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const recommendedActions: DashboardAction[] = [];
  if (activeCriticalIssues > 0) {
    recommendedActions.push({
      title: `Investigate ${activeCriticalIssues} critical issue${activeCriticalIssues > 1 ? 's' : ''}`,
      rationale: 'P1 or critical incidents are active and should be triaged first.',
      targetView: 'incidents',
      severity: 'critical'
    });
  }
  if (stale > 0) {
    recommendedActions.push({
      title: `Review ${stale} stale device${stale > 1 ? 's' : ''}`,
      rationale: 'Devices that have not synced for over 7 days often hide enrollment drift or policy gaps.',
      targetView: 'windowsEnrollment',
      severity: 'warn'
    });
  }
  if (nonCompliantDevices.length > 0) {
    recommendedActions.push({
      title: `Focus on ${nonCompliantDevices.length} non-compliant device${nonCompliantDevices.length > 1 ? 's' : ''}`,
      rationale: 'Compliance failures directly reduce rollout readiness and user trust.',
      targetView: 'reports',
      severity: 'warn'
    });
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push({
      title: 'Environment looks stable',
      rationale: 'No critical issues were detected in the current rolling window.',
      targetView: 'reports',
      severity: 'info'
    });
  }

  return {
    totalDevices: data.devices.length,
    windowsEnrollmentDevices: windowsDevices.length,
    linuxEnrollmentDevices: linuxDevices.length,
    autopilotUserDrivenDevices: userDriven.length,
    autopilotAutomaticDevices: automatic.length,
    mobileEnrollmentDevices: mobileDevices.length,
    macEnrollmentDevices: macDevices.length,
    topEnrollmentStates: [
      { category: 'Compliant', count: compliantDevices.length },
      { category: 'Non-compliant', count: nonCompliantDevices.length },
      { category: 'Stale Sync (>7 days)', count: stale }
    ],
    healthScore,
    activeCriticalIssues,
    activeIssues: activeIncidents.length,
    readinessRisks,
    staleDevices: stale,
    recommendedActions,
    topRootCauses,
    lastRefresh: new Date().toISOString()
  };
}

function buildWindowsEnrollmentGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return data.devices
    .filter((device) => (device.operatingSystem ?? '').toLowerCase().includes('windows'))
    .map((device) => ({
    id: device.id,
    deviceName: device.deviceName,
    operatingSystem: device.operatingSystem,
    osVersion: device.osVersion,
    complianceState: device.complianceState,
    lastSyncDateTime: device.lastSyncDateTime,
    userPrincipalName: device.userPrincipalName,
    details: `Device: ${device.deviceName}\nOS: ${device.operatingSystem} ${device.osVersion}\nCompliance: ${device.complianceState}\nLast Sync: ${device.lastSyncDateTime}`
    }));
}

function buildLinuxEnrollmentGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return data.devices
    .filter((device) => (device.operatingSystem ?? '').toLowerCase().includes('linux'))
    .map((device) => ({
      id: device.id,
      deviceName: device.deviceName,
      operatingSystem: device.operatingSystem,
      osVersion: device.osVersion,
      complianceState: device.complianceState,
      lastSyncDateTime: device.lastSyncDateTime,
      userPrincipalName: device.userPrincipalName,
      details: `Device: ${device.deviceName}\nOS: ${device.operatingSystem} ${device.osVersion}\nCompliance: ${device.complianceState}\nLast Sync: ${device.lastSyncDateTime}`
    }));
}

function buildAutopilotAllGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return data.devices.map((device) => ({
    id: device.id,
    serialNumber: device.serialNumber ?? '-',
    deviceName: device.deviceName,
    userPrincipalName: device.userPrincipalName || '-',
    joinType: device.joinType ?? 'unknown',
    enrollmentType: device.deviceEnrollmentType ?? 'unknown',
    complianceState: device.complianceState,
    lastSyncDateTime: device.lastSyncDateTime,
    details: `Device: ${device.deviceName}\nUPN: ${device.userPrincipalName || '-'}\nJoin Type: ${device.joinType ?? 'unknown'}\nEnrollment Type: ${device.deviceEnrollmentType ?? 'unknown'}`
  }));
}

function buildAutopilotUserDrivenGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return buildAutopilotAllGrid(data).filter((row) => String(row.userPrincipalName).includes('@'));
}

function buildAutopilotPreProvisioningGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  return buildAutopilotAllGrid(data).filter((row) => !String(row.userPrincipalName).includes('@'));
}

function buildOcrGrid(data: Awaited<ReturnType<typeof getViewData>>) {
  const rows = data.statuses.map((row) => ({
    id: row.id,
    appName: row.appName,
    targetName: row.targetName,
    normalizedCategory: row.normalizedCategory || 'Unknown',
    confidence: row.confidence,
    errorCode: row.errorCode || 'Unknown',
    errorDescription: row.errorDescription || 'Unknown',
    cause: row.cause || 'Unknown',
    recommendedActions: (row.recommendedActions ?? []).join(' | '),
    details: `App: ${row.appName}\nTarget: ${row.targetName}\nCategory: ${row.normalizedCategory || 'Unknown'}\nCause: ${row.cause || 'Unknown'}\nConfidence: ${row.confidence}`
  }));

  if (rows.length > 0) return rows;

  // Fallback: show device baseline if app status telemetry is empty
  const deviceFallback = data.devices.slice(0, 200).map((device) => ({
    id: `device-ocr:${device.id}`,
    appName: 'Device Compliance Baseline',
    targetName: device.deviceName,
    normalizedCategory: (device.complianceState ?? '').toLowerCase() === 'compliant' ? 'DeviceHealth' : 'ComplianceRisk',
    confidence: (device.complianceState ?? '').toLowerCase() === 'compliant' ? 0.45 : 0.7,
    errorCode: (device.complianceState ?? '').toLowerCase() === 'compliant' ? '-' : 'DEVICE_NONCOMPLIANT',
    errorDescription: (device.complianceState ?? '').toLowerCase() === 'compliant' ? 'Compliant device baseline signal.' : 'Non-compliant device signal from managedDevices.',
    cause: (device.complianceState ?? '').toLowerCase() === 'compliant'
      ? 'Device is reporting compliant state; app-level telemetry is not currently available.'
      : `Device reports ${device.complianceState} compliance state.`,
    recommendedActions: (device.complianceState ?? '').toLowerCase() === 'compliant'
      ? 'Assign at least one required app and wait for Intune status telemetry to populate.'
      : 'Open device in Intune and review compliance policies and recent check-in.',
    details: `Device: ${device.deviceName}\nCompliance: ${device.complianceState}\nOS: ${device.operatingSystem} ${device.osVersion}\nLast Sync: ${device.lastSyncDateTime}`
  }));

  return deviceFallback.length
    ? deviceFallback
    : [{
      id: 'ocr-empty',
      appName: 'No OCR telemetry yet',
      targetName: '-',
      normalizedCategory: 'DataUnavailable',
      confidence: 0,
      errorCode: '-',
      errorDescription: 'No app installation status rows were returned from Graph.',
      cause: 'Either there are currently no app status events, or delegated permissions are not sufficient.',
      recommendedActions: 'Grant admin consent for required Graph delegated permissions and refresh again.',
      details: 'OCR needs app status telemetry. Verify Microsoft Graph delegated permissions and Intune app status availability.'
    }];
}

function buildPermissionCheck(req: Request) {
  const token = req.session?.accessToken;
  return [{
    id: 'permission-check',
    connected: Boolean(token),
    mockMode: config.mockMode,
    configuredScopes: (config.entra?.scopes ?? []).join(' '),
    recommendedScopes: 'openid profile offline_access User.Read Directory.Read.All DeviceManagementManagedDevices.Read.All DeviceManagementApps.Read.All DeviceManagementServiceConfig.Read.All',
    details:
      `Configured scopes:\n${(config.entra?.scopes ?? []).join(' ')}\n\n` +
      `Recommended (Intune enrollment + app status):\n` +
      `DeviceManagementManagedDevices.Read.All\nDeviceManagementApps.Read.All\nDeviceManagementServiceConfig.Read.All\nDirectory.Read.All\n\n` +
      `Remember: delegated permissions require admin consent in Entra ID.`
  }];
}

function buildEnrollmentErrorCatalog() {
  return enrollmentErrorCatalog;
}

function buildReportData(data: Awaited<ReturnType<typeof getViewData>>, upn: string, tenantId: string): ReportData {
  const windows = data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('windows'));
  const mac     = data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('mac'));
  const ios     = data.devices.filter(d => { const o = (d.operatingSystem ?? '').toLowerCase(); return o.includes('ios') || o.includes('ipados'); });
  const android = data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('android'));

  const compliantOf = (arr: typeof data.devices) => arr.filter(d => (d.complianceState ?? '').toLowerCase() === 'compliant').length;
  const scoreOf = (arr: typeof data.devices): number => {
    if (!arr.length) return 0;
    return Math.round((compliantOf(arr) / arr.length) * 100);
  };

  const platformBreakdown: PlatformBreakdown[] = [
    { platform: 'Windows', count: windows.length, compliant: compliantOf(windows), nonCompliant: windows.length - compliantOf(windows) },
    { platform: 'macOS',   count: mac.length,     compliant: compliantOf(mac),     nonCompliant: mac.length - compliantOf(mac) },
    { platform: 'iOS',     count: ios.length,     compliant: compliantOf(ios),     nonCompliant: ios.length - compliantOf(ios) },
    { platform: 'Android', count: android.length, compliant: compliantOf(android), nonCompliant: android.length - compliantOf(android) },
  ].filter(p => p.count > 0);

  const healthScores: HealthScore[] = platformBreakdown.map(p => ({
    platform: p.platform,
    score: p.count > 0 ? Math.round((p.compliant / p.count) * 100) : 0,
    trend: 'stable' as const,
    enrolled: p.count,
    compliant: p.compliant,
    total: p.count
  }));

  // Top errors from incidents
  const topErrors: TopErrorEntry[] = data.incidents
    .filter(i => !i.isPlaceholder)
    .sort((a, b) => b.impactedCount - a.impactedCount)
    .slice(0, 5)
    .map(i => ({
      errorCode: i.errorCode || i.normalizedCategory,
      title: i.summary || i.normalizedCategory,
      count: i.impactedCount,
      severity: i.severity
    }));

  const totalCompliant = compliantOf(data.devices);
  const overallRate = data.devices.length > 0 ? Math.round((totalCompliant / data.devices.length) * 100) : 0;
  const totalDevices = data.devices.length;
  const activeIncidents = data.incidents.filter(i => !i.isPlaceholder).length;

  // Synthetic 7-day trend from incidents (grouped by lastSeen date)
  const trendMap = new Map<string, number>();
  for (const inc of data.incidents.filter(i => !i.isPlaceholder)) {
    const day = (inc.lastSeen ?? '').slice(0, 10);
    if (day) trendMap.set(day, (trendMap.get(day) ?? 0) + inc.impactedCount);
  }
  const enrollmentTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([date, count]) => ({ date, count }));

  return {
    generatedAt: new Date().toISOString(),
    tenantId: tenantId || '',
    tenantUpn: upn || '',
    totalDevices,
    overallComplianceRate: overallRate,
    activeIncidents,
    platformBreakdown,
    topErrors,
    healthScores,
    enrollmentTrend,
    executiveSummary: {
      openIncidents: activeIncidents,
      resolvedIncidents: 0,
      slaBreached: 0,
      slaAtRisk: 0,
      topFailureCauses: topErrors.slice(0, 5).map((item) => ({
        title: item.title,
        category: item.errorCode || 'Unknown',
        impacted: item.count
      }))
    }
  };
}

function buildChecklist(data: Awaited<ReturnType<typeof getViewData>>, scenario: ChecklistScenario): ChecklistItem[] {
  const hasWindows  = data.devices.some(d => (d.operatingSystem ?? '').toLowerCase().includes('windows'));
  const hasMac      = data.devices.some(d => (d.operatingSystem ?? '').toLowerCase().includes('mac'));
  const hasIos      = data.devices.some(d => { const o = (d.operatingSystem ?? '').toLowerCase(); return o.includes('ios') || o.includes('ipados'); });
  const hasAndroid  = data.devices.some(d => (d.operatingSystem ?? '').toLowerCase().includes('android'));
  const hasDevices  = data.devices.length > 0;
  const hasIncidents = data.incidents.some(i => !i.isPlaceholder);

  const pass  = (label: string, cat: string, desc: string, detail: string, doc: string): ChecklistItem =>
    ({ id: `${scenario}-${label}`, category: cat, label, description: desc, status: 'pass', detail, docUrl: doc });
  const warn  = (label: string, cat: string, desc: string, detail: string, doc: string): ChecklistItem =>
    ({ id: `${scenario}-${label}`, category: cat, label, description: desc, status: 'warn', detail, docUrl: doc });
  const manual = (label: string, cat: string, desc: string, detail: string, doc: string): ChecklistItem =>
    ({ id: `${scenario}-${label}`, category: cat, label, description: desc, status: 'manual', detail, docUrl: doc });

  if (scenario === 'autopilot') return [
    hasWindows ? pass('Windows Devices Detected', 'Devices', 'Windows devices are present in tenant', `${data.devices.filter(d=>(d.operatingSystem??'').toLowerCase().includes('windows')).length} Windows devices found`, 'https://learn.microsoft.com/autopilot') : warn('Windows Devices Detected', 'Devices', 'No Windows devices found in tenant', 'Ensure devices are enrolled before testing Autopilot', 'https://learn.microsoft.com/autopilot'),
    manual('Hardware Hash Uploaded', 'Registration', 'Device hardware hashes imported into Intune', 'Check Devices > Windows > Enrollment > Devices (Autopilot)', 'https://learn.microsoft.com/autopilot/add-devices'),
    manual('Autopilot Profile Assigned', 'Profile', 'Deployment profile assigned to device or group', 'Check Devices > Windows > Enrollment > Deployment Profiles', 'https://learn.microsoft.com/autopilot/profiles'),
    manual('ESP Profile Configured', 'Profile', 'Enrollment Status Page profile assigned', 'Check Devices > Windows > Enrollment > Enrollment Status Page', 'https://learn.microsoft.com/intune/enrollment/windows-enrollment-status'),
    manual('MDM User Scope Configured', 'Licensing', 'MDM User Scope set to All or target group', 'Check Entra ID > Mobility > Microsoft Intune > MDM User Scope', 'https://learn.microsoft.com/intune/enrollment/windows-enroll'),
    manual('Intune License Assigned', 'Licensing', 'Users have Intune or M365 license', 'Check M365 Admin Center > Users > Active users > Licenses', 'https://learn.microsoft.com/intune/fundamentals/licenses'),
    hasIncidents ? warn('No Active Incidents', 'Health', 'Check for active enrollment incidents', `${data.incidents.filter(i=>!i.isPlaceholder).length} active incidents detected`, 'https://learn.microsoft.com/intune/enrollment/troubleshoot-windows-enrollment-errors') : pass('No Active Incidents', 'Health', 'No active enrollment incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/troubleshoot-windows-enrollment-errors'),
    manual('Network Endpoints Reachable', 'Network', 'Required Microsoft endpoints accessible', 'Verify *.manage.microsoft.com, *.microsoftonline.com, *.windowsupdate.com', 'https://learn.microsoft.com/intune/fundamentals/intune-endpoints'),
    manual('DNS CNAME Configured', 'Network', 'EnterpriseEnrollment CNAME record exists', 'nslookup EnterpriseEnrollment.<yourdomain>', 'https://learn.microsoft.com/intune/enrollment/windows-enrollment-create-cname'),
    manual('Conditional Access Reviewed', 'Security', 'CA policies allow initial enrollment', 'Temporarily exclude users from device compliance CA during first enrollment', 'https://learn.microsoft.com/intune/protect/conditional-access'),
  ];

  if (scenario === 'ade-ios') return [
    hasIos ? pass('iOS Devices Present', 'Devices', 'iOS/iPadOS devices found in tenant', `${data.devices.filter(d=>{const o=(d.operatingSystem??'').toLowerCase();return o.includes('ios')||o.includes('ipados');}).length} devices`, 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios') : warn('iOS Devices Present', 'Devices', 'No iOS devices found yet', 'Enroll test device to validate pipeline', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
    manual('Apple Business Manager Configured', 'ABM', 'ABM account linked to Intune tenant', 'Check Tenant administration > Apple > Enrollment program tokens', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
    manual('ADE Token Not Expired', 'ABM', 'Enrollment program token is valid', 'Token expires annually — check expiry date in Intune', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
    manual('Device Synced from ABM', 'ABM', 'Device serial visible in Intune after ABM sync', 'Devices > iOS/iPadOS > Enrollment program tokens > Sync', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
    manual('ADE Enrollment Profile Assigned', 'Profile', 'Enrollment profile assigned to device in Intune', 'Devices > iOS/iPadOS > Enrollment program tokens > Profiles', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
    manual('APNs Certificate Valid', 'Certificates', 'Apple MDM Push Certificate not expired', 'Tenant administration > Apple MDM Push certificate', 'https://learn.microsoft.com/intune/enrollment/apple-mdm-push-certificate-get'),
    manual('Network Access to Apple Endpoints', 'Network', 'Device can reach apple.com endpoints', 'Verify albert.apple.com, gdmf.apple.com, *.push.apple.com reachable on TCP 443', 'https://support.apple.com/en-us/101555'),
    manual('Intune License Assigned to Users', 'Licensing', 'Users have Intune license', 'Check M365 Admin Center > Users > Active users > Licenses', 'https://learn.microsoft.com/intune/fundamentals/licenses'),
    hasIncidents ? warn('No Active Incidents', 'Health', 'Check for iOS enrollment incidents', `${data.incidents.filter(i=>!i.isPlaceholder).length} active incidents`, 'https://learn.microsoft.com/intune/enrollment/troubleshoot-ios-enrollment-errors') : pass('No Active Incidents', 'Health', 'No active iOS incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/troubleshoot-ios-enrollment-errors'),
  ];

  if (scenario === 'ade-macos') return [
    hasMac ? pass('macOS Devices Present', 'Devices', 'macOS devices found in tenant', `${data.devices.filter(d=>(d.operatingSystem??'').toLowerCase().includes('mac')).length} devices`, 'https://learn.microsoft.com/intune/enrollment/macos-enroll') : warn('macOS Devices Present', 'Devices', 'No macOS devices found yet', 'Enroll test Mac to validate pipeline', 'https://learn.microsoft.com/intune/enrollment/macos-enroll'),
    manual('Apple Business Manager Configured', 'ABM', 'ABM account linked to Intune', 'Check Tenant administration > Apple > Enrollment program tokens', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
    manual('macOS ADE Token Valid', 'ABM', 'macOS enrollment token not expired', 'Check token expiry in Intune — renew 30 days before expiry', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
    manual('Mac Serial Synced from ABM', 'ABM', 'Mac serial visible in Intune after sync', 'Devices > macOS > Enrollment program tokens > Sync', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
    manual('macOS ADE Enrollment Profile Assigned', 'Profile', 'Enrollment profile assigned to Mac in Intune', 'Include Setup Assistant screens and MDM settings', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
    manual('APNs Certificate Valid', 'Certificates', 'Apple MDM Push Certificate not expired', 'Tenant administration > Apple MDM Push certificate', 'https://learn.microsoft.com/intune/enrollment/apple-mdm-push-certificate-get'),
    manual('macOS Compliance Policy Assigned', 'Policy', 'Compliance policy targeting macOS devices', 'Devices > macOS > Compliance policies', 'https://learn.microsoft.com/intune/protect/compliance-policy-create-mac-os'),
    manual('Network Access to Apple Endpoints', 'Network', 'Mac can reach Apple/Intune endpoints', 'albert.apple.com, gdmf.apple.com, *.manage.microsoft.com on TCP 443', 'https://support.apple.com/en-us/101555'),
    hasIncidents ? warn('No Active Incidents', 'Health', 'Check for macOS incidents', `${data.incidents.filter(i=>!i.isPlaceholder).length} active incidents`, 'https://learn.microsoft.com/intune/enrollment/macos-enroll') : pass('No Active Incidents', 'Health', 'No active macOS incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/macos-enroll'),
  ];

  // android-enterprise
  return [
    hasAndroid ? pass('Android Devices Present', 'Devices', 'Android devices found in tenant', `${data.devices.filter(d=>(d.operatingSystem??'').toLowerCase().includes('android')).length} devices`, 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll') : warn('Android Devices Present', 'Devices', 'No Android devices found yet', 'Enroll test device to validate', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
    manual('Managed Google Play Linked', 'Google', 'Managed Google Play enterprise account linked to Intune', 'Tenant administration > Android > Managed Google Play', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
    manual('Android Enterprise Enrollment Type Selected', 'Profile', 'Work Profile, Fully Managed, or Dedicated device configured', 'Devices > Android > Enrollment profiles', 'https://learn.microsoft.com/intune/enrollment/android-fully-managed-enroll'),
    manual('Enrollment Restriction Allows Android', 'Policy', 'Device type restriction allows Android Enterprise', 'Devices > Enrollment restrictions > Device type restrictions', 'https://learn.microsoft.com/intune/enrollment/enrollment-restrictions-set'),
    manual('Google Play Services Updated on Device', 'Device', 'Google Play Services is up to date', 'Settings > Apps > Google Play Services > version check', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
    manual('Device is Play Protect Certified', 'Device', 'Device passes Google Play Protect certification', 'Settings > Security > Play Protect certification', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
    manual('Company Portal Installed', 'Apps', 'Company Portal app available on device', 'Managed Google Play > search Company Portal > assign', 'https://learn.microsoft.com/intune/user-help/enroll-device-android-company-portal'),
    manual('Intune License Assigned', 'Licensing', 'Users have Intune license', 'Check M365 Admin Center > Users > Active users > Licenses', 'https://learn.microsoft.com/intune/fundamentals/licenses'),
    hasIncidents ? warn('No Active Incidents', 'Health', 'Check for Android incidents', `${data.incidents.filter(i=>!i.isPlaceholder).length} active incidents`, 'https://learn.microsoft.com/intune/enrollment/troubleshoot-android-enrollment') : pass('No Active Incidents', 'Health', 'No active Android incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/troubleshoot-android-enrollment'),
    manual('Network – FCM Reachable', 'Network', 'Firebase Cloud Messaging not blocked by firewall', 'fcm.googleapis.com on TCP 443 must be reachable', 'https://firebase.google.com/docs/cloud-messaging'),
  ];
}


async function graphPostAction(accessToken: string, path: string, body?: string): Promise<void> {
  const response = await fetch(`https://graph.microsoft.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    ...(body ? { body } : {})
  });

  if (response.ok || response.status === 204 || response.status === 202) return;
  const text = await response.text();
  throw new Error(`Graph action failed (${response.status}) on ${path}: ${text || response.statusText}`);
}

function requireWriteToken(req: Request): string {
  ensureTenantBound(req);
  const session = req.session as any;
  const token = session?.writeAccessToken;
  if (!token || session?.hasWritePermissions !== true) {
    throw new Error('Write access is required for this action. Re-authenticate with elevated permissions.');
  }
  return token;
}

async function explainOcrText(text: string) {
  const trimmed = text.trim();
  const fakeRow: AppStatusRow = {
    id: 'ocr-explain',
    appId: 'ocr-explain',
    appName: 'OCR Assistant',
    targetType: 'device',
    targetId: 'ocr-input',
    targetName: 'OCR Input',
    installState: 'unknown',
    errorCode: (trimmed.match(/(?:error code|code)[:\s-]*([0-9a-zx-]+)/i)?.[1] ?? 'Unknown').toUpperCase(),
    errorDescription: trimmed.slice(0, 4000),
    lastReportedDateTime: new Date().toISOString(),
    normalizedCategory: '',
    cause: '',
    confidence: 0,
    recommendedActions: []
  };

  const normalized = await normalizeStatus(fakeRow);
  return {
    category: normalized.normalizedCategory,
    confidence: normalized.confidence,
    cause: normalized.cause,
    recommendedActions: normalized.recommendedActions
  };
}

export const apiRouter = Router();

apiRouter.get('/admin/signins/summary', async (req, res) => {
  try {
    ensureAdmin(req);

    const [totalLogins, uniqueUsersRaw, uniqueTenantsRaw, lastLogin] = await Promise.all([
      prisma.signInEvent.count({ where: { eventType: 'login_success' } }),
      prisma.signInEvent.findMany({
        where: { eventType: 'login_success', userPrincipalName: { not: null } },
        distinct: ['userPrincipalName'],
        select: { userPrincipalName: true }
      }),
      prisma.signInEvent.findMany({
        where: { eventType: 'login_success', tenantId: { not: null } },
        distinct: ['tenantId'],
        select: { tenantId: true }
      }),
      prisma.signInEvent.findFirst({
        where: { eventType: 'login_success' },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return res.json({
      totalLogins,
      uniqueUsers: uniqueUsersRaw.length,
      uniqueTenants: uniqueTenantsRaw.length,
      lastLoginAt: lastLogin?.createdAt?.toISOString() ?? null,
      lastLoginUser: lastLogin?.userPrincipalName ?? null
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to load sign-in summary.';
    return res.status(msg === 'Forbidden' ? 403 : 500).json({ message: msg });
  }
});

apiRouter.get('/admin/signins', async (req, res) => {
  try {
    ensureAdmin(req);

    const takeRaw = Number(req.query.take ?? 100);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 500) : 100;

    const rows = await prisma.signInEvent.findMany({
      where: { eventType: 'login_success' },
      orderBy: { createdAt: 'desc' },
      take
    });

    return res.json({
      rows: rows.map((row: {
        id: string;
        createdAt: Date;
        userPrincipalName: string | null;
        displayName: string | null;
        tenantId: string | null;
        ipAddress: string | null;
        userAgent: string | null;
        eventType: string;
      }) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        userPrincipalName: row.userPrincipalName,
        displayName: row.displayName,
        tenantId: row.tenantId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        eventType: row.eventType
      }))
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to load sign-ins.';
    return res.status(msg === 'Forbidden' ? 403 : 500).json({ message: msg });
  }
});

apiRouter.use(ensureConnected);

apiRouter.get('/export', async (req, res) => {
  try {
    const view = String(req.query.view || '');
    const format = String(req.query.format || 'json').toLowerCase();
    const data = await getViewData((req as any).session?.accessToken);

    let rows: Record<string, unknown>[];
    if (view === 'windowsEnrollment') {
      rows = buildWindowsEnrollmentGrid(data) as any;
    } else if (view === 'linuxEnrollment') {
      rows = buildLinuxEnrollmentGrid(data) as any;
    } else if (view === 'mobileEnrollment') {
      rows = data.devices.filter((d) => {
        const os = (d.operatingSystem ?? '').toLowerCase();
        return os.includes('ios') || os.includes('android') || os.includes('ipados');
      }).map((d) => ({ id: d.id, deviceName: d.deviceName, operatingSystem: d.operatingSystem, osVersion: d.osVersion, complianceState: d.complianceState, lastSyncDateTime: d.lastSyncDateTime, userPrincipalName: d.userPrincipalName })) as any;
    } else if (view === 'macEnrollment') {
      rows = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('mac'))
        .map((d) => ({ id: d.id, deviceName: d.deviceName, osVersion: d.osVersion, complianceState: d.complianceState, lastSyncDateTime: d.lastSyncDateTime, userPrincipalName: d.userPrincipalName, serialNumber: d.serialNumber })) as any;
    } else {
      // Fallback: export all devices
      rows = data.devices.map((d) => ({ id: d.id, deviceName: d.deviceName, operatingSystem: d.operatingSystem, osVersion: d.osVersion, complianceState: d.complianceState, lastSyncDateTime: d.lastSyncDateTime, userPrincipalName: d.userPrincipalName })) as any;
    }

    const filename = `${view || 'export'}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      const escape = (v: unknown) => {
        const s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json(rows);
    }
  } catch (error: any) {
    handleError(req, res, error, 'Export failed.');
  }
});

apiRouter.post('/ocr/explain', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) return res.status(400).json({ message: 'Missing OCR text.' });
  try {
    const explanation = await explainOcrText(text);
    return res.json(explanation);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message ?? 'OCR explanation failed.' });
  }
});

apiRouter.post('/devices/:deviceId/sync', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    await graphPostAction(token, `/v1.0/deviceManagement/managedDevices/${encodeURIComponent(deviceId)}/syncDevice`);
    return res.json({ success: true, message: 'Sync command sent.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Sync failed.' });
  }
});

apiRouter.post('/devices/:deviceId/reboot', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    await graphPostAction(token, `/v1.0/deviceManagement/managedDevices/${encodeURIComponent(deviceId)}/rebootNow`);
    return res.json({ success: true, message: 'Reboot command sent.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Reboot failed.' });
  }
});

apiRouter.post('/devices/:deviceId/autopilotReset', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    await graphPostAction(token, `/beta/deviceManagement/managedDevices/${encodeURIComponent(deviceId)}/cleanWindowsDevice`);
    return res.json({ success: true, message: 'Autopilot Reset command sent.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Autopilot Reset failed.' });
  }
});

apiRouter.post('/devices/bulk', async (req, res) => {
  const parsed = bulkDeviceActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid bulk request.' });
  }
  const { deviceIds, action } = parsed.data;
  try {
    const data = await getScopedData(req);
    const allowedIds = new Set(data.devices.map((device) => device.id));
    const unknownIds = deviceIds.filter((id) => !allowedIds.has(id));
    if (unknownIds.length > 0) {
      return res.status(403).json({ success: false, message: 'One or more devices are not accessible in this tenant context.' });
    }
    const token = requireWriteToken(req);
    const results = [];
    for (const id of deviceIds) {
      try {
        if (action === 'sync') await graphPostAction(token, `/v1.0/deviceManagement/managedDevices/${encodeURIComponent(id)}/syncDevice`);
        else if (action === 'reboot') await graphPostAction(token, `/v1.0/deviceManagement/managedDevices/${encodeURIComponent(id)}/rebootNow`);
        else await graphPostAction(token, `/beta/deviceManagement/managedDevices/${encodeURIComponent(id)}/cleanWindowsDevice`);
        results.push({ id, ok: true });
      } catch (error: any) {
        results.push({ id, ok: false, error: error?.message ?? 'Action failed.' });
      }
    }
    return res.json({ success: results.every((r:any)=>r.ok), results });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Bulk action failed.' });
  }
});

apiRouter.get('/incidents/workflows', async (_req, res) => {
  try {
    const rows = await incidentRepo.listWorkflows();
    return res.json({ rows });
  } catch (error) {
    logger.warn({ err: error }, 'Workflow store unavailable; returning empty workflow set.');
    return res.json({ rows: [] });
  }
});

apiRouter.post('/incidents/:signature/workflow', async (req, res) => {
  const signature = String(req.params.signature ?? '').trim();
  if (!signature) return res.status(400).json({ message: 'Missing incident signature.' });

  const parsed = workflowSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid workflow payload.' });
  }

  try {
    await assertKnownIncidentSignature(req, signature);
    const row = await incidentRepo.upsertWorkflow({
      signature,
      owner: parsed.data.owner || 'Unassigned',
      status: parsed.data.status,
      notes: parsed.data.notes
    });
    return res.json(row);
  } catch (error) {
    return res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to save workflow.' });
  }
});

apiRouter.get('/refresh', async (req, res) => {
  try {
    await getViewData(req.session.accessToken);
    res.json({ message: 'Refresh completed.' });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Refresh failed.' });
  }
});

apiRouter.get('/view/:view', async (req, res) => {
  try {
    const view = String(req.params.view) as ViewName;

    if (view === 'permissionCheck') {
      return res.json({
        rows: buildPermissionCheck(req),
        message: 'Permission check loaded.'
      });
    }

    if (view === 'settings') {
      const settings: SettingsData = {
        incidentWindowMinutes: config.incidentWindowMinutes,
        incidentThresholdCount: config.incidentThresholdCount,
        severityThresholds: config.severityThresholds,
        refreshIntervalSeconds: config.refreshIntervalSeconds,
        mockMode: config.mockMode
      };
      return res.json({ rows: [settings], message: 'Settings loaded.' });
    }

    if (view === 'enrollmentErrorCatalog') {
      return res.json({
        rows: buildEnrollmentErrorCatalog(),
        message: 'Enrollment Error Catalog loaded.'
      });
    }

    // ── Readiness Checklist — lightweight path (devices only, no app-status fetch) ──
    if (view === 'readinessChecklist') {
      const token = req.session?.accessToken;
      if (!token) return res.status(401).json({ message: 'Not authenticated.' });
      const scenario = (typeof req.query.scenario === 'string' ? req.query.scenario : 'autopilot') as ChecklistScenario;

      // Fetch ONLY devices — one Graph call instead of N app-status calls
      const devicesUrl = 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices' +
        '?$top=200&$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userPrincipalName';
      const devRes = await fetch(devicesUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      const devJson = devRes.ok ? await devRes.json().catch(() => ({ value: [] })) : { value: [] };
      const devices = (devJson.value ?? []).map((d: any) => ({
        id: d.id ?? '',
        deviceName: d.deviceName ?? '',
        operatingSystem: d.operatingSystem ?? '',
        osVersion: d.osVersion ?? '',
        complianceState: d.complianceState ?? 'unknown',
        lastSyncDateTime: d.lastSyncDateTime ?? '',
        userPrincipalName: d.userPrincipalName ?? '',
        userDisplayName: '',
        serialNumber: '',
        joinType: '',
        deviceEnrollmentType: ''
      }));

      // Use persisted incidents from DB (no Graph needed for checklist)
      const dbIncidents = await incidentRepo.listWorkflows().catch(() => []);
      const incidents = dbIncidents.map((w) => ({
        isPlaceholder: false,
        signature: w.signature,
        impactedCount: 1,
        severity: 'Low',
        priority: 'P3',
        normalizedCategory: '',
        cause: ''
      }));

      return res.json({
        rows: buildChecklist({ devices, incidents } as any, scenario),
        message: `Readiness checklist for ${scenario} loaded.`
      });
    }

    const data = await getViewData(req.session.accessToken);

    if (view === 'dashboard') {
  const message = data.diagnostics?.devicesAvailable === false
    ? data.diagnostics.devicesMessage ?? 'Command Center loaded with limited tenant data.'
    : 'Command Center loaded.';

  return res.json({
    rows: [buildDashboard(data)],
    message,
    diagnostics: data.diagnostics
  });
}
    if (view === 'windowsEnrollment') {
      return res.json({ rows: buildWindowsEnrollmentGrid(data), message: 'Windows Enrollment loaded.' });
    }
    if (view === 'linuxEnrollment') {
      return res.json({ rows: buildLinuxEnrollmentGrid(data), message: 'Linux Enrollment loaded.' });
    }
    if (view === 'mobileEnrollment') {
      const mobileRows = data.devices
        .filter((d) => {
          const os = (d.operatingSystem ?? '').toLowerCase();
          return os.includes('ios') || os.includes('android') || os.includes('ipados');
        })
        .map((d) => ({
          id: d.id,
          deviceName: d.deviceName,
          operatingSystem: d.operatingSystem,
          osVersion: d.osVersion,
          complianceState: d.complianceState,
          lastSyncDateTime: d.lastSyncDateTime,
          userDisplayName: d.userDisplayName,
          userPrincipalName: d.userPrincipalName,
          details: `Device: ${d.deviceName}
OS: ${d.operatingSystem} ${d.osVersion}
Compliance: ${d.complianceState}
UPN: ${d.userPrincipalName || '-'}
Last Sync: ${d.lastSyncDateTime}`
        }));
      return res.json({ rows: mobileRows, message: 'Mobile Enrollment loaded.' });
    }
    if (view === 'macEnrollment') {
      const macRows = data.devices
        .filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('mac'))
        .map((d) => {
          const enrollType = (d.deviceEnrollmentType ?? '').toLowerCase();
          const isADE = enrollType.includes('dep') || enrollType.includes('automated') || enrollType.includes('apple');
          return {
            id: d.id,
            deviceName: d.deviceName,
            osVersion: d.osVersion,
            enrollmentType: isADE ? 'ADE / DEP' : 'User Enrollment',
            supervised: isADE,
            userApproved: !isADE,
            complianceState: d.complianceState,
            lastSyncDateTime: d.lastSyncDateTime,
            userPrincipalName: d.userPrincipalName || '-',
            serialNumber: d.serialNumber || '-',
            details: `Device: ${d.deviceName}
OS: macOS ${d.osVersion}
Enrollment: ${isADE ? 'ADE / DEP (Supervised)' : 'User Enrollment'}
Compliance: ${d.complianceState}
UPN: ${d.userPrincipalName || '-'}
Serial: ${d.serialNumber || '-'}
Last Sync: ${d.lastSyncDateTime}`
          };
        });
      const msg = macRows.length === 0
        ? 'No macOS devices found in tenant.'
        : `macOS Enrollment loaded — ${macRows.length} device${macRows.length !== 1 ? 's' : ''}.`;
      return res.json({ rows: macRows, message: msg });
    }
    if (view === 'ocr') {
      return res.json({ rows: buildOcrGrid(data), message: 'OCR loaded.' });
    }
    if (view === 'incidents') {
      const mergedIncidents = await mergeIncidentWorkflows(data.incidents);

      // Also fetch enrollment failures and build incidents from them
      let enrollmentIncidents: any[] = [];
      try {
        const token = req.session?.accessToken;
        if (token) {
          const G = 'https://graph.microsoft.com';
          const hdr = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
          const efRes = await fetch(G + '/v1.0/deviceManagement/troubleshootingEvents?$top=200&$orderby=eventDateTime desc', { headers: hdr });
          if (efRes.ok) {
            const efData: any = await efRes.json();
            const items: any[] = (efData.value ?? []).filter((item: any) =>
              item['@odata.type'] === '#microsoft.graph.enrollmentTroubleshootingEvent' ||
              item.failureCategory !== undefined || item.enrollmentType !== undefined
            );
            const rows = items.map((item: any) => ({
              failureDateTime: item.eventDateTime ?? null,
              failureReason: item.failureReason ?? item.failureCategory ?? '—',
              failureCategory: item.failureCategory ?? null,
              os: item.operatingSystem ?? null,
              osVersion: item.osVersion ?? null,
              userPrincipalName: item.userPrincipalName ?? item.userId ?? null,
              enrollmentMethod: item.enrollmentType ?? null,
              deviceId: item.deviceId ?? item.managedDeviceIdentifier ?? null,
              correlationId: item.correlationId ?? null,
            }));
            enrollmentIncidents = buildEnrollmentIncidents(rows, config.severityThresholds);
          }
        }
      } catch (_) { /* silent — don't break Fix Queue if enrollment fetch fails */ }

      // Merge: enrollment incidents first (more actionable), then device incidents
      const allIncidents = [...enrollmentIncidents, ...mergedIncidents.filter(i => !i.isPlaceholder)];

      // If both sources empty — return placeholder
      if (allIncidents.length === 0) {
        return res.json({
          rows: mergedIncidents, // contains placeholder
          message: 'No active incidents in current window.'
        });
      }

      // Apply saved workflow states
      const withWorkflow = await mergeIncidentWorkflows(allIncidents);
      return res.json({
        rows: withWorkflow,
        message: `${allIncidents.length} active incident${allIncidents.length !== 1 ? 's' : ''} loaded.`
      });
    }
    if (view === 'reports') {
      return res.json({
        rows: [buildReportData(data, req.session?.account?.username ?? '', req.session?.account?.tenantId ?? '')],
        message: 'Reports loaded.'
      });
    }
    if (String(req.params.view) === 'auditLogs') {
      return res.json({ rows: [], message: 'Audit Logs loaded.' });
    }
    if (String(req.params.view) === 'enrollmentFailures') {
      // Redirect to the dedicated handler logic inline
      return res.status(200).json({ rows: [], message: 'Use /api/graph/enrollment-failures for live data.' });
    }
    if (String(req.params.view) === 'graphQuery') {
      return res.json({ rows: [], message: 'Graph Explorer ready.' });
    }

    return res.status(400).json({ message: `Unsupported view: ${req.params.view}` });
  } catch (error) {
    // Token expired or invalid — clear session and redirect to login
    const isTokenError = (
      error instanceof Error && (
        error.name === 'TokenExpiredError' ||
        error.message.includes('401') ||
        error.message.toLowerCase().includes('token') ||
        error.message.toLowerCase().includes('unauthorized') ||
        error.message.toLowerCase().includes('invalidauthenticationtoken') ||
        error.message.toLowerCase().includes('lifetime validation failed') ||
        error.message.toLowerCase().includes('compacttoken')
      )
    );
    if (isTokenError) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: 'Session expired. Please sign in again.', expired: true });
    }
    const msg = error instanceof Error ? error.message : 'Failed to load view.';
    return res.status(500).json({ message: msg });
  }
});

apiRouter.post('/graph/proxy', async (req, res) => {
  try {
    const token = req.session?.accessToken;
    if (!token) return res.status(401).json({ message: 'Not authenticated.' });

    const rawUrl: string = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) return res.status(400).json({ message: 'Missing url in request body.' });

    // Only allow graph.microsoft.com paths
    const path = rawUrl.startsWith('https://graph.microsoft.com')
      ? rawUrl.replace('https://graph.microsoft.com', '')
      : rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;

    if (!path.startsWith('/v1.0/') && !path.startsWith('/beta/')) {
      return res.status(400).json({ message: 'URL must start with /v1.0/ or /beta/' });
    }

    const response = await fetch(`https://graph.microsoft.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg = (data as any)?.error?.message ?? response.statusText ?? 'Graph error';
      return res.status(response.status).json({ message: errMsg, graphError: data });
    }

    return res.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Graph proxy failed.';
    return res.status(500).json({ message: msg });
  }
});

apiRouter.get('/graph/enrollment-failures', async (req, res) => {
  try {
    const token = req.session?.accessToken;
    if (!token) return res.status(401).json({ message: 'Not authenticated.' });

    const GRAPH = 'https://graph.microsoft.com';
    const url = GRAPH + '/v1.0/deviceManagement/troubleshootingEvents?$top=200&$orderby=eventDateTime desc';

    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = (errData as any)?.error?.message ?? response.statusText;
      const fallbackRes = await fetch(
        GRAPH + "/v1.0/deviceManagement/managedDevices?$filter=complianceState eq 'noncompliant' or complianceState eq 'unknown'&$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userPrincipalName,deviceEnrollmentType&$top=200",
        { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }
      );
      if (!fallbackRes.ok) {
        return res.status(response.status).json({ message: 'Enrollment failures unavailable: ' + msg, rows: [] });
      }
      const fb: any = await fallbackRes.json();
      const fbRows = (fb.value ?? []).map((item: any) => ({
        failureDateTime: item.lastSyncDateTime ?? null,
        failureReason: item.complianceState === 'noncompliant' ? 'Non-compliant device' : 'Compliance unknown',
        failureCategory: item.complianceState ?? null,
        os: item.operatingSystem ?? null,
        osVersion: item.osVersion ?? null,
        userPrincipalName: item.userPrincipalName ?? null,
        enrollmentMethod: item.deviceEnrollmentType ?? null,
        deviceId: item.id ?? null,
        deviceName: item.deviceName ?? null,
      }));
      return res.json({ rows: fbRows, message: fbRows.length + ' record(s) loaded (fallback mode).' });
    }

    const data: any = await response.json();
    const items: any[] = data?.value ?? [];

    const enrollmentItems = items.filter((item: any) =>
      (item as any)['@odata.type'] === '#microsoft.graph.enrollmentTroubleshootingEvent' ||
      item.failureCategory !== undefined ||
      item.enrollmentType !== undefined
    );

    const rows = enrollmentItems.map((item: any) => ({
      failureDateTime: item.eventDateTime ?? null,
      failureReason: item.failureReason ?? item.failureCategory ?? '—',
      failureCategory: item.failureCategory ?? null,
      os: item.operatingSystem ?? null,
      osVersion: item.osVersion ?? null,
      userPrincipalName: item.userPrincipalName ?? item.userId ?? null,
      enrollmentMethod: item.enrollmentType ?? null,
      deviceId: item.deviceId ?? item.managedDeviceIdentifier ?? null,
      deviceName: item.deviceDisplayName ?? item.deviceId ?? null,
      correlationId: item.correlationId ?? null,
    }));

    return res.json({ rows, message: rows.length + ' enrollment failure' + (rows.length !== 1 ? 's' : '') + ' loaded.' });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Enrollment failures fetch failed.';
    return res.status(500).json({ message: msg });
  }
});

apiRouter.get('/graph/enrollment-policy', async (req, res) => {
  try {
    const token = req.session?.accessToken;
    if (!token) return res.status(401).json({ message: 'Not authenticated.' });

    const G = 'https://graph.microsoft.com';
    const hdr = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    const [configsRes, mgmtRes, autopilotRes] = await Promise.all([
      fetch(G + '/v1.0/deviceManagement/deviceEnrollmentConfigurations?$top=50', { headers: hdr }),
      fetch(G + '/v1.0/deviceManagement', { headers: hdr }),
      // No $select — use full payload to avoid OData property errors
      fetch(G + '/v1.0/deviceManagement/windowsAutopilotDeviceIdentities?$top=200', { headers: hdr }),
    ]);

    // Parse enrollment configurations
    const configsData: any = configsRes.ok ? await configsRes.json() : { value: [] };
    const configs: any[] = configsData.value ?? [];

    // Default limit config (priority 0)
    const limitConfig = configs.find((c: any) =>
      c['@odata.type'] === '#microsoft.graph.deviceEnrollmentLimitConfiguration' && c.priority === 0
    );
    // Custom limit configs (priority > 0, per-group overrides)
    const customLimitConfigs = configs.filter((c: any) =>
      c['@odata.type'] === '#microsoft.graph.deviceEnrollmentLimitConfiguration' && c.priority > 0
    );
    // Default platform restrictions (priority 0)
    const platformConfig = configs.find((c: any) =>
      c['@odata.type'] === '#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration' && c.priority === 0
    );
    // Custom platform restriction policies (priority > 0)
    const customPlatformConfigs = configs.filter((c: any) =>
      c['@odata.type'] === '#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration' && c.priority > 0
    );

    // Parse MDM info
    const mgmtData: any = mgmtRes.ok ? await mgmtRes.json() : {};

    // Parse Autopilot
    const autopilotData: any = autopilotRes.ok ? await autopilotRes.json() : { value: [], '@odata.count': 0 };
    const autopilotDevices: any[] = autopilotData.value ?? [];
    const autopilotTotal: number = autopilotData['@odata.count'] ?? autopilotDevices.length;
    const enrollmentStates: Record<string, number> = {};
    autopilotDevices.forEach((d: any) => {
      const state = d.enrollmentState ?? 'unknown';
      enrollmentStates[state] = (enrollmentStates[state] ?? 0) + 1;
    });

    return res.json({
      mdmAuthority: 'Intune',
      intuneAccountId: mgmtData.intuneAccountId ?? null,
      deviceLimit: limitConfig?.limit ?? null,
      deviceLimitPolicyName: limitConfig?.displayName ?? 'Default',
      platformRestrictions: platformConfig ? {
        iosRestriction: platformConfig.iosRestriction,
        windowsRestriction: platformConfig.windowsRestriction,
        windowsMobileRestriction: platformConfig.windowsMobileRestriction,
        androidRestriction: platformConfig.androidRestriction,
        macOSRestriction: platformConfig.macOSRestriction,
        policyName: platformConfig.displayName,
        lastModified: platformConfig.lastModifiedDateTime,
      } : null,
      customLimitPolicies: customLimitConfigs.map((c: any) => ({
        displayName: c.displayName,
        priority: c.priority,
        limit: c.limit,
        lastModifiedDateTime: c.lastModifiedDateTime,
      })),
      customPlatformPolicies: customPlatformConfigs.map((c: any) => ({
        displayName: c.displayName,
        priority: c.priority,
        lastModifiedDateTime: c.lastModifiedDateTime,
        iosRestriction: c.iosRestriction,
        windowsRestriction: c.windowsRestriction,
        androidRestriction: c.androidRestriction,
        macOSRestriction: c.macOSRestriction,
        windowsMobileRestriction: c.windowsMobileRestriction,
      })),
      autopilot: {
        total: autopilotTotal,
        enrollmentStates,
        devices: autopilotDevices.slice(0, 100).map((d: any) => ({
          id: d.id,
          serialNumber: d.serialNumber,
          manufacturer: d.manufacturer,
          model: d.model,
          groupTag: d.groupTag,
          enrollmentState: d.enrollmentState,
          lastContactedDateTime: d.lastContactedDateTime,
          managedDeviceId: d.managedDeviceId,
          userPrincipalName: d.userPrincipalName ?? d.addressableUserName ?? '',
          displayName: d.displayName,
        })),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Enrollment policy fetch failed.';
    return res.status(500).json({ message: msg });
  }
});

apiRouter.post('/devices/:deviceId/retire', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    await graphPostAction(token, '/v1.0/deviceManagement/managedDevices/' + encodeURIComponent(deviceId) + '/retire');
    return res.json({ success: true, message: 'Retire command sent. Device will unenroll on next check-in.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Retire failed.' });
  }
});

apiRouter.post('/devices/:deviceId/wipe', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    const body = req.body?.keepEnrollmentData === true
      ? JSON.stringify({ keepEnrollmentData: true, keepUserData: false })
      : '{}';
    await graphPostAction(token, '/v1.0/deviceManagement/managedDevices/' + encodeURIComponent(deviceId) + '/wipe', body);
    return res.json({ success: true, message: 'Wipe command sent. Device will be factory reset on next check-in.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Wipe failed.' });
  }
});

apiRouter.post('/devices/:deviceId/collectDiagnostics', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    await graphPostAction(token, '/beta/deviceManagement/managedDevices/' + encodeURIComponent(deviceId) + '/createDeviceLogCollectionRequest', JSON.stringify({ templateType: 'predefined' }));
    return res.json({ success: true, message: 'Diagnostics collection started. Check Intune portal for download link.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Collect diagnostics failed.' });
  }
});

apiRouter.post('/devices/:deviceId/rotateBitLockerKeys', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    await graphPostAction(token, '/beta/deviceManagement/managedDevices/' + encodeURIComponent(deviceId) + '/rotateBitLockerKeys');
    return res.json({ success: true, message: 'BitLocker key rotation initiated.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'BitLocker key rotation failed.' });
  }
});

apiRouter.post('/devices/:deviceId/resetPasscode', async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    await assertKnownDeviceId(req, deviceId);
    const token = requireWriteToken(req);
    await graphPostAction(token, '/v1.0/deviceManagement/managedDevices/' + encodeURIComponent(deviceId) + '/resetPasscode');
    return res.json({ success: true, message: 'Passcode reset sent. User will need to set a new passcode.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message ?? 'Reset passcode failed.' });
  }
});

apiRouter.get('/graph/compliance-drift', async (req, res) => {
  try {
    const token = req.session?.accessToken;
    if (!token) return res.status(401).json({ message: 'Not authenticated.' });

    const G = 'https://graph.microsoft.com';
    const hdr = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    // Fetch all managed devices compliance states
    let allDevices: any[] = [];
    let url: string | null = G + '/v1.0/deviceManagement/managedDevices?$select=id,complianceState&$top=999';
    while (url) {
      const r: any = await fetch(url, { headers: hdr });
      if (!r.ok) break;
      const data: any = await r.json();
      allDevices = allDevices.concat(data.value ?? []);
      url = data['@odata.nextLink'] ?? null;
    }

    const counts = { compliant: 0, noncompliant: 0, unknown: 0, total: allDevices.length };
    allDevices.forEach((d: any) => {
      if (d.complianceState === 'compliant') counts.compliant++;
      else if (d.complianceState === 'noncompliant') counts.noncompliant++;
      else counts.unknown++;
    });

    // Load existing snapshots from session, add new one
    const existing: any[] = (req.session as any).driftSnapshots ?? [];
    const snapshot = { timestamp: new Date().toISOString(), ...counts };
    // Keep last 30 snapshots
    const snapshots = [...existing, snapshot].slice(-30);
    (req.session as any).driftSnapshots = snapshots;

    return res.json({ snapshots, latest: snapshot });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Compliance drift fetch failed.';
    return res.status(500).json({ message: msg });
  }
});

