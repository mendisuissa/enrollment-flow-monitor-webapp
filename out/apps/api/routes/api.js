import { Router } from 'express';
import fs from 'fs/promises';
import { config } from '../config.js';
import { normalizeStatus } from '../engines/normalization.js';
import { buildIncidents } from '../engines/incidents.js';
import { getDataBundle } from '../graph/provider.js';
import { logger } from '../utils/logger.js';
import { PrismaIncidentRepository } from '../storage/incidentRepository.js';
import { enrollmentErrorCatalog } from '../catalog/enrollmentErrors.js';
const incidentRepo = new PrismaIncidentRepository();
function ensureConnected(req, res, next) {
    if (config.mockMode || req.session?.accessToken)
        return next();
    res.status(401).json({ message: 'Not connected. Click Connect first.' });
}
async function getViewData(accessToken) {
    const bundle = await getDataBundle(accessToken);
    // Normalize app status rows (if any)
    const statuses = [];
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
    // Build + persist incidents (best effort)
    const incidents = buildIncidents(statuses);
    try {
        await incidentRepo.upsertMany(incidents);
    }
    catch (error) {
        logger.warn({ err: error }, 'Incident persistence failed; continuing with in-memory incidents.');
    }
    return {
        apps: bundle.apps ?? [],
        devices: bundle.devices ?? [],
        users: bundle.users ?? [],
        statuses,
        incidents
    };
}
function buildDashboard(data) {
    const windowsDevices = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('windows'));
    const mobileDevices = data.devices.filter((d) => {
        const os = (d.operatingSystem ?? '').toLowerCase();
        return os.includes('ios') || os.includes('android') || os.includes('ipados');
    });
    const macDevices = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('mac'));
    const autopilotReady = windowsDevices.filter((d) => (d.complianceState ?? '').toLowerCase() === 'compliant');
    const userDriven = windowsDevices.filter((d) => (d.userPrincipalName ?? '').includes('@'));
    const automatic = windowsDevices.filter((d) => !(d.userPrincipalName ?? '').includes('@'));
    const stale = windowsDevices.filter((d) => {
        const stamp = Date.parse(d.lastSyncDateTime ?? '');
        if (Number.isNaN(stamp))
            return false;
        return (Date.now() - stamp) / (1000 * 60 * 60 * 24) > 7;
    }).length;
    return {
        totalDevices: data.devices.length,
        windowsEnrollmentDevices: windowsDevices.length,
        autopilotUserDrivenDevices: userDriven.length,
        autopilotAutomaticDevices: automatic.length,
        mobileEnrollmentDevices: mobileDevices.length,
        macEnrollmentDevices: macDevices.length,
        topEnrollmentStates: [
            { category: 'Compliant', count: autopilotReady.length },
            { category: 'Non-compliant', count: Math.max(0, windowsDevices.length - autopilotReady.length) },
            { category: 'Stale Sync (>7 days)', count: stale }
        ],
        lastRefresh: new Date().toISOString()
    };
}
function buildWindowsEnrollmentGrid(data) {
    return data.devices.map((device) => ({
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
function buildAutopilotAllGrid(data) {
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
function buildAutopilotUserDrivenGrid(data) {
    return buildAutopilotAllGrid(data).filter((row) => String(row.userPrincipalName).includes('@'));
}
function buildAutopilotPreProvisioningGrid(data) {
    return buildAutopilotAllGrid(data).filter((row) => !String(row.userPrincipalName).includes('@'));
}
function buildOcrGrid(data) {
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
    if (rows.length > 0)
        return rows;
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
function buildPermissionCheck() {
    return [{
            id: 'permission-check',
            connected: Boolean(config.mockMode || true),
            mockMode: config.mockMode,
            configuredScopes: (config.entra?.scopes ?? []).join(' '),
            recommendedScopes: 'openid profile offline_access User.Read User.ReadBasic.All DeviceManagementManagedDevices.Read.All DeviceManagementApps.Read.All',
            details: `Configured scopes:\n${(config.entra?.scopes ?? []).join(' ')}\n\n` +
                `Recommended (Intune enrollment + app status):\n` +
                `DeviceManagementManagedDevices.Read.All\nDeviceManagementApps.Read.All\nUser.ReadBasic.All\n\n` +
                `Remember: delegated permissions require admin consent in Entra ID.`
        }];
}
function buildEnrollmentErrorCatalog() {
    return enrollmentErrorCatalog;
}
function buildReportData(data, upn) {
    const windows = data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('windows'));
    const mac = data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('mac'));
    const ios = data.devices.filter(d => { const o = (d.operatingSystem ?? '').toLowerCase(); return o.includes('ios') || o.includes('ipados'); });
    const android = data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('android'));
    const compliantOf = (arr) => arr.filter(d => (d.complianceState ?? '').toLowerCase() === 'compliant').length;
    const scoreOf = (arr) => {
        if (!arr.length)
            return 0;
        return Math.round((compliantOf(arr) / arr.length) * 100);
    };
    const platformBreakdown = [
        { platform: 'Windows', count: windows.length, compliant: compliantOf(windows), nonCompliant: windows.length - compliantOf(windows) },
        { platform: 'macOS', count: mac.length, compliant: compliantOf(mac), nonCompliant: mac.length - compliantOf(mac) },
        { platform: 'iOS', count: ios.length, compliant: compliantOf(ios), nonCompliant: ios.length - compliantOf(ios) },
        { platform: 'Android', count: android.length, compliant: compliantOf(android), nonCompliant: android.length - compliantOf(android) },
    ].filter(p => p.count > 0);
    const healthScores = platformBreakdown.map(p => ({
        platform: p.platform,
        score: p.count > 0 ? Math.round((p.compliant / p.count) * 100) : 0,
        trend: 'stable',
        enrolled: p.count,
        compliant: p.compliant,
        total: p.count
    }));
    // Top errors from incidents
    const topErrors = data.incidents
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
    // Synthetic 7-day trend from incidents (grouped by lastSeen date)
    const trendMap = new Map();
    for (const inc of data.incidents.filter(i => !i.isPlaceholder)) {
        const day = (inc.lastSeen ?? '').slice(0, 10);
        if (day)
            trendMap.set(day, (trendMap.get(day) ?? 0) + inc.impactedCount);
    }
    const enrollmentTrend = Array.from(trendMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-7)
        .map(([date, count]) => ({ date, count }));
    return {
        generatedAt: new Date().toISOString(),
        tenantId: '',
        tenantUpn: upn,
        totalDevices: data.devices.length,
        overallComplianceRate: overallRate,
        activeIncidents: data.incidents.filter(i => !i.isPlaceholder).length,
        platformBreakdown,
        topErrors,
        healthScores,
        enrollmentTrend
    };
}
function buildChecklist(data, scenario) {
    const hasWindows = data.devices.some(d => (d.operatingSystem ?? '').toLowerCase().includes('windows'));
    const hasMac = data.devices.some(d => (d.operatingSystem ?? '').toLowerCase().includes('mac'));
    const hasIos = data.devices.some(d => { const o = (d.operatingSystem ?? '').toLowerCase(); return o.includes('ios') || o.includes('ipados'); });
    const hasAndroid = data.devices.some(d => (d.operatingSystem ?? '').toLowerCase().includes('android'));
    const hasDevices = data.devices.length > 0;
    const hasIncidents = data.incidents.some(i => !i.isPlaceholder);
    const pass = (label, cat, desc, detail, doc) => ({ id: `${scenario}-${label}`, category: cat, label, description: desc, status: 'pass', detail, docUrl: doc });
    const warn = (label, cat, desc, detail, doc) => ({ id: `${scenario}-${label}`, category: cat, label, description: desc, status: 'warn', detail, docUrl: doc });
    const manual = (label, cat, desc, detail, doc) => ({ id: `${scenario}-${label}`, category: cat, label, description: desc, status: 'manual', detail, docUrl: doc });
    if (scenario === 'autopilot')
        return [
            hasWindows ? pass('Windows Devices Detected', 'Devices', 'Windows devices are present in tenant', `${data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('windows')).length} Windows devices found`, 'https://learn.microsoft.com/autopilot') : warn('Windows Devices Detected', 'Devices', 'No Windows devices found in tenant', 'Ensure devices are enrolled before testing Autopilot', 'https://learn.microsoft.com/autopilot'),
            manual('Hardware Hash Uploaded', 'Registration', 'Device hardware hashes imported into Intune', 'Check Devices > Windows > Enrollment > Devices (Autopilot)', 'https://learn.microsoft.com/autopilot/add-devices'),
            manual('Autopilot Profile Assigned', 'Profile', 'Deployment profile assigned to device or group', 'Check Devices > Windows > Enrollment > Deployment Profiles', 'https://learn.microsoft.com/autopilot/profiles'),
            manual('ESP Profile Configured', 'Profile', 'Enrollment Status Page profile assigned', 'Check Devices > Windows > Enrollment > Enrollment Status Page', 'https://learn.microsoft.com/intune/enrollment/windows-enrollment-status'),
            manual('MDM User Scope Configured', 'Licensing', 'MDM User Scope set to All or target group', 'Check Entra ID > Mobility > Microsoft Intune > MDM User Scope', 'https://learn.microsoft.com/intune/enrollment/windows-enroll'),
            manual('Intune License Assigned', 'Licensing', 'Users have Intune or M365 license', 'Check M365 Admin Center > Users > Active users > Licenses', 'https://learn.microsoft.com/intune/fundamentals/licenses'),
            hasIncidents ? warn('No Active Incidents', 'Health', 'Check for active enrollment incidents', `${data.incidents.filter(i => !i.isPlaceholder).length} active incidents detected`, 'https://learn.microsoft.com/intune/enrollment/troubleshoot-windows-enrollment-errors') : pass('No Active Incidents', 'Health', 'No active enrollment incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/troubleshoot-windows-enrollment-errors'),
            manual('Network Endpoints Reachable', 'Network', 'Required Microsoft endpoints accessible', 'Verify *.manage.microsoft.com, *.microsoftonline.com, *.windowsupdate.com', 'https://learn.microsoft.com/intune/fundamentals/intune-endpoints'),
            manual('DNS CNAME Configured', 'Network', 'EnterpriseEnrollment CNAME record exists', 'nslookup EnterpriseEnrollment.<yourdomain>', 'https://learn.microsoft.com/intune/enrollment/windows-enrollment-create-cname'),
            manual('Conditional Access Reviewed', 'Security', 'CA policies allow initial enrollment', 'Temporarily exclude users from device compliance CA during first enrollment', 'https://learn.microsoft.com/intune/protect/conditional-access'),
        ];
    if (scenario === 'ade-ios')
        return [
            hasIos ? pass('iOS Devices Present', 'Devices', 'iOS/iPadOS devices found in tenant', `${data.devices.filter(d => { const o = (d.operatingSystem ?? '').toLowerCase(); return o.includes('ios') || o.includes('ipados'); }).length} devices`, 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios') : warn('iOS Devices Present', 'Devices', 'No iOS devices found yet', 'Enroll test device to validate pipeline', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
            manual('Apple Business Manager Configured', 'ABM', 'ABM account linked to Intune tenant', 'Check Tenant administration > Apple > Enrollment program tokens', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
            manual('ADE Token Not Expired', 'ABM', 'Enrollment program token is valid', 'Token expires annually — check expiry date in Intune', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
            manual('Device Synced from ABM', 'ABM', 'Device serial visible in Intune after ABM sync', 'Devices > iOS/iPadOS > Enrollment program tokens > Sync', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
            manual('ADE Enrollment Profile Assigned', 'Profile', 'Enrollment profile assigned to device in Intune', 'Devices > iOS/iPadOS > Enrollment program tokens > Profiles', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-ios'),
            manual('APNs Certificate Valid', 'Certificates', 'Apple MDM Push Certificate not expired', 'Tenant administration > Apple MDM Push certificate', 'https://learn.microsoft.com/intune/enrollment/apple-mdm-push-certificate-get'),
            manual('Network Access to Apple Endpoints', 'Network', 'Device can reach apple.com endpoints', 'Verify albert.apple.com, gdmf.apple.com, *.push.apple.com reachable on TCP 443', 'https://support.apple.com/en-us/101555'),
            manual('Intune License Assigned to Users', 'Licensing', 'Users have Intune license', 'Check M365 Admin Center > Users > Active users > Licenses', 'https://learn.microsoft.com/intune/fundamentals/licenses'),
            hasIncidents ? warn('No Active Incidents', 'Health', 'Check for iOS enrollment incidents', `${data.incidents.filter(i => !i.isPlaceholder).length} active incidents`, 'https://learn.microsoft.com/intune/enrollment/troubleshoot-ios-enrollment-errors') : pass('No Active Incidents', 'Health', 'No active iOS incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/troubleshoot-ios-enrollment-errors'),
        ];
    if (scenario === 'ade-macos')
        return [
            hasMac ? pass('macOS Devices Present', 'Devices', 'macOS devices found in tenant', `${data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('mac')).length} devices`, 'https://learn.microsoft.com/intune/enrollment/macos-enroll') : warn('macOS Devices Present', 'Devices', 'No macOS devices found yet', 'Enroll test Mac to validate pipeline', 'https://learn.microsoft.com/intune/enrollment/macos-enroll'),
            manual('Apple Business Manager Configured', 'ABM', 'ABM account linked to Intune', 'Check Tenant administration > Apple > Enrollment program tokens', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
            manual('macOS ADE Token Valid', 'ABM', 'macOS enrollment token not expired', 'Check token expiry in Intune — renew 30 days before expiry', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
            manual('Mac Serial Synced from ABM', 'ABM', 'Mac serial visible in Intune after sync', 'Devices > macOS > Enrollment program tokens > Sync', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
            manual('macOS ADE Enrollment Profile Assigned', 'Profile', 'Enrollment profile assigned to Mac in Intune', 'Include Setup Assistant screens and MDM settings', 'https://learn.microsoft.com/intune/enrollment/device-enrollment-program-enroll-macos'),
            manual('APNs Certificate Valid', 'Certificates', 'Apple MDM Push Certificate not expired', 'Tenant administration > Apple MDM Push certificate', 'https://learn.microsoft.com/intune/enrollment/apple-mdm-push-certificate-get'),
            manual('macOS Compliance Policy Assigned', 'Policy', 'Compliance policy targeting macOS devices', 'Devices > macOS > Compliance policies', 'https://learn.microsoft.com/intune/protect/compliance-policy-create-mac-os'),
            manual('Network Access to Apple Endpoints', 'Network', 'Mac can reach Apple/Intune endpoints', 'albert.apple.com, gdmf.apple.com, *.manage.microsoft.com on TCP 443', 'https://support.apple.com/en-us/101555'),
            hasIncidents ? warn('No Active Incidents', 'Health', 'Check for macOS incidents', `${data.incidents.filter(i => !i.isPlaceholder).length} active incidents`, 'https://learn.microsoft.com/intune/enrollment/macos-enroll') : pass('No Active Incidents', 'Health', 'No active macOS incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/macos-enroll'),
        ];
    // android-enterprise
    return [
        hasAndroid ? pass('Android Devices Present', 'Devices', 'Android devices found in tenant', `${data.devices.filter(d => (d.operatingSystem ?? '').toLowerCase().includes('android')).length} devices`, 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll') : warn('Android Devices Present', 'Devices', 'No Android devices found yet', 'Enroll test device to validate', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
        manual('Managed Google Play Linked', 'Google', 'Managed Google Play enterprise account linked to Intune', 'Tenant administration > Android > Managed Google Play', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
        manual('Android Enterprise Enrollment Type Selected', 'Profile', 'Work Profile, Fully Managed, or Dedicated device configured', 'Devices > Android > Enrollment profiles', 'https://learn.microsoft.com/intune/enrollment/android-fully-managed-enroll'),
        manual('Enrollment Restriction Allows Android', 'Policy', 'Device type restriction allows Android Enterprise', 'Devices > Enrollment restrictions > Device type restrictions', 'https://learn.microsoft.com/intune/enrollment/enrollment-restrictions-set'),
        manual('Google Play Services Updated on Device', 'Device', 'Google Play Services is up to date', 'Settings > Apps > Google Play Services > version check', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
        manual('Device is Play Protect Certified', 'Device', 'Device passes Google Play Protect certification', 'Settings > Security > Play Protect certification', 'https://learn.microsoft.com/intune/enrollment/android-work-profile-enroll'),
        manual('Company Portal Installed', 'Apps', 'Company Portal app available on device', 'Managed Google Play > search Company Portal > assign', 'https://learn.microsoft.com/intune/user-help/enroll-device-android-company-portal'),
        manual('Intune License Assigned', 'Licensing', 'Users have Intune license', 'Check M365 Admin Center > Users > Active users > Licenses', 'https://learn.microsoft.com/intune/fundamentals/licenses'),
        hasIncidents ? warn('No Active Incidents', 'Health', 'Check for Android incidents', `${data.incidents.filter(i => !i.isPlaceholder).length} active incidents`, 'https://learn.microsoft.com/intune/enrollment/troubleshoot-android-enrollment') : pass('No Active Incidents', 'Health', 'No active Android incidents', 'System appears healthy', 'https://learn.microsoft.com/intune/enrollment/troubleshoot-android-enrollment'),
        manual('Network – FCM Reachable', 'Network', 'Firebase Cloud Messaging not blocked by firewall', 'fcm.googleapis.com on TCP 443 must be reachable', 'https://firebase.google.com/docs/cloud-messaging'),
    ];
}
export const apiRouter = Router();
apiRouter.use(ensureConnected);
apiRouter.get('/debug/token', (req, res) => {
    const token = req.session?.accessToken;
    if (!token)
        return res.status(401).json({ connected: false });
    res.json({
        connected: true,
        user: req.session?.account ?? null,
        tokenPreview: token.slice(0, 40) + '...',
        scopes: (config.entra?.scopes ?? []).join(' ')
    });
});
// בדיקת Graph בסיסית (GET) כדי להבין אם הטננט באמת "חי"
apiRouter.get('/debug/graph', async (req, res) => {
    const token = req.session?.accessToken;
    if (!token)
        return res.status(401).json({ message: 'Not connected' });
    const p = typeof req.query.path === 'string' ? req.query.path : '/v1.0/organization';
    try {
        // פה אתה צריך להשתמש באותה פונקציה/Provider שיש לך ב-graph/provider.js
        // לדוגמה: const data = await graphGet(p, token);
        // אם אין לך graphGet – תגיד לי איך provider ממומש ואני אתאים שורה-בשורה.
        const data = await getDataBundle(token); // זמני: רק כדי לראות שזה בכלל עובד
        res.json({ ok: true, path: p, data });
    }
    catch (e) {
        res.status(500).json({ ok: false, message: e?.message ?? 'Graph failed' });
    }
});
apiRouter.get('/refresh', async (req, res) => {
    try {
        await getViewData(req.session.accessToken);
        res.json({ message: 'Refresh completed.' });
    }
    catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Refresh failed.' });
    }
});
apiRouter.get('/view/:view', async (req, res) => {
    try {
        const view = String(req.params.view);
        const data = await getViewData(req.session.accessToken);
        if (view === 'dashboard')
            return res.json({ rows: [buildDashboard(data)], message: 'Dashboard loaded.' });
        if (view === 'windowsAutopilot')
            return res.json({ rows: buildAutopilotAllGrid(data), message: 'Device Preparation (All) loaded.' });
        if (view === 'autopilotUserDriven')
            return res.json({ rows: buildAutopilotUserDrivenGrid(data), message: 'Device Preparation - User-Driven loaded.' });
        if (view === 'autopilotPreProvisioning')
            return res.json({ rows: buildAutopilotPreProvisioningGrid(data), message: 'Device Preparation - Automatic loaded.' });
        if (view === 'windowsEnrollment')
            return res.json({ rows: buildWindowsEnrollmentGrid(data), message: 'Windows Enrollment loaded.' });
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
                details: `Device: ${d.deviceName}\nOS: ${d.operatingSystem} ${d.osVersion}\nCompliance: ${d.complianceState}\nUPN: ${d.userPrincipalName || '-'}\nLast Sync: ${d.lastSyncDateTime}`
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
                    details: `Device: ${d.deviceName}\nOS: macOS ${d.osVersion}\nEnrollment: ${isADE ? 'ADE / DEP (Supervised)' : 'User Enrollment'}\nCompliance: ${d.complianceState}\nUPN: ${d.userPrincipalName || '-'}\nSerial: ${d.serialNumber || '-'}\nLast Sync: ${d.lastSyncDateTime}`
                };
            });
            const msg = macRows.length === 0
                ? 'No macOS devices found in tenant.'
                : `macOS Enrollment loaded — ${macRows.length} device${macRows.length !== 1 ? 's' : ''}.`;
            return res.json({ rows: macRows, message: msg });
        }
        if (view === 'ocr')
            return res.json({ rows: buildOcrGrid(data), message: 'OCR loaded.' });
        if (view === 'incidents')
            return res.json({ rows: data.incidents, message: data.incidents[0]?.isPlaceholder ? 'No active incidents in current window.' : 'Incidents loaded.' });
        if (view === 'settings') {
            const settings = {
                incidentWindowMinutes: config.incidentWindowMinutes,
                incidentThresholdCount: config.incidentThresholdCount,
                severityThresholds: config.severityThresholds,
                refreshIntervalSeconds: config.refreshIntervalSeconds,
                mockMode: config.mockMode
            };
            return res.json({ rows: [settings], message: 'Settings loaded.' });
        }
        // Extended views used by the UI
        if (String(req.params.view) === 'permissionCheck')
            return res.json({ rows: buildPermissionCheck(), message: 'Permission check loaded.' });
        if (String(req.params.view) === 'enrollmentErrorCatalog')
            return res.json({ rows: buildEnrollmentErrorCatalog(), message: 'Enrollment Error Catalog loaded.' });
        if (String(req.params.view) === 'reports')
            return res.json({ rows: [buildReportData(data, req.session?.account?.username ?? '')], message: 'Reports loaded.' });
        if (String(req.params.view) === 'readinessChecklist') {
            const scenario = (typeof req.query.scenario === 'string' ? req.query.scenario : 'autopilot');
            return res.json({ rows: buildChecklist(data, scenario), message: `Readiness checklist for ${scenario} loaded.` });
        }
        return res.status(400).json({ message: `Unsupported view: ${req.params.view}` });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to load view.';
        return res.status(500).json({ message: msg });
    }
});
apiRouter.post('/runbook', async (req, res) => {
    const row = req.body;
    const actions = Array.isArray(row?.recommendedActions) ? row.recommendedActions : [];
    if ((row?.installState ?? '').toLowerCase().includes('fail') && actions.length > 0) {
        const runbook = actions.map((a, i) => `${i + 1}. ${a}`).join('\n');
        return res.json({ runbook });
    }
    return res.json({
        runbook: '1. Validate user licensing and MDM scope.\n' +
            '2. Re-check network/proxy/TLS path.\n' +
            '3. Inspect Intune + Entra logs around the timestamp.'
    });
});
apiRouter.get('/logs', async (_req, res) => {
    try {
        const raw = await fs.readFile(config.logFile, 'utf8');
        const lines = raw.split('\n').filter(Boolean);
        res.json({ rows: lines.slice(-200).map((line, index) => ({ id: String(index), line })), message: 'Log tail loaded.' });
    }
    catch {
        res.json({ rows: [{ id: '0', line: 'No logs found yet.' }], message: 'Logs unavailable.' });
    }
});
apiRouter.get('/logs/download', async (_req, res) => {
    try {
        const raw = await fs.readFile(config.logFile, 'utf8');
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename=app.log');
        res.send(raw);
    }
    catch {
        res.status(404).send('No logs available.');
    }
});
// ── OCR / AI Explanation ──────────────────────────────────
apiRouter.post('/ocr/explain', async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) {
        return res.status(400).json({ explanation: 'No text provided. Paste an error message and try again.' });
    }
    // Look up error code in local catalog first (fast, no external call)
    const lowerText = text.toLowerCase();
    const catalogMatch = enrollmentErrorCatalog.find(entry => {
        const code = entry.errorCode.toLowerCase();
        return lowerText.includes(code);
    });
    if (catalogMatch) {
        const explanation = [
            `**${catalogMatch.title}** (${catalogMatch.errorCode})`,
            '',
            `**Description:** ${catalogMatch.symptoms}`,
            '',
            `**Root Cause:** ${catalogMatch.likelyRootCause}`,
            '',
            '**Recommended Actions:**',
            catalogMatch.remediation
        ].join('\n');
        return res.json({ explanation });
    }
    // Fallback: extract error code pattern and give generic guidance
    const errorCodeMatch = text.match(/0x[0-9A-Fa-f]{6,8}|80\d{6}|0x8[0-9A-Fa-f]{7}/);
    const correlationMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const lines = [];
    if (errorCodeMatch) {
        lines.push(`**Error Code Detected:** \`${errorCodeMatch[0]}\``);
        lines.push('');
        lines.push('This error code was not found in the local catalog. General troubleshooting steps:');
        lines.push('1. Search https://learn.microsoft.com/en-us/mem/intune for this error code.');
        lines.push('2. Check Intune portal: Devices → Monitor → Enrollment failures.');
        lines.push('3. Review Azure AD Sign-in logs for the user/device around the failure timestamp.');
        lines.push('4. Verify device compliance and MDM enrollment scope in Entra ID.');
    }
    else {
        lines.push('**Enrollment Error Analysis**');
        lines.push('');
        lines.push('No specific error code detected. Based on the message content:');
        lines.push('1. Verify the device has a valid Intune license assigned to the user.');
        lines.push('2. Confirm the device is in scope for MDM auto-enrollment.');
        lines.push('3. Check proxy/firewall rules — ensure Intune endpoints are reachable.');
        lines.push('4. Review: https://www.microsoft.com/wamerrors for Windows-specific codes.');
    }
    if (correlationMatch) {
        lines.push('');
        lines.push(`**Correlation ID:** \`${correlationMatch[0]}\``);
        lines.push('→ Use this ID in Azure AD audit logs or Intune diagnostic reports for exact trace.');
    }
    return res.json({ explanation: lines.join('\n') });
});
// ── Device Remediation Actions ────────────────────────────
// These routes MUST use the write token (from GRAPH_SCOPES_WRITE elevated login).
// If writeAccessToken is missing, the user has not yet consented to write permissions.
function getWriteToken(req) {
    return req.session?.writeAccessToken ?? null;
}
function requireWriteToken(req, res) {
    const token = getWriteToken(req);
    if (!token) {
        res.status(403).json({
            success: false,
            code: 'WRITE_PERMISSIONS_REQUIRED',
            message: 'This action requires elevated permissions. Please authorize via the Upgrade Access flow.'
        });
        return null;
    }
    return token;
}
apiRouter.post('/devices/:id/sync', async (req, res) => {
    try {
        const token = requireWriteToken(req, res);
        if (!token)
            return;
        const graphRes = await fetch(`https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${req.params.id}/syncDevice`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' }
        });
        if (!graphRes.ok && graphRes.status !== 204) {
            const body = await graphRes.text().catch(() => '');
            res.status(graphRes.status).json({ success: false, message: `Graph error ${graphRes.status}: ${body}` });
            return;
        }
        res.json({ success: true, message: 'Sync command sent.' });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Sync failed.' });
    }
});
apiRouter.post('/devices/:id/reboot', async (req, res) => {
    try {
        const token = requireWriteToken(req, res);
        if (!token)
            return;
        const graphRes = await fetch(`https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${req.params.id}/rebootNow`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' }
        });
        if (!graphRes.ok && graphRes.status !== 204) {
            const body = await graphRes.text().catch(() => '');
            res.status(graphRes.status).json({ success: false, message: `Graph error ${graphRes.status}: ${body}` });
            return;
        }
        res.json({ success: true, message: 'Reboot command sent.' });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Reboot failed.' });
    }
});
apiRouter.post('/devices/:id/autopilotReset', async (req, res) => {
    try {
        const token = requireWriteToken(req, res);
        if (!token)
            return;
        const graphRes = await fetch(`https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${req.params.id}/windowsAutopilotReset`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' }
        });
        if (!graphRes.ok && graphRes.status !== 204) {
            const body = await graphRes.text().catch(() => '');
            res.status(graphRes.status).json({ success: false, message: `Graph error ${graphRes.status}: ${body}` });
            return;
        }
        res.json({ success: true, message: 'Autopilot Reset command sent.' });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Autopilot Reset failed.' });
    }
});
apiRouter.post('/devices/bulk', async (req, res) => {
    const { deviceIds, action } = req.body;
    if (!Array.isArray(deviceIds) || !action) {
        res.status(400).json({ success: false, message: 'Missing deviceIds or action.' });
        return;
    }
    const token = requireWriteToken(req, res);
    if (!token)
        return;
    const actionMap = {
        sync: 'syncDevice', reboot: 'rebootNow', autopilotReset: 'windowsAutopilotReset'
    };
    const results = await Promise.allSettled(deviceIds.map(id => fetch(`https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${id}/${actionMap[action]}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' }
    }).then(r => ({ id, ok: r.ok || r.status === 204 }))
        .catch((e) => ({ id, ok: false, error: e?.message ?? 'Failed' }))));
    const mapped = results.map(r => r.status === 'fulfilled' ? r.value : { id: '', ok: false, error: 'Promise rejected' });
    res.json({ success: true, results: mapped });
});
export default apiRouter;
//# sourceMappingURL=api.js.map