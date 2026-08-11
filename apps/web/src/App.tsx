import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { IncidentWorkflowRecord, IncidentWorkflowStatus, ViewName } from '@efm/shared';
type ExtendedViewName = ViewName | 'auditLogs' | 'privacy' | 'home' | 'adminDashboard' | 'graphQuery' | 'enrollmentFailures' | 'enrollmentPolicy' | 'complianceDrift';
import { api, copyRunbook, getAuthStatus, getLogs, getView, refreshData, deviceSync, deviceReboot, deviceAutopilotReset, deviceBulkAction, deviceRetire, deviceWipe, deviceCollectDiagnostics, deviceRotateBitLockerKeys, deviceResetPasscode, getExportUrl, getIncidentWorkflows, saveIncidentWorkflow } from './api/client.js';
import { recognize } from 'tesseract.js';
import SupervisorWidget from './SupervisorWidget.js';

type Row = Record<string, unknown>;
type ThemePreference = 'system' | 'light' | 'dark';
type Toast = { id: number; kind: 'info' | 'success' | 'error'; message: string };

type SavedViewConfig = {
  id: string;
  name: string;
  view: ExtendedViewName;
  search: string;
  filters: string[];
};

const SAVED_VIEW_STORAGE_KEY = 'efm-saved-views-v1';

// ── Trial banner ────────────────────────────────────────────────────────────
const TRIAL_STORAGE_KEY   = 'efm-trial-start-v1';
const TRIAL_DAYS_TOTAL    = 30;
const TRIAL_EXEMPT_EMAILS = ['menahem@365-poc.com', 'menahem@modernendpoint.tech'];
function getTrialDaysLeft(upn: string): number {
  if (TRIAL_EXEMPT_EMAILS.includes(upn.toLowerCase())) return Infinity;
  try {
    let stored = window.localStorage.getItem(TRIAL_STORAGE_KEY);
    if (!stored) { stored = Date.now().toString(); window.localStorage.setItem(TRIAL_STORAGE_KEY, stored); }
    const elapsed = Math.floor((Date.now() - parseInt(stored)) / 86_400_000);
    return Math.max(0, TRIAL_DAYS_TOTAL - elapsed);
  } catch { return TRIAL_DAYS_TOTAL; }
}
// ────────────────────────────────────────────────────────────────────────────


const DEVICE_FILTER_CHIPS = [
  { id: 'non-compliant', label: '⚠️ Non-Compliant', color: 'red' },
  { id: 'stale', label: '🕒 Stale Sync', color: 'amber' },
  { id: 'windows', label: '🪟 Windows Only', color: 'blue' },
  { id: 'unknown-user', label: '👤 Unknown User', color: 'purple' },
  { id: 'errors', label: '❌ Errors Only', color: 'red' }
] as const;

const INCIDENT_FILTER_CHIPS = [
  { id: 'p1', label: '🔥 P1', color: 'red' },
  { id: 'critical', label: '🚨 Critical', color: 'red' },
  { id: 'investigating', label: '🧭 Investigating', color: 'blue' },
  { id: 'unassigned', label: '🪪 Unassigned', color: 'amber' },
  { id: 'no-notes', label: '📝 No Notes', color: 'purple' },
  { id: 'resolved', label: '✅ Resolved', color: 'green' }
] as const;

const views: Array<{ id: ExtendedViewName; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Command Center', icon: '🎛️' },
  { id: 'windowsEnrollment', label: 'Windows Enrollment', icon: '🪟' },
  { id: 'linuxEnrollment', label: 'Linux Enrollment', icon: '🐧' },
  { id: 'mobileEnrollment', label: 'Mobile Enrollment', icon: '📱' },
  { id: 'macEnrollment', label: 'macOS Enrollment', icon: '🍎' },
  { id: 'ocr', label: 'OCR', icon: '🧠' },
  { id: 'incidents', label: 'Fix Queue', icon: '🚨' },
  { id: 'enrollmentFailures', label: 'Enrollment Failures', icon: '⛔' },
  { id: 'enrollmentPolicy', label: 'Enrollment Policy', icon: '🛡️' },
  { id: 'complianceDrift', label: 'Compliance Drift', icon: '📉' },
  { id: 'permissionCheck', label: 'Access Validation', icon: '🔑' },
  { id: 'enrollmentErrorCatalog', label: 'Failure Catalog', icon: '📚' },
  { id: 'reports', label: 'Executive Reports', icon: '📈' },
  { id: 'readinessChecklist', label: 'Readiness Risks', icon: '✅' },
  { id: 'auditLogs', label: 'Audit Trail', icon: '📋' },
  { id: 'graphQuery', label: 'Graph Explorer', icon: '⚡' },
];

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}


function isLikelyIsoDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.trim());
}

