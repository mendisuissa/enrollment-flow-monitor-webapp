export type ViewName =
  | 'dashboard'
  | 'windowsAutopilot'
  | 'autopilotUserDriven'
  | 'autopilotPreProvisioning'
  | 'windowsEnrollment'
  | 'linuxEnrollment'
  | 'mobileEnrollment'
  | 'macEnrollment'
  | 'ocr'
  | 'incidents'
  | 'settings'
  | 'permissionCheck'
  | 'enrollmentErrorCatalog'
  | 'reports'
  | 'readinessChecklist';

export interface AuthStatus {
  connected: boolean;
  upn: string;
  tenantId: string;
  displayName: string;
}

export interface FailureExplanation {
  normalizedCategory: string;
  cause: string;
  confidence: number;
  recommendedActions: string[];
  evidence: {
    lastReportedDateTime: string;
    errorCode: string;
    errorDescription: string;
  };
}

export interface ManagedDevice {
  id: string;
  deviceName: string;
  operatingSystem: string;
  osVersion: string;
  complianceState: string;
  lastSyncDateTime: string;
  userDisplayName: string;
  userPrincipalName: string;
  serialNumber?: string;
  joinType?: string;
  deviceEnrollmentType?: string;
}

export interface UserRow {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail: string;
}

export interface MobileApp {
  id: string;
  displayName: string;
  publisher: string;
  platform: string;
  lastModifiedDateTime: string;
}

export interface AppStatusRow {
  id: string;
  appId: string;
  appName: string;
  targetType: 'device' | 'user';
  targetId: string;
  targetName: string;
  installState: string;
  errorCode: string;
  errorDescription: string;
  lastReportedDateTime: string;
  normalizedCategory: string;
  cause: string;
  confidence: number;
  recommendedActions: string[];
}

export type IncidentSeverity = 'Low' | 'Medium' | 'High';

export interface IncidentRow {
  id: string;
  signature: string;
  appId: string;
  appName: string;
  normalizedCategory: string;
  errorCode: string;
  impactedCount: number;
  firstSeen: string;
  lastSeen: string;
  severity: IncidentSeverity;
  isPlaceholder?: boolean;
  summary: string;
}

export interface DashboardData {
  totalDevices: number;
  windowsEnrollmentDevices: number;
  linuxEnrollmentDevices: number;
  autopilotUserDrivenDevices: number;
  autopilotAutomaticDevices: number;
  mobileEnrollmentDevices: number;
  macEnrollmentDevices: number;
  topEnrollmentStates: Array<{ category: string; count: number }>;
  lastRefresh: string;
}


export interface EnrollmentErrorRow {
  id: string;
  area: string;
  errorCode: string;
  title: string;
  symptoms: string;
  likelyRootCause: string;
  remediation: string;
  severity: 'Low' | 'Medium' | 'High';
}


export interface GridPayload<T = Record<string, unknown>> {
  rows: T[];
  message: string;
}

export interface NormalizationRule {
  id: string;
  enabled: boolean;
  failureCategory: string;
  confidence: number;
  cause: string;
  anyMatches: string[];
  recommendedActions: string[];
}

export interface SeverityThresholds {
  Low: number;
  Medium: number;
  High: number;
}

export function getSeverity(count: number, thresholds: SeverityThresholds): IncidentSeverity {
  if (count >= thresholds.High) return 'High';
  if (count >= thresholds.Medium) return 'Medium';
  return 'Low';
}
export interface SettingsData {
  incidentWindowMinutes: number;
  incidentThresholdCount: number;
  severityThresholds: SeverityThresholds;
  refreshIntervalSeconds: number;
  mockMode: boolean;
}

// ── macOS Enrollment ──────────────────────────────────────────────────────────
export interface MacDeviceRow {
  id: string;
  deviceName: string;
  osVersion: string;
  enrollmentType: string;   // 'ADE' | 'UserEnrollment' | 'Unknown'
  supervised: boolean;
  userApproved: boolean;
  complianceState: string;
  lastSyncDateTime: string;
  userPrincipalName: string;
  serialNumber: string;
  details: string;
}

// ── Reports ───────────────────────────────────────────────────────────────────
export interface PlatformBreakdown {
  platform: string;
  count: number;
  compliant: number;
  nonCompliant: number;
}

export interface TopErrorEntry {
  errorCode: string;
  title: string;
  count: number;
  severity: 'High' | 'Medium' | 'Low';
}

export interface HealthScore {
  platform: string;
  score: number;          // 0-100
  trend: 'up' | 'down' | 'stable';
  enrolled: number;
  compliant: number;
  total: number;
}

export interface ReportData {
  generatedAt: string;
  tenantId: string;
  tenantUpn: string;
  totalDevices: number;
  overallComplianceRate: number;   // 0-100
  activeIncidents: number;
  platformBreakdown: PlatformBreakdown[];
  topErrors: TopErrorEntry[];
  healthScores: HealthScore[];
  enrollmentTrend: Array<{ date: string; count: number }>;
}

// ── Readiness Checklist ───────────────────────────────────────────────────────
export type ChecklistScenario = 'autopilot' | 'ade-ios' | 'ade-macos' | 'android-enterprise';
export type ChecklistStatus = 'pass' | 'warn' | 'fail' | 'manual';

export interface ChecklistItem {
  id: string;
  category: string;
  label: string;
  description: string;
  status: ChecklistStatus;
  detail: string;
  docUrl: string;
}