// ── Failure Catalog (module-level constant – not recreated per render) ──────
const ERROR_CATALOG = [
  {
    code: '0x80180014', title: 'MDM enrollment not allowed',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'The user account is not licensed or the MDM authority is not configured to allow enrollment.',
    cause: 'Missing Intune license, or MDM enrollment restricted by Conditional Access or Enrollment Restrictions policy.',
    actions: ['Assign an Intune/EMS license to the user in Entra ID admin center.', 'Check Enrollment Restrictions: Devices > Enrollment restrictions — ensure the platform is allowed.', 'Verify MDM User Scope in Entra ID > Mobility: set to "All" or add the user to the included group.', 'Check Conditional Access policies blocking device compliance registration.']
  },
  {
    code: '0x80180026', title: 'Enrollment failed – hybrid join required',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'The device is domain-joined and requires Hybrid Azure AD Join rather than direct MDM enrollment.',
    cause: 'Group Policy or registry is configured to require Hybrid AADJ before MDM enrollment.',
    actions: ['Verify Azure AD Connect is configured with Hybrid Azure AD Join.', 'Check GPO: Computer Config > Admin Templates > Windows Components > MDM — ensure "Automatic MDM enrollment" is enabled.', 'Run dsregcmd /status to verify AzureAdJoined and DomainJoined state.', 'Ensure the device SCP (Service Connection Point) is configured in Active Directory.']
  },
  {
    code: '0x80070774', title: 'Autopilot profile not assigned',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/autopilot/troubleshoot-oobe',
    description: 'Windows Autopilot cannot find a deployment profile assigned to the device.',
    cause: 'The device hardware hash is not registered in Autopilot, or no profile is assigned to the device/group.',
    actions: ['Verify the device appears in Devices > Windows > Windows Enrollment > Devices (Windows Autopilot devices).', 'Check that an Autopilot profile is assigned to the device or its group.', 'Re-upload hardware hash if hardware was recently replaced.', 'Wait up to 15 minutes for profile assignment to sync after upload.', 'Trigger sync: run Get-AutopilotProfile in PowerShell with WindowsAutopilotIntune module.']
  },
  {
    code: '80180003', title: 'Terms of Use not accepted',
    severity: 'medium', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-device-enrollment-in-intune',
    description: 'Enrollment is blocked because the user has not accepted the required Terms of Use policy.',
    cause: 'A Terms of Use Conditional Access policy is enforced and the user has not yet consented.',
    actions: ['Direct user to https://myapps.microsoft.com and accept Terms of Use.', 'Check Entra ID > Security > Conditional Access > Terms of Use — verify policy scope.', 'Ensure the user is included in the Terms of Use assignment.', 'Have user sign in to Company Portal and accept terms when prompted.']
  },
  {
    code: '0x80CF0437', title: 'Clock not synchronized',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'Certificate validation fails because the device clock is not synchronized with the time server.',
    cause: 'More than 5 minutes time skew between device and Azure AD / Intune servers.',
    actions: ['Run: w32tm /resync in an elevated command prompt.', 'Ensure Windows Time service is running: sc query w32tm.', 'Set NTP server via GPO: Computer Config > Admin Templates > System > Windows Time Service.', 'Verify firewall allows UDP port 123 to time.windows.com.']
  },
  {
    code: '0x87D101F4', title: 'Device limit reached',
    severity: 'medium', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/enrollment-restrictions-set',
    description: 'The user has reached the maximum number of enrolled devices allowed by the enrollment restriction.',
    cause: 'Default or custom Enrollment Restriction policy limits devices per user.',
    actions: ['Check current limit: Devices > Enrollment restrictions > Device limit restrictions.', 'Increase device limit for the user group (max 15 per user).', 'Have user remote-wipe or unenroll an old device from Company Portal.', 'Admin can delete stale device records from Devices > All devices.']
  },
  {
    code: '0x80180005', title: 'User not authorized for enrollment',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-device-enrollment-in-intune',
    description: 'The user is not included in the MDM user scope or has been explicitly excluded.',
    cause: 'Entra ID Mobility settings have MDM user scope set to "Some" and the user is not in the included group.',
    actions: ['Go to Entra ID > Mobility (MDM and WIP) > Microsoft Intune.', 'Set MDM User Scope to "All" or add the user to the MDM user scope group.', 'Verify the user is not in an exclusion group.', 'Allow 10-15 minutes for policy propagation after changes.']
  },
  {
    code: '0x80090016', title: 'Certificate enrollment failed',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/protect/certificates-scep-configure',
    description: 'PKCS or SCEP certificate deployment failed during enrollment or compliance check.',
    cause: 'NDES connector misconfiguration, expired CA certificate, or network connectivity to NDES server.',
    actions: ['Check NDES connector status in Tenant administration > Connectors and tokens > Certificate connectors.', 'Verify the NDES service account has proper permissions on the CA.', 'Test NDES URL accessibility from device: https://<ndes-server>/certsrv/mscep/mscep.dll.', 'Review NDES connector logs: C:\\Program Files\\Microsoft Intune\\NDESConnectorUI\\Logs.', 'Ensure CA root certificate is trusted on the device.']
  },
  {
    code: '80180001', title: 'OS version not supported',
    severity: 'medium', platforms: ['Windows', 'Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/enrollment-restrictions-set',
    description: 'The device OS version is below the minimum required by the Enrollment Restriction policy.',
    cause: 'Enrollment Restriction policy has minimum OS version set and device does not meet it.',
    actions: ['Check Devices > Enrollment restrictions > Platform restrictions — review minimum OS version.', 'Update device OS to meet the minimum requirement.', 'Consider adjusting the minimum version in the restriction policy if business needs allow.', 'For Android: verify the device is not in the blocked manufacturer list.']
  },
  {
    code: '0x80192EE7', title: 'Network connection failed during enrollment',
    severity: 'medium', platforms: ['Windows', 'iOS', 'Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/fundamentals/intune-endpoints',
    description: 'The device cannot reach Intune enrollment endpoints during the enrollment process.',
    cause: 'Proxy, firewall, or DNS blocking required Microsoft endpoints.',
    actions: ['Verify the device can reach: *.manage.microsoft.com, *.microsoftonline.com, login.microsoftonline.com.', 'Check proxy settings and bypass list for Intune endpoints.', 'Review firewall rules — ensure TCP 443 is open to Intune URLs.', 'Test DNS resolution for manage.microsoft.com from the device.', 'Reference: Microsoft Intune network endpoints documentation.']
  },
  {
    code: '0x80070057', title: 'Invalid parameter during enrollment',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'An invalid configuration parameter was sent during the MDM enrollment handshake.',
    cause: 'Corrupted local MDM registry entries or a previous partial enrollment left stale state.',
    actions: ['Run: MdmDiagnosticsTool.exe -area DeviceEnrollment -zip C:\\Temp\\mdm.zip to collect logs.', 'Delete stale MDM enrollment keys: HKLM\\SOFTWARE\\Microsoft\\Enrollments (remove non-AAD entries).', 'Run dsregcmd /leave then re-attempt Azure AD Join.', 'Ensure no third-party MDM client is interfering.']
  },
  {
    code: '0x80CF0014', title: 'Company Portal not updated',
    severity: 'low', platforms: ['Windows', 'Android', 'iOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/user-help/install-apps-cpapp-windows',
    description: 'Enrollment or management action failed because the Company Portal app is outdated.',
    cause: 'An older version of Company Portal is installed that does not support the required enrollment flow.',
    actions: ['Update Company Portal from the Microsoft Store (Windows) or App Store/Google Play.', 'For corporate-owned devices: update the Company Portal app via Intune app deployment.', 'Verify the latest Company Portal version in Intune: Apps > All apps > Company Portal.']
  },
  {
    code: '80180018', title: 'Device enrolled with different identity',
    severity: 'medium', platforms: ['iOS', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-ios-enrollment-errors',
    description: 'The device was previously enrolled with a different Apple ID or MDM server and was not properly unenrolled.',
    cause: 'Residual MDM profile from a previous enrollment. Common after DEP re-assignment.',
    actions: ['Remove existing MDM profile: Settings > General > VPN & Device Management > remove old profile.', 'For DEP devices: re-assign the device in Apple Business Manager and sync to Intune.', 'Wipe and re-enroll the device if manual profile removal is not possible.', 'Verify the device serial is released from previous MDM in Apple Business Manager.']
  },
  {
    code: 'AADSTS50105', title: 'User not assigned to application',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal',
    description: 'The user attempting to sign in to Company Portal or enroll is not assigned to the Microsoft Intune application in Entra ID.',
    cause: 'The enterprise application "Microsoft Intune" has user assignment required, and the user is not assigned.',
    actions: ['Go to Entra ID > Enterprise applications > Microsoft Intune > Users and groups.', 'Add the user or their group to the application assignment.', 'Alternatively, set "Assignment required" to No if open access is desired.', 'Allow 5-10 minutes for the change to propagate.']
  },
  {
    code: '0x80072EE6', title: 'Enrollment URL not reachable',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/windows-enrollment-create-cname',
    description: 'The enrollment discovery URL cannot be resolved or reached by the device.',
    cause: 'DNS CNAME record for enterprise enrollment (EnterpriseEnrollment.<domain>) is missing or incorrect.',
    actions: ['Create CNAME: EnterpriseEnrollment.<yourdomain.com> → EnterpriseEnrollment.manage.microsoft.com.', 'Also create: EnterpriseRegistration.<yourdomain.com> → EnterpriseRegistration.windows.net.', 'Verify with nslookup EnterpriseEnrollment.<yourdomain.com>.', 'Allow DNS propagation time (up to 24-48 hours for external DNS).']
  },
  {
    code: '0x80180025', title: 'Enrollment blocked by Conditional Access',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/protect/conditional-access-intune-common-ways-use',
    description: 'A Conditional Access policy is blocking the device from enrolling or registering with Azure AD.',
    cause: 'CA policy requires compliant or hybrid-joined device, but device has not yet enrolled, creating a chicken-and-egg situation.',
    actions: ['Temporarily exclude the user from the CA policy during initial enrollment.', 'Use Autopilot or a bulk enrollment token to pre-provision devices before applying CA.', 'Check Entra ID Sign-in logs for the specific CA policy that is blocking.', 'Enable "Require device to be marked as compliant" only after initial enrollment completes.']
  },
  {
    code: '0x8007064C', title: 'Autopilot – device already registered',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/autopilot/troubleshoot-device-enrollment',
    description: 'The device hardware hash is already registered in Windows Autopilot under a different tenant.',
    cause: 'Device was previously registered in another organization\'s Autopilot tenant and not deregistered.',
    actions: ['Previous owner must deregister the device in their Autopilot portal.', 'If device was purchased new: contact the OEM or reseller to clear the registration.', 'Use Get-WindowsAutoPilotInfo to verify the hardware hash.', 'File a support request with Microsoft if the previous tenant cannot be reached.']
  },
  {
    code: '0x80180028', title: 'Account not found in directory',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-device-enrollment-in-intune',
    description: 'The user account used for enrollment does not exist in the tenant directory.',
    cause: 'User was deleted, is a guest account, or the UPN domain is not verified in the tenant.',
    actions: ['Verify the user account exists in Entra ID > Users > All users.', 'Ensure the UPN domain suffix matches a verified domain in Entra ID > Custom domain names.', 'For guest users: guest accounts cannot enroll devices — a member account is required.', 'Re-create the user account if it was accidentally deleted.']
  },
  {
    code: '0x80180035', title: 'Enrollment profile not found (ADE/DEP)',
    severity: 'high', platforms: ['iOS', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/device-enrollment-program-enroll-ios',
    description: 'Apple Device Enrollment (ADE/DEP) cannot find an enrollment profile to assign to the device.',
    cause: 'The device serial number is not synced from Apple Business Manager, or no ADE profile is assigned.',
    actions: ['Sync Apple Business Manager in Intune: Devices > iOS/iPadOS > iOS enrollment > Enrollment program tokens > Sync.', 'Verify the device serial appears in Intune after sync (can take up to 24 hours).', 'Assign an ADE enrollment profile to the device or its device group.', 'Ensure the token used in Intune matches the one in Apple Business Manager.']
  },
  {
    code: 'AADSTS700016', title: 'Application not found in tenant',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes',
    description: 'The Microsoft Intune or Company Portal application cannot be found in the tenant.',
    cause: 'The enterprise application was deleted or was never consented to in the tenant.',
    actions: ['Go to Entra ID > Enterprise applications — search for Microsoft Intune and Company Portal.', 'If missing: use the Microsoft 365 Admin Center to re-consent or re-add the application.', 'Run: Connect-MgGraph; Get-MgServicePrincipal -Filter "displayName eq \'Microsoft Intune\'" to verify via PowerShell.', 'Contact Microsoft Support if the application cannot be restored.']
  },
  {
    code: '0x87D13B8E', title: 'Policy application failed – app configuration',
    severity: 'medium', platforms: ['iOS', 'Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/apps/app-configuration-policies-overview',
    description: 'An app configuration policy failed to apply to the device after enrollment.',
    cause: 'Incorrect bundle ID in the policy, managed app not installed, or the policy targets a wrong group.',
    actions: ['Verify the app bundle ID in the configuration policy matches the actual app bundle ID.', 'Ensure the target app is deployed and installed on the device via Intune.', 'Check the policy assignment — ensure the user or device group is correctly targeted.', 'Review Intune device diagnostics: Devices > All devices > [device] > Monitor > App configuration status.']
  },
  {
    code: '0x80CF0022', title: 'Service temporarily unavailable',
    severity: 'low', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://status.azure.com',
    description: 'Intune service returned a temporary error (503 / service unavailable) during enrollment or policy sync.',
    cause: 'Azure/Intune service degradation or scheduled maintenance window.',
    actions: ['Check Azure Service Health: https://status.azure.com for Intune/Endpoint Manager status.', 'Wait 15-30 minutes and retry enrollment.', 'Check the Microsoft 365 Admin Center > Health > Service health for active incidents.', 'If problem persists >1 hour, open a support ticket with Microsoft.']
  },
  {
    code: '80090030', title: 'TPM required but not available',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/oem-bitlocker',
    description: 'Windows enrollment or compliance policy requires TPM 2.0, but the device does not have a compatible TPM.',
    cause: 'Device lacks TPM 2.0, TPM is disabled in BIOS/UEFI, or firmware TPM is not enabled.',
    actions: ['Check TPM status: run tpm.msc and verify TPM 2.0 is present and ready.', 'Enable TPM in BIOS/UEFI settings if it is disabled.', 'For VMs: ensure the hypervisor supports vTPM (Hyper-V Gen 2 with security settings).', 'Review Intune compliance policy — adjust "Require TPM" if virtual machines must be supported.']
  },
  {
    code: '0x80040154', title: 'MDM agent COM class not registered',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'The MDM enrollment agent COM class is not registered on the device, preventing enrollment.',
    cause: 'Corrupted Windows image, missing MDM DLLs, or the Enrollment service was disabled.',
    actions: ['Run: sfc /scannow in an elevated command prompt to repair system files.', 'Run: DISM /Online /Cleanup-Image /RestoreHealth.', 'Verify the DeviceEnroller service is running: Get-Service -Name DeviceEnroller.', 'If system files are irreparably corrupted, consider re-imaging the device.']
  },
  {
    code: '0x8018002A', title: 'Enrollment blocked – platform restriction',
    severity: 'medium', platforms: ['Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/enrollment-restrictions-set',
    description: 'Android enrollment is blocked by the platform restriction policy in Intune.',
    cause: 'The Enrollment Restriction policy blocks Android (or a specific Android enrollment type such as BYOD work profile).',
    actions: ['Check Devices > Enrollment restrictions > Device type restrictions.', 'Ensure Android Enterprise (work profile, fully managed, or dedicated device) is set to Allow.', 'Verify the user is assigned the correct restriction profile (check priority order).', 'For personal devices: ensure BYOD work profile enrollment is permitted.']
  },
  {
    code: '0x80180024', title: 'Intune subscription expired or not found',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/fundamentals/licenses',
    description: 'The Intune subscription has expired or the tenant does not have an active Intune license.',
    cause: 'Trial period expired, licenses were removed, or billing issue with the Microsoft subscription.',
    actions: ['Check subscription status in Microsoft 365 Admin Center > Billing > Subscriptions.', 'Assign Intune or Microsoft 365 E3/E5 licenses to users.', 'Verify the MDM authority is set to Intune: Tenant administration > Tenant status.', 'Contact Microsoft billing support if subscription renewal is required.']
  },
  {
    code: '0x800700B7', title: 'Configuration already exists',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'A conflicting MDM enrollment configuration already exists on the device.',
    cause: 'Previous MDM enrollment (SCCM co-management, another MDM) was not cleanly removed before re-enrolling.',
    actions: ['Run dsregcmd /leave to remove existing Azure AD join / MDM enrollment.', 'Check HKLM\\SOFTWARE\\Microsoft\\Enrollments registry for stale entries and remove them.', 'If co-managed with SCCM: ensure co-management workloads are correctly configured.', 'Re-enroll after confirming the device shows "Not enrolled" in dsregcmd /status.']
  },
  {
    code: '0x80CF0301', title: 'Intune client installation failed',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'The Intune management extension or client failed to install during enrollment.',
    cause: 'Blocked by Group Policy, antivirus, or AppLocker; or Windows Installer service issues.',
    actions: ['Check Windows Installer service is running: Get-Service msiserver.', 'Temporarily disable antivirus to test if it is blocking the installer.', 'Review AppLocker or Windows Defender Application Control policies.', 'Check Intune Management Extension logs: C:\\ProgramData\\Microsoft\\IntuneManagementExtension\\Logs.', 'Ensure .NET Framework 4.x is installed on the device.']
  },
  {
    code: '0x80180036', title: 'Push notification service error (APNs/FCM)',
    severity: 'medium', platforms: ['iOS', 'Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/apple-mdm-push-certificate-get',
    description: 'Intune cannot communicate with the device because the push notification service certificate is invalid or expired.',
    cause: 'Apple MDM Push Certificate (APNs) has expired, or Firebase Cloud Messaging token is invalid.',
    actions: ['For iOS: Check Tenant administration > Apple MDM Push certificate — verify expiry date and renew if needed.', 'APNs certificate must be renewed with the same Apple ID used to create it.', 'After renewal, devices should re-check in automatically within 24 hours.', 'For Android: verify Google Play Services is active on the device and FCM is not blocked by firewall.']
  },
  {
    code: 'MENROLL_E_DEVICENOTSUPPORTED', title: 'Device type not supported',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/troubleshoot-windows-enrollment-errors',
    description: 'The device type or edition of Windows does not support MDM enrollment (e.g. Windows Home edition).',
    cause: 'Windows Home edition does not include MDM enrollment APIs. Only Pro, Enterprise, and Education editions are supported.',
    actions: ['Verify the Windows edition: run winver — Home edition is not supported.', 'Upgrade the device to Windows Pro or Enterprise.', 'For education devices: ensure Windows Education edition is installed.', 'Consider using Intune-enrolled Android or iOS devices as an alternative for Home-edition users.']
  },
  {
    code: '0x87D1313C', title: 'Enrollment status page timeout',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/windows-enrollment-status',
    description: 'The Enrollment Status Page (ESP) timed out while waiting for apps or policies to install.',
    cause: 'Required apps are taking too long to install, large app packages, or slow network during OOBE.',
    actions: ['Increase the ESP timeout: Devices > Windows > Windows Enrollment > Enrollment Status Page > Edit profile > increase timeout value.', 'Reduce the number of apps marked as required during ESP.', 'Ensure required apps are lightweight or use supersedence to only install the latest version.', 'Check Intune Management Extension logs for the specific app blocking ESP.', 'Consider marking non-critical apps as available instead of required during ESP.']
  },
  // ── iOS / macOS / Apple ─────────────────────────────────
  {
    code: '0x87D13B91', title: 'ADE/DEP enrollment failed – profile download',
    severity: 'high', platforms: ['iOS', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/device-enrollment-program-enroll-ios',
    description: 'Automated Device Enrollment (ADE/DEP) fails to download the enrollment profile during Setup Assistant.',
    cause: 'Device not assigned in Apple Business Manager, token expired, or network blocking access to albert.apple.com.',
    actions: ['Verify device is assigned to your MDM server in Apple Business Manager or Apple School Manager.', 'Check the ADE token is not expired: Tenant administration > Apple > Enrollment program tokens.', 'Ensure the device can reach albert.apple.com, gdmf.apple.com on TCP 443.', 'Sync the token: click Sync in Intune portal, wait 15 minutes and retry.', 'If device was previously supervised, erase and re-provision from ABM.']
  },
  {
    code: '0x87D13B92', title: 'APNs certificate mismatch or expired',
    severity: 'high', platforms: ['iOS', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/apple-mdm-push-certificate-get',
    description: 'MDM commands cannot be sent to iOS/macOS devices because the Apple MDM Push Certificate is expired or was renewed with a different Apple ID.',
    cause: 'APNs certificate expired (annual renewal required) or renewed with a wrong Apple ID causing certificate UID mismatch.',
    actions: ['Go to Tenant administration > Connectors and tokens > Apple MDM Push certificate.', 'Renew using the SAME Apple ID that was used to originally create the certificate.', 'Download the CSR from Intune, upload to push.apple.com, download the new .pem and upload back.', 'If wrong Apple ID was used: devices must be re-enrolled after creating a new certificate.', 'Set a calendar reminder 30 days before expiry to avoid outages.']
  },
  {
    code: 'PROFILE_INSTALLATION_FAILED', title: 'iOS configuration profile installation failed',
    severity: 'medium', platforms: ['iOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/configuration/device-profile-troubleshoot',
    description: 'A configuration profile pushed from Intune fails to install on the iOS device.',
    cause: 'Conflicting existing profile, payload not supported on device OS version, or supervised-only settings pushed to unsupervised device.',
    actions: ['Check the device OS version meets the minimum requirement for the payload.', 'Verify supervised-only settings are not being pushed to unsupervised (BYOD) devices.', 'Remove conflicting profiles manually and retry.', 'Review Intune device configuration profile status under Devices > iOS/iPadOS > Configuration profiles.', 'Check device logs: Settings > Privacy & Security > VPN & Device Management > profile details.']
  },
  {
    code: '0x87D1041C', title: 'Device compliance policy not applied (iOS)',
    severity: 'medium', platforms: ['iOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-create-ios',
    description: 'iOS device shows as non-compliant even after enrollment and policy assignment.',
    cause: 'Compliance policy evaluation has not completed, jailbreak detection triggered, or OS version below minimum.',
    actions: ['Wait up to 8 hours for the initial compliance evaluation cycle.', 'Force a sync: Company Portal app > tap device > Check status.', 'Verify the device OS version meets the minimum version in the compliance policy.', 'Check if jailbreak detection is blocking compliance — the device may be jailbroken.', 'Review Intune compliance reports: Devices > Compliance policies > select policy > Device status.']
  },
  // ── Android ─────────────────────────────────────────────
  {
    code: '0x87D13B93', title: 'Android Enterprise enrollment – work profile failed',
    severity: 'high', platforms: ['Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/android-work-profile-enroll',
    description: 'Android Enterprise Work Profile enrollment fails during Company Portal setup.',
    cause: 'Google Play Services outdated, device not certified by Google (uncertified ROM), or managed Google Play account issue.',
    actions: ['Ensure Google Play Services is updated to the latest version on the device.', 'Verify the device is Google Play Protect certified (Settings > Security > Play Protect).', 'Check that the Managed Google Play enterprise account is linked: Tenant administration > Android > Managed Google Play.', 'If device is a custom/enterprise ROM, ensure it passes GMS certification.', 'Try re-enrolling after clearing Company Portal app data and cache.']
  },
  {
    code: 'ANDROID_MANAGEMENT_0x3', title: 'Android Fully Managed enrollment – DPC not set',
    severity: 'high', platforms: ['Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/android-fully-managed-enroll',
    description: 'Android fully managed (COBO) enrollment fails because the Device Policy Controller was not set during factory reset provisioning.',
    cause: 'QR code / NFC token not scanned during initial setup, device went through normal setup flow instead of provisioning mode.',
    actions: ['Factory reset the device and immediately scan the QR code or NFC token during "Welcome" screen.', 'Do not tap through the standard setup wizard — provisioning must happen at first boot.', 'Ensure the enrollment token has not expired (tokens are valid for 90 days by default).', 'For NFC: hold devices back-to-back within 1cm and tap the NFC tag immediately at boot.', 'Verify zero-touch enrollment (if applicable) is configured with the correct configuration JSON.']
  },
  {
    code: '0x8018002B', title: 'Android device admin enrollment blocked',
    severity: 'medium', platforms: ['Android'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/enrollment-restrictions-set',
    description: 'Legacy Android device administrator enrollment is blocked by enrollment restrictions.',
    cause: 'Google deprecated device administrator APIs and Intune now blocks DA enrollment by default. Only Android Enterprise is supported.',
    actions: ['Migrate devices to Android Enterprise: work profile for BYOD, fully managed or dedicated for corporate.', 'If legacy DA must temporarily remain, enable it in Devices > Enrollment restrictions > Device type restrictions > Android.', 'Plan migration using the Android Enterprise Migration Blitz guidance from Microsoft.', 'Communicate timeline to end users to update Company Portal and re-enroll via Android Enterprise.']
  },
  // ── Windows – Autopilot & Hybrid ────────────────────────
  {
    code: '0x80070490', title: 'Autopilot – element not found (hardware hash)',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/autopilot/troubleshooting-faq',
    description: 'Autopilot registration fails because the hardware hash could not be collected or matched.',
    cause: 'BIOS/UEFI firmware is outdated, Secure Boot is disabled, or the hardware hash was captured incorrectly.',
    actions: ['Update device firmware/BIOS to the latest version from the manufacturer.', 'Enable Secure Boot and TPM 2.0 in UEFI settings.', 'Re-capture the hardware hash: Install-Script -Name Get-WindowsAutoPilotInfo, then run Get-WindowsAutoPilotInfo -OutputFile hash.csv.', 'Import the corrected CSV into Intune: Devices > Windows > Windows Enrollment > Devices > Import.', 'Wait up to 24 hours after import before attempting enrollment.']
  },
  {
    code: '0x801c0003', title: 'Azure AD join failed – user not authorized',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/azure/active-directory/devices/troubleshoot-hybrid-join-windows-current',
    description: 'Device cannot join Azure AD during Autopilot or manual AADJ enrollment because the user is not permitted to join devices.',
    cause: 'The Azure AD "Users may join devices to Azure AD" setting is restricted, or the user has reached the device join limit.',
    actions: ['Check Azure AD > Devices > Device settings > Users may join devices to Azure AD — set to All or the target group.', 'Check maximum number of devices per user setting and increase if needed.', 'Verify the user has a valid Intune/AAD P1 license assigned.', 'For Autopilot: assign the user to the Autopilot deployment profile.', 'Review Azure AD audit logs for the specific rejection reason.']
  },
  {
    code: '0x80180017', title: 'Hybrid Azure AD join – SCP not configured',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/azure/active-directory/devices/hybrid-azuread-join-plan',
    description: 'Hybrid Azure AD Join fails because the Service Connection Point (SCP) is not configured in on-premises AD.',
    cause: 'Azure AD Connect has not configured the SCP, or the SCP is pointing to the wrong tenant.',
    actions: ['Run Azure AD Connect and ensure the Hybrid Azure AD join option is enabled.', 'Verify SCP exists: CN=62a0ff2e-97b9-4513-943f-0d221bd30080,CN=Device Registration Configuration,CN=Services in AD Sites & Services.', 'Check the SCP tenant name matches your Azure AD tenant: Get-ADObject -Filter {objectClass -eq "serviceConnectionPoint"} -Properties *', 'Ensure Domain Controllers have line-of-sight to login.microsoftonline.com and enterpriseregistration.windows.net.', 'Run dsregcmd /status and review the AzureAdJoined and DomainJoined fields.']
  },
  {
    code: '0x80092013', title: 'Certificate revocation check failed',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/protect/certificates-configure',
    description: 'Certificate-based enrollment or SCEP/PKCS certificate deployment fails because CRL/OCSP check is unreachable.',
    cause: 'Device cannot reach the CRL distribution point or OCSP responder URL, typically due to network/proxy restrictions.',
    actions: ['Identify the CRL URL from the certificate: certutil -URL <cert_file>.', 'Ensure the device can reach the CRL URL on port 80 (HTTP) — CRL checks typically use HTTP not HTTPS.', 'If behind a proxy, add CRL/OCSP URLs to proxy bypass list.', 'For NDES/SCEP: verify the NDES server is accessible from the device network segment.', 'Test CRL connectivity: certutil -verify -urlfetch <cert_file>.']
  },
  // ── Co-management & ConfigMgr ────────────────────────────
  {
    code: '0x87D10D4C', title: 'Co-management enrollment conflict',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/configmgr/comanage/overview',
    description: 'Device enrolled in both SCCM/ConfigMgr and Intune shows workload conflicts or duplicate policies.',
    cause: 'Co-management workloads not properly configured, or device switched MDM authority without clean re-enrollment.',
    actions: ['Review co-management workload slider in ConfigMgr: Administration > Cloud Services > Co-management.', 'Decide which workloads (Compliance, Resource Access, Client Apps, etc.) should be managed by Intune vs ConfigMgr.', 'Do not assign the same policy type from both tools to avoid conflicts.', 'Check device co-management status in ConfigMgr console: Monitoring > Co-management.', 'For full Intune management: complete the transition by switching all workloads to Intune and retiring from ConfigMgr.']
  },
  // ── Intune Management Extension ──────────────────────────
  {
    code: 'IME_0x87D10196', title: 'Intune Management Extension – script execution failed',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/apps/powershell-scripts-win32',
    description: 'A PowerShell script deployed via Intune Management Extension fails to execute.',
    cause: 'Script execution policy blocking, 32-bit vs 64-bit PowerShell mismatch, or the script contains syntax errors.',
    actions: ['Check IME logs at C:\\ProgramData\\Microsoft\\IntuneManagementExtension\\Logs\\IntuneManagementExtension.log.', 'Verify "Run this script using the logged on credentials" vs SYSTEM account is set correctly for the script.', 'Ensure the script is signed or the execution policy allows unsigned scripts in the Intune portal setting.', 'Test the script manually in the appropriate context (SYSTEM vs user) using PsExec.', 'Check script for 32-bit vs 64-bit issues if "Run script in 64-bit PowerShell host" is not enabled.']
  },
  {
    code: 'IME_WIN32_0x8007010B', title: 'Win32 app – directory not found during install',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/apps/apps-win32-app-management',
    description: 'Win32 app deployed via Intune fails with directory not found error during installation.',
    cause: 'The .intunewin package references a path that does not exist on the target device, or the content extraction failed.',
    actions: ['Verify the .intunewin file was created with the correct source folder and setup file.', 'Check IME logs for the exact path causing the failure.', 'Ensure installation runs with SYSTEM account if the path requires elevated access.', 'Re-package the application with the Intune Win32 Content Prep tool if extraction may be corrupted.', 'Review detection rules — if the app is already installed, detection should return success.']
  },
  // ── Compliance & Conditional Access ─────────────────────
  {
    code: 'CAE_53003', title: 'Conditional Access – device compliance required',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/azure/active-directory/conditional-access/require-managed-devices',
    description: 'User is blocked from accessing a resource because Conditional Access requires a compliant device, but the device is not compliant or not enrolled.',
    cause: 'Device is not enrolled in Intune, compliance policy has not yet evaluated, or a compliance setting is failing (e.g., BitLocker, OS version).',
    actions: ['Enroll the device in Intune via Company Portal or Settings > Accounts > Access work or school.', 'After enrollment, wait up to 15 minutes for compliance evaluation to complete.', 'Check device compliance status in Company Portal app — it will show which setting is failing.', 'Remediate failing compliance settings (e.g., enable BitLocker, update OS, set PIN).', 'If compliant but still blocked, trigger a manual sync: Company Portal > Sync device.']
  },
  {
    code: 'AADSTS53000', title: 'Device not compliant – access blocked by CA',
    severity: 'high', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/azure/active-directory/conditional-access/troubleshoot-conditional-access',
    description: 'Azure AD Conditional Access policy AADSTS53000 error blocks sign-in because the device is marked non-compliant.',
    cause: 'The device compliance grace period has elapsed, a compliance policy requirement is not met, or the device is not registered in Azure AD.',
    actions: ['Sign in to myapps.microsoft.com from a compliant device to diagnose.', 'Use the What If tool in Azure AD Conditional Access to simulate the sign-in and see which policy blocks.', 'Review Intune compliance reports for the specific failing policy item.', 'Ensure the compliance policy is assigned to the correct user/device group.', 'Check grace period settings — if within grace period, device should be marked compliant.']
  },
  // ── macOS specific ───────────────────────────────────────
  {
    code: '0x87D13B94', title: 'macOS MDM enrollment – user-approved required',
    severity: 'medium', platforms: ['macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/enrollment/macos-enroll',
    description: 'macOS device enrolled via user-initiated enrollment is not "User Approved" which limits MDM capabilities.',
    cause: 'User did not explicitly approve the MDM profile in System Preferences/System Settings, resulting in limited MDM enrollment.',
    actions: ['Open System Settings > Privacy & Security > Profiles and manually approve the MDM profile.', 'On macOS Ventura+: System Settings > Privacy & Security > Profiles > approve Management profile.', 'User-Approved MDM is required for kernel extension management and certain payloads.', 'For full management without user approval, use ADE/DEP via Apple Business Manager.', 'Verify approval status with: profiles status -type enrollment in Terminal.']
  },
  {
    code: 'ERR_MACOS_SCEP', title: 'macOS SCEP certificate enrollment failed',
    severity: 'medium', platforms: ['macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/protect/certificates-scep-configure',
    description: 'SCEP certificate profile fails to deploy to macOS devices.',
    cause: 'NDES server unreachable from Mac, certificate template permissions incorrect, or Intune Certificate Connector not healthy.',
    actions: ['Verify the Intune Certificate Connector is running and healthy: Tenant administration > Connectors > Certificate connectors.', 'Check that the Mac can reach the NDES URL (typically https://<ndes-server>/certsrv/mscep/mscep.dll).', 'Review NDES IIS logs and the Intune Certificate Connector logs on the NDES server.', 'Ensure the certificate template is configured with the correct key usage and subject name format.', 'Check macOS Console app logs for profile installation errors related to the certificate.']
  },
  // ── Windows – BitLocker & Security ──────────────────────
  {
    code: '0x8031004A', title: 'BitLocker – no compatible TPM found',
    severity: 'high', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/protect/encrypt-devices',
    description: 'BitLocker encryption policy cannot be applied because no compatible TPM is present.',
    cause: 'Device does not have TPM 2.0, TPM is disabled in BIOS/UEFI, or the policy requires TPM startup key without TPM.',
    actions: ['Run tpm.msc to verify TPM 2.0 status.', 'Enable TPM in BIOS/UEFI if disabled.', 'For virtual machines: use Hyper-V Generation 2 VMs and enable virtual TPM in security settings.', 'If TPM is genuinely unavailable, configure the BitLocker policy to allow non-TPM encryption with a startup PIN.', 'Review BitLocker event log: Event Viewer > Applications and Services Logs > Microsoft > Windows > BitLocker-API.']
  },
  {
    code: '0x80284001', title: 'BitLocker recovery key escrow failed',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/protect/encrypt-devices',
    description: 'BitLocker recovery key cannot be escrowed to Azure AD / Intune.',
    cause: 'Device is not Azure AD joined, network connectivity issue during key upload, or the key was already backed up.',
    actions: ['Verify the device is Azure AD joined or Hybrid Azure AD joined: dsregcmd /status.', 'Force key backup: manage-bde -protectors -adbackup C: in elevated command prompt.', 'Check Azure AD > Devices > select device > BitLocker keys tab for existing keys.', 'Ensure the policy "Save BitLocker recovery information to Azure Active Directory" is enabled.', 'Review Azure AD audit logs for key backup events.']
  },
  // ── Enrollment Errors – general ──────────────────────────
  {
    code: '0x80CF4017', title: 'Intune Management Extension not installed',
    severity: 'medium', platforms: ['Windows'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/apps/powershell-scripts-win32',
    description: 'PowerShell scripts or Win32 apps are not executing because the Intune Management Extension (IME) is not installed.',
    cause: 'IME is only installed when a PowerShell script or Win32/LOB app is assigned to the user or device. If no such assignment exists, IME is absent.',
    actions: ['Assign at least one PowerShell script or Win32 app to the device or user to trigger IME installation.', 'Verify IME service: Get-Service -Name IntuneManagementExtension.', 'Manually install: download IntuneWindowsAgent.exe from Intune portal if needed.', 'Check IME installation log at C:\\ProgramData\\Microsoft\\IntuneManagementExtension\\Logs.', 'Ensure the device is AAD joined and the user has an Intune license.']
  },
  {
    code: '0x87D1041A', title: 'Device check-in failure – MDM heartbeat missed',
    severity: 'low', platforms: ['Windows', 'iOS', 'Android', 'macOS'],
    ref: 'https://learn.microsoft.com/en-us/mem/intune/remote-actions/device-sync',
    description: 'Device has not checked in with Intune within the expected interval and shows as "not contacted" or stale.',
    cause: 'Device is powered off, offline for extended period, or the MDM client service has stopped.',
    actions: ['Power on and connect the device to the internet.', 'Trigger a manual sync: Company Portal app > sync, or from Intune portal: Devices > select device > Sync.', 'For Windows: check schedule task "Schedule to run OMADMClient by client" in Task Scheduler.', 'Verify the Enrollment Management service is running: Get-Service -Name DMEnrollmentSvc.', 'If device is stale and no longer in use, retire or wipe it from the Intune portal.']
  },
];

function formatDateTimeDisplay(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!raw || !isLikelyIsoDate(raw)) return toText(value);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

function formatTimeDisplay(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!raw || !isLikelyIsoDate(raw)) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

function formatRelativeTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!raw || !isLikelyIsoDate(raw)) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minutes = Math.round(absMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${diffMs < 0 ? '' : 'in '}${minutes} min${minutes === 1 ? '' : 's'}${diffMs < 0 ? ' ago' : ''}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${diffMs < 0 ? '' : 'in '}${hours} hr${hours === 1 ? '' : 's'}${diffMs < 0 ? ' ago' : ''}`;
  const days = Math.round(hours / 24);
  return `${diffMs < 0 ? '' : 'in '}${days} day${days === 1 ? '' : 's'}${diffMs < 0 ? ' ago' : ''}`;
}

function isDateLikeHeader(header: string): boolean {
  return /date|time|sync|checkin|enroll/i.test(header);
}


function getPriorityTone(priority: unknown): string {
  const normalized = String(priority ?? 'P3').toUpperCase();
  if (normalized === 'P1') return 'critical';
  if (normalized === 'P2') return 'warning';
  return 'neutral';
}

function getStatusTone(status: unknown): string {
  const normalized = String(status ?? 'New').toLowerCase();
  if (normalized === 'new') return 'critical';
  if (normalized === 'investigating') return 'warning';
  if (normalized === 'mitigating') return 'info';
  if (normalized === 'resolved') return 'success';
  return 'neutral';
}

function getIncidentSortScore(row: Row): number {
  const priority = String(row['priority'] ?? 'P3').toUpperCase();
  const status = String(row['status'] ?? 'New');
  const severity = String(row['severity'] ?? 'Low');
  const impactedCount = Number(row['impactedCount'] ?? 0);

  const priorityRank = priority === 'P1' ? 0 : priority === 'P2' ? 1 : 2;
  const severityRank = severity === 'Critical' ? 0 : severity === 'High' ? 1 : severity === 'Medium' ? 2 : 3;
  const statusRank = status === 'New' ? 0 : status === 'Investigating' ? 1 : status === 'Mitigating' ? 2 : 3;

  return priorityRank * 100000 + severityRank * 10000 + statusRank * 1000 - impactedCount;
}

function renderTableValue(header: string, value: unknown) {
  if (isDateLikeHeader(header) && isLikelyIsoDate(value)) {
    const relative = formatRelativeTime(value);
    const timeText = formatTimeDisplay(value);
    return (
      <div className="datetime-cell">
        <div className="datetime-main">{formatDateTimeDisplay(value)}</div>
        <div className="datetime-sub-row">
          {timeText && <div className="datetime-sub">{timeText}</div>}
          {relative && <div className="datetime-relative-pill">{relative}</div>}
        </div>
      </div>
    );
  }
  return toText(value);
}



// ── AdminDashboard — visible only to ADMIN_UPNS ────────────────────────────
const ADMIN_EMAILS = ['menahem@365-poc.com', 'menahem@modernendpoint.tech'];

function AdminDashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [sumRes, rowsRes] = await Promise.all([
          fetch('/api/admin/signins/summary', { credentials: 'include' }),
          fetch('/api/admin/signins?take=200', { credentials: 'include' }),
        ]);
        if (sumRes.status === 403 || rowsRes.status === 403) {
          setError('Access denied.');
          return;
        }
        const sumData  = await sumRes.json();
        const rowsData = await rowsRes.json();
        setSummary(sumData);
        setRows(rowsData.rows ?? []);
      } catch {
        setError('Failed to load data.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = rows.filter(r =>
    !search ||
    (r.userPrincipalName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.displayName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.tenantId ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // Group by user for session summary
  const byUser: Record<string, { upn: string; name: string; tenant: string; count: number; last: string }> = {};
  rows.forEach(r => {
    const key = r.userPrincipalName ?? 'unknown';
    if (!byUser[key]) byUser[key] = { upn: key, name: r.displayName ?? key, tenant: r.tenantId ?? '—', count: 0, last: r.createdAt };
    byUser[key].count++;
    if (r.createdAt > byUser[key].last) byUser[key].last = r.createdAt;
  });
  const userList = Object.values(byUser).sort((a, b) => b.last.localeCompare(a.last));

  function fmt(iso: string) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }
  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)', fontFamily: "'DM Mono', monospace" }}>Loading admin data...</div>;
  if (error)   return <div style={{ padding: 40, color: '#ef4444', fontFamily: "'DM Mono', monospace" }}>{error}</div>;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ fontSize: 22 }}>🛡️</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Admin Dashboard</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: "'DM Mono', monospace" }}>Visible only to: {ADMIN_EMAILS.join(', ')}</div>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Total Logins',    value: summary?.totalLogins   ?? 0, color: '#60a5fa' },
          { label: 'Unique Users',    value: summary?.uniqueUsers   ?? 0, color: '#22c55e' },
          { label: 'Unique Tenants',  value: summary?.uniqueTenants ?? 0, color: '#f59e0b' },
          { label: 'Last Login',      value: summary?.lastLoginAt ? timeAgo(summary.lastLoginAt) : '—', color: '#e2e8f0' },
        ].map((k, i) => (
          <div key={i} style={{ background: 'var(--navy-mid)', border: '1px solid var(--navy-border)', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Users ({userList.length})</div>
        <div style={{ background: 'var(--navy-mid)', border: '1px solid var(--navy-border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                {['User', 'Display Name', 'Tenant ID', 'Sessions', 'Last Seen'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid var(--navy-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {userList.map((u, i) => (
                <tr key={u.upn} style={{ borderBottom: '1px solid var(--navy)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '9px 14px', color: '#60a5fa', fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{u.upn}</td>
                  <td style={{ padding: '9px 14px', color: 'var(--text-muted)' }}>{u.name}</td>
                  <td style={{ padding: '9px 14px', color: 'var(--text-dim)', fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{u.tenant.slice(0, 8)}…</td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{u.count}</span>
                  </td>
                  <td style={{ padding: '9px 14px', color: 'var(--text-dim)', fontSize: 11 }}>{timeAgo(u.last)}</td>
                </tr>
              ))}
              {userList.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '20px 14px', color: 'var(--text-dim)', textAlign: 'center' }}>No sign-ins recorded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw sign-in log */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Sign-in log ({filtered.length})</div>
          <input
            type="text" placeholder="Filter by user / tenant..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--navy-border)', background: 'var(--navy)', color: 'var(--text)', fontSize: 11, fontFamily: "'DM Mono', monospace", width: 240 }}
          />
        </div>
        <div style={{ background: 'var(--navy-mid)', border: '1px solid var(--navy-border)', borderRadius: 10, overflow: 'hidden', maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--navy-mid)', zIndex: 1 }}>
              <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                {['Time', 'User', 'Display Name', 'Tenant', 'IP'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid var(--navy-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--navy)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '7px 12px', color: 'var(--text-dim)', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap' }}>{fmt(r.createdAt)}</td>
                  <td style={{ padding: '7px 12px', color: '#60a5fa', fontFamily: "'DM Mono', monospace" }}>{r.userPrincipalName ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{r.displayName ?? '—'}</td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-dim)', fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{(r.tenantId ?? '').slice(0, 8)}…</td>
                  <td style={{ padding: '7px 12px', color: 'var(--text-dim)' }}>{r.ipAddress ?? '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '20px 12px', color: 'var(--text-dim)', textAlign: 'center' }}>No results</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── EfmWalkthrough — interactive feature tour ─────────────────────────────
function EfmWalkthrough({ onSignIn }: { onSignIn: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: '🎛️', title: 'Command Center',
      desc: 'Real-time enrollment health. Instant visibility into compliance rates, failed enrollments, and platform breakdown across your entire tenant.',
      stats: [
        { label: 'Health Score', value: '84%', color: '#22c55e' },
        { label: 'Total Devices', value: '247', color: '#e2e8f0' },
        { label: 'Failures', value: '11', color: '#ef4444' },
      ],
      rows: [
        { name: 'iis-srv-devops', sub: 'Windows 10.0.20348', status: 'UNKNOWN', cls: 'badge-unk' },
        { name: 'CPC-talys-O4MMV', sub: 'Windows 10.0.26200', status: 'COMPLIANT', cls: 'badge-ok' },
        { name: 'BG-DAGAN-AAT', sub: 'Windows 10.0.20348', status: 'FAILED', cls: 'badge-err' },
      ],
    },
    {
      icon: '⛔', title: 'Enrollment Failures',
      desc: 'Live enrollment failures pulled directly from Intune via Graph API. Every failure includes category, correlation ID, and targeted fix steps.',
      stats: [
        { label: 'Live Failures', value: '7', color: '#ef4444' },
        { label: 'Catalog Match', value: '6/7', color: '#22c55e' },
        { label: 'Fix Steps', value: 'Auto', color: '#f59e0b' },
      ],
      rows: [
        { name: 'UserAbandonment — Android 16', sub: 'userEnrollment · 10/20/2025', status: 'CATALOG', cls: 'badge-ok' },
        { name: 'Authentication — Windows 11', sub: 'userEnrollment · 10/18/2025', status: 'CATALOG', cls: 'badge-ok' },
        { name: 'DeviceLimit — iOS 17', sub: 'userEnrollment · 10/15/2025', status: 'GENERIC', cls: 'badge-unk' },
      ],
    },
    {
      icon: '🛡️', title: 'Enrollment Policy',
      desc: 'Live view of your Intune enrollment configuration — platform restrictions, device limits, Autopilot devices, and custom policies in one panel.',
      stats: [
        { label: 'MDM Authority', value: 'Intune', color: '#22c55e' },
        { label: 'Device Limit', value: '5 devices', color: '#f59e0b' },
        { label: 'Autopilot', value: '14 registered', color: '#60a5fa' },
      ],
      rows: [
        { name: 'Windows — Allowed', sub: 'Personal + Corporate · All OS versions', status: 'ALLOW', cls: 'badge-ok' },
        { name: 'Android — Blocked', sub: 'Platform restriction active', status: 'BLOCK', cls: 'badge-err' },
        { name: 'iOS/iPadOS — Allowed', sub: 'Personal + Corporate · All OS versions', status: 'ALLOW', cls: 'badge-ok' },
      ],
    },
    {
      icon: '🔧', title: 'Remediation Actions',
      desc: 'Remote actions on any device — Sync, Reboot, Retire, Wipe, BitLocker Key Rotation, Reset Passcode, Collect Diagnostics. All with audit trail.',
      stats: [
        { label: 'Actions', value: '8 types', color: '#60a5fa' },
        { label: 'Confirmation', value: 'Required', color: '#f59e0b' },
        { label: 'Audit Log', value: 'Full trail', color: '#22c55e' },
      ],
      rows: [
        { name: '🔁 Sync Device', sub: 'Force Intune check-in', status: 'SAFE', cls: 'badge-ok' },
        { name: '📤 Retire Device', sub: 'Remove management, keep data', status: 'SAFE', cls: 'badge-ok' },
        { name: '🗑️ Wipe Device', sub: 'Factory reset — requires confirmation', status: 'DANGER', cls: 'badge-err' },
      ],
    },
    {
      icon: '📉', title: 'Compliance Drift',
      desc: 'Track compliance state over time. Each snapshot records compliant/non-compliant/unknown counts. Visualize trends and catch drops before they escalate.',
      stats: [
        { label: 'Compliance Rate', value: '91%', color: '#22c55e' },
        { label: '7-day Trend', value: '+3%', color: '#22c55e' },
        { label: 'Snapshots', value: 'Unlimited', color: '#60a5fa' },
      ],
      rows: [
        { name: 'Snapshot 28/03/2026', sub: '225 compliant · 18 non-compliant · 4 unknown', status: '91%', cls: 'badge-ok' },
        { name: 'Snapshot 21/03/2026', sub: '218 compliant · 22 non-compliant · 7 unknown', status: '88%', cls: 'badge-unk' },
        { name: 'Snapshot 14/03/2026', sub: '210 compliant · 28 non-compliant · 9 unknown', status: '85%', cls: 'badge-err' },
      ],
    },
    {
      icon: '⚡', title: 'Graph Explorer',
      desc: 'Run Microsoft Graph API queries directly — 8 built-in templates. Export live reports as CSV/JSON for stakeholders in one click.',
      stats: [
        { label: 'Templates', value: '8 built-in', color: '#60a5fa' },
        { label: 'Export', value: 'CSV / JSON', color: '#f59e0b' },
        { label: 'Data', value: 'Real-time', color: '#22c55e' },
      ],
      rows: [
        { name: 'Managed Devices', sub: 'All devices in tenant', status: 'READY', cls: 'badge-ok' },
        { name: 'Stale Devices (30d+)', sub: 'Devices not synced in 30 days', status: 'READY', cls: 'badge-ok' },
        { name: 'Enrolled This Month', sub: 'Recent enrollments', status: 'READY', cls: 'badge-ok' },
      ],
    },
  ];

  const s = steps[step];

  return (
    <div className="efm-walkthrough">
      <div className="efm-wt-left">
        <div className="efm-wt-badge">{s.icon}</div>
        <h2 className="efm-wt-heading">{s.title}</h2>
        <p className="efm-wt-desc">{s.desc}</p>
        <div className="efm-wt-stats">
          {s.stats.map((st, i) => (
            <div key={i} className="efm-wt-stat">
              <div className="efm-wt-stat-val" style={{ color: st.color }}>{st.value}</div>
              <div className="efm-wt-stat-lbl">{st.label}</div>
            </div>
          ))}
        </div>
        <div className="efm-wt-tabs">
          {steps.map((_, i) => (
            <button key={i} className={"efm-wt-tab" + (i === step ? " active" : "")} onClick={() => setStep(i)}>
              {steps[i].icon}
            </button>
          ))}
        </div>
        <div className="efm-wt-nav">
          <button className="efm-wt-nav-btn" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Prev</button>
          <div className="efm-wt-dots">
            {steps.map((_, i) => <div key={i} className={"efm-wt-dot" + (i === step ? " active" : "")} onClick={() => setStep(i)} />)}
          </div>
          {step < steps.length - 1
            ? <button className="efm-wt-nav-btn" onClick={() => setStep(step + 1)}>Next →</button>
            : <button className="btn btn-primary welcome-signin-btn" style={{ padding: '6px 18px', fontSize: 12 }} onClick={onSignIn}>🔑 Get started</button>
          }
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary welcome-signin-btn" style={{ marginTop: 24, width: '100%' }} onClick={onSignIn}>
            🔑 Connect your Intune tenant
          </button>
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: 'var(--text-dim)' }}>
            30-day free trial · No credit card required · $5/month after trial
          </div>
        </div>
      </div>
      <div className="efm-wt-right">
        <div className="efm-wt-mock-topbar">
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>⚡ Enrollment Flow Monitor</span>
          <span className="efm-wt-mock-pill">● Live</span>
        </div>
        <div className="efm-wt-mock-rows">
          {s.rows.map((r, i) => (
            <div key={i} className="efm-wt-mock-row">
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{r.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{r.sub}</div>
              </div>
              <span className={"efm-wt-badge-pill " + r.cls}>{r.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ── EnrollmentFailuresView ────────────────────────────────────────────────────
function getFixSteps(row: any, ERROR_CATALOG: any[]): { title: string; steps: string[]; matched: boolean } {
  const reason = (row.failureReason ?? row.failureCategory ?? '').toLowerCase();
  const category = (row.failureCategory ?? '').toLowerCase();
  const os = (row.os ?? '').toLowerCase();

  // Match by failureCategory from troubleshootingEvents (authentication, deviceLimit, etc.)
  const categoryMap: Record<string, { title: string; steps: string[] }> = {
    authentication: {
      title: 'Authentication failure during enrollment',
      steps: [
        'Verify the user account is not blocked in Entra ID — check Sign-in logs for errors.',
        'Confirm the user has an active Intune license assigned.',
        'Check Conditional Access policies — ensure enrollment is not blocked by a CA rule.',
        'Ask the user to sign out of Company Portal, restart, and try again.',
        'Verify MDM Terms of Use have been accepted by the user.',
      ],
    },
    deviceLimit: {
      title: 'Device limit reached',
      steps: [
        'Go to Devices / Enrollment restrictions / Device limit restrictions.',
        'Increase the limit for the user or remove an old enrolled device.',
        'Check if the user has stale/duplicate device records in Entra ID — remove them.',
        'Verify the user is not in a restrictive group with a lower device limit.',
      ],
    },
    deviceNotSupported: {
      title: 'Device type or platform not supported',
      steps: [
        'Go to Devices / Enrollment restrictions / Device type restrictions.',
        'Ensure the platform (Android/iOS/Windows) is set to Allow.',
        'Check if the device manufacturer or model is on a blocked list.',
        'Verify the OS version meets the minimum version requirement in restrictions.',
      ],
    },
    notLicensed: {
      title: 'User not licensed for Intune',
      steps: [
        'Assign an Intune or EMS E3/E5 license to the user in Entra ID / Users / Licenses.',
        'Wait 10–15 minutes for license propagation after assignment.',
        'Verify the license includes the Intune service plan (not just the bundle).',
        'Check if the license assignment was done via a group — confirm the user is in the group.',
      ],
    },
    userAbandonment: {
      title: 'User abandoned the enrollment flow',
      steps: [
        'This is informational — the user started but did not complete enrollment.',
        'Follow up with the user and ask them to retry enrollment.',
        'Verify Company Portal is up to date on the device.',
        'Check for any blocking prompts the user may have dismissed (Terms of Use, MFA).',
      ],
    },
    accountValidation: {
      title: 'Account validation failed',
      steps: [
        'Verify the UPN (email) is correct and the account exists in Entra ID.',
        'Check if the account is a guest or external user — these cannot enroll by default.',
        'Ensure the user is in scope for MDM enrollment in Entra ID / Mobility.',
        'Verify no name/UPN mismatch between on-prem AD and Entra ID (hybrid environments).',
      ],
    },
    aadTokenError: {
      title: 'Azure AD token error during enrollment',
      steps: [
        'Ask the user to sign out completely and sign back in with their work account.',
        'Clear the Company Portal app cache and data.',
        'Verify there are no Conditional Access policies blocking token issuance.',
        'Check if MFA is enforced — the user may need to complete MFA first.',
        'Review Entra ID Sign-in logs for the specific token failure.',
      ],
    },
  };

  if (category && categoryMap[category]) {
    return { matched: true, ...categoryMap[category] };
  }
  // Also try with original casing (Intune may send mixed case)
  const categoryOriginal = row.failureCategory ?? '';
  if (categoryOriginal && categoryMap[categoryOriginal]) {
    return { matched: true, ...categoryMap[categoryOriginal] };
  }
  // Normalize camelCase to lowercase for lookup
  const camelToLower: Record<string, string> = {
    'devicelimit': 'deviceLimit',
    'devicenotsupported': 'deviceNotSupported',
    'notlicensed': 'notLicensed',
    'userabandonment': 'userAbandonment',
    'accountvalidation': 'accountValidation',
    'aadtokenerror': 'aadTokenError',
  };
  const mappedKey = camelToLower[category];
  if (mappedKey && categoryMap[mappedKey]) {
    return { matched: true, ...categoryMap[mappedKey] };
  }

  // Match by failureReason text against ERROR_CATALOG
  const match = ERROR_CATALOG.find(e => {
    const t = e.title.toLowerCase();
    return reason.includes(t.slice(0, 20)) || t.includes(reason.slice(0, 20));
  });
  if (match) return { title: match.title, steps: match.actions, matched: true };

  // OS-based fallback
  if (os.includes('android')) return { matched: false, title: 'Android enrollment — general steps', steps: [
    'Verify the user has an Intune license in Entra ID / Users / Licenses.',
    'Check Enrollment Restrictions: ensure Android platform is allowed.',
    'Ask user to clear Company Portal data and retry enrollment.',
    'Confirm Android Enterprise is configured: Devices / Android / Android enrollment.',
    'Check blocked device manufacturer/model list.',
  ]};
  if (os.includes('ios') || os.includes('ipad')) return { matched: false, title: 'iOS/iPadOS enrollment — general steps', steps: [
    'Verify APNs certificate is valid: Devices / iOS/iPadOS enrollment / Apple MDM Push Certificate.',
    'Confirm user has Intune license and is in MDM user scope.',
    'Ask user to delete management profile and re-enroll via Company Portal.',
    'Check Enrollment Restrictions for iOS platform allowance.',
    'For ADE/DEP — verify profile is assigned in Apple Business Manager.',
  ]};
  if (os.includes('windows')) return { matched: false, title: 'Windows enrollment — general steps', steps: [
    'Run dsregcmd /status — verify AzureAdJoined and MdmEnrolled.',
    'Check MDM User Scope in Entra ID / Mobility: set to All or add user to group.',
    'Verify Intune license is assigned. Check Enrollment Restrictions.',
    'Run w32tm /resync to fix clock skew issues.',
    'Re-enroll: Settings / Accounts / Access work or school / Connect.',
  ]};
  if (os.includes('mac')) return { matched: false, title: 'macOS enrollment — general steps', steps: [
    'Verify APNs certificate is valid and not expired.',
    'User must approve MDM in System Settings / Privacy and Security.',
    'Check Enrollment Restrictions for macOS platform allowance.',
    'For ADE — verify profile is assigned in Apple Business Manager.',
    'Confirm user has Intune license and is in scope.',
  ]};
  return { matched: false, title: 'General enrollment troubleshooting', steps: [
    'Verify user has a valid Intune license in Entra ID / Users / Licenses.',
    'Check Enrollment Restrictions: Devices / Enrollment restrictions.',
    'Confirm MDM User Scope includes this user: Entra ID / Mobility.',
    'Review Conditional Access policies that may block enrollment.',
    'Check Intune Service Health for any ongoing outages.',
  ]};
}

function EnrollmentFailuresView({ efRows, efLoading, efError, efSearch, setEfSearch, efOsFilter, setEfOsFilter, selectedEfRow, setSelectedEfRow, efRetrying, setEfRetrying, auth, api, addToast, setEfRows, setEfLoading, setEfError, ERROR_CATALOG }: any) {
  const efFiltered = efRows.filter((r: any) => {
    const matchOs = efOsFilter === 'all' || (r.os ?? '').toLowerCase().includes(efOsFilter.toLowerCase());
    const matchSearch = !efSearch || Object.values(r).some(v => String(v).toLowerCase().includes(efSearch.toLowerCase()));
    return matchOs && matchSearch;
  });
  const fix = selectedEfRow ? getFixSteps(selectedEfRow, ERROR_CATALOG) : null;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div className="error-catalog-shell" style={{ flex: 1, minWidth: 0 }}>
        <div className="error-catalog-header">
          <div>
            <div className="error-catalog-title">⛔ Enrollment Failures</div>
            <div className="error-catalog-subtitle">Live from Intune via Graph API · click a row to act</div>
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => {
            setEfLoading(true); setEfError(''); setSelectedEfRow(null);
            api.get('/graph/enrollment-failures').then((res: any) => {
              setEfRows(res.data.rows ?? []);
              addToast('success', `Refreshed — ${(res.data.rows ?? []).length} record(s)`);
            }).catch((err: any) => {
              setEfError(err?.response?.data?.message ?? err?.message ?? 'Refresh failed.');
            }).finally(() => setEfLoading(false));
          }}>↺ Refresh</button>
        </div>
        <div className="error-catalog-filters">
          <input className="error-search" placeholder="Search by user, failure, OS..." value={efSearch} onChange={e => { setEfSearch(e.target.value); setSelectedEfRow(null); }} />
          <div className="error-filter-chips">
            {(['all', 'Windows', 'iOS', 'Android', 'macOS'] as const).map(f => (
              <button key={f} className={`filter-chip ${efOsFilter === f ? 'active' : ''}`} onClick={() => { setEfOsFilter(f); setSelectedEfRow(null); }}>{f}</button>
            ))}
          </div>
        </div>
        {efLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: 12 }}>
            <div style={{ fontSize: 28 }}>⏳</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Loading enrollment failures…</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', maxWidth: 320 }}>
              Pulling troubleshooting events from Intune.
            </div>
            <div className="skeleton" style={{ width: '100%', marginTop: 8 }} />
            <div className="skeleton" style={{ width: '100%' }} />
            <div className="skeleton" style={{ width: '80%' }} />
          </div>
        ) : efError ? (
          <div className="empty-state">
            <div className="empty-state-title" style={{ color: 'var(--red)' }}>Failed to load</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 8 }}>{efError}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>Make sure DeviceManagementManagedDevices.Read.All permission is granted.</div>
          </div>
        ) : efRows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No enrollment failures found</div>
            <div>Your tenant has no recent enrollment failures — great sign!</div>
          </div>
        ) : (
          <>
            <div className="error-catalog-count">{efFiltered.length} failure{efFiltered.length !== 1 ? 's' : ''} found{selectedEfRow ? ' · row selected' : ' · click a row to view actions'}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Date', 'Failure', 'OS', 'OS Version', 'User', 'Method'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', color: 'var(--text-dim)', fontWeight: 700, fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {efFiltered.map((r: any, i: number) => {
                    const isSel = selectedEfRow === r;
                    return (
                      <tr key={i} onClick={() => setSelectedEfRow(isSel ? null : r)}
                        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSel ? 'var(--amber-dim)' : '', borderLeft: isSel ? '2px solid var(--amber)' : '2px solid transparent', transition: 'background .1s' }}
                        onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--navy-light, #1E2D42)'; }}
                        onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = ''; }}
                      >
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: 'var(--text-dim)', fontSize: 11 }}>{r.failureDateTime ? new Date(r.failureDateTime).toLocaleString() : '—'}</td>
                        <td style={{ padding: '7px 10px' }}><span style={{ display: 'inline-block', background: 'rgba(239,68,68,.12)', color: 'var(--red)', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{r.failureReason ?? r.failureCategory ?? '—'}</span></td>
                        <td style={{ padding: '7px 10px', fontSize: 12 }}>{r.os ?? '—'}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text-dim)', fontSize: 11 }}>{r.osVersion ?? '—'}</td>
                        <td style={{ padding: '7px 10px', fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.userPrincipalName ?? r.userId ?? '—'}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text-dim)', fontSize: 11 }}>{r.enrollmentMethod ?? r.deviceType ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {selectedEfRow && fix && (
        <div style={{ width: 300, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⛔ Failure Details</div>
            <button onClick={() => setSelectedEfRow(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          {([['Failure', selectedEfRow.failureReason ?? selectedEfRow.failureCategory ?? '—'], ['Category', selectedEfRow.failureCategory ?? '—'], ['User', selectedEfRow.userPrincipalName ?? selectedEfRow.userId ?? '—'], ['OS', `${selectedEfRow.os ?? '—'} ${selectedEfRow.osVersion ?? ''}`.trim()], ['Method', selectedEfRow.enrollmentMethod ?? selectedEfRow.deviceType ?? '—'], ['Date', selectedEfRow.failureDateTime ? new Date(selectedEfRow.failureDateTime).toLocaleString() : '—'], ...(selectedEfRow.correlationId ? [['Correlation ID', selectedEfRow.correlationId] as [string,string]] : [])] as [string, string][]).map(([label, val]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</span>
              <span style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>{val}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 2 }}>Actions</div>
            {!auth.hasWritePermissions && (
              <div style={{ fontSize: 10, color: 'var(--amber)', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 6, padding: '6px 10px' }}>
                🔒 Upgrade to Write Access to enable actions
              </div>
            )}
            {!selectedEfRow.deviceId && auth.hasWritePermissions && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '6px 10px' }}>
                ⚠ No device ID — device may not have reached Intune yet
              </div>
            )}
            {[
              { icon: '🔁', label: 'Sync Device', endpoint: 'sync', os: null, danger: false, desc: 'Force device to check in with Intune' },
              { icon: '🔄', label: 'Reboot Device', endpoint: 'reboot', os: 'Windows', danger: false, desc: 'Send remote reboot command' },
              { icon: '📤', label: 'Retire Device', endpoint: 'retire', os: null, danger: false, desc: 'Remove management — keeps user data' },
              { icon: '🗑️', label: 'Wipe Device', endpoint: 'wipe', os: null, danger: true, desc: 'Factory reset — ALL data will be erased' },
              { icon: '🔑', label: 'Rotate BitLocker Keys', endpoint: 'rotateBitLockerKeys', os: 'Windows', danger: false, desc: 'Rotate BitLocker recovery key in Entra ID' },
              { icon: '📱', label: 'Reset Passcode', endpoint: 'resetPasscode', os: 'iOS/Android', danger: false, desc: 'Clear device PIN/passcode' },
              { icon: '📋', label: 'Collect Diagnostics', endpoint: 'collectDiagnostics', os: 'Windows', danger: false, desc: 'Download device logs from Intune portal' },
            ].map(action => {
              const osMatch = !action.os ||
                (action.os === 'Windows' && selectedEfRow.os?.toLowerCase().includes('windows')) ||
                (action.os === 'iOS/Android' && (selectedEfRow.os?.toLowerCase().includes('ios') || selectedEfRow.os?.toLowerCase().includes('android')));
              if (!osMatch) return null;
              return (
                <button key={action.endpoint}
                  className="btn btn-secondary"
                  style={{ width: '100%', justifyContent: 'flex-start', gap: 8, fontSize: 11, padding: '7px 10px', border: action.danger ? '1px solid rgba(239,68,68,.25)' : undefined }}
                  disabled={!selectedEfRow.deviceId || efRetrying || !auth.hasWritePermissions}
                  title={action.desc}
                  onClick={async () => {
                    if (!selectedEfRow.deviceId) return;
                    if (action.danger) {
                      if (!window.confirm(`⚠️ WIPE DEVICE

This will factory reset "${selectedEfRow.deviceName ?? selectedEfRow.deviceId}".

ALL data will be permanently erased. This cannot be undone.

Proceed?`)) return;
                    }
                    setEfRetrying(true);
                    try {
                      const res: any = await api.post(`/devices/${selectedEfRow.deviceId}/${action.endpoint}`);
                      addToast('success', res.data?.message ?? `${action.label} sent.`);
                    } catch (err: any) {
                      addToast('error', err?.response?.data?.message ?? `${action.label} failed.`);
                    } finally { setEfRetrying(false); }
                  }}>
                  <span>{action.icon}</span>
                  <span style={{ flex: 1 }}>{efRetrying ? 'Sending…' : action.label}</span>
                  {action.danger && <span style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700 }}>DANGER</span>}
                  {action.os && <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>{action.os}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Fix Steps</div>
              <span style={{ fontSize: 9, background: fix.matched ? 'rgba(16,185,129,.15)' : 'var(--amber-dim)', color: fix.matched ? 'var(--green)' : 'var(--amber)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>
                {fix.matched ? 'CATALOG MATCH' : 'GENERIC'}
              </span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{fix.title}</div>
            <ol style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {fix.steps.map((step: string, i: number) => (
                <li key={i} style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GraphExplorerView ─────────────────────────────────────────────────────────
const GQ_TEMPLATES = [
  { label: 'Managed Devices', url: '/v1.0/deviceManagement/managedDevices?$top=20&$select=deviceName,operatingSystem,complianceState,lastSyncDateTime,userPrincipalName' },
  { label: 'Non-Compliant Devices', url: "/v1.0/deviceManagement/managedDevices?$filter=complianceState eq 'noncompliant'&$select=deviceName,operatingSystem,userPrincipalName,lastSyncDateTime&$top=20" },
  { label: 'Enrollment Failures', url: "/v1.0/deviceManagement/managedDevices?$filter=complianceState eq 'noncompliant' or complianceState eq 'unknown'&$select=deviceName,operatingSystem,osVersion,complianceState,userPrincipalName,deviceEnrollmentType&$top=20" },
  { label: 'Active Users', url: '/v1.0/users?$filter=accountEnabled eq true&$select=displayName,userPrincipalName,mail&$top=20' },
  { label: 'Autopilot Devices', url: '/v1.0/deviceManagement/windowsAutopilotDeviceIdentities?$top=20' },
  { label: 'Enrollment Restrictions', url: '/v1.0/deviceManagement/deviceEnrollmentConfigurations?$select=displayName,priority,createdDateTime,lastModifiedDateTime&$top=20' },
  { label: 'Stale Devices (30d+)', url: "/v1.0/deviceManagement/managedDevices?$filter=lastSyncDateTime le " + new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0] + "T00:00:00Z&$select=deviceName,operatingSystem,lastSyncDateTime,userPrincipalName,complianceState&$top=20" },
  { label: 'Enrolled This Month', url: "/v1.0/deviceManagement/managedDevices?$filter=enrolledDateTime ge " + new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0] + "T00:00:00Z&$select=deviceName,operatingSystem,enrolledDateTime,userPrincipalName,complianceState&$top=50" },
];

function GraphExplorerView({ gqUrl, setGqUrl, gqResult, setGqResult, gqLoading, setGqLoading, gqError, setGqError, gqSelectedTemplate, setGqSelectedTemplate, auth, api, addToast }: any) {
  const runQuery = async () => {
    if (!gqUrl.trim()) return;
    setGqLoading(true); setGqError(''); setGqResult(null);
    try {
      const res = await api.post('/graph/proxy', { url: gqUrl.trim() });
      setGqResult((res as any).data);
    } catch (err: any) {
      setGqError(err?.response?.data?.message ?? err?.message ?? 'Query failed.');
    } finally {
      setGqLoading(false);
    }
  };
  const resultRows: any[] = gqResult?.value ?? (Array.isArray(gqResult?.rows) ? gqResult.rows : gqResult && !gqResult.value ? [gqResult] : []);
  const colKeys = resultRows.length > 0 ? Object.keys(resultRows[0]).filter(k => !k.startsWith('@')) : [];
  return (
    <div className="error-catalog-shell">
      <div className="error-catalog-header">
        <div>
          <div className="error-catalog-title">⚡ Graph Explorer</div>
          <div className="error-catalog-subtitle">Run Microsoft Graph API queries against your tenant in real-time</div>
        </div>
        <a className="btn-ai-inline" href="https://developer.microsoft.com/en-us/graph/graph-explorer" target="_blank" rel="noopener noreferrer">↗ Graph Explorer</a>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {GQ_TEMPLATES.map(t => (
          <button key={t.label} className={`filter-chip ${gqSelectedTemplate === t.label ? 'active' : ''}`} onClick={() => { setGqUrl(t.url); setGqSelectedTemplate(t.label); setGqResult(null); setGqError(''); }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px', gap: 8 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'DM Mono, monospace' }}>GET</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>graph.microsoft.com</span>
          <input
            value={gqUrl}
            onChange={e => { setGqUrl(e.target.value); setGqSelectedTemplate(''); }}
            onKeyDown={e => e.key === 'Enter' && runQuery()}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: 'DM Mono, monospace', fontSize: 13, padding: '10px 0' }}
            placeholder="/v1.0/deviceManagement/managedDevices"
          />
        </div>
        <button className="btn btn-primary" onClick={runQuery} disabled={gqLoading || !auth.connected} style={{ minWidth: 80 }}>
          {gqLoading ? '⏳' : '▶ Run'}
        </button>
      </div>
      {!auth.connected && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          <div className="empty-state-title">Sign in required</div>
          <div>Connect your Microsoft tenant to run live Graph queries.</div>
        </div>
      )}
      {gqLoading && <div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
      {gqError && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid var(--red)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>Query Error</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{gqError}</div>
        </div>
      )}
      {gqResult && !gqLoading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {resultRows.length > 0 ? `${resultRows.length} row${resultRows.length !== 1 ? 's' : ''} returned` : 'Response received'}
              {gqResult['@odata.count'] ? ` (total: ${gqResult['@odata.count']})` : ''}
            </div>
            <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(gqResult, null, 2));
              addToast('success', 'Copied to clipboard');
            }}>📋 Copy JSON</button>
          </div>
          {resultRows.length > 0 && colKeys.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {colKeys.map(k => (
                      <th key={k} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map((row: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--navy-light, #1E2D42)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}>
                      {colKeys.map(k => (
                        <td key={k} style={{ padding: '8px 12px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row[k] === null || row[k] === undefined ? <span style={{ color: 'var(--text-dim)' }}>—</span> : typeof row[k] === 'boolean' ? (row[k] ? '✓' : '✗') : String(row[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, fontSize: 12, overflowX: 'auto', color: 'var(--text)', fontFamily: 'DM Mono, monospace', maxHeight: 400, overflowY: 'auto' }}>
              {JSON.stringify(gqResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── ComplianceDriftView ───────────────────────────────────────────────────────
function ComplianceDriftView({ snapshots, loading, api, addToast, setSnapshots, setLoading }: any) {
  const refresh = () => {
    setLoading(true);
    api.get('/graph/compliance-drift').then((res: any) => {
      setSnapshots(res.data?.snapshots ?? []);
      addToast('success', 'Compliance drift refreshed');
    }).catch((err: any) => {
      addToast('error', err?.response?.data?.message ?? 'Refresh failed');
    }).finally(() => setLoading(false));
  };

  // Compute summary stats from snapshots
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];
  const complianceRate = latest ? Math.round((latest.compliant / Math.max(latest.total, 1)) * 100) : null;
  const prevRate = previous ? Math.round((previous.compliant / Math.max(previous.total, 1)) * 100) : null;
  const delta = complianceRate !== null && prevRate !== null ? complianceRate - prevRate : null;

  const stateColor = (state: string) => {
    if (state === 'compliant') return 'var(--green)';
    if (state === 'noncompliant') return 'var(--red)';
    return 'var(--amber)';
  };

  return (
    <div className="error-catalog-shell">
      <div className="error-catalog-header">
        <div>
          <div className="error-catalog-title">📉 Compliance Drift</div>
          <div className="error-catalog-subtitle">Compliance state tracked over time — snapshot taken on each refresh</div>
        </div>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={refresh}>↺ Take Snapshot</button>
      </div>

      {loading ? (
        <div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
      ) : snapshots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No snapshots yet</div>
          <div className="empty-state-desc">Click "Take Snapshot" to record your current compliance state. Each refresh adds a new data point to track drift over time.</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={refresh}>📸 Take First Snapshot</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: 'Compliance Rate', value: complianceRate !== null ? complianceRate + '%' : '—', color: (complianceRate ?? 0) >= 90 ? 'var(--green)' : (complianceRate ?? 0) >= 70 ? 'var(--amber)' : 'var(--red)', sub: 'Latest snapshot' },
              { label: '7-day Trend', value: delta !== null ? (delta >= 0 ? '+' : '') + delta + '%' : '—', color: delta === null ? 'var(--text)' : delta >= 0 ? 'var(--green)' : 'var(--red)', sub: delta === null ? 'Need 2+ snapshots' : delta >= 0 ? 'Improving' : 'Declining' },
              { label: 'Total Devices', value: latest?.total ?? '—', color: 'var(--text)', sub: 'In Intune' },
              { label: 'Snapshots', value: snapshots.length, color: 'var(--teal)', sub: 'Data points collected' },
            ].map(c => (
              <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{String(c.value)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Chart — SVG bar chart */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Compliance Over Time</div>
            <div style={{ overflowX: 'auto' }}>
              <svg width={Math.max(600, snapshots.length * 70)} height={180} style={{ display: 'block' }}>
                {snapshots.map((s: any, i: number) => {
                  const x = i * 70 + 35;
                  const rate = Math.round((s.compliant / Math.max(s.total, 1)) * 100);
                  const barH = Math.round((rate / 100) * 130);
                  const barY = 150 - barH;
                  const col = rate >= 90 ? '#10B981' : rate >= 70 ? '#F59E0B' : '#EF4444';
                  return (
                    <g key={i}>
                      <rect x={x - 20} y={barY} width={40} height={barH} fill={col} fillOpacity={0.8} rx={3} />
                      <text x={x} y={barY - 5} textAnchor="middle" fill={col} fontSize={10} fontWeight={700}>{rate}%</text>
                      <text x={x} y={168} textAnchor="middle" fill="#4A6080" fontSize={9}>{new Date(s.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })}</text>
                    </g>
                  );
                })}
                <line x1={0} y1={150} x2={Math.max(600, snapshots.length * 70)} y2={150} stroke="#263850" strokeWidth={1} />
              </svg>
            </div>
          </div>

          {/* Breakdown table */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Snapshot History</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  {['Date', 'Compliant', 'Non-Compliant', 'Unknown', 'Total', 'Rate'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-dim)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((s: any, i: number) => {
                  const rate = Math.round((s.compliant / Math.max(s.total, 1)) * 100);
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--text-dim)', fontSize: 10 }}>{new Date(s.timestamp).toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--green)', fontWeight: 700 }}>{s.compliant}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--red)', fontWeight: 700 }}>{s.noncompliant}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--amber)', fontWeight: 700 }}>{s.unknown}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text)' }}>{s.total}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, background: rate >= 90 ? 'rgba(16,185,129,.12)' : rate >= 70 ? 'rgba(245,158,11,.12)' : 'rgba(239,68,68,.12)', color: rate >= 90 ? 'var(--green)' : rate >= 70 ? 'var(--amber)' : 'var(--red)' }}>{rate}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── EnrollmentPolicyView ──────────────────────────────────────────────────────
function EnrollmentPolicyView({ epData, epLoading, epError, api, setEpData, setEpLoading, setEpError, addToast, runbookText, setRunbookText, runbookLoading, setRunbookLoading }: any) {
  const refresh = () => {
    setEpLoading(true); setEpError('');
    api.get('/graph/enrollment-policy').then((res: any) => {
      setEpData(res.data);
      addToast('success', 'Policy refreshed');
    }).catch((err: any) => {
      setEpError(err?.response?.data?.message ?? err?.message ?? 'Refresh failed.');
    }).finally(() => setEpLoading(false));
  };

  const generateRunbook = () => {
    if (!epData) return;
    setRunbookLoading(true);

    // ── Smart Runbook — pure logic, no API needed ────────────────
    const sections: string[] = [];
    const risks: string[] = [];
    const actions: string[] = [];
    const helpdesk: string[] = [];

    const p = epData.platformRestrictions;
    const limit = epData.deviceLimit ?? 5;
    const ap = epData.autopilot;

    // ── Current Policy Summary ───────────────────────────────────
    sections.push('## Current Policy Summary');
    sections.push('MDM Authority: ' + (epData.mdmAuthority ?? 'Intune'));
    sections.push('Default Device Limit: ' + limit + ' devices per user (' + (epData.deviceLimitPolicyName ?? 'Default') + ')');

    if (p) {
      const platLines = [
        'Windows: ' + (p.windowsRestriction?.platformBlocked ? 'BLOCKED' : ('Allowed' + (p.windowsRestriction?.personalDeviceEnrollmentBlocked ? ' — Corporate only' : ' — Personal + Corporate'))),
        'iOS/iPadOS: ' + (p.iosRestriction?.platformBlocked ? 'BLOCKED' : ('Allowed' + (p.iosRestriction?.personalDeviceEnrollmentBlocked ? ' — Corporate only' : ' — Personal + Corporate'))),
        'Android: ' + (p.androidRestriction?.platformBlocked ? 'BLOCKED' : ('Allowed' + (p.androidRestriction?.personalDeviceEnrollmentBlocked ? ' — Corporate only' : ' — Personal + Corporate'))),
        'macOS: ' + (p.macOSRestriction?.platformBlocked ? 'BLOCKED' : ('Allowed' + (p.macOSRestriction?.personalDeviceEnrollmentBlocked ? ' — Corporate only' : ' — Personal + Corporate'))),
        'Windows Mobile: ' + (p.windowsMobileRestriction?.platformBlocked ? 'BLOCKED' : 'Allowed'),
      ];
      sections.push('\nPlatform Restrictions (Policy: ' + p.policyName + '):');
      platLines.forEach(l => sections.push('  • ' + l));
    }

    if ((epData.customLimitPolicies ?? []).length > 0) {
      sections.push('\nCustom Device Limit Overrides:');
      epData.customLimitPolicies.forEach((c: any) => sections.push('  • ' + c.displayName + ': ' + c.limit + ' devices (Priority ' + c.priority + ')'));
    }

    if (ap) {
      sections.push('\nWindows Autopilot: ' + ap.total + ' device' + (ap.total !== 1 ? 's' : '') + ' registered');
      Object.entries(ap.enrollmentStates).forEach(([state, count]: any) => {
        sections.push('  • ' + state + ': ' + count);
      });
    }

    // ── Identified Risks or Gaps ─────────────────────────────────
    if (limit <= 3) risks.push('Device limit of ' + limit + ' is very low — users with multiple devices will be blocked from enrollment.');
    if (limit === 5) risks.push('Default device limit of 5 may be insufficient for power users or executives who use multiple devices.');

    if (p?.androidRestriction?.platformBlocked) risks.push('Android enrollment is fully blocked — BYOD Android users cannot enroll. Verify this is intentional policy.');
    if (p?.windowsMobileRestriction?.platformBlocked) risks.push('Windows Mobile is blocked — this is expected for most tenants (platform is deprecated).');
    if (p?.iosRestriction?.personalDeviceEnrollmentBlocked) risks.push('Personal iOS devices are blocked — only corporate-owned iOS devices can enroll.');
    if (p?.androidRestriction && !p.androidRestriction.platformBlocked && p.androidRestriction.personalDeviceEnrollmentBlocked) risks.push('Personal Android devices are blocked — BYOD Android policy may frustrate users.');

    if (ap && ap.total > 0) {
      const notContacted = ap.enrollmentStates['notContacted'] ?? 0;
      if (notContacted > 0) risks.push(notContacted + ' Autopilot device' + (notContacted !== 1 ? 's' : '') + ' have status "notContacted" — these devices have never reached Intune. Verify network connectivity and Autopilot profile assignment.');
      const failed = ap.enrollmentStates['failed'] ?? 0;
      if (failed > 0) risks.push(failed + ' Autopilot device' + (failed !== 1 ? 's' : '') + ' failed enrollment — check Autopilot deployment profile and hardware hash validity.');
    }
    if (ap && ap.total === 0) risks.push('No Autopilot devices registered — Windows Autopilot is not configured. Devices must be enrolled manually.');

    if ((epData.customPlatformPolicies ?? []).length > 0) risks.push((epData.customPlatformPolicies.length) + ' custom platform restriction polic' + (epData.customPlatformPolicies.length > 1 ? 'ies' : 'y') + ' detected — ensure they are intentional and do not conflict with default policy.');

    if (risks.length === 0) risks.push('No critical risks identified. Policy appears well-configured.');

    // ── Recommended Actions ──────────────────────────────────────
    if (limit <= 5) actions.push('Consider raising the default device limit to 10 for standard users, and creating a custom limit policy for specific groups if needed.');
    if (p?.androidRestriction?.platformBlocked) actions.push('If Android BYOD is required, unblock Android in Enrollment Restrictions and configure Android Enterprise (Work Profile) for personal devices.');
    if (ap && ap.total > 0 && (ap.enrollmentStates['notContacted'] ?? 0) > 0) {
      actions.push('For Autopilot "notContacted" devices: 1) Verify the device has internet access, 2) Check that the Autopilot profile is assigned to the device/group, 3) Run Get-AutopilotDiagnostics to inspect status.');
    }
    if (!ap || ap.total === 0) actions.push('To enable Autopilot: upload device hardware hashes via Intune (Devices > Windows > Windows Enrollment > Devices), assign an Autopilot deployment profile, and test with a pilot device.');
    actions.push('Review Enrollment Restrictions quarterly to ensure they align with current device policy.');
    actions.push('Enable Enrollment Notifications (Devices > Enrollment Notifications) to alert users upon successful enrollment.');

    // ── Helpdesk Quick Reference ─────────────────────────────────
    helpdesk.push('User cannot enroll Android → Check if Android is blocked in Enrollment Restrictions. If blocked, escalate to IT admin.');
    helpdesk.push('User hit device limit → Go to Entra ID > Users > [user] and remove a stale device, or raise the limit in Enrollment Restrictions.');
    helpdesk.push('Autopilot device stuck at enrollment → Verify device is in Autopilot list (Intune > Devices > Windows > Enrollment > Devices). Run Autopilot Diagnostics.');
    helpdesk.push('Enrollment fails immediately → Check if the user has an Intune license assigned in Entra ID > Users > Licenses.');

    const runbook = [
      '# Intune Enrollment Policy Runbook',
      '**Generated by Enrollment Flow Monitor · ' + new Date().toLocaleDateString() + '**',
      '',
      sections.join('\n'),
      '',
      '## Identified Risks or Gaps',
      ...risks.map(r => '• ' + r),
      '',
      '## Recommended Actions for IT Admin',
      ...actions.map((a, i) => (i+1) + '. ' + a),
      '',
      '## Helpdesk Quick Reference',
      ...helpdesk.map(h => '• ' + h),
    ].join('\n');

    setTimeout(() => {
      setRunbookText(runbook);
      setRunbookLoading(false);
    }, 300); // small delay for UX
  };

  const stateColor = (state: string) => {
    if (state === 'enrolled') return { bg: 'rgba(16,185,129,.12)', color: 'var(--green)' };
    if (state === 'notContacted') return { bg: 'rgba(245,158,11,.12)', color: 'var(--amber)' };
    return { bg: 'rgba(239,68,68,.12)', color: 'var(--red)' };
  };

  const PlatRow = ({ label, r }: { label: string; r: any }) => {
    if (!r) return null;
    const blocked = r.platformBlocked;
    const personalBlocked = r.personalDeviceEnrollmentBlocked;
    const hasOsRange = r.osMinimumVersion || r.osMaximumVersion;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '120px 120px 160px 1fr', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {/* Platform status */}
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, textAlign: 'center', background: blocked ? 'rgba(239,68,68,.12)' : 'rgba(16,185,129,.12)', color: blocked ? 'var(--red)' : 'var(--green)' }}>
          {blocked ? '⛔ Blocked' : '✅ Allowed'}
        </span>
        {/* Personal device status */}
        {!blocked ? (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, textAlign: 'center', background: personalBlocked ? 'rgba(245,158,11,.12)' : 'rgba(16,185,129,.12)', color: personalBlocked ? 'var(--amber)' : 'var(--green)' }}>
            {personalBlocked ? '⚠ Corporate Only' : '✅ Personal Allowed'}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>— no enrollment</span>
        )}
        {/* OS version range */}
        {hasOsRange ? (
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
            OS {r.osMinimumVersion || 'any'} → {r.osMaximumVersion || 'any'}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>All OS versions</span>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div className="error-catalog-shell" style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div className="error-catalog-header">
          <div>
            <div className="error-catalog-title">🛡️ Enrollment Policy</div>
            <div className="error-catalog-subtitle">Live enrollment configuration from your Intune tenant</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={refresh}>↺ Refresh</button>
            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={!epData || runbookLoading} onClick={generateRunbook}>
              {runbookLoading ? '⏳ Building…' : '📋 Generate Runbook'}
            </button>
          </div>
        </div>

        {epLoading ? (
          <div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        ) : epError ? (
          <div className="empty-state"><div className="empty-state-title" style={{ color: 'var(--red)' }}>⚠ {epError}</div></div>
        ) : !epData ? (
          <div className="empty-state"><div className="empty-state-title">Select Enrollment Policy to load data</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                { label: 'MDM Authority', value: epData.mdmAuthority ?? 'Intune', color: 'var(--green)', sub: 'Mobile Device Management' },
                { label: 'Device Limit', value: `${epData.deviceLimit ?? '—'} devices`, color: (epData.deviceLimit ?? 0) >= 5 ? 'var(--green)' : 'var(--amber)', sub: epData.deviceLimitPolicyName ?? 'Per user' },
                { label: 'Autopilot Devices', value: epData.autopilot?.total ?? 0, color: (epData.autopilot?.total ?? 0) > 0 ? 'var(--teal)' : 'var(--text-dim)', sub: 'Registered in tenant' },
                { label: 'Custom Policies', value: (epData.customLimitPolicies?.length ?? 0) + (epData.customPlatformPolicies?.length ?? 0), color: 'var(--text)', sub: 'Limit + platform overrides' },
              ].map(c => (
                <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>{c.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{String(c.value)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{c.sub}</div>
                </div>
              ))}
            </div>

            {/* Platform Restrictions */}
            {epData.platformRestrictions && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Platform Restrictions</div>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Policy: {epData.platformRestrictions.policyName} · Modified {new Date(epData.platformRestrictions.lastModified).toLocaleDateString()}</span>
                </div>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '120px 120px 160px 1fr', gap: 8, padding: '4px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 4 }}>
                  {['Platform', 'Status', 'Personal Devices', 'OS Version Range'].map(h => (
                    <div key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</div>
                  ))}
                </div>
                <PlatRow label="Windows" r={epData.platformRestrictions.windowsRestriction} />
                <PlatRow label="iOS / iPadOS" r={epData.platformRestrictions.iosRestriction} />
                <PlatRow label="Android" r={epData.platformRestrictions.androidRestriction} />
                <PlatRow label="macOS" r={epData.platformRestrictions.macOSRestriction} />
                <PlatRow label="Windows Mobile" r={epData.platformRestrictions.windowsMobileRestriction} />
              </div>
            )}

            {/* Custom Device Limit Policies */}
            {(epData.customLimitPolicies?.length ?? 0) > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
                  Custom Device Limit Policies ({epData.customLimitPolicies.length})
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-dim)', marginLeft: 8 }}>— per-group overrides</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 120px', gap: 8, padding: '4px 0 8px', borderBottom: '2px solid var(--border)', marginBottom: 4 }}>
                  {['Policy Name', 'Limit', 'Priority', 'Last Modified'].map(h => (
                    <div key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</div>
                  ))}
                </div>
                {epData.customLimitPolicies.map((r: any, i: number) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 120px', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12, alignItems: 'center' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{r.displayName}</span>
                    <span style={{ color: 'var(--amber)', fontWeight: 700, fontFamily: 'monospace' }}>{r.limit} devices</span>
                    <span style={{ color: 'var(--text-dim)' }}>P{r.priority}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{new Date(r.lastModifiedDateTime).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Custom Platform Restriction Policies */}
            {(epData.customPlatformPolicies?.length ?? 0) > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
                  Custom Platform Policies ({epData.customPlatformPolicies.length})
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-dim)', marginLeft: 8 }}>— group-specific overrides</span>
                </div>
                {epData.customPlatformPolicies.map((policy: any, pi: number) => (
                  <div key={pi} style={{ marginBottom: pi < epData.customPlatformPolicies.length - 1 ? 12 : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{policy.displayName}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Priority {policy.priority} · {new Date(policy.lastModifiedDateTime).toLocaleDateString()}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 120px 160px 1fr', gap: 8, padding: '4px 0 4px', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
                      {['Platform', 'Status', 'Personal Devices', 'OS Range'].map(h => (
                        <div key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</div>
                      ))}
                    </div>
                    {[
                      { label: 'Windows', r: policy.windowsRestriction },
                      { label: 'iOS / iPadOS', r: policy.iosRestriction },
                      { label: 'Android', r: policy.androidRestriction },
                      { label: 'macOS', r: policy.macOSRestriction },
                    ].filter(x => x.r).map(({ label, r }) => (
                      <PlatRow key={label} label={label} r={r} />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Autopilot */}
            {epData.autopilot && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Windows Autopilot — {epData.autopilot.total} devices</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {Object.entries(epData.autopilot.enrollmentStates).map(([state, count]: any) => {
                      const col = stateColor(state);
                      return <span key={state} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700, background: col.bg, color: col.color }}>{state}: {count}</span>;
                    })}
                  </div>
                </div>
                {epData.autopilot.devices.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)' }}>
                          {['Serial Number', 'Manufacturer', 'Model', 'Group Tag', 'State', 'Last Contact'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-dim)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {epData.autopilot.devices.map((d: any, i: number) => {
                          const col = stateColor(d.enrollmentState);
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--navy-light, #1E2D42)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}>
                              <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 10 }}>{d.serialNumber || '—'}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-dim)' }}>{d.manufacturer || '—'}</td>
                              <td style={{ padding: '6px 8px' }}>{d.model || '—'}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-dim)' }}>{d.groupTag || '—'}</td>
                              <td style={{ padding: '6px 8px' }}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 700, background: col.bg, color: col.color }}>{d.enrollmentState}</span></td>
                              <td style={{ padding: '6px 8px', color: 'var(--text-dim)', fontSize: 10 }}>{d.lastContactedDateTime && d.lastContactedDateTime !== '0001-01-01T00:00:00Z' ? new Date(d.lastContactedDateTime).toLocaleDateString() : 'Never'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Runbook panel */}
      {(runbookText || runbookLoading) && (
        <div style={{ width: 360, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>🤖 AI Runbook</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {runbookText && (
                <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={() => { navigator.clipboard.writeText(runbookText); addToast('success', 'Copied!'); }}>📋 Copy</button>
              )}
              <button onClick={() => { setRunbookText(''); setRunbookLoading(false); }} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
          </div>
          {runbookLoading ? (
            <div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
          ) : (
            <pre style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 520, overflowY: 'auto', margin: 0 }}>{runbookText}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Landing Page — shown to unauthenticated visitors
// ─────────────────────────────────────────────────────────────────────────────
function LandingPage() {
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);

  const features = [
    {
      icon: '🔍',
      title: 'Instant Enrollment Diagnostics',
      desc: 'Every enrollment failure decoded — error code, root cause, and step-by-step fix. Works across Windows, iOS, Android and macOS.',
    },
    {
      icon: '📊',
      title: 'Live Compliance Dashboard',
      desc: 'See compliant vs. non-compliant devices across your entire fleet. Drill into any device to find what is blocking compliance.',
    },
    {
      icon: '🤖',
      title: 'OCR Error Scanner',
      desc: 'Screenshot an error on any device. Upload it here and get instant AI-powered root-cause analysis and remediation steps.',
    },
    {
      icon: '🛡️',
      title: 'Autopilot Readiness Checker',
      desc: 'Validate your tenant before rolling out Autopilot, ADE or Android Enterprise. Catch misconfigurations before they hit end-users.',
    },
    {
      icon: '📋',
      title: 'Incident Workflow Tracker',
      desc: 'Track enrollment incidents with status, owner, and notes. Export reports to PDF, CSV or JSON for management visibility.',
    },
    {
      icon: '⚡',
      title: 'Remote Device Actions',
      desc: 'Trigger sync, reboot or Autopilot reset directly from the dashboard — no switching to the Intune portal.',
    },
  ];

  const stats = [
    { value: '50+', label: 'Error codes decoded' },
    { value: '4', label: 'Platforms supported' },
    { value: '30 day', label: 'Free trial' },
    { value: '0', label: 'Agents to install' },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #1C1917 0%, #1a1612 50%, #1C1917 100%)',
      color: '#F5F4F0',
      fontFamily: 'Inter, system-ui, sans-serif',
      overflowX: 'hidden',
    }}>
      <style>{`
        @keyframes lp-fade-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes lp-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
        .lp-fade-1 { animation: lp-fade-up 0.6s ease both; }
        .lp-fade-2 { animation: lp-fade-up 0.6s 0.12s ease both; }
        .lp-fade-3 { animation: lp-fade-up 0.6s 0.24s ease both; }
        .lp-fade-4 { animation: lp-fade-up 0.6s 0.36s ease both; }
        .lp-cta-btn {
          display: inline-flex; align-items: center; gap: 10px;
          background: linear-gradient(135deg, #F59E0B, #D97706);
          color: #1C1917; font-weight: 700; font-size: 15px;
          padding: 14px 32px; border-radius: 10px; border: none;
          cursor: pointer; text-decoration: none;
          box-shadow: 0 4px 24px rgba(245,158,11,0.35);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .lp-cta-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(245,158,11,0.5); }
        .lp-cta-btn:active { transform: translateY(0); }
        .lp-cta-secondary {
          display: inline-flex; align-items: center; gap: 8px;
          background: transparent; color: #94A3B8; font-size: 14px;
          padding: 12px 24px; border-radius: 10px;
          border: 1px solid rgba(148,163,184,0.25);
          cursor: pointer; text-decoration: none;
          transition: border-color 0.15s, color 0.15s;
        }
        .lp-cta-secondary:hover { border-color: rgba(148,163,184,0.5); color: #F5F4F0; }
        .lp-feature-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px; padding: 24px;
          transition: border-color 0.2s, background 0.2s, transform 0.2s;
          cursor: default;
        }
        .lp-feature-card:hover {
          border-color: rgba(245,158,11,0.3);
          background: rgba(245,158,11,0.04);
          transform: translateY(-2px);
        }
        .lp-stat-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px; padding: 20px 24px;
          text-align: center;
        }
        @media (max-width: 640px) {
          .lp-hero-btns { flex-direction: column !important; align-items: stretch !important; }
          .lp-features-grid { grid-template-columns: 1fr !important; }
          .lp-stats-grid { grid-template-columns: 1fr 1fr !important; }
          .lp-hero-title { font-size: 28px !important; }
        }
      `}</style>

      {/* ── TOP NAV ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(28,25,23,0.9)', backdropFilter: 'blur(8px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/efm-logo.svg" alt="EFM" style={{ width: 34, height: 34 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F4F0', lineHeight: 1.2 }}>Enrollment Flow Monitor</div>
            <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: '0.05em' }}>by modernendpoint.tech</div>
          </div>
        </div>
        <a className="lp-cta-btn" href="/api/auth/login" style={{ padding: '8px 20px', fontSize: 13 }}>
          Sign in with Microsoft
        </a>
      </nav>

      {/* ── HERO ── */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '80px 32px 60px', textAlign: 'center' }}>
        {/* Badge */}
        <div className="lp-fade-1" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 99, padding: '5px 14px', marginBottom: 28,
          fontSize: 12, fontWeight: 600, color: '#F59E0B', letterSpacing: '0.04em',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', animation: 'lp-pulse 2s infinite' }} />
          FREE 30-DAY TRIAL — NO CREDIT CARD REQUIRED
        </div>

        {/* Headline */}
        <h1 className="lp-fade-2 lp-hero-title" style={{
          fontSize: 44, fontWeight: 800, lineHeight: 1.15,
          margin: '0 0 20px',
          background: 'linear-gradient(135deg, #F5F4F0 30%, #94A3B8 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Know exactly why your Intune<br />enrollments are failing
        </h1>

        {/* Subheadline */}
        <p className="lp-fade-3" style={{
          fontSize: 18, color: '#A8A29E', lineHeight: 1.7,
          maxWidth: 620, margin: '0 auto 40px',
        }}>
          Real-time diagnostics, compliance monitoring and enrollment readiness checks
          for Microsoft Intune — in one dashboard, no agents, no setup.
        </p>

        {/* CTAs */}
        <div className="lp-fade-4 lp-hero-btns" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a className="lp-cta-btn" href="/api/auth/login">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M11.4 2H2v9.4h9.4V2z" fill="#F25022"/>
              <path d="M22 2h-9.4v9.4H22V2z" fill="#7FBA00"/>
              <path d="M11.4 12.6H2V22h9.4v-9.4z" fill="#00A4EF"/>
              <path d="M22 12.6h-9.4V22H22v-9.4z" fill="#FFB900"/>
            </svg>
            Start Free Trial — Sign in with Microsoft
          </a>
          <a className="lp-cta-secondary" href="https://www.youtube.com/watch?v=VoLX31W2kOI" target="_blank" rel="noopener noreferrer">
            ▶ Watch 2-min demo
          </a>
        </div>

        {/* Trust line */}
        <div style={{ marginTop: 24, fontSize: 12, color: '#57534E', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap' }}>
          <span>🔒 Your data never leaves your tenant</span>
          <span>·</span>
          <span>✅ Microsoft OAuth2 — no passwords stored</span>
          <span>·</span>
          <span>🌍 Works with any Microsoft 365 tenant</span>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section style={{ maxWidth: 860, margin: '0 auto 64px', padding: '0 32px' }}>
        <div className="lp-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {stats.map(s => (
            <div key={s.label} className="lp-stat-card">
              <div style={{ fontSize: 30, fontWeight: 800, color: '#F59E0B', lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#78716C', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ maxWidth: 960, margin: '0 auto 80px', padding: '0 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 10px' }}>Everything you need to manage Intune enrollment</h2>
          <p style={{ fontSize: 15, color: '#78716C', margin: 0 }}>Built by an IT admin, for IT admins — focused on the tools you actually need on incident day</p>
        </div>
        <div className="lp-features-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {features.map((f, i) => (
            <div
              key={f.title}
              className="lp-feature-card"
              onMouseEnter={() => setHoveredFeature(i)}
              onMouseLeave={() => setHoveredFeature(null)}
            >
              <div style={{ fontSize: 28, marginBottom: 12, filter: hoveredFeature === i ? 'none' : 'grayscale(20%)' }}>{f.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F4F0', marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: '#78716C', lineHeight: 1.65 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{
        maxWidth: 860, margin: '0 auto 80px', padding: '48px 32px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
      }}>
        <h2 style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, margin: '0 0 40px' }}>Up and running in 60 seconds</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32, textAlign: 'center' }}>
          {[
            { step: '1', title: 'Sign in', desc: 'Click "Sign in with Microsoft" and authenticate with your M365 account. No extra permissions needed.' },
            { step: '2', title: 'See your data', desc: 'Your Intune devices, enrollment failures and compliance status load instantly from your tenant.' },
            { step: '3', title: 'Fix & export', desc: 'Drill into any issue, follow the guided remediation steps, and export reports for your team.' },
          ].map(s => (
            <div key={s.step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, color: '#1C1917', flexShrink: 0,
              }}>{s.step}</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: '#78716C', lineHeight: 1.65 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── WHO IS IT FOR ── */}
      <section style={{ maxWidth: 860, margin: '0 auto 80px', padding: '0 32px' }}>
        <h2 style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, margin: '0 0 32px' }}>Built for the people who live in Intune</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {[
            { role: '🧑‍💻 IT Administrators', desc: 'Stop hunting through Intune portal tabs. Get one view of enrollment health, compliance and active failures.' },
            { role: '🏢 MSPs & Managed Service Providers', desc: 'Manage multiple tenants from a unified dashboard. Spot issues before your clients call you.' },
            { role: '🔧 Systems Engineers', desc: 'Deep-dive into Autopilot, ADE, Android Enterprise and SCEP certificate chains — all in one place.' },
            { role: '📈 IT Managers', desc: 'Export executive reports, track incident resolution and demonstrate compliance posture to leadership.' },
          ].map(r => (
            <div key={r.role} className="lp-feature-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F4F0' }}>{r.role}</div>
              <div style={{ fontSize: 13, color: '#78716C', lineHeight: 1.65 }}>{r.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BOTTOM CTA ── */}
      <section style={{
        maxWidth: 700, margin: '0 auto 80px', padding: '64px 32px',
        background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.03))',
        border: '1px solid rgba(245,158,11,0.2)',
        borderRadius: 20, textAlign: 'center',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B', letterSpacing: '0.06em', marginBottom: 16 }}>GET STARTED TODAY</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 16px', lineHeight: 1.25 }}>
          Start your free 30-day trial.<br />No credit card required.
        </h2>
        <p style={{ fontSize: 15, color: '#78716C', margin: '0 0 32px', lineHeight: 1.7 }}>
          Sign in with your Microsoft 365 account and get instant access to every feature.
          Upgrade to Pro to keep access after the trial.
        </p>
        <a className="lp-cta-btn" href="/api/auth/login" style={{ fontSize: 16, padding: '16px 36px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M11.4 2H2v9.4h9.4V2z" fill="#F25022"/>
            <path d="M22 2h-9.4v9.4H22V2z" fill="#7FBA00"/>
            <path d="M11.4 12.6H2V22h9.4v-9.4z" fill="#00A4EF"/>
            <path d="M22 12.6h-9.4V22H22v-9.4z" fill="#FFB900"/>
          </svg>
          Sign in with Microsoft — it's free
        </a>
        <div style={{ marginTop: 20, fontSize: 12, color: '#57534E' }}>
          Already subscribed? Sign in to restore your Pro access.
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '24px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
        fontSize: 12, color: '#57534E',
      }}>
        <div>© 2025 modernendpoint.tech · Enrollment Flow Monitor</div>
        <div style={{ display: 'flex', gap: 20 }}>
          <a href="/api/auth/login" style={{ color: '#78716C', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = '#F5F4F0')} onMouseLeave={e => (e.currentTarget.style.color = '#78716C')}>Sign In</a>
          <a href="https://moderne.gumroad.com/l/cynmjz" target="_blank" rel="noopener noreferrer" style={{ color: '#78716C', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = '#F5F4F0')} onMouseLeave={e => (e.currentTarget.style.color = '#78716C')}>Upgrade to Pro</a>
          <a href="https://modernendpoint.tech" target="_blank" rel="noopener noreferrer" style={{ color: '#78716C', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = '#F5F4F0')} onMouseLeave={e => (e.currentTarget.style.color = '#78716C')}>Website</a>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [currentView, setCurrentView] = useState<ExtendedViewName>('dashboard');
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [detailsSummary, setDetailsSummary] = useState('Select a row to view details.');
  const [detailsText, setDetailsText] = useState('');
  const [auth, setAuth] = useState({ connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false });
  const [authChecked, setAuthChecked] = useState(false);
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const isTrialExpired = auth.connected && !isSubscribed && getTrialDaysLeft(auth.upn) === 0;
  const [ocrImageFile, setOcrImageFile] = useState<File | null>(null);
  const [ocrInputText, setOcrInputText] = useState('');
  const [ocrStatusText, setOcrStatusText] = useState('OCR: Not started');
  const [ocrAssistantAnswer, setOcrAssistantAnswer] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);

  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const stored = window.localStorage.getItem('efm-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'system';
  });
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mainPanelRef = useRef<HTMLDivElement>(null);

  // ── Graph Explorer state ─────────────────────────────────
  const [gqUrl, setGqUrl] = useState('/v1.0/deviceManagement/managedDevices?$top=10&$select=deviceName,operatingSystem,complianceState,lastSyncDateTime,userPrincipalName');
  const [gqResult, setGqResult] = useState<any>(null);
  const [gqLoading, setGqLoading] = useState(false);
  const [gqError, setGqError] = useState('');
  const [gqSelectedTemplate, setGqSelectedTemplate] = useState('');

  // ── Enrollment Failures state ────────────────────────────
  const [efRows, setEfRows] = useState<any[]>([]);
  const [efLoading, setEfLoading] = useState(false);
  const [efError, setEfError] = useState('');
  const [efSearch, setEfSearch] = useState('');
  const [efOsFilter, setEfOsFilter] = useState('all');
  const [selectedEfRow, setSelectedEfRow] = useState<any>(null);
  const [efRetrying, setEfRetrying] = useState(false);

  // ── Enrollment Policy state ──────────────────────────────
  const [epData, setEpData] = useState<any>(null);
  const [epLoading, setEpLoading] = useState(false);
  const [epError, setEpError] = useState('');

  // ── Compliance Drift state ───────────────────────────────
  const [driftSnapshots, setDriftSnapshots] = useState<any[]>([]);
  const [driftLoading, setDriftLoading] = useState(false);

  // ── AI Runbook state ─────────────────────────────────────
  const [runbookRow, setRunbookRow] = useState<any>(null);
  const [runbookText, setRunbookText] = useState('');
  const [runbookLoading, setRunbookLoading] = useState(false);

  // ✅ FIX: badge counts state for sidebar
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
  const [incidentWorkflows, setIncidentWorkflows] = useState<Record<string, IncidentWorkflowRecord>>({});
  const [incidentOwnerDraft, setIncidentOwnerDraft] = useState('');
  const [incidentStatusDraft, setIncidentStatusDraft] = useState<IncidentWorkflowStatus>('New');
  const [incidentNotesDraft, setIncidentNotesDraft] = useState('');
  const [incidentWorkflowSaving, setIncidentWorkflowSaving] = useState(false);

  function addToast(kind: Toast['kind'], message: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((previous) => [...previous, { id, kind, message }]);
  }

  function statusKind(message: string): 'ok' | 'warn' | 'error' {
    const normalized = message.toLowerCase();
    if (normalized.includes('fail') || normalized.includes('error')) return 'error';
    if (normalized.includes('not') || normalized.includes('no ') || normalized.includes('empty')) return 'warn';
    return 'ok';
  }

  function openDashboardView(view: ExtendedViewName) {
    setCurrentView(view);
    setSelectedIndex(null);
    setSidebarOpen(false);
    if (view === 'incidents') setDetailsSummary('Fix Queue');
    if (view === 'windowsEnrollment') setDetailsSummary('Windows Enrollment');
    if (view === 'readinessChecklist') setDetailsSummary('Readiness Checklist');
    if (view === 'reports') setDetailsSummary('Executive Reports');
  }

  const incidentWorkflowStatuses: IncidentWorkflowStatus[] = ['New', 'Investigating', 'Mitigating', 'Resolved'];

  const selectedIncident = currentView === 'incidents' && selectedIndex !== null ? rows[selectedIndex] ?? null : null;
  const selectedIncidentSignature = String(selectedIncident?.['signature'] ?? '');

  function syncIncidentWorkflowDraft(row: Row | null) {
    const signature = String(row?.['signature'] ?? '');
    const persisted = signature ? incidentWorkflows[signature] : undefined;
    setIncidentOwnerDraft(String(persisted?.owner ?? row?.['owner'] ?? 'Unassigned'));
    setIncidentStatusDraft((persisted?.status ?? row?.['status'] ?? 'New') as IncidentWorkflowStatus);
    setIncidentNotesDraft(String(persisted?.notes ?? row?.['notes'] ?? ''));
  }

  const headers = useMemo(() => {
    const first = rows[0];
    if (!first) return [] as string[];
    return Object.keys(first).filter((key) => key !== 'details');
  }, [rows]);

  async function loadAuth() {
    try {
      const result = await getAuthStatus();
      setAuth(result);
      // Check subscription status from server
      if (result.connected) {
        try {
          const subRes = await fetch('/api/subscription/status', { credentials: 'include' });
          const subData = await subRes.json();
          setIsSubscribed(subData.subscribed === true);
        } catch (err) {
          // A transient network/parse failure here used to silently push a
          // legitimately-subscribed user into isTrialExpired gating (OCR,
          // export, and other actions disabled) with zero indication this
          // was a fetch error rather than an actual expired trial.
          console.warn('Subscription status check failed — treating as unsubscribed for this session:', err);
          setIsSubscribed(false);
        }
      }
      setAuthChecked(true);
      return result;
    } catch {
      const fallback = { connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false };
      setAuth(fallback);
      setAuthChecked(true);
      return fallback;
    }
  }

  function setConnectedPanel(summary: string, extra?: string) {
    const identity = auth.displayName || auth.upn || 'Connected user';
    setDetailsSummary(summary);
    setDetailsText(extra ?? `Signed in as ${identity}. Tenant data is available.`);
  }

  async function loadView(view: ExtendedViewName) {
    if (view === 'ocr') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('OCR assistant ready. Upload image or paste error text, then analyze.');
      setDetailsSummary('OCR & Error Assistant');
      setDetailsText(ocrAssistantAnswer || 'Pick image, run OCR, then get explanation. You can also type error text manually.');
      return;
    }

    if (view === 'privacy') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Privacy policy loaded.');
      setDetailsSummary('Privacy Policy');
      setDetailsText('Review the privacy policy content for Enrollment Flow Monitor.');
      return;
    }

    if (view === 'adminDashboard') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Admin dashboard loaded.');
      setDetailsSummary('Admin Dashboard');
      setDetailsText('Sign-in analytics and user activity.');
      return;
    }

    if (view === 'enrollmentFailures' || view === 'graphQuery') {
      // These views handle their own data loading independently
      return;
    }
    if (view === 'enrollmentPolicy') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Loading enrollment policy...');
      setEpLoading(true);
      setEpError('');
      Promise.all([
        api.get('/graph/enrollment-policy').catch((e: any) => ({ data: { error: e?.response?.data?.message ?? e?.message } })),
      ]).then(([policyRes]: any[]) => {
        if (policyRes.data?.error) {
          setEpError(policyRes.data.error);
          setStatusMessage('Enrollment Policy load failed.');
        } else {
          setEpData(policyRes.data);
          setStatusMessage('Enrollment Policy loaded.');
        }
      }).finally(() => setEpLoading(false));
      return;
    }
    if (view === 'complianceDrift') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Loading compliance drift...');
      setDriftLoading(true);
      api.get('/graph/compliance-drift').then((res: any) => {
        setDriftSnapshots(res.data?.snapshots ?? []);
        setStatusMessage('Compliance drift loaded.');
      }).catch(() => {
        setStatusMessage('Compliance drift load failed.');
      }).finally(() => setDriftLoading(false));
      return;
    }

    try {
      setIsViewLoading(true);
      const result = await getView(view);
      const safeRows = Array.isArray(result.rows) ? result.rows : [];
      setRows(safeRows);
      setSelectedIndex(safeRows.length > 0 ? 0 : null);
      setStatusMessage(result.message || `${view} loaded.`);

      if (view === 'incidents') {
        try {
          const workflowResponse = await getIncidentWorkflows();
          const workflowMap = Object.fromEntries((workflowResponse.rows ?? []).map((item) => [item.signature, item]));
          setIncidentWorkflows(workflowMap);
        } catch {
          setIncidentWorkflows({});
        }
      }

      // Capture dashboard KPI data
      if (view === 'dashboard' && safeRows[0]) {
        setDashboardData(safeRows[0]);
      }

      // Update sidebar badges
      setBadgeCounts((prev) => {
        const next = { ...prev };
        const count =
          view === 'incidents'
            ? safeRows.filter((r) => !(r as any).isPlaceholder).length
            : safeRows.length;

        next[view] = count;

        if (view === 'dashboard' && safeRows[0]) {
          const row: any = safeRows[0];
          next['windowsEnrollment'] = Number(row.windowsEnrollmentDevices ?? 0);
          next['linuxEnrollment'] = Number(row.linuxEnrollmentDevices ?? 0);
          next['mobileEnrollment'] = Number(row.mobileEnrollmentDevices ?? 0);
          next['macEnrollment'] = Number(row.macEnrollmentDevices ?? 0);
        }

        if (view === 'enrollmentErrorCatalog') {
          next['enrollmentErrorCatalog'] = safeRows.length;
        }

        return next;
      });

      if (safeRows.length === 0) {
        setDetailsSummary(auth.connected ? 'No data returned for this view.' : 'Guest preview');
        setDetailsText(
          auth.connected
            ? 'The endpoint returned an empty dataset. This is handled safely.'
            : 'You can browse the interface before signing in. Use Sign in to continue.'
        );
      } else {
        const first = safeRows[0];
        setDetailsSummary(
          toText(first['name'] ?? first['deviceName'] ?? first['displayName'] ?? first['summary'] ?? `${view} row selected`)
        );
        setDetailsText(toText(first['details'] ?? first));
      }
    } catch (error) {
      setRows([]);
      setSelectedIndex(null);
      const message = error instanceof Error ? error.message : 'Failed to load view.';
      setStatusMessage(message);
      if (auth.connected) {
        setDetailsSummary('Load failed');
        setDetailsText(message);
      } else {
        setDetailsSummary('Guest preview');
        setDetailsText('You can browse the interface before signing in. Use Sign in to continue.');
      }
      addToast('error', 'View load failed.');
    } finally {
      setIsViewLoading(false);
    }
  }

  useEffect(() => {
    void loadAuth();
  }, []);

  useEffect(() => {
    if (!auth.connected) {
      if (currentView === 'privacy') {
        setRows([]);
        setSelectedIndex(null);
        setStatusMessage('Privacy policy loaded.');
        setDetailsSummary('Privacy Policy');
        setDetailsText('Review the privacy policy content for Enrollment Flow Monitor.');
        return;
      }
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Public preview mode. Sign in to load tenant data.');
      setDetailsSummary('Guest preview');
      setDetailsText('You can browse the interface before signing in. Use Sign in to continue.');
      return;
    }

    // Handle custom views
    if (currentView === 'enrollmentErrorCatalog') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Failure Catalog: Browse known errors and fixes.');
      setDetailsSummary('Failure Catalog');
      setDetailsText('Select an error card to see details and remediation steps.');
      return;
    }
    if (currentView === 'graphQuery') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Graph Explorer ready. Select a template or enter a custom URL.');
      setDetailsSummary('Graph Explorer');
      setDetailsText('Run Graph API queries against your tenant in real-time.');
      setGqResult(null);
      setGqError('');
      return;
    }
    if (currentView === 'enrollmentFailures') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Loading enrollment failures...');
      setDetailsSummary('Enrollment Failures');
      setEfLoading(true);
      setEfError('');
      api.get('/graph/enrollment-failures').then((res: any) => {
        setEfRows(res.data.rows ?? []);
        setStatusMessage(`Enrollment Failures loaded — ${(res.data.rows ?? []).length} record(s).`);
      }).catch((err: any) => {
        const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to load enrollment failures.';
        setEfError(msg);
        setStatusMessage('Enrollment Failures load failed.');
      }).finally(() => setEfLoading(false));
      return;
    }
    if (currentView === 'reports') {
      setRows([]);
      setSelectedIndex(null);
      setConnectedPanel('Reports', 'Signed in. Loading enrollment analytics...');
      setStatusMessage('Executive Reports: Loading enrollment analytics...');
      getView('reports' as any).then(result => {
        const data = result.rows?.[0] as any;
        setReportData(data ?? null);
        setStatusMessage('Reports loaded.');
        setConnectedPanel('Reports', 'Signed in. Reports data loaded successfully.');
      }).catch((error) => {
        setStatusMessage('Reports load failed.');
        setDetailsSummary('Load failed');
        setDetailsText(error instanceof Error ? error.message : 'Reports load failed.');
      });
      return;
    }
    if (currentView === 'readinessChecklist') {
      setRows([]);
      setSelectedIndex(null);
      setConnectedPanel('Readiness Risks', 'Signed in. Loading checklist data...');
      setStatusMessage('Readiness Risks loaded.');
      getView('readinessChecklist' as any).then(result => {
        setChecklistItems(result.rows ?? []);
        setConnectedPanel('Readiness Risks', 'Signed in. Checklist data loaded successfully.');
      }).catch((error) => {
        setChecklistItems([]);
        setDetailsSummary('Load failed');
        setDetailsText(error instanceof Error ? error.message : 'Readiness checklist load failed.');
      });
      return;
    }
    if (currentView === 'dashboard') {
      setRows([]);
      setSelectedIndex(null);
      setIsViewLoading(true);
      setConnectedPanel('Dashboard overview');
      setStatusMessage('Loading dashboard...');
      getView('dashboard').then(result => {
        const data = result.rows?.[0] as any;
        setDashboardData(data ?? null);
        setStatusMessage('Dashboard loaded.');
        setConnectedPanel('Dashboard overview', 'Signed in. Dashboard metrics loaded successfully.');
        addAuditLog('View Dashboard', 'Dashboard loaded', 'info');
      }).catch((error) => {
        setStatusMessage('Dashboard load failed.');
        setDetailsSummary('Load failed');
        setDetailsText(error instanceof Error ? error.message : 'Dashboard load failed.');
      }).finally(() => setIsViewLoading(false));
      return;
    }

    void loadView(currentView);
  }, [auth.connected, currentView]);

  // Scroll main panel to top whenever the view changes
  useEffect(() => {
    mainPanelRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [currentView]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const next = themePreference === 'system' ? (media.matches ? 'dark' : 'light') : themePreference;
      setEffectiveTheme(next);
      document.documentElement.setAttribute('data-theme', next);
      window.localStorage.setItem('efm-theme', themePreference);
    };

    apply();
    const onMediaChange = () => {
      if (themePreference === 'system') apply();
    };

    media.addEventListener('change', onMediaChange);
    return () => media.removeEventListener('change', onMediaChange);
  }, [themePreference]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timeout = window.setTimeout(() => {
      setToasts((previous) => previous.slice(1));
    }, 3500);
    return () => window.clearTimeout(timeout);
  }, [toasts]);

  useEffect(() => {
    if (selectedIndex === null || !rows[selectedIndex]) {
      return;
    }

    const row = rows[selectedIndex];
    setDetailsSummary(toText(row['name'] ?? row['deviceName'] ?? row['displayName'] ?? row['summary'] ?? 'Row selected'));
    setDetailsText(toText(row['details'] ?? row));
  }, [selectedIndex, rows]);

  async function onRefresh() {
    try {
      setIsRefreshing(true);
      await loadAuth();
      await refreshData();
      if (currentView === 'dashboard') {
        const result = await getView('dashboard');
        const data = result.rows?.[0] as any;
        setDashboardData(data ?? null);
        setStatusMessage(result.message || 'Dashboard loaded.');
        setConnectedPanel('Dashboard overview', 'Signed in. Dashboard metrics loaded successfully.');
      } else if (currentView === 'reports') {
        const result = await getView('reports' as any);
        setReportData((result.rows?.[0] as any) ?? null);
        setStatusMessage(result.message || 'Reports loaded.');
        setConnectedPanel('Reports', 'Signed in. Reports data loaded successfully.');
      } else if (currentView === 'readinessChecklist') {
        const result = await getView('readinessChecklist' as any);
        setChecklistItems(result.rows ?? []);
        setStatusMessage(result.message || 'Readiness checklist loaded.');
        setConnectedPanel('Readiness Risks', 'Signed in. Checklist data loaded successfully.');
      } else {
        await loadView(currentView);
      }
      addToast('success', 'Data refreshed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refresh failed';
      setStatusMessage(message);
      setDetailsSummary('Refresh failed');
      setDetailsText(message);
      addToast('error', 'Refresh failed.');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function onDisconnect() {
    await api.post('/auth/logout');
    setAuth({ connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false });
    setRows([]);
    setSelectedIndex(null);
    setStatusMessage('Disconnected.');
    setDetailsSummary('Disconnected from tenant.');
    setDetailsText('');
    setIsUserMenuOpen(false);
    addToast('info', 'Disconnected from tenant.');
  }

  async function onCopyRunbook() {
    const row = selectedIndex !== null ? rows[selectedIndex] ?? null : null;
    const result = await copyRunbook(row);
    await navigator.clipboard.writeText(result.runbook);
    setStatusMessage('Runbook copied to clipboard.');
    addToast('success', 'Runbook copied.');
  }

  // ── Audit Trail ───────────────────────────────────────────
  const [auditLogs, setAuditLogs] = useState<Array<{
    id: string; timestamp: string; action: string; view: string;
    details: string; user: string; result: 'success' | 'fail' | 'info';
  }>>([]);

  function addAuditLog(action: string, details: string, result: 'success' | 'fail' | 'info' = 'info') {
    const entry = {
      id: String(Date.now()),
      timestamp: new Date().toISOString(),
      action,
      view: currentView,
      details,
      user: auth.upn || 'Guest',
      result
    };
    setAuditLogs(prev => [entry, ...prev].slice(0, 500));
  }

  function onOpenAuditLogs() {
    setCurrentView('auditLogs');
    if (isMobile) setSidebarOpen(false);
  }

  function onExport(format: 'json' | 'csv') {
    window.open(getExportUrl(currentView, format), '_blank');
  }


  // ── Device action helpers ─────────────────────────────────
  function getDeviceId(row: Row): string { return String(row['id'] ?? row['deviceId'] ?? ''); }
  function getDeviceName(row: Row): string {
    return toText(row['deviceName'] ?? row['displayName'] ?? row['name'] ?? 'Unknown Device');
  }

  function openConfirm(action: typeof confirmModal['action'], row?: Row) {
    // Gate on write permissions
    if (!auth.hasWritePermissions) {
      setUpgradeAction(action ?? 'this action');
      setUpgradeModalOpen(true);
      return;
    }
    if (row) {
      setConfirmModal({ open: true, action, deviceId: getDeviceId(row), deviceName: getDeviceName(row) });
    } else {
      setConfirmModal({ open: true, action, count: selectedDevices.size });
    }
  }

  function toggleFilter(filter: string) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter); else next.add(filter);
      return next;
    });
  }

  function clearFilters() {
    setActiveFilters(new Set());
    setInlineSearch('');
    setGlobalSearch('');
  }

  function saveCurrentView() {
    const defaultName = `${views.find(v => v.id === currentView)?.label ?? currentView} · ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Saved view name', defaultName)?.trim();
    if (!name) return;
    const nextView: SavedViewConfig = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name,
      view: currentView,
      search: globalSearch || inlineSearch,
      filters: Array.from(activeFilters)
    };
    setSavedViews(prev => [nextView, ...prev.filter(item => !(item.view === nextView.view && item.name === nextView.name))].slice(0, 12));
    addToast('success', `Saved view: ${name}`);
  }

  function applySavedView(view: SavedViewConfig) {
    setCurrentView(view.view);
    setInlineSearch(view.search);
    setGlobalSearch('');
    setActiveFilters(new Set(view.filters));
    addToast('info', `Loaded view: ${view.name}`);
  }

  function removeSavedView(viewId: string) {
    setSavedViews(prev => prev.filter(item => item.id !== viewId));
    addToast('success', 'Saved view removed.');
  }

  async function executeAction() {
    const { action, deviceId, count } = confirmModal;
    setConfirmModal(m => ({ ...m, open: false }));
    if (!action) return;

    const isBulk = action.startsWith('bulk-');

    if (isBulk) {
      setActionLoading('bulk');
      const ids = Array.from(selectedDevices);
      const bulkMap: Record<string, 'sync' | 'reboot' | 'autopilotReset'> = {
        'bulk-sync': 'sync', 'bulk-reboot': 'reboot', 'bulk-reset': 'autopilotReset'
      };
      try {
        const res = await deviceBulkAction(ids, bulkMap[action]);
        const ok = res.results.filter(r => r.ok).length;
        addToast('success', `Bulk action: ${ok}/${ids.length} devices succeeded`);
        addAuditLog(`Bulk ${bulkMap[action]}`, `${ok}/${ids.length} devices affected`, ok === ids.length ? 'success' : 'fail');
        setSelectedDevices(new Set());
      } catch (e: any) {
        addToast('error', `Bulk action failed: ${e?.message ?? 'Unknown error'}`);
        addAuditLog(`Bulk ${action}`, `Failed: ${e?.message ?? 'Unknown'}`, 'fail');
      } finally {
        setActionLoading(null);
      }
      return;
    }

    if (!deviceId) return;
    setActionLoading(deviceId);
    try {
      if (action === 'sync') await deviceSync(deviceId);
      else if (action === 'reboot') await deviceReboot(deviceId);
      else if (action === 'autopilotReset') await deviceAutopilotReset(deviceId);
      else if (action === 'retire') await deviceRetire(deviceId);
      else if (action === 'wipe') await deviceWipe(deviceId);
      else if (action === 'collectDiagnostics') await deviceCollectDiagnostics(deviceId);
      else if (action === 'rotateBitLockerKeys') await deviceRotateBitLockerKeys(deviceId);
      else if (action === 'resetPasscode') await deviceResetPasscode(deviceId);
      const labelMap: Record<string, string> = {
        sync: 'Sync', reboot: 'Reboot', autopilotReset: 'Autopilot Reset',
        retire: 'Retire', wipe: 'Wipe', collectDiagnostics: 'Collect Diagnostics',
        rotateBitLockerKeys: 'Rotate BitLocker Keys', resetPasscode: 'Reset Passcode'
      };
      const label = labelMap[action] ?? action;
      addToast('success', `${label} command sent successfully`);
      addAuditLog(label, `Device: ${confirmModal.deviceName} (${deviceId})`, 'success');
    } catch (e: any) {
      addToast('error', `Action failed: ${e?.message ?? 'Unknown error'}`);
      addAuditLog(action, `Failed on ${confirmModal.deviceName}: ${e?.message ?? 'Unknown'}`, 'fail');
    } finally {
      setActionLoading(null);
    }
  }

  function toggleDeviceSelect(deviceId: string) {
    setSelectedDevices(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId); else next.add(deviceId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedDevices.size === filteredRows.length) {
      setSelectedDevices(new Set());
    } else {
      setSelectedDevices(new Set(filteredRows.map(r => getDeviceId(r)).filter(Boolean)));
    }
  }

  // Device views that support remediation actions
  const DEVICE_VIEWS: ExtendedViewName[] = ['windowsEnrollment', 'linuxEnrollment', 'mobileEnrollment', 'macEnrollment'];
  const isDeviceView = DEVICE_VIEWS.includes(currentView);

  async function onSaveIncidentWorkflow() {
    if (!selectedIncidentSignature) return;
    try {
      setIncidentWorkflowSaving(true);
      const saved = await saveIncidentWorkflow(selectedIncidentSignature, {
        owner: incidentOwnerDraft.trim() || 'Unassigned',
        status: incidentStatusDraft,
        notes: incidentNotesDraft.trim()
      });
      setIncidentWorkflows((prev) => ({ ...prev, [saved.signature]: saved }));
      setRows((prev) => prev.map((row) => String(row['signature'] ?? '') === saved.signature ? ({ ...row, owner: saved.owner, status: saved.status, notes: saved.notes, workflowUpdatedAt: saved.updatedAt }) : row));
      addToast('success', 'Incident workflow saved.');
      addAuditLog('Incident workflow updated', `${saved.signature} → ${saved.status} (${saved.owner})`, 'success');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to save incident workflow.');
    } finally {
      setIncidentWorkflowSaving(false);
    }
  }

  function onPickImage() {
    fileInputRef.current?.click();
  }

  async function onRunOcr() {
    if (!ocrImageFile) {
      setOcrStatusText('OCR: No image selected');
      return;
    }

    setOcrBusy(true);
    setOcrStatusText('OCR: Running...');
    try {
      const result = await recognize(ocrImageFile, 'eng', { workerPath: '/tesseract/worker.min.js', workerBlobURL: false });
      const extracted = (result.data.text ?? '').trim();
      if (!extracted) {
        setOcrStatusText('OCR: Completed, no text found');
        setStatusMessage('OCR found no readable text. Paste visible error text manually.');
        return;
      }

      setOcrInputText(extracted.length > 12000 ? extracted.substring(0, 12000) : extracted);
      setOcrStatusText('OCR: Success');
      setStatusMessage('OCR completed. Click Get Explanation.');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setOcrStatusText('OCR: Failed (manual text needed)');
      setStatusMessage(errMsg || 'OCR failed. Paste text manually.');
      setOcrInputText(`[OCR Error — paste text manually]\n\n${errMsg}`);
    } finally {
      setOcrBusy(false);
    }
  }

  async function onGetOcrExplanation() {
    const input = ocrInputText.trim();
    if (!input) {
      setStatusMessage('Enter error text or run OCR first.');
      setOcrAssistantAnswer('No input detected. Paste error text or run OCR first, then click Get Explanation.');
      return;
    }

    setOcrBusy(true);
    try {
      const response = await api.post('/ocr/explain', { text: input });
      const payload = response.data as {
        category?: string;
        confidence?: number;
        cause?: string;
        recommendedActions?: string[];
      };

      const category =
        typeof payload.category === 'string' && payload.category.trim().length > 0 ? payload.category : 'Unknown';
      const confidence = Number.isFinite(payload.confidence) ? payload.confidence : 0;
      const cause =
        typeof payload.cause === 'string' && payload.cause.trim().length > 0
          ? payload.cause
          : 'No explicit cause returned by analyzer.';
      const actions = Array.isArray(payload.recommendedActions)
        ? payload.recommendedActions.filter((action) => typeof action === 'string' && action.trim().length > 0)
        : [];

      const answer = [
        `Category: ${category}`,
        `Confidence: ${confidence}`,
        `Cause: ${cause}`,
        'Recommended Actions:',
        ...(actions.length > 0
          ? actions.map((action, index) => `${index + 1}. ${action}`)
          : ['1. No recommended actions were returned. Refine the pasted error text and retry.'])
      ].join('\n');

      setOcrAssistantAnswer(answer);
      setDetailsSummary('OCR Explanation');
      setDetailsText(answer);
      setStatusMessage('OCR explanation generated.');
      addToast('success', 'OCR explanation generated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate OCR explanation.';
      const fallback = ['Explanation failed.', `Reason: ${message}`, 'Try pasting only the exact error sentence and run again.'].join(
        '\n'
      );
      setOcrAssistantAnswer(fallback);
      setDetailsSummary('OCR Explanation Failed');
      setDetailsText(fallback);
      setStatusMessage(message);
      addToast('error', 'OCR explanation failed.');
    } finally {
      setOcrBusy(false);
    }
  }

  function onCycleTheme() {
    setThemePreference((current) => {
      if (current === 'system') return 'light';
      if (current === 'light') return 'dark';
      return 'system';
    });
  }


  const [errorSearch, setErrorSearch] = useState('');
  const [errorFilter, setErrorFilter] = useState<'all' | 'high' | 'medium' | 'low' | 'Windows' | 'iOS' | 'Android' | 'macOS'>('all');
  const [expandedError, setExpandedError] = useState<string | null>(null);

  // Reports state
  const [reportData, setReportData] = useState<any>(null);

  // Readiness Risks state
  const [checklistScenario, setChecklistScenario] = useState<'autopilot' | 'ade-ios' | 'ade-macos' | 'android-enterprise'>('autopilot');
  const [checklistItems, setChecklistItems] = useState<any[]>([]);

  // Tutorial modal state
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // Dashboard KPI state
  const [dashboardData, setDashboardData] = useState<any>(null);

  const demoDashboardData = useMemo(() => ({
    totalDevices: 128,
    windowsEnrollmentDevices: 74,
    mobileEnrollmentDevices: 31,
    macEnrollmentDevices: 15,
    linuxEnrollmentDevices: 8,
    failedEnrollments: 11,
    readinessRisks: 7,
    healthScore: 84,
    activeIncidents: 3,
    lastRefresh: new Date().toISOString()
  }), []);


  // ── Device Remediation state ─────────────────────────────
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    action: 'sync' | 'reboot' | 'autopilotReset' | 'bulk-sync' | 'bulk-reboot' | 'bulk-reset' | 'retire' | 'wipe' | 'collectDiagnostics' | 'rotateBitLockerKeys' | 'resetPasscode' | null;
    deviceId?: string;
    deviceName?: string;
    count?: number;
  }>({ open: false, action: null });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [inlineSearch, setInlineSearch] = useState('');
  const inlineSearchRef = useRef<HTMLInputElement>(null);

  // ── Upgrade Access / Permission Modal ────────────────────
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeAction, setUpgradeAction] = useState<string>('');

  // ── Filter Chips ─────────────────────────────────────────
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [savedViews, setSavedViews] = useState<SavedViewConfig[]>(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_VIEW_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_VIEW_STORAGE_KEY, JSON.stringify(savedViews));
    } catch {
      // ignore storage errors
    }
  }, [savedViews]);


  // ── Global Search (Ctrl+K) ───────────────────────────────
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const globalSearchRef = useRef<HTMLInputElement>(null);

  // ── JSON Viewer Modal ────────────────────────────────────
  const [jsonModalRow, setJsonModalRow] = useState<Row | null>(null);

  // Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => globalSearchRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setGlobalSearch('');
        setJsonModalRow(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filteredErrors = useMemo(() => ERROR_CATALOG.filter(e => {
    const matchesSearch = !errorSearch ||
      e.title.toLowerCase().includes(errorSearch.toLowerCase()) ||
      e.code.toLowerCase().includes(errorSearch.toLowerCase()) ||
      e.description.toLowerCase().includes(errorSearch.toLowerCase());
    const matchesFilter = errorFilter === 'all' ||
      e.severity === errorFilter ||
      e.platforms.includes(errorFilter as string);
    return matchesSearch && matchesFilter;
  }), [errorSearch, errorFilter]);

  // Global search + smart filters combined
  const filteredRows = useMemo(() => {
    let result = rows;
    const q = (globalSearch || inlineSearch).toLowerCase().trim();

    if (q) {
      result = result.filter(row =>
        Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))
      );
    }

    if (currentView === 'incidents') {
      if (activeFilters.has('p1')) {
        result = result.filter(r => String(r['priority'] ?? '').toLowerCase() === 'p1');
      }
      if (activeFilters.has('critical')) {
        result = result.filter(r => {
          const severity = String(r['severity'] ?? '').toLowerCase();
          return severity.includes('critical') || severity.includes('high');
        });
      }
      if (activeFilters.has('investigating')) {
        result = result.filter(r => String(r['status'] ?? '').toLowerCase() === 'investigating');
      }
      if (activeFilters.has('unassigned')) {
        result = result.filter(r => {
          const owner = String(r['owner'] ?? '').trim().toLowerCase();
          return owner === '' || owner === 'unassigned';
        });
      }
      if (activeFilters.has('no-notes')) {
        result = result.filter(r => !String(r['notes'] ?? '').trim());
      }
      if (activeFilters.has('resolved')) {
        result = result.filter(r => String(r['status'] ?? '').toLowerCase() === 'resolved');
      }
      return result;
    }

    if (isDeviceView) {
      if (activeFilters.has('non-compliant')) {
        result = result.filter(r => String(r['complianceState'] ?? '').toLowerCase().includes('non'));
      }
      if (activeFilters.has('stale')) {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        result = result.filter(r => {
          const ts = r['lastSyncDateTime'] ?? r['enrolledDateTime'] ?? r['lastCheckInTime'];
          return ts ? new Date(String(ts)).getTime() < cutoff : false;
        });
      }
      if (activeFilters.has('windows')) {
        result = result.filter(r => String(r['operatingSystem'] ?? r['platform'] ?? '').toLowerCase().includes('windows'));
      }
      if (activeFilters.has('unknown-user')) {
        result = result.filter(r => {
          const upn = String(r['userPrincipalName'] ?? '').trim().toLowerCase();
          return upn === '' || upn === 'unknown';
        });
      }
      if (activeFilters.has('errors')) {
        result = result.filter(r =>
          String(r['enrollmentState'] ?? r['status'] ?? '').toLowerCase().includes('fail') ||
          String(r['complianceState'] ?? '').toLowerCase().includes('error') ||
          String(r['complianceState'] ?? '').toLowerCase().includes('unknown')
        );
      }
    }

    return result;
  }, [rows, globalSearch, inlineSearch, activeFilters, currentView, isDeviceView]);

  const visibleFilterChips = currentView === 'incidents' ? INCIDENT_FILTER_CHIPS : isDeviceView ? DEVICE_FILTER_CHIPS : [];

  const sortedIncidentRows = useMemo(() => {
    if (currentView !== 'incidents') return filteredRows;
    return [...filteredRows].sort((left, right) => {
      const scoreDifference = getIncidentSortScore(left) - getIncidentSortScore(right);
      if (scoreDifference !== 0) return scoreDifference;
      return Number(right['impactedCount'] ?? 0) - Number(left['impactedCount'] ?? 0);
    });
  }, [currentView, filteredRows]);
  const scopedSavedViews = savedViews.filter(view => view.view === currentView);

  // Detect mobile — reactive to window resize
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── PDF Export ───────────────────────────────────────────
  async function generateEnrollmentPDF(data: any, toast: (k: 'info' | 'success' | 'error', m: string) => void) {
    if (!data) return;
    toast('info', 'Generating PDF report...');
    try {
      // Load jsPDF dynamically from CDN
      await new Promise<void>((resolve, reject) => {
        if ((window as any).jspdf) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
      });
      const { jsPDF } = (window as any).jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = 210, H = 297;
      const navy = [13,27,42], navyMid = [22,32,50], navyLight = [30,45,66];
      const amber = [245,158,11], teal = [14,165,233], green = [16,185,129];
      const red = [239,68,68], purple = [99,102,241];
      const txt = [232,237,245], muted = [122,144,171];

      // Load both logo versions as base64
      const loadImg = async (path: string) => {
        try {
          const resp = await fetch(path);
          if (!resp.ok) return '';
          const buf = await resp.arrayBuffer();
          let bin = '';
          new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
          return btoa(bin);
        } catch(_) { return ''; }
      };
      const logoAmberB64     = await loadImg('/logo.png');          // amber, full opacity
      const logoWatermarkB64 = await loadImg('/logo_watermark.png'); // amber, 15% opacity

      const drawPageShell = (pg: number, total: number) => {
        // Background
        doc.setFillColor(...navy); doc.rect(0, 0, W, H, 'F');
        // Watermark — amber logo pre-baked at low opacity, centered
        if (logoWatermarkB64) {
          try { doc.addImage(`data:image/png;base64,${logoWatermarkB64}`, 'PNG', W/2-45, H/2-45, 90, 90, 'wm', 'NONE'); } catch(_) {}
        }
        // Header bar
        doc.setFillColor(...navyMid); doc.rect(0, 0, W, 20, 'F');
        doc.setFillColor(...amber);   doc.rect(0, 20, W, 0.7, 'F');
        // Logo in header (amber, clear)
        if (logoAmberB64) {
          try { doc.addImage(`data:image/png;base64,${logoAmberB64}`, 'PNG', 6, 2, 16, 16, 'hdr', 'NONE'); } catch(_) {}
        }
        doc.setTextColor(...amber);   doc.setFontSize(10); doc.setFont('helvetica','bold');
        doc.text('MODERN ENDPOINT', 25, 8);
        doc.setTextColor(...muted);   doc.setFontSize(5.5); doc.setFont('helvetica','normal');
        doc.text('Enterprise Architecture Journal', 25, 13);
        doc.setTextColor(...amber);   doc.setFontSize(11); doc.setFont('helvetica','bold');
        doc.text('Enrollment Flow Monitor — Report', W-8, 9, {align:'right'});
        doc.setTextColor(...muted);   doc.setFontSize(5.5); doc.setFont('helvetica','normal');
        doc.text(`Generated: ${new Date().toLocaleString()}`, W-8, 15, {align:'right'});
        // Footer
        doc.setFillColor(...navyMid); doc.rect(0, H-10, W, 10, 'F');
        doc.setFillColor(...amber);   doc.rect(0, H-10, W, 0.4, 'F');
        doc.setTextColor(...muted);   doc.setFontSize(5.5);
        doc.text('enrollment.modernendpoint.tech  ·  Enrollment Flow Monitor', 8, H-3.5);
        doc.text(`© ${new Date().getFullYear()} modernendpoint.tech — Confidential`, W/2, H-3.5, {align:'center'});
        doc.text(`Page ${pg} of ${total}`, W-8, H-3.5, {align:'right'});
      };

      let y = 0;
      const section = (title: string) => {
        doc.setFillColor(...navyLight); doc.rect(8, y, W-16, 7, 'F');
        doc.setFillColor(...amber);     doc.rect(8, y, 1.2, 7, 'F');
        doc.setTextColor(...txt);       doc.setFontSize(6.5); doc.setFont('helvetica','bold');
        doc.text(title.toUpperCase(), 13, y+4.8);
        y += 11;
      };

      // ── PAGE 1 ──────────────────────────────────────────
      drawPageShell(1, 2);
      y = 25;

      // KPI row
      const kw = (W-16-9)/4, kh = 22;
      const kpis = [
        ['Total Devices',    String(data.totalDevices??0),                      teal],
        ['Compliance Rate',  `${data.overallComplianceRate??0}%`,               green],
        ['Active Incidents', String(data.activeIncidents??0),                   (data.activeIncidents??0)>0?red:green],
        ['Platforms',        String((data.platformBreakdown??[]).length),        purple],
      ] as [string, string, number[]][];
      kpis.forEach(([label, val, col], i) => {
        const x = 8 + i*(kw+3);
        doc.setFillColor(...navyLight); doc.roundedRect(x, y, kw, kh, 2, 2, 'F');
        doc.setFillColor(...col);       doc.roundedRect(x, y, kw, 2, 1, 1, 'F');
        doc.setTextColor(...col);       doc.setFontSize(16); doc.setFont('helvetica','bold');
        doc.text(val, x+kw/2, y+kh/2+2, {align:'center'});
        doc.setTextColor(...muted);     doc.setFontSize(5.5); doc.setFont('helvetica','normal');
        doc.text(label, x+kw/2, y+kh-2.5, {align:'center'});
      });
      y += kh + 8;

      // Platform breakdown
      section('Platform Breakdown');
      (data.platformBreakdown??[]).forEach((p: any) => {
        const tot = p.count||1, pct = p.compliant/tot;
        const bx=50, bw=W-50-36, bh=5;
        doc.setTextColor(...txt); doc.setFontSize(7); doc.setFont('helvetica','normal');
        doc.text(p.platform, 10, y+3.8);
        doc.setFillColor(...navyLight); doc.roundedRect(bx, y, bw, bh, 2, 2, 'F');
        doc.setFillColor(...green);     doc.roundedRect(bx, y, bw*pct, bh, 2, 2, 'F');
        if (p.nonCompliant>0) { doc.setFillColor(...red); doc.roundedRect(bx+bw*pct, y, bw*(p.nonCompliant/tot), bh, 2, 2, 'F'); }
        doc.setTextColor(...muted); doc.setFontSize(6);
        doc.text(`${p.compliant} ✓  ${p.nonCompliant} ✗  / ${p.count}`, W-8, y+4, {align:'right'});
        y += 10;
      });
      y += 4;

      // Health scores
      const hs = data.healthScores??[];
      if (hs.length > 0) {
        section('Platform Health Scores');
        const cw = (W-16-(hs.length-1)*3)/hs.length, ch=28;
        hs.forEach((h: any, i: number) => {
          const cx = 8+i*(cw+3);
          doc.setFillColor(...navyLight); doc.roundedRect(cx, y, cw, ch, 2, 2, 'F');
          const sc = h.score>=75?green:h.score>=50?amber:red;
          doc.setTextColor(...sc); doc.setFontSize(14); doc.setFont('helvetica','bold');
          doc.text(String(h.score), cx+cw/2, y+14, {align:'center'});
          doc.setFontSize(5); doc.setFont('helvetica','normal');
          doc.text('/100', cx+cw/2, y+19, {align:'center'});
          doc.setTextColor(...txt); doc.setFontSize(6); doc.setFont('helvetica','bold');
          doc.text(h.platform, cx+cw/2, y+25, {align:'center'});
        });
        y += ch + 8;
      }

      // ── PAGE 2 ──────────────────────────────────────────
      doc.addPage();
      drawPageShell(2, 2);
      y = 25;

      // Top errors table
      const errs = data.topErrors??[];
      if (errs.length > 0) {
        section('Top Enrollment Errors');
        const sevC: Record<string,number[]> = {High:red, Medium:amber, Low:teal};
        errs.slice(0,12).forEach((e: any, i: number) => {
          const rh=8, ry=y;
          doc.setFillColor(...(i%2===0?navyLight:navyMid)); doc.rect(8, ry, W-16, rh, 'F');
          doc.setTextColor(...muted); doc.setFontSize(6); doc.setFont('helvetica','bold');
          doc.text(`#${i+1}`, 11, ry+5.5);
          const sc = sevC[e.severity]??teal;
          doc.setFillColor(...sc); doc.roundedRect(18, ry+1.5, 13, 5, 1, 1, 'F');
          doc.setTextColor(255,255,255); doc.setFontSize(4.5); doc.setFont('helvetica','bold');
          doc.text((e.severity||'LOW').toUpperCase(), 24.5, ry+5.2, {align:'center'});
          doc.setTextColor(...teal); doc.setFontSize(6); doc.setFont('helvetica','bold');
          doc.text(String(e.errorCode), 34, ry+5.5);
          doc.setTextColor(...txt); doc.setFontSize(6); doc.setFont('helvetica','normal');
          doc.text(String(e.title||'').substring(0,68), 70, ry+5.5);
          doc.setTextColor(...amber); doc.setFontSize(6); doc.setFont('helvetica','bold');
          doc.text(`${e.count} devices`, W-10, ry+5.5, {align:'right'});
          y += rh+1;
        });
        y += 6;
      }

      // Executive summary
      section('Executive Summary');
      doc.setFillColor(...navyLight); doc.roundedRect(8, y, W-16, 38, 2, 2, 'F');
      doc.setFillColor(...amber);     doc.rect(8, y, 1.2, 38, 'F');
      const lines = [
        `Total managed devices: ${data.totalDevices??'N/A'}`,
        `Overall compliance rate: ${data.overallComplianceRate??'N/A'}%`,
        `Active incidents: ${data.activeIncidents??0}`,
        `Platforms monitored: ${(data.platformBreakdown??[]).map((p:any)=>p.platform).join(', ')}`,
        `Report generated: ${new Date().toLocaleString()}`,
        `Source: Enrollment Flow Monitor · enrollment.modernendpoint.tech`,
      ];
      lines.forEach((line, i) => {
        doc.setTextColor(...(i===lines.length-1?muted:txt)); doc.setFontSize(7); doc.setFont('helvetica', i===0?'bold':'normal');
        doc.text(line, 14, y+7+i*5.5);
      });

      doc.save(`enrollment-report-${new Date().toISOString().slice(0,10)}.pdf`);
      toast('success', 'PDF exported successfully!');
    } catch(err) {
      console.error('PDF generation error:', err);
      toast('error', 'PDF generation failed — check console');
    }
  }

  // ── Landing page (shown to unauthenticated visitors) ───────────────────────
  if (authChecked && !auth.connected) {
    return <LandingPage />;
  }

  // ── Loading splash (auth check in flight) ────────────────────────────────
  if (!authChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1C1917' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <img src="/efm-logo.svg" alt="EFM" style={{ width: 48, height: 48, opacity: 0.85 }} />
          <div style={{ width: 32, height: 32, border: '3px solid rgba(245,158,11,0.3)', borderTopColor: '#F59E0B', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div style={{ padding: '4px 12px 0' }}><SupervisorWidget /></div>
      <div className="surface topbar">
        <div className="topbar-left">
          {isMobile && (
            <button className="btn-hamburger" onClick={() => setSidebarOpen(true)}>&#9776;</button>
          )}
          <div className="logo-pill">
            <img src="/efm-logo.svg" className="logo-img" alt="EFM" style={{ width: 34, height: 34 }} />
            <div className="logo-text">
              <span className="logo-title">Enrollment Flow</span>
              <span className="logo-sub">Monitor</span>
            </div>
          </div>
          <div className="topbar-titles">
            <span className="topbar-title">Enrollment Flow Monitor</span>
            {!isMobile && (
              <span className="topbar-subtitle">
                {auth.connected ? `● Signed in: ${auth.upn}` : '● Public preview mode'}
              </span>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          {/* Search — always visible */}
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => { setSearchOpen(true); setTimeout(() => globalSearchRef.current?.focus(), 50); }}
          >
            <span>🔍</span>
            <span>Search</span>
          </button>


          {/* Theme — hidden on mobile (accessible from sidebar) */}
          {!isMobile && (
            <button className="btn btn-secondary" onClick={onCycleTheme}>
              {themePreference === 'system' ? `Theme: ${effectiveTheme}` : `Theme: ${themePreference}`}
            </button>
          )}

          {/* Connected pill — hidden on mobile */}
          {auth.connected && !isMobile && (
            auth.hasWritePermissions ? (
              <span className="status-connected-pill perm-write"><span className="status-dot-pulse" />Write Access</span>
            ) : (
              <button className="perm-readonly-pill" onClick={() => setUpgradeModalOpen(true)} title="Upgrade to Write Access">
                🔒 Read Only
              </button>
            )
          )}

          {/* Auth actions */}
          {!auth.connected ? (
            <button className="btn btn-primary" onClick={() => { window.location.href = '/api/auth/login'; }}>
              {isMobile ? 'Sign in' : '🔑 Sign in'}
            </button>
          ) : (
            <>
              {/* Refresh — icon only on mobile */}
              <button className="btn btn-primary topbar-refresh-btn" onClick={onRefresh} disabled={isRefreshing || isTrialExpired} title={isTrialExpired ? '🔒 Trial expired — upgrade to refresh' : 'Refresh data'}>
                {isRefreshing ? '↻' : '↻ Refresh'}
              </button>
              <div className="user-menu" style={{ position: 'relative' }}>
                <div className="user-chip-btn" onClick={() => setIsUserMenuOpen((current) => !current)}>
                  <div className="user-chip-avatar">{(auth.displayName || auth.upn || 'U')[0].toUpperCase()}</div>
                  {!isMobile && <span className="user-chip-name">{auth.displayName || auth.upn?.split('@')[0] || 'Account'}</span>}
                </div>
                {isUserMenuOpen && (
                  <div className="user-menu-pop">
                    <div className="menu-user">{auth.upn || 'Connected user'}</div>
                    {isMobile && (
                      <button className="btn btn-secondary text-left" onClick={onCycleTheme} style={{ width: '100%' }}>
                        Theme: {themePreference}
                      </button>
                    )}
                    {ADMIN_EMAILS.includes((auth.upn ?? '').toLowerCase()) && (
                      <button className="btn btn-secondary" style={{ marginBottom: 4 }} onClick={() => { setCurrentView('adminDashboard'); setIsUserMenuOpen(false); }}>
                        🛡️ Admin Dashboard
                      </button>
                    )}
                    <button className="btn btn-danger" onClick={onDisconnect}>Disconnect</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Trial Banner ─────────────────────────────────────────────── */}
      {auth.connected && (() => {
        const daysLeft = getTrialDaysLeft(auth.upn);
        if (daysLeft === Infinity) return null;          // exempt user — no banner
        if (isSubscribed) return null;                   // paid subscriber — no banner
        if (trialBannerDismissed && daysLeft > 0) return null; // dismissed (not expired)
        const isUrgent  = daysLeft > 0 && daysLeft <= 7;
        const isExpired = daysLeft === 0;
        const progress  = Math.round(((TRIAL_DAYS_TOTAL - daysLeft) / TRIAL_DAYS_TOTAL) * 100);
        const color     = isExpired ? '#ef4444' : isUrgent ? '#f59e0b' : '#22c55e';
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', minHeight: 36,
            background: isExpired ? '#1a0a0a' : isUrgent ? '#1a1600' : '#141a1f',
            borderBottom: `1px solid ${color}33`,
            flexWrap: 'wrap', fontFamily: "'DM Mono', monospace", fontSize: 12,
          }}>
            {/* Badge */}
            <div style={{ display:'flex', alignItems:'center', gap:5, padding:'2px 9px', borderRadius:4,
              border:`1px solid ${color}44`, background:`${color}14`, flexShrink:0 }}>
              <div style={{ width:5, height:5, borderRadius:'50%', background:color,
                animation: isUrgent ? 'efm-blink 1s ease-in-out infinite' : 'none' }} />
              <span style={{ fontSize:10, fontWeight:500, letterSpacing:'0.08em', color, textTransform:'uppercase' }}>
                {isExpired ? 'Trial Ended' : isUrgent ? 'Expiring Soon' : 'Trial Active'}
              </span>
            </div>
            {/* Message */}
            <span style={{ color:'#94a3b8', whiteSpace:'nowrap' }}>
              {isExpired
                ? <><b style={{color:'#e2e8f0', fontWeight:500}}>{auth.upn}</b> — trial ended, upgrade to restore access</>
                : <>Signed in: {auth.upn} &nbsp;·&nbsp; <b style={{color, fontWeight:500}}>{daysLeft} {daysLeft===1?'day':'days'} remaining</b></>
              }
            </span>
            {/* Features (normal state only) */}
            {!isUrgent && !isExpired && ['All features', 'Export CSV/JSON', 'Full support'].map(f => (
              <span key={f} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#475569' }}>
                <span style={{ width:4, height:4, borderRadius:'50%', background:'#22c55e', display:'inline-block' }} />
                {f}
              </span>
            ))}
            <div style={{ flex:1 }} />
            {/* Progress */}
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <div style={{ width:88, height:2, background:'#2a2f3d', borderRadius:99, overflow:'hidden' }}>
                <div style={{ width:`${progress}%`, height:'100%', background:color, borderRadius:99, transition:'width .4s' }} />
              </div>
              <span style={{ fontSize:11, color:'#475569' }}>{TRIAL_DAYS_TOTAL - Math.min(daysLeft, TRIAL_DAYS_TOTAL)}/{TRIAL_DAYS_TOTAL} days</span>
            </div>
            {/* CTA */}
            <button onClick={() => window.open('https://moderne.gumroad.com/l/cynmjz', '_blank')} style={{
              padding:'4px 14px', borderRadius:5, fontSize:11, fontFamily:'inherit', fontWeight:500,
              cursor:'pointer', border:`1px solid ${color}55`, background:`${color}14`, color, flexShrink:0,
            }}>
              ↑ {isExpired ? 'Restore Access' : isUrgent ? 'Upgrade Now' : 'Upgrade to Pro'}
            </button>
            {/* Dismiss (not on expired) */}
            {!isExpired && (
              <button onClick={() => setTrialBannerDismissed(true)} style={{
                background:'none', border:'none', cursor:'pointer', color:'#334155', fontSize:14, padding:4,
              }}>✕</button>
            )}
            <style>{`@keyframes efm-blink { 0%,100%{opacity:1} 50%{opacity:.2} }`}</style>
          </div>
        );
      })()}
      {/* ─────────────────────────────────────────────────────────────── */}

      <div className={isMobile ? "flex flex-col gap-3" : "content-grid"}>
        {/* Sidebar: Drawer for mobile, panel for desktop */}
        {isMobile ? (
          sidebarOpen && (
            <div ref={sidebarRef} className="fixed inset-0 bg-black bg-opacity-40 z-50 flex" onClick={() => setSidebarOpen(false)}>
              <div className="panel w-64 h-full overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="nav-list">
                  {views.map((view) => (
                    <button
                      key={view.id}
                      className={`nav-btn ${currentView === view.id ? 'active' : ''}`}
                      onClick={() => { setCurrentView(view.id); setSidebarOpen(false); }}
                    >
                      <span className={`nav-icon ${view.id === 'windowsEnrollment' ? 'nav-icon-device' : ''}`}>{view.icon}</span>
                      <span className="nav-label">{view.label}</span>
                      {badgeCounts[view.id] ? (
                        <span className="badge" title="Count">{badgeCounts[view.id]}</span>
                      ) : null}
                    </button>
                  ))}
                  <div className="section-divider" />
                  <button className="btn btn-secondary text-left" onClick={() => { onExport('csv'); setSidebarOpen(false); }} disabled={!auth.connected || isTrialExpired}>Export CSV</button>
                  <button className="btn btn-secondary text-left" onClick={() => { onExport('json'); setSidebarOpen(false); }} disabled={!auth.connected || isTrialExpired}>Export JSON</button>
                  <button className="btn btn-secondary text-left" onClick={() => { onCopyRunbook(); setSidebarOpen(false); }} disabled={!auth.connected || isTrialExpired}>Copy Runbook</button>
                  {auth.connected && (
                    <button className="btn btn-danger text-left" onClick={() => { void onDisconnect(); setSidebarOpen(false); }}>
                      Disconnect
                    </button>
                  )}
                  <div className="section-divider" />
                  <a
                    className="btn-ai-sidebar"
                    href="https://chatgpt.com/g/g-698c483ab6888191a8ac539d2944f696-m-intune-architect-ai-enterprise-edition"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <span className="ai-icon">🤖</span>
                    <span className="ai-text">
                      <span className="ai-label">M-Intune Architect AI</span>
                      <span className="ai-sub">Enterprise Edition</span>
                    </span>
                  </a>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="panel">
            <div className="nav-list">
              {views.map((view) => (
                <button
                  key={view.id}
                  className={`nav-btn ${currentView === view.id ? 'active' : ''}`}
                  onClick={() => setCurrentView(view.id as ExtendedViewName)}
                >
                  <span className={`nav-icon ${view.id === 'windowsEnrollment' ? 'nav-icon-device' : ''}`}>{view.icon}</span>
                  <span className="nav-label">{view.label}</span>
                  {badgeCounts[view.id] ? (
                    <span className="badge" title="Count">{badgeCounts[view.id]}</span>
                  ) : null}
                </button>
              ))}
              <div className="section-divider" />
              <button className="btn btn-secondary text-left" onClick={() => onExport('csv')} disabled={!auth.connected || isTrialExpired}>Export CSV</button>
              <button className="btn btn-secondary text-left" onClick={() => onExport('json')} disabled={!auth.connected || isTrialExpired}>Export JSON</button>
              <button className="btn btn-secondary text-left" onClick={onCopyRunbook} disabled={!auth.connected || isTrialExpired}>Copy Runbook</button>
              <div className="section-divider" />
              <a
                className="btn-ai-sidebar"
                href="https://chatgpt.com/g/g-698c483ab6888191a8ac539d2944f696-m-intune-architect-ai-enterprise-edition"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="ai-icon">🤖</span>
                <span className="ai-text">
                  <span className="ai-label">M-Intune Architect AI</span>
                  <span className="ai-sub">Enterprise Edition</span>
                </span>
              </a>
            </div>
          </div>
        )}

        <div className="panel" ref={mainPanelRef} style={(currentView === 'graphQuery' || currentView === 'enrollmentFailures' || currentView === 'enrollmentPolicy' || currentView === 'complianceDrift') ? { gridColumn: '2 / 4' } : {}}>
          {currentView === 'adminDashboard' ? (
            <AdminDashboard />
          ) : currentView === 'privacy' ? (
            <div className="privacy-shell">
              <div className="privacy-header">
                <button className="btn btn-secondary" style={{ fontSize: 11, marginBottom: 16, alignSelf: 'flex-start' }} onClick={() => setCurrentView('dashboard')}>← Back</button>
                <h1 className="privacy-title">Privacy Policy</h1>
                <p className="privacy-effective">Effective date: January 1, 2025 · <a href="https://modernendpoint.tech" target="_blank" rel="noopener noreferrer" className="privacy-site-link">modernendpoint.tech</a></p>
              </div>
              <div className="privacy-body">
                {[
                  { title: '1. Introduction', content: 'Enrollment Flow Monitor ("the App") is operated by Menahem Suissa / modernendpoint.tech. This Privacy Policy explains how we collect, use, and protect information when you use the App to monitor Microsoft Intune enrollment data in your organization.' },
                  { title: '2. Data We Access', content: "The App connects to Microsoft Graph API using delegated permissions granted by you or your organization's IT administrator. It accesses device management data including device names, compliance states, enrollment statuses, and user principal names solely to display them within the App interface." },
                  { title: '3. Data Storage', content: "The App does not store, cache, or transmit your Microsoft tenant data to any external server owned by us. All Microsoft Graph data is fetched in real-time and displayed only in your browser session. Session data (authentication tokens) is stored server-side in an encrypted session for the duration of your login only." },
                  { title: '4. Authentication & Permissions', content: 'Authentication is handled entirely through Microsoft Entra ID (Azure AD) using the official OAuth 2.0 authorization code flow. We request only the minimum Graph API permissions required. Privileged permissions (DeviceManagementManagedDevices.PrivilegedOperations.All) are requested separately, only when you explicitly choose to enable remote actions.' },
                  { title: '5. Audit Trail', content: 'In-app audit logs record actions you perform (device sync, reboot, reset commands) within your browser session. These logs are stored in memory only and cleared when you close or refresh the browser. You may export them as CSV at any time.' },
                  { title: '6. Third-Party Services', content: "The App integrates exclusively with Microsoft Graph API (graph.microsoft.com). No third-party analytics, advertising, or tracking services are used. The optional AI Assistant button links to an external ChatGPT-based tool; its use is governed by OpenAI's privacy policy." },
                  { title: '7. Your Rights', content: 'You may disconnect your Microsoft account at any time using the "Disconnect" option in the user menu. This destroys your session and removes all cached authentication data.' },
                  { title: '8. Contact', content: 'For any privacy-related questions, please visit modernendpoint.tech or contact Menahem Suissa directly through the website.' },
                ].map(section => (
                  <div key={section.title} className="privacy-section">
                    <h2 className="privacy-section-title">{section.title}</h2>
                    <p className="privacy-section-body">{section.content}</p>
                  </div>
                ))}
              </div>
            </div>

          ) : !auth.connected ? (
            <div className="welcome-screen efm-landing">
              {/* ── HERO ── */}
              <div className="efm-hero">
                <div className="efm-hero-left">
                  <div className="efm-live-badge">
                    <span className="efm-pulse-dot" />
                    LIVE DEMO — No sign-in required
                  </div>
                  <h1 className="efm-hero-title">
                    Intune Enrollment<br />
                    <span className="efm-hero-accent">Intelligence Platform</span>
                  </h1>
                  <p className="efm-hero-sub">
                    Diagnose enrollment failures, track compliance, and roll out with confidence —
                    connected directly to your Microsoft tenant via Entra ID.
                  </p>
                  <div className="efm-hero-actions">
                    <button className="btn btn-primary welcome-signin-btn" onClick={() => { window.location.href = '/api/auth/login'; }}>
                      🔑 Sign in with Microsoft
                    </button>
                    <button className="btn welcome-tutorial-btn" onClick={() => setTutorialOpen(true)}>
                      ▶ Watch Tutorial
                    </button>
                  </div>
                  <div className="efm-trust-row">
                    <span className="efm-trust-item"><span className="efm-trust-dot" />Connects via Entra ID</span>
                    <span className="efm-trust-item"><span className="efm-trust-dot" />No data stored</span>
                    <span className="efm-trust-item"><span className="efm-trust-dot" />30-day free trial</span>
                  </div>
                </div>
                <div className="efm-hero-right">
                  <div className="efm-demo-label">Demo data preview</div>
                  <div className="kpi-row" style={{ marginBottom: 10 }}>
                    <div className="kpi-card">
                      <div className="kpi-label">Health Score</div>
                      <div className="kpi-value green">{demoDashboardData.healthScore}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Total Devices</div>
                      <div className="kpi-value">{demoDashboardData.totalDevices}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Failed</div>
                      <div className="kpi-value red">{demoDashboardData.failedEnrollments}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Risks</div>
                      <div className="kpi-value amber">{demoDashboardData.readinessRisks}</div>
                    </div>
                  </div>
                  <div className="efm-device-preview">
                    {[
                      { name: 'iis-srv-devops',   os: 'Win 10.0.20348', status: 'UNKNOWN',   cls: 'badge-unk' },
                      { name: 'CPC-talys-O4MMV',  os: 'Win 10.0.26200', status: 'COMPLIANT', cls: 'badge-ok'  },
                      { name: 'BG-DAGAN-AAT',     os: 'Win 10.0.20348', status: 'FAILED',    cls: 'badge-err' },
                    ].map(d => (
                      <div key={d.name} className="efm-device-row">
                        <span className="efm-device-name">{d.name}</span>
                        <span className="efm-device-os">{d.os}</span>
                        <span className={`efm-badge ${d.cls}`}>{d.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── WALKTHROUGH ── */}
              <EfmWalkthrough onSignIn={() => { window.location.href = '/api/auth/login'; }} />

              {/* Tutorial Modal */}
              {tutorialOpen && (
                <div className="tutorial-overlay" onClick={() => setTutorialOpen(false)}>
                  <div className="tutorial-modal" onClick={e => e.stopPropagation()}>
                    <div className="tutorial-modal-header">
                      <div className="tutorial-modal-title">▶ Getting Started with Enrollment Flow Monitor</div>
                      <button className="tutorial-close-btn" onClick={() => setTutorialOpen(false)}>✕</button>
                    </div>
                    <div className="tutorial-video-wrap">
                      <iframe
                        src="https://www.youtube-nocookie.com/embed/VoLX31W2kOI?rel=0&modestbranding=1"
                        title="Enrollment Flow Monitor – Tutorial"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    </div>
                    <div className="tutorial-chapters">
                      <div className="tutorial-chapter-label">What's covered:</div>
                      <div className="tutorial-chapter-list">
                        <span className="tutorial-chapter">00:00 — Overview & Sign-in</span>
                        <span className="tutorial-chapter">01:30 — Error Catalog</span>
                        <span className="tutorial-chapter">03:00 — Reports & Health Score</span>
                        <span className="tutorial-chapter">05:00 — Readiness Risks</span>
                        <span className="tutorial-chapter">07:00 — AI Assistant</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : currentView === 'dashboard' ? (
            <div className="dashboard-shell">
              <div className="dashboard-header">
                <div>
                  <div className="dashboard-title">🎛️ Command Center</div>
                  <div className="dashboard-subtitle">
                    {dashboardData ? `Last refresh: ${new Date(dashboardData.lastRefresh ?? '').toLocaleTimeString()}` : 'Loading...'}
                  </div>
                </div>
                <button className="btn btn-primary" onClick={onRefresh} disabled={isRefreshing || isTrialExpired}>
                  {isRefreshing ? '↻ Refreshing…' : '↻ Refresh'}
                </button>
              </div>

              {isViewLoading || !dashboardData ? (
                <div className="kpi-row">
                  {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 88, borderRadius: 12 }} />)}
                </div>
              ) : (
                <>
                  <div className="command-center-grid polished">
                    <button type="button" className="hero-score-card hero-card-prominent dashboard-nav-card" onClick={() => openDashboardView('reports')}>
                      <div className="hero-score-topline">
                        <div>
                          <div className="hero-score-label">Enrollment Health Score</div>
                          <div className="hero-score-value">{dashboardData.healthScore ?? 0}</div>
                        </div>
                        <div className={`hero-score-status ${(dashboardData.healthScore ?? 0) >= 85 ? 'healthy' : (dashboardData.healthScore ?? 0) >= 70 ? 'watch' : 'risk'}`}>
                          {(dashboardData.healthScore ?? 0) >= 85 ? 'Healthy' : (dashboardData.healthScore ?? 0) >= 70 ? 'Watch' : 'At Risk'}
                        </div>
                      </div>
                      <div className="hero-score-sub">
                        {(dashboardData.healthScore ?? 0) >= 85 ? 'Tenant enrollment posture looks stable.' : (dashboardData.healthScore ?? 0) >= 70 ? 'Some signals require review before they become incidents.' : 'This tenant needs focused remediation in the next review cycle.'}
                      </div>
                      <div className="hero-score-highlights">
                        <div className="hero-highlight-pill">
                          <span className="hero-highlight-value">{dashboardData.activeIssues ?? 0}</span>
                          <span className="hero-highlight-label">Active issues</span>
                        </div>
                        <div className="hero-highlight-pill">
                          <span className="hero-highlight-value">{dashboardData.readinessRisks ?? 0}</span>
                          <span className="hero-highlight-label">Readiness risks</span>
                        </div>
                        <div className="hero-highlight-pill">
                          <span className="hero-highlight-value">{dashboardData.staleDevices ?? 0}</span>
                          <span className="hero-highlight-label">Stale devices</span>
                        </div>
                      </div>
                    </button>
                    <button type="button" className="command-mini-card critical subdued-card dashboard-nav-card" onClick={() => openDashboardView('incidents')}>
                      <div className="cmc-label">Critical Issues</div>
                      <div className="cmc-value">{dashboardData.activeCriticalIssues ?? 0}</div>
                      <div className="cmc-sub">Requires immediate triage</div>
                    </button>
                    <button type="button" className="command-mini-card warn subdued-card dashboard-nav-card" onClick={() => openDashboardView('readinessChecklist')}>
                      <div className="cmc-label">Readiness Risks</div>
                      <div className="cmc-value">{dashboardData.readinessRisks ?? 0}</div>
                      <div className="cmc-sub">Configuration &amp; policy gaps</div>
                    </button>
                    <button type="button" className="command-mini-card info subdued-card dashboard-nav-card" onClick={() => openDashboardView('windowsEnrollment')}>
                      <div className="cmc-label">Stale Devices</div>
                      <div className="cmc-value">{dashboardData.staleDevices ?? 0}</div>
                      <div className="cmc-sub">No sync in the last 7 days</div>
                    </button>
                  </div>

                  <div className="command-columns polished-columns">
                    <div className="command-card action-card-surface">
                      <div className="dashboard-section-title">Recommended Actions</div>
                      <div className="recommended-list upgraded-actions">
                        {(dashboardData.recommendedActions ?? []).map((action: any, index: number) => (
                          <button
                            key={`${action.title}-${index}`}
                            className={`recommended-action cardlike ${action.severity ?? 'info'}`}
                            onClick={() => action.targetView ? setCurrentView(action.targetView as ExtendedViewName) : undefined}
                          >
                            <span className="recommended-action-header">
                              <span className="recommended-action-title">{action.title}</span>
                              <span className={`action-severity-badge ${action.severity ?? 'info'}`}>{String(action.severity ?? 'info')}</span>
                            </span>
                            <span className="recommended-action-rationale">{action.rationale}</span>
                            <span className="recommended-action-cta">Open recommended view →</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="command-card cause-card-surface">
                      <div className="dashboard-section-title">Top Root Causes</div>
                      <div className="root-cause-list refined-empty-state">
                        {((dashboardData.topRootCauses ?? []).length ? dashboardData.topRootCauses : [{ category: 'No recurring failure clusters found', count: 0, empty: true }]).map((cause: any) => (
                          cause.empty ? (
                            <button type="button" key={cause.category} className="root-cause-empty dashboard-nav-card" onClick={() => openDashboardView('reports')}>
                              <div className="root-cause-empty-icon">✓</div>
                              <div>
                                <div className="root-cause-empty-title">No recurring causes detected</div>
                                <div className="root-cause-empty-sub">No repeated failure pattern was detected in the recent review window.</div>
                              </div>
                            </button>
                          ) : (
                            <button type="button" key={cause.category} className="root-cause-row elevated-row dashboard-nav-row" onClick={() => openDashboardView('incidents')}>
                              <span className="root-cause-name">{cause.category}</span>
                              <span className="root-cause-count">{cause.count}</span>
                            </button>
                          )
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="dashboard-section-title">Command Metrics</div>
                  <div className="kpi-row">
                    <button type="button" className="kpi-card dashboard-nav-card" onClick={() => openDashboardView('windowsEnrollment')}>
                      <div className="kpi-icon kpi-icon-blue">🖥️</div>
                      <div className="kpi-value">{dashboardData.totalDevices ?? 0}</div>
                      <div className="kpi-label">Total Devices</div>
                      <div className="kpi-indicator kpi-indicator-blue">All Platforms</div>
                    </button>
                    <button type="button" className="kpi-card dashboard-nav-card" onClick={() => openDashboardView('windowsEnrollment')}>
                      <div className="kpi-icon kpi-icon-amber">🪟</div>
                      <div className="kpi-value">{dashboardData.windowsEnrollmentDevices ?? 0}</div>
                      <div className="kpi-label">Windows Devices</div>
                      <div className="kpi-indicator kpi-indicator-amber">Enrolled</div>
                    </button>
                    <button type="button" className="kpi-card dashboard-nav-card" onClick={() => openDashboardView('windowsEnrollment')}>
                      <div className="kpi-icon kpi-icon-green">✅</div>
                      <div className="kpi-value">
                        {(dashboardData.topEnrollmentStates ?? []).find((s: any) => s.category === 'Compliant')?.count ?? 0}
                      </div>
                      <div className="kpi-label">Compliant Devices</div>
                      <div className="kpi-indicator kpi-indicator-green">Policy OK</div>
                    </button>
                    <button type="button" className="kpi-card dashboard-nav-card" onClick={() => openDashboardView('windowsEnrollment')}>
                      <div className="kpi-icon kpi-icon-red">⚠️</div>
                      <div className="kpi-value">
                        {(dashboardData.topEnrollmentStates ?? []).find((s: any) => s.category === 'Non-compliant')?.count ?? 0}
                      </div>
                      <div className="kpi-label">Non-Compliant</div>
                      <div className="kpi-indicator kpi-indicator-red">Action Required</div>
                    </button>
                  </div>

                  <div className="dashboard-section-title">Compliance Breakdown</div>
                  <div className="compliance-bars">
                    {(dashboardData.topEnrollmentStates ?? []).map((s: any) => {
                      const total = dashboardData.totalDevices || 1;
                      const pct = Math.round((s.count / total) * 100);
                      const color = s.category === 'Compliant' ? 'var(--green)' : s.category === 'Non-compliant' ? 'var(--red)' : 'var(--amber)';
                      return (
                        <button type="button" key={s.category} className="compliance-bar-row dashboard-bar-button" onClick={() => openDashboardView('windowsEnrollment')}>
                          <div className="cbr-label">{s.category}</div>
                          <div className="cbr-track">
                            <div className="cbr-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <div className="cbr-count" style={{ color }}>{s.count} <span className="cbr-pct">({pct}%)</span></div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : currentView === 'incidents' ? (
            <div className="fix-queue-shell">
              <div className="dashboard-header">
                <div>
                  <div className="dashboard-title">🚨 Fix Queue</div>
                  <div className="dashboard-subtitle">Prioritized incidents with remediation guidance and next-best actions.</div>
                </div>
                <button className="btn btn-primary" onClick={onRefresh} disabled={isRefreshing || isTrialExpired}>
                  {isRefreshing ? '↻ Refreshing…' : '↻ Refresh'}
                </button>
              </div>

              <div className="fix-queue-list">
                {sortedIncidentRows.length === 0 ? (
                  <section className="fix-queue-empty-state">
                    <div className="fix-queue-empty-state__badges">
                      <span className="queue-badge queue-badge--success">Resolved</span>
                      <span className="queue-badge queue-badge--success">Healthy</span>
                    </div>
                    <h3>No active incidents</h3>
                    <p>No failed installs matched incident grouping rules for the selected timeframe.</p>
                    <div className="fix-meta-grid fix-meta-grid--maturity">
                      <div><span>Category</span><strong>None</strong></div>
                      <div><span>Owner</span><strong>Enrollment Operations</strong></div>
                      <div><span>Active incidents</span><strong>0</strong></div>
                      <div><span>Confidence</span><strong>Not applicable</strong></div>
                    </div>
                    <div className="fix-next-action fix-next-action--maturity">
                      <span>Next best action</span>
                      <strong>Keep monitoring. No active remediation is required right now.</strong>
                    </div>
                  </section>
                ) : (
                  sortedIncidentRows.map((row) => {
                    const rowIndex = rows.findIndex((candidate) => String(candidate['id'] ?? candidate['signature'] ?? '') === String(row['id'] ?? row['signature'] ?? ''));
                    const selected = selectedIndex === rowIndex;
                    const priority = String(row['priority'] ?? 'P3');
                    const severity = String(row['severity'] ?? 'Low');
                    const status = String(row['status'] ?? 'New');
                    const sla = String(row['slaState'] ?? 'Healthy');
                    const remediation = Array.isArray(row['remediationSteps']) ? row['remediationSteps'] as string[] : [];
                    const workflowUpdatedAt = row['workflowUpdatedAt'] ?? row['lastSeen'];
                    const confidence = Number(row['rootCauseConfidence'] ?? 0);
                    const notesText = String(row['notes'] ?? '').trim();
                    return (
                      <button key={String(row['id'] ?? rowIndex)} className={`fix-card fix-card--maturity fix-card--${getPriorityTone(priority)} ${selected ? 'active' : ''}`} onClick={() => setSelectedIndex(rowIndex)}>
                        <div className="fix-card-top">
                          <div className="fix-card-title-wrap">
                            <span className={`queue-badge queue-badge--${getPriorityTone(priority)}`}>{priority}</span>
                            <span className={`queue-badge queue-badge--${getStatusTone(status)}`}>{status}</span>
                            <span className="queue-badge queue-badge--neutral">{severity}</span>
                            <span className={`sla-pill ${sla.toLowerCase()}`}>{sla}</span>
                          </div>
                          <span className="fix-impact">{toText(row['impactedCount'])} impacted</span>
                        </div>
                        <div className="fix-card-title-row">
                          <div className="fix-card-title">{toText(row['appName'])}</div>
                          <span className="owner-pill">{toText(row['owner'] || 'Unassigned')}</span>
                        </div>
                        <div className="fix-card-summary">{toText(row['summary'])}</div>
                        <div className="fix-meta-grid fix-meta-grid--maturity">
                          <div><span>Category</span><strong style={{ wordBreak: 'break-word', fontSize: 11 }}>{toText(row['normalizedCategory'])}</strong></div>
                          <div><span>Confidence</span><strong>{Math.round(confidence * 100)}%</strong></div>
                          <div><span>Updated</span><strong>{formatRelativeTime(workflowUpdatedAt) || 'Unknown'}</strong><em>{formatDateTimeDisplay(workflowUpdatedAt)} {formatTimeDisplay(workflowUpdatedAt)}</em></div>
                          <div><span>Owner</span><strong>{toText(row['owner'] || 'Unassigned')}</strong></div>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginRight: 6 }}>SIG</span>{toText(row['signature'])}
                        </div>
                        <div className="fix-next-action fix-next-action--maturity">
                          <span>Next best action</span>
                          <strong>{toText(row['nextBestAction'])}</strong>
                        </div>
                        <div className={`fix-notes-preview ${notesText ? '' : 'is-empty'}`}>
                          <span>Notes preview</span>
                          <p>{notesText ? `${notesText.slice(0, 140)}${notesText.length > 140 ? '…' : ''}` : 'No notes yet. Open this incident to capture remediation progress.'}</p>
                        </div>
                        {remediation.length > 0 && (
                          <ol className="fix-steps">
                            {remediation.slice(0, 3).map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}
                          </ol>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : currentView === 'ocr' ? (
            <div className="ocr-shell">
              {isTrialExpired && (
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', margin:'0 0 12px', borderRadius:6, background:'#1a0a0a', border:'1px solid #ef444433' }}>
                  <span style={{ fontSize:13, color:'#ef4444', fontFamily:"'DM Mono',monospace" }}>🔒 OCR &amp; AI are disabled — trial expired. Upgrade to restore access.</span>
                  <button onClick={() => window.open('https://moderne.gumroad.com/l/cynmjz', '_blank')} style={{ marginLeft:'auto', padding:'3px 12px', borderRadius:4, fontSize:11, fontFamily:"'DM Mono',monospace", cursor:'pointer', border:'1px solid #ef444455', background:'#ef444414', color:'#ef4444', flexShrink:0 }}>↑ Upgrade</button>
                </div>
              )}
              <div className="ocr-head">
                <div>
                  <div className="ocr-title">OCR &amp; Error Assistant</div>
                  <div className="ocr-subtitle">Upload a screenshot or paste an error, then get actionable remediation guidance.</div>
                </div>
                <span className={`status-badge ${statusKind(ocrStatusText)}`}>{ocrStatusText}</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0] ?? null;
                  setOcrImageFile(file);
                  if (file) {
                    setOcrStatusText(`OCR: Image selected (${file.name})`);
                    setStatusMessage('Image selected. Click Run OCR or type text manually.');
                  }
                }}
              />
              <div className="ocr-actions">
                <button className="btn btn-secondary" onClick={onPickImage} disabled={ocrBusy || isTrialExpired}>Pick Image</button>
                <button className="btn btn-secondary" onClick={onRunOcr} disabled={ocrBusy || isTrialExpired}>Run OCR</button>
                <button className="btn btn-primary" onClick={onGetOcrExplanation} disabled={ocrBusy || isTrialExpired}>Get Explanation</button>
              </div>
              <div className="ocr-grid">
                <div className="ocr-card">
                  <h4>OCR / Manual Input</h4>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 250 }}
                    placeholder="Paste error text manually or run OCR from image..."
                    value={ocrInputText}
                    onChange={(event) => setOcrInputText(event.target.value)}
                  />
                </div>
                <div className="ocr-card">
                  <h4>Assistant Answer</h4>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 250 }}
                    value={ocrAssistantAnswer}
                    readOnly
                    placeholder="No explanation yet. Pick image or paste text, then click Get Explanation."
                  />
                </div>
              </div>
            </div>
          ) : currentView === 'enrollmentErrorCatalog' ? (
            <div className="error-catalog-shell">
              <div className="error-catalog-header">
                <div>
                  <div className="error-catalog-title">📚 Failure Catalog</div>
                  <div className="error-catalog-subtitle">Known Intune &amp; enrollment errors with remediation steps — sourced from Microsoft Docs</div>
                </div>
                <a
                  className="btn-ai-inline"
                  href="https://chatgpt.com/g/g-698c483ab6888191a8ac539d2944f696-m-intune-architect-ai-enterprise-edition"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🤖 Ask AI
                </a>
              </div>
              <div className="error-catalog-filters">
                <input
                  className="error-search"
                  placeholder="🔍 Search by code, title or description..."
                  value={errorSearch}
                  onChange={e => setErrorSearch(e.target.value)}
                />
                <div className="error-filter-chips">
                  {(['all','high','medium','low','Windows','iOS','Android','macOS'] as const).map(f => (
                    <button
                      key={f}
                      className={`filter-chip ${errorFilter === f ? 'active' : ''}`}
                      onClick={() => setErrorFilter(f)}
                    >{f}</button>
                  ))}
                </div>
              </div>
              <div className="error-catalog-count">{filteredErrors.length} error{filteredErrors.length !== 1 ? 's' : ''} found</div>
              <div className="error-card-list">
                {filteredErrors.map(err => (
                  <div key={err.code} className={`error-card sev-${err.severity}`} onClick={() => setExpandedError(expandedError === err.code ? null : err.code)}>
                    <div className="error-card-top">
                      <div className="error-card-left">
                        <span className={`sev-badge sev-${err.severity}`}>{err.severity.toUpperCase()}</span>
                        <span className="error-code">{err.code}</span>
                        <span className="error-title">{err.title}</span>
                      </div>
                      <div className="error-card-right">
                        {err.platforms.map(p => <span key={p} className="platform-tag">{p}</span>)}
                        <span className="expand-icon">{expandedError === err.code ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    {expandedError === err.code && (
                      <div className="error-card-body">
                        <p className="error-description">{err.description}</p>
                        <div className="error-cause"><strong>Root cause:</strong> {err.cause}</div>
                        <div className="error-actions-title">Remediation steps:</div>
                        <ol className="error-actions-list">
                          {err.actions.map((a, i) => <li key={i}>{a}</li>)}
                        </ol>
                        <a className="error-ref-link" href={err.ref} target="_blank" rel="noopener noreferrer">📄 Microsoft Docs ↗</a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : currentView === 'reports' ? (
            <div className="reports-shell">
              <div className="reports-header">
                <div>
                  <div className="reports-title">📈 Enrollment Reports</div>
                  <div className="reports-subtitle">Live analytics — generated {reportData ? new Date(reportData.generatedAt).toLocaleString() : '...'}</div>
                </div>
                <button className="btn btn-primary" onClick={() => generateEnrollmentPDF(reportData, addToast)} disabled={isTrialExpired}>⬇ Export PDF</button>
              </div>
              {!reportData ? (
                <div className="empty-state"><div className="empty-state-title">Loading reports...</div></div>
              ) : (
                <div id="reports-print-area" className="reports-body">
                  {/* KPI row */}
                  <div className="kpi-row">
                    <div className="kpi-card"><div className="kpi-value">{reportData.totalDevices}</div><div className="kpi-label">Total Devices</div></div>
                    <div className="kpi-card"><div className="kpi-value green">{reportData.overallComplianceRate}%</div><div className="kpi-label">Compliance Rate</div></div>
                    <div className="kpi-card"><div className={`kpi-value ${reportData.activeIncidents > 0 ? 'red' : 'green'}`}>{reportData.activeIncidents}</div><div className="kpi-label">Active Incidents</div></div>
                    <div className="kpi-card"><div className="kpi-value amber">{reportData.platformBreakdown?.length ?? 0}</div><div className="kpi-label">Platforms</div></div>
                  </div>

                  {/* Health Scores */}
                  <div className="reports-section-title">Platform Health Score</div>
                  <div className="health-score-row">
                    {(reportData.healthScores ?? []).map((h: any) => (
                      <div key={h.platform} className="health-score-card">
                        <div className="hs-platform">{h.platform}</div>
                        <div className="hs-score-wrap">
                          <div className="hs-ring" style={{ '--score': h.score } as any}>
                            <span className="hs-number">{h.score}</span>
                          </div>
                        </div>
                        <div className="hs-stats">
                          <span className="hs-stat green">{h.compliant} compliant</span>
                          <span className="hs-stat red">{h.enrolled - h.compliant} non-compliant</span>
                          <span className="hs-stat muted">{h.enrolled} total</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Platform breakdown */}
                  <div className="reports-section-title">Platform Breakdown</div>
                  <div className="platform-bars">
                    {(reportData.platformBreakdown ?? []).map((p: any) => (
                      <div key={p.platform} className="platform-bar-row">
                        <div className="pb-label">{p.platform}</div>
                        <div className="pb-bar-wrap">
                          <div className="pb-bar-compliant" style={{ width: `${p.count > 0 ? (p.compliant / p.count) * 100 : 0}%` }} />
                          <div className="pb-bar-nc" style={{ width: `${p.count > 0 ? (p.nonCompliant / p.count) * 100 : 0}%` }} />
                        </div>
                        <div className="pb-counts">
                          <span className="green">{p.compliant}✓</span>
                          <span className="red">{p.nonCompliant}✗</span>
                          <span className="muted">/ {p.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Top Errors */}
                  {(reportData.topErrors ?? []).length > 0 && (<>
                    <div className="reports-section-title">Top Enrollment Errors</div>
                    <div className="top-errors-list">
                      {(reportData.topErrors ?? []).map((e: any, i: number) => (
                        <div key={e.errorCode} className={`top-error-row sev-${(e.severity ?? 'low').toLowerCase()}`}>
                          <span className="te-rank">#{i + 1}</span>
                          <span className={`sev-badge sev-${(e.severity ?? 'low').toLowerCase()}`}>{e.severity}</span>
                          <span className="te-code">{e.errorCode}</span>
                          <span className="te-title">{e.title}</span>
                          <span className="te-count">{e.count} devices</span>
                        </div>
                      ))}
                    </div>
                  </>)}
                </div>
              )}
            </div>
          ) : currentView === 'readinessChecklist' ? (
            <div className="checklist-shell">
              <div className="checklist-header">
                <div>
                  <div className="checklist-title">✅ Enrollment Readiness Risks</div>
                  <div className="checklist-subtitle">Pre-flight verification before rolling out a new enrollment scenario</div>
                </div>
              </div>
              <div className="checklist-scenarios">
                {([
                  { id: 'autopilot', label: '🖥️ Windows Autopilot' },
                  { id: 'ade-ios', label: '📱 ADE – iOS/iPadOS' },
                  { id: 'ade-macos', label: '🍎 ADE – macOS' },
                  { id: 'android-enterprise', label: '🤖 Android Enterprise' },
                ] as const).map(s => (
                  <button
                    key={s.id}
                    className={`scenario-btn ${checklistScenario === s.id ? 'active' : ''}`}
                    onClick={() => {
                      setChecklistScenario(s.id);
                      getView(`readinessChecklist?scenario=${s.id}` as any).then(r => setChecklistItems(r.rows ?? [])).catch(() => setChecklistItems([]));
                    }}
                  >{s.label}</button>
                ))}
              </div>
              {checklistItems.length === 0 ? (
                <div className="empty-state"><div className="empty-state-title">Loading checklist...</div></div>
              ) : (
                <div className="checklist-list">
                  {(['Devices', 'Licensing', 'Registration', 'ABM', 'Profile', 'Policy', 'Certificates', 'Network', 'Apps', 'Google', 'Device', 'Security', 'Health'] as const).map(cat => {
                    const items = checklistItems.filter((i: any) => i.category === cat);
                    if (!items.length) return null;
                    return (
                      <div key={cat} className="checklist-category">
                        <div className="checklist-cat-label">{cat}</div>
                        {items.map((item: any) => (
                          <div key={item.id} className={`checklist-item status-${item.status}`}>
                            <span className="ci-icon">
                              {item.status === 'pass' ? '✅' : item.status === 'warn' ? '⚠️' : item.status === 'fail' ? '❌' : '🔲'}
                            </span>
                            <div className="ci-content">
                              <div className="ci-label">{item.label}</div>
                              <div className="ci-desc">{item.description}</div>
                              <div className="ci-detail">{item.detail}</div>
                            </div>
                            <a className="ci-doc" href={item.docUrl} target="_blank" rel="noopener noreferrer">Docs ↗</a>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  <div className="checklist-legend">
                    <span>✅ Auto-verified</span>
                    <span>⚠️ Warning detected</span>
                    <span>❌ Failed</span>
                    <span>🔲 Manual check required</span>
                  </div>
                </div>
              )}
            </div>

          ) : currentView === 'auditLogs' ? (
            <div className="audit-shell">
              <div className="audit-header">
                <div>
                  <div className="audit-title">📋 Audit Trail</div>
                  <div className="audit-subtitle">User actions performed in this session — {auditLogs.length} events recorded</div>
                </div>
                <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={() => {
                  const csv = ['Timestamp,User,Action,View,Details,Result',
                    ...auditLogs.map(l => `"${l.timestamp}","${l.user}","${l.action}","${l.view}","${l.details}","${l.result}"`)
                  ].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = 'audit-logs.csv'; a.click();
                  URL.revokeObjectURL(url);
                  addToast('success', 'Audit logs exported');
                }}>⬇ Export CSV</button>
              </div>
              {auditLogs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">No actions recorded yet</div>
                  <div>Actions you perform (Sync, Reboot, Reset, view navigation) will appear here.</div>
                </div>
              ) : (
                <div className="audit-list">
                  {auditLogs.map(log => (
                    <div key={log.id} className={`audit-entry audit-${log.result}`}>
                      <div className="audit-icon">
                        {log.result === 'success' ? '✅' : log.result === 'fail' ? '❌' : 'ℹ️'}
                      </div>
                      <div className="audit-content">
                        <div className="audit-action-row">
                          <span className="audit-action">{log.action}</span>
                          <span className={`audit-badge audit-badge-${log.result}`}>{log.result}</span>
                          <span className="audit-view">in {log.view}</span>
                        </div>
                        <div className="audit-details">{log.details}</div>
                      </div>
                      <div className="audit-meta">
                        <div className="audit-user">{log.user}</div>
                        <div className="audit-time">{new Date(log.timestamp).toLocaleTimeString()}</div>
                        <div className="audit-date">{new Date(log.timestamp).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          ) : currentView === 'enrollmentFailures' ? (
            <EnrollmentFailuresView
              efRows={efRows} efLoading={efLoading} efError={efError}
              efSearch={efSearch} setEfSearch={setEfSearch}
              efOsFilter={efOsFilter} setEfOsFilter={setEfOsFilter}
              selectedEfRow={selectedEfRow} setSelectedEfRow={setSelectedEfRow}
              efRetrying={efRetrying} setEfRetrying={setEfRetrying}
              auth={auth} api={api} addToast={addToast}
              setEfRows={setEfRows} setEfLoading={setEfLoading} setEfError={setEfError}
              ERROR_CATALOG={ERROR_CATALOG}
            />
          ) : currentView === 'enrollmentPolicy' ? (
            <EnrollmentPolicyView
              epData={epData} epLoading={epLoading} epError={epError}
              api={api} setEpData={setEpData} setEpLoading={setEpLoading} setEpError={setEpError}
              addToast={addToast}
              runbookText={runbookText} setRunbookText={setRunbookText}
              runbookLoading={runbookLoading} setRunbookLoading={setRunbookLoading}
            />
          ) : currentView === 'complianceDrift' ? (
            <ComplianceDriftView
              snapshots={driftSnapshots} loading={driftLoading}
              api={api} addToast={addToast}
              setSnapshots={setDriftSnapshots} setLoading={setDriftLoading}
            />
          ) : currentView === 'graphQuery' ? (
            <GraphExplorerView
              gqUrl={gqUrl} setGqUrl={setGqUrl}
              gqResult={gqResult} setGqResult={setGqResult}
              gqLoading={gqLoading} setGqLoading={setGqLoading}
              gqError={gqError} setGqError={setGqError}
              gqSelectedTemplate={gqSelectedTemplate} setGqSelectedTemplate={setGqSelectedTemplate}
              auth={auth} api={api} addToast={addToast}
            />
          ) : (
            isViewLoading ? (
              <div>
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
            ) : rows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No rows returned</div>
                <div>{statusMessage || 'No data for this view.'}</div>
              </div>
            ) : (
              <>
                {/* ── Smart Filters + Saved Views ── */}
                {isDeviceView && (
                  <div className="smart-toolbar">
                    <div className="smart-toolbar-row">
                      <div className="filter-chips-row">
                        {visibleFilterChips.map(chip => (
                          <button
                            key={chip.id}
                            className={`filter-chip filter-chip-${chip.color} ${activeFilters.has(chip.id) ? 'active' : ''}`}
                            onClick={() => toggleFilter(chip.id)}
                          >
                            {chip.label}
                          </button>
                        ))}
                        {(activeFilters.size > 0 || inlineSearch || globalSearch) && (
                          <button className="filter-chip-clear" onClick={clearFilters}>Clear filters ✕</button>
                        )}
                      </div>

                      <div className="saved-views-actions">
                        <button className="btn btn-secondary" onClick={saveCurrentView}>
                          ⭐ Save current view
                        </button>
                      </div>
                    </div>

                    {scopedSavedViews.length > 0 && (
                      <div className="saved-views-row">
                        <div className="saved-views-label">Saved views</div>
                        <div className="saved-views-list">
                          {scopedSavedViews.map(view => (
                            <div key={view.id} className="saved-view-pill">
                              <button
                                type="button"
                                className="saved-view-open"
                                onClick={() => applySavedView(view)}
                                title={`Open ${view.name}`}
                              >
                                {view.name}
                              </button>
                              <button
                                type="button"
                                className="saved-view-remove"
                                onClick={() => removeSavedView(view.id)}
                                aria-label={`Remove ${view.name}`}
                                title="Remove saved view"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Persistent inline search bar ── */}
                <div className="inline-search-wrap">
                  <div className="inline-search-bar">
                    <span className="inline-search-icon">🔍</span>
                    <input
                      ref={inlineSearchRef}
                      className="inline-search-input"
                      value={inlineSearch}
                      onChange={e => { setInlineSearch(e.target.value); setGlobalSearch(''); }}
                      placeholder={"Search devices, users, serial numbers..."}
                    />
                    {(inlineSearch || globalSearch) && (
                      <button className="inline-search-clear" onClick={() => { setInlineSearch(''); setGlobalSearch(''); }}>✕</button>
                    )}
                    {(inlineSearch || globalSearch) && (
                      <span className="inline-search-count">{filteredRows.length}/{rows.length}</span>
                    )}
                  </div>
                </div>

                {/* ── Bulk Action Floating Bar ── */}
                {isDeviceView && selectedDevices.size > 0 && (
                  <div className="bulk-action-bar">
                    <span className="bulk-count">{selectedDevices.size} device{selectedDevices.size !== 1 ? 's' : ''} selected</span>
                    <div className="bulk-actions">
                      <button
                        className="bulk-btn bulk-btn-sync"
                        disabled={actionLoading === 'bulk' || isTrialExpired}
                        onClick={() => openConfirm('bulk-sync')}
                      >🔄 Sync {selectedDevices.size}</button>
                      <button
                        className="bulk-btn bulk-btn-reboot"
                        disabled={actionLoading === 'bulk' || isTrialExpired}
                        onClick={() => openConfirm('bulk-reboot')}
                      >⚡ Reboot {selectedDevices.size}</button>
                      <button
                        className="bulk-btn bulk-btn-reset"
                        disabled={actionLoading === 'bulk' || isTrialExpired}
                        onClick={() => openConfirm('bulk-reset')}
                      >⚠️ Reset {selectedDevices.size}</button>
                      <button className="bulk-btn bulk-btn-clear" onClick={() => setSelectedDevices(new Set())}>✕ Clear</button>
                    </div>
                  </div>
                )}

                {/* Mobile: stacked cards */}
                {isMobile ? (
                  <div className="mobile-card-list">
                    {filteredRows.length === 0 ? (
                      <div className="empty-state"><div className="empty-state-title">No matching devices</div><div>Try a different search term.</div></div>
                    ) : filteredRows.map((row, index) => {
                      const devId = getDeviceId(row);
                      const isSelected = selectedDevices.has(devId);
                      const isActing = actionLoading === devId;
                      const compState = String(row['complianceState'] ?? row['status'] ?? '').toLowerCase();
                      return (
                        <div
                          key={devId || index}
                          className={`mobile-data-card ${selectedIndex === index ? 'active' : ''} ${isSelected ? 'mdc-selected' : ''}`}
                          onClick={() => setSelectedIndex(index)}
                        >
                          <div className="mdc-header">
                            {isDeviceView && devId && (
                              <input type="checkbox" className="mdc-checkbox" checked={isSelected}
                                onChange={() => toggleDeviceSelect(devId)}
                                onClick={e => e.stopPropagation()} />
                            )}
                            <span className="mdc-title">
                              {toText(row['deviceName'] ?? row['displayName'] ?? row['name'] ?? row['title'] ?? `Row ${index + 1}`)}
                            </span>
                            {compState && (
                              <span className={`status-pill status-pill-${compState.includes('compliant') && !compState.includes('non') ? 'green' : compState.includes('non') ? 'red' : 'blue'}`}>
                                {toText(row['complianceState'] ?? row['status'] ?? '')}
                              </span>
                            )}
                            <div className="mdc-actions">
                              {Boolean(row['id']) && (
                                <button className="copy-id-btn" title="Copy ID" onClick={e => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(String(row['id']));
                                  addToast('success', 'ID copied!');
                                }}>⧉</button>
                              )}
                              <button className="view-json-btn" title="Open record details" aria-label="Open record details" onClick={e => { e.stopPropagation(); setJsonModalRow(row); }}><span className="view-json-btn-icon">🗂</span><span className="view-json-btn-label">Record</span></button>
                            </div>
                          </div>
                          {headers.filter(h => h !== 'id' && h !== 'details' && h !== 'complianceState').slice(0, 3).map(h => (
                            <div key={h} className="mdc-row">
                              <span className="mdc-key">{h}</span>
                              <span className="mdc-val">{toText(row[h])}</span>
                            </div>
                          ))}
                          {isDeviceView && devId && (
                            <div className="mdc-device-actions">
                              <button className={`daction-btn daction-sync ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                disabled={!!actionLoading}
                                onClick={e => { e.stopPropagation(); openConfirm('sync', row); }}
                              >{isActing ? '⏳' : auth.hasWritePermissions ? '🔄' : '🔒'} Sync</button>
                              <button className={`daction-btn daction-reboot ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                disabled={!!actionLoading}
                                onClick={e => { e.stopPropagation(); openConfirm('reboot', row); }}
                              >{isActing ? '⏳' : auth.hasWritePermissions ? '⚡' : '🔒'} Reboot</button>
                              <button className={`daction-btn daction-reset ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                disabled={!!actionLoading}
                                onClick={e => { e.stopPropagation(); openConfirm('autopilotReset', row); }}
                              >{isActing ? '⏳' : auth.hasWritePermissions ? '♻️' : '🔒'} Reset</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Desktop: enhanced table with actions */
                  <div className="table-wrap">
                    {filteredRows.length === 0 ? (
                      <div className="empty-state" style={{ padding: '40px 20px' }}>
                        <div className="empty-state-title">No matching devices</div>
                        <div>Try a different search term.</div>
                      </div>
                    ) : (
                      <table className="data-table data-table-enhanced">
                        <thead>
                          <tr>
                            {isDeviceView && (
                              <th style={{ width: 36 }}>
                                <input type="checkbox"
                                  checked={selectedDevices.size === filteredRows.length && filteredRows.length > 0}
                                  onChange={toggleSelectAll}
                                  title="Select all"
                                  style={{ cursor: 'pointer', accentColor: 'var(--amber)' }}
                                />
                              </th>
                            )}
                            {headers.map((header) => (
                              <th key={header}>{header.replace(/([A-Z])/g, ' $1').trim()}</th>
                            ))}
                            <th style={{ width: isDeviceView ? 200 : 72 }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRows.map((row, index) => {
                            const devId = getDeviceId(row);
                            const isSelected = selectedDevices.has(devId);
                            const isActing = actionLoading === devId;
                            const compState = String(row['complianceState'] ?? '').toLowerCase();
                            return (
                              <tr
                                key={devId || index}
                                className={`table-row ${selectedIndex === index ? 'active' : ''} ${index % 2 === 1 ? 'zebra' : ''} ${isSelected ? 'row-selected' : ''}`}
                                onClick={() => setSelectedIndex(index)}
                              >
                                {isDeviceView && (
                                  <td onClick={e => e.stopPropagation()}>
                                    {devId && <input type="checkbox" checked={isSelected} onChange={() => toggleDeviceSelect(devId)}
                                      style={{ cursor: 'pointer', accentColor: 'var(--amber)' }} />}
                                  </td>
                                )}
                                {headers.map((header) => (
                                  <td key={`${index}-${header}`}>
                                    {header === 'complianceState' || header === 'status' ? (
                                      <span className={`status-pill status-pill-${compState.includes('compliant') && !compState.includes('non') ? 'green' : compState.includes('non') ? 'red' : 'blue'}`}>
                                        {toText(row[header])}
                                      </span>
                                    ) : (header === 'id' || (String(row[header] ?? '').length === 36 && String(row[header] ?? '').includes('-'))) ? (
                                      <span className="guid-cell">
                                        <span className="guid-text">{toText(row[header])}</span>
                                        <button className="copy-id-btn" title="Copy ID" onClick={e => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(toText(row[header]));
                                          addToast('success', 'ID copied!');
                                        }}>⧉</button>
                                      </span>
                                    ) : renderTableValue(header, row[header])}
                                  </td>
                                ))}
                                <td onClick={e => e.stopPropagation()}>
                                  <div className="row-actions">
                                    <button className="view-json-btn" title="Open record details" aria-label="Open record details" onClick={() => setJsonModalRow(row)}><span className="view-json-btn-icon">🗂</span><span className="view-json-btn-label">Record</span></button>
                                    {isDeviceView && devId && (<>
                                      <button className={`daction-btn daction-sync ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                        disabled={!!actionLoading || isTrialExpired} title={isTrialExpired ? '🔒 Trial expired' : auth.hasWritePermissions ? 'Sync device' : '🔒 Requires Write Access'}
                                        onClick={() => openConfirm('sync', row)}>
                                        {isActing ? '⏳' : auth.hasWritePermissions ? '🔄' : '🔒'}
                                      </button>
                                      <button className={`daction-btn daction-reboot ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                        disabled={!!actionLoading || isTrialExpired} title={isTrialExpired ? '🔒 Trial expired' : auth.hasWritePermissions ? 'Reboot device' : '🔒 Requires Write Access'}
                                        onClick={() => openConfirm('reboot', row)}>
                                        {isActing ? '⏳' : auth.hasWritePermissions ? '⚡' : '🔒'}
                                      </button>
                                      <button className={`daction-btn daction-reset ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                        disabled={!!actionLoading || isTrialExpired} title={isTrialExpired ? '🔒 Trial expired' : auth.hasWritePermissions ? 'Autopilot Reset' : '🔒 Requires Write Access'}
                                        onClick={() => openConfirm('autopilotReset', row)}>
                                        {isActing ? '⏳' : auth.hasWritePermissions ? '♻️' : '🔒'}
                                      </button>
                                    </>)}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </>
            )
          )}
        </div>

        <div className={`panel detail-rail ${currentView === 'dashboard' ? 'dashboard-rail' : ''} ${!detailsText ? 'is-empty' : ''} ${(currentView === 'graphQuery' || currentView === 'enrollmentFailures' || currentView === 'enrollmentPolicy' || currentView === 'complianceDrift') ? 'is-hidden' : ''}`} style={(currentView === 'graphQuery' || currentView === 'enrollmentFailures' || currentView === 'enrollmentPolicy' || currentView === 'complianceDrift') ? { display: 'none' } : {}}>
          <div className="font-semibold text-xl mb-2">Summary</div>
          <div className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
            {currentView === 'ocr' ? 'OCR Assistant Answer' : detailsSummary}
          </div>
          <div className="font-semibold text-xl mb-2">Details</div>
          <pre
            className="text-xs whitespace-pre-wrap rounded-lg p-3"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
          >
            {currentView === 'ocr'
              ? (ocrAssistantAnswer || 'No explanation yet. Pick image or paste text, then click Get Explanation.')
              : detailsText}
          </pre>

          {currentView === 'incidents' && selectedIncident && !selectedIncident['isPlaceholder'] && (
            <div className="incident-workflow-card">
              <div className="incident-workflow-header">
                <div>Workflow</div>
                <span className="incident-workflow-badge">{incidentStatusDraft}</span>
              </div>
              <label className="incident-workflow-label">Owner</label>
              <input
                className="incident-workflow-input"
                value={incidentOwnerDraft}
                onChange={(e) => setIncidentOwnerDraft(e.target.value)}
                placeholder="Unassigned"
              />
              <label className="incident-workflow-label">Status</label>
              <select
                className="incident-workflow-input"
                value={incidentStatusDraft}
                onChange={(e) => setIncidentStatusDraft(e.target.value as IncidentWorkflowStatus)}
              >
                {incidentWorkflowStatuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <label className="incident-workflow-label">Notes</label>
              <textarea
                className="incident-workflow-notes"
                value={incidentNotesDraft}
                onChange={(e) => setIncidentNotesDraft(e.target.value)}
                placeholder="What are we doing next? Who owns the follow-up?"
              />
              <div className="incident-workflow-meta">
                Signature: <span>{selectedIncidentSignature || 'N/A'}</span>
              </div>
              <div className="incident-workflow-meta">
                Last updated: <span>{formatDateTimeDisplay(selectedIncident['workflowUpdatedAt'] ?? selectedIncident['lastSeen'] ?? 'Not saved yet')} {formatTimeDisplay(selectedIncident['workflowUpdatedAt'] ?? selectedIncident['lastSeen'])}</span>
              </div>
              <button className="btn btn-primary incident-workflow-save" onClick={onSaveIncidentWorkflow} disabled={incidentWorkflowSaving || isTrialExpired}>
                {incidentWorkflowSaving ? 'Saving…' : 'Save Workflow'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="surface footer">
        <div className={`status-badge ${statusKind(statusMessage)}`}>{statusMessage}</div>
        <div className="footer-links">
          <span>© {new Date().getFullYear()} All rights reserved</span>
          <a href="https://modernendpoint.tech" target="_blank" rel="noopener noreferrer" className="footer-link">modernendpoint.tech</a>
          <span className="footer-sep">·</span>
          <span>by Menahem Suissa</span>
          <span className="footer-sep">·</span>
          <button className="footer-link footer-link-btn" onClick={() => setCurrentView('privacy' as ExtendedViewName)}>Privacy Policy</button>
        </div>
      </div>

      {toasts.length > 0 && (
        <div className="toast-wrap">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
          ))}
        </div>
      )}

      {/* ── Upgrade Access Modal (Permissions) ── */}
      {upgradeModalOpen && (
        <div className="confirm-overlay" onClick={() => setUpgradeModalOpen(false)}>
          <div className="confirm-modal upgrade-modal" onClick={e => e.stopPropagation()}>
            <div className="upgrade-shield">🛡️</div>
            <div className="upgrade-badge">Admin Permissions Required</div>
            <div className="confirm-title" style={{ fontSize: 17 }}>Upgrade Access</div>
            <div className="confirm-body">
              <p>
                Remote actions like <strong style={{ color: 'var(--amber)' }}>{
                  upgradeAction === 'sync' ? 'Device Sync'
                  : upgradeAction === 'reboot' ? 'Remote Reboot'
                  : upgradeAction?.includes('reset') ? 'Autopilot Reset'
                  : 'Remote Actions'
                }</strong> require elevated Microsoft Graph permissions.
              </p>
              <div className="upgrade-scope-list">
                <div className="upgrade-scope">
                  <span className="scope-dot scope-dot-purple" />
                  <span>DeviceManagementManagedDevices.<strong>PrivilegedOperations.All</strong></span>
                </div>
                <div className="upgrade-scope">
                  <span className="scope-dot scope-dot-blue" />
                  <span>DeviceManagementManagedDevices.<strong>ReadWrite.All</strong></span>
                </div>
              </div>
              <p className="upgrade-note">
                You'll be redirected to Microsoft to grant consent. This is a one-time action per tenant.
              </p>
            </div>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setUpgradeModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary upgrade-auth-btn" onClick={() => {
                setUpgradeModalOpen(false);
                window.location.href = '/api/auth/login?elevated=true';
              }}>
                🔑 Authorize Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation Modal ── */}
      {confirmModal.open && (
        <div className="confirm-overlay" onClick={() => setConfirmModal(m => ({ ...m, open: false }))}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-icon">
              {confirmModal.action === 'wipe' ? '🗑️'
                : confirmModal.action === 'retire' ? '📤'
                : confirmModal.action === 'rotateBitLockerKeys' ? '🔑'
                : confirmModal.action === 'resetPasscode' ? '📱'
                : confirmModal.action === 'collectDiagnostics' ? '📋'
                : confirmModal.action?.includes('reset') ? '⚠️'
                : confirmModal.action?.includes('reboot') ? '⚡' : '🔄'}
            </div>
            <div className="confirm-title">
              {confirmModal.action === 'sync' && 'Sync Device'}
              {confirmModal.action === 'reboot' && 'Reboot Device'}
              {confirmModal.action === 'autopilotReset' && 'Autopilot Reset'}
              {confirmModal.action === 'retire' && 'Retire Device'}
              {confirmModal.action === 'wipe' && 'Wipe Device'}
              {confirmModal.action === 'rotateBitLockerKeys' && 'Rotate BitLocker Keys'}
              {confirmModal.action === 'resetPasscode' && 'Reset Passcode'}
              {confirmModal.action === 'collectDiagnostics' && 'Collect Diagnostics'}
              {confirmModal.action === 'bulk-sync' && `Sync ${confirmModal.count} Devices`}
              {confirmModal.action === 'bulk-reboot' && `Reboot ${confirmModal.count} Devices`}
              {confirmModal.action === 'bulk-reset' && `Reset ${confirmModal.count} Devices`}
            </div>
            <div className="confirm-body">
              {confirmModal.action === 'wipe' ? (
                <>
                  <p>Are you sure you want to <strong>WIPE</strong> <span className="confirm-device-name">{confirmModal.deviceName}</span>?</p>
                  <p className="confirm-warning">🗑️ This will factory reset the device. <strong>ALL user data will be permanently erased. This cannot be undone.</strong></p>
                </>
              ) : confirmModal.action === 'retire' ? (
                <>
                  <p>Retire <span className="confirm-device-name">{confirmModal.deviceName}</span> from Intune management?</p>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>The device will be unenrolled on next check-in. User data is preserved.</p>
                </>
              ) : confirmModal.action === 'rotateBitLockerKeys' ? (
                <p>Rotate BitLocker recovery key for <span className="confirm-device-name">{confirmModal.deviceName}</span>? The new key will be stored in Entra ID.</p>
              ) : confirmModal.action === 'resetPasscode' ? (
                <>
                  <p>Reset passcode on <span className="confirm-device-name">{confirmModal.deviceName}</span>?</p>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>The user will need to set a new PIN/passcode on next unlock.</p>
                </>
              ) : confirmModal.action === 'collectDiagnostics' ? (
                <p>Start diagnostic log collection on <span className="confirm-device-name">{confirmModal.deviceName}</span>? Download the logs from the Intune portal when complete.</p>
              ) : confirmModal.action === 'autopilotReset' ? (
                <>
                  <p>Are you sure you want to <strong>Autopilot Reset</strong> <span className="confirm-device-name">{confirmModal.deviceName}</span>?</p>
                  <p className="confirm-warning">⚠️ This will wipe the device and re-run Autopilot provisioning. <strong>This action cannot be undone.</strong></p>
                </>
              ) : confirmModal.action === 'bulk-reset' ? (
                <>
                  <p>Are you sure you want to reset <strong>{confirmModal.count} devices</strong>?</p>
                  <p className="confirm-warning">⚠️ All selected devices will be wiped. <strong>This action cannot be undone.</strong></p>
                </>
              ) : confirmModal.action === 'reboot' ? (
                <p>Reboot <span className="confirm-device-name">{confirmModal.deviceName}</span>? The device will restart immediately.</p>
              ) : confirmModal.action === 'bulk-reboot' ? (
                <p>Reboot <strong>{confirmModal.count} devices</strong>? All selected devices will restart.</p>
              ) : confirmModal.action === 'bulk-sync' ? (
                <p>Force policy sync on <strong>{confirmModal.count} devices</strong>?</p>
              ) : (
                <p>Force policy sync on <span className="confirm-device-name">{confirmModal.deviceName}</span>?</p>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmModal(m => ({ ...m, open: false }))}>Cancel</button>
              <button
                className={`btn ${['wipe','autopilotReset','bulk-reset'].includes(confirmModal.action ?? '') ? 'btn-danger' : 'btn-primary'}`}
                onClick={executeAction}
              >
                {confirmModal.action === 'sync' || confirmModal.action === 'bulk-sync' ? '🔄 Confirm Sync'
                  : confirmModal.action === 'reboot' || confirmModal.action === 'bulk-reboot' ? '⚡ Confirm Reboot'
                  : confirmModal.action === 'wipe' ? '🗑️ Confirm Wipe'
                  : confirmModal.action === 'retire' ? '📤 Confirm Retire'
                  : confirmModal.action === 'rotateBitLockerKeys' ? '🔑 Rotate Keys'
                  : confirmModal.action === 'resetPasscode' ? '📱 Reset Passcode'
                  : confirmModal.action === 'collectDiagnostics' ? '📋 Start Collection'
                  : '♻️ Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Global Search Modal (Ctrl+K) ── */}
      {searchOpen && (
        <div className="search-overlay" onClick={() => { setSearchOpen(false); setGlobalSearch(''); }}>
          <div className="search-modal" onClick={e => e.stopPropagation()}>
            <div className="search-modal-inner">
              <span className="search-modal-icon">🔍</span>
              <input
                ref={globalSearchRef}
                className="search-modal-input"
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                placeholder="Search across all rows… (Esc to close)"
              />
              {globalSearch && <span className="search-modal-count">{filteredRows.length} results</span>}
            </div>
            {globalSearch && filteredRows.length > 0 && (
              <div className="search-results-preview">
                {filteredRows.slice(0, 6).map((row, i) => (
                  <div key={i} className="search-result-item" onClick={() => {
                    const idx = rows.indexOf(row);
                    setSelectedIndex(idx);
                    setSearchOpen(false);
                    setGlobalSearch('');
                  }}>
                    <span className="sri-title">{toText(row['deviceName'] ?? row['displayName'] ?? row['name'] ?? row['title'] ?? `Row ${i + 1}`)}</span>
                    <span className="sri-sub">{toText(row['operatingSystem'] ?? row['area'] ?? row['platform'] ?? row['normalizedCategory'] ?? '')}</span>
                  </div>
                ))}
                {filteredRows.length > 6 && (
                  <div className="search-result-more">+{filteredRows.length - 6} more — press Enter to apply filter</div>
                )}
              </div>
            )}
            <div className="search-modal-footer">
              <span>↵ to filter table</span>
              <span>Esc to close</span>
              <span>Ctrl+K to reopen</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Record Details Modal ── */}
      {jsonModalRow && (
        <div className="json-overlay" onClick={() => setJsonModalRow(null)}>
          <div className="json-modal" onClick={e => e.stopPropagation()}>
            <div className="json-modal-header">
              <div className="json-modal-title-wrap">
                <span className="json-modal-kicker">Record details</span>
                <span className="json-modal-title">
                  {toText(jsonModalRow['deviceName'] ?? jsonModalRow['displayName'] ?? jsonModalRow['name'] ?? jsonModalRow['id'] ?? 'Row')}
                </span>
              </div>
              <div className="json-modal-actions">
                <button className="btn btn-secondary json-copy-btn" onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(jsonModalRow, null, 2));
                  addToast('success', 'JSON copied!');
                }}><span className="json-copy-icon">📋</span><span>Copy JSON</span></button>
                <button className="json-close-btn" onClick={() => setJsonModalRow(null)}>✕</button>
              </div>
            </div>
            <div className="json-body">
              <div className="record-summary-grid">
                <div className="record-summary-card">
                  <div className="record-summary-label">Device</div>
                  <div className="record-summary-value">{toText(jsonModalRow['deviceName'] ?? jsonModalRow['displayName'] ?? jsonModalRow['name'] ?? 'Unknown')}</div>
                </div>
                <div className="record-summary-card">
                  <div className="record-summary-label">Platform</div>
                  <div className="record-summary-value">{toText(jsonModalRow['operatingSystem'] ?? jsonModalRow['platform'] ?? 'Unknown')}</div>
                </div>
                <div className="record-summary-card">
                  <div className="record-summary-label">Compliance</div>
                  <div className="record-summary-value">{toText(jsonModalRow['complianceState'] ?? jsonModalRow['status'] ?? 'Unknown')}</div>
                </div>
                <div className="record-summary-card">
                  <div className="record-summary-label">Last sync</div>
                  <div className="record-summary-value">{formatDateTimeDisplay(jsonModalRow['lastSyncDateTime'] ?? jsonModalRow['lastCheckInTime'] ?? jsonModalRow['enrolledDateTime'] ?? 'Unknown')}</div>
                  <div className="record-summary-sub-row">
                    <div className="record-summary-sub">{formatTimeDisplay(jsonModalRow['lastSyncDateTime'] ?? jsonModalRow['lastCheckInTime'] ?? jsonModalRow['enrolledDateTime'] ?? '')}</div>
                    <div className="record-summary-pill">{formatRelativeTime(jsonModalRow['lastSyncDateTime'] ?? jsonModalRow['lastCheckInTime'] ?? jsonModalRow['enrolledDateTime'] ?? '')}</div>
                  </div>
                </div>
              </div>

              <div className="record-detail-list">
                {Object.entries(jsonModalRow).map(([key, value]) => (
                  <div key={key} className="record-detail-row">
                    <div className="record-detail-key">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                    <div className="record-detail-value">
                      {isDateLikeHeader(key) && isLikelyIsoDate(value)
                        ? (
                          <div className="datetime-cell datetime-cell-inline">
                            <div className="datetime-main">{formatDateTimeDisplay(value)}</div>
                            <div className="datetime-sub-row">
                              <div className="datetime-sub">{formatTimeDisplay(value)}</div>
                              <div className="datetime-relative-pill">{formatRelativeTime(value)}</div>
                            </div>
                          </div>
                        )
                        : toText(value) || '—'}
                    </div>
                  </div>
                ))}
              </div>

              <details className="json-raw-section">
                <summary className="json-raw-summary">
                  <div>
                    <div className="json-raw-title">Raw JSON</div>
                    <div className="json-raw-subtitle">Open only when you need the full payload.</div>
                  </div>
                  <span className="json-raw-toggle">Expand</span>
                </summary>
                <pre className="json-pre">{JSON.stringify(jsonModalRow, null, 2)}</pre>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}