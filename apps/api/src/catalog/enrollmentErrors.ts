import { EnrollmentErrorRow } from '@efm/shared';

/**
 * Enrollment Error Catalog — 53 known Intune / enrollment errors.
 * Sourced from Microsoft Docs. Synchronized with front-end ERROR_CATALOG in App.tsx.
 * Used by the API /view/enrollmentErrorCatalog endpoint.
 */
export const enrollmentErrorCatalog: EnrollmentErrorRow[] = [

  // ── Windows Enrollment / General ────────────────────────────────────────────
  { id: 'WIN-01', area: 'Windows Enrollment', errorCode: '0x80180014', title: 'MDM enrollment not allowed',
    symptoms: 'Enrollment blocked; device never appears in Intune.',
    likelyRootCause: 'Missing Intune license, MDM user scope restricted, or Enrollment Restrictions blocking the platform.',
    remediation: 'Assign Intune/EMS license to user. Set MDM User Scope to All in Entra ID > Mobility. Check Enrollment Restrictions and Conditional Access.', severity: 'High' },

  { id: 'WIN-02', area: 'Windows Enrollment', errorCode: '0x80180026', title: 'Enrollment failed – hybrid join required',
    symptoms: 'Enrollment fails on domain-joined devices with hybrid join error.',
    likelyRootCause: 'GPO or registry requires Hybrid AADJ before MDM enrollment, but AAD Connect is not configured.',
    remediation: 'Verify Azure AD Connect Hybrid AADJ config. Enable MDM auto-enrollment GPO. Run dsregcmd /status to verify join state.', severity: 'High' },

  { id: 'WIN-03', area: 'Windows Enrollment', errorCode: '80180003', title: 'Terms of Use not accepted',
    symptoms: 'Enrollment blocked; user prompted to accept terms.',
    likelyRootCause: 'A Terms of Use CA policy is enforced and the user has not consented.',
    remediation: 'Direct user to https://myapps.microsoft.com to accept Terms of Use. Verify policy scope in Entra ID > Security > CA > Terms of Use.', severity: 'Medium' },

  { id: 'WIN-04', area: 'Windows Enrollment', errorCode: '0x80CF0437', title: 'Clock not synchronized',
    symptoms: 'Certificate validation fails; enrollment errors reference time skew.',
    likelyRootCause: 'More than 5 minutes time skew between device and Azure AD / Intune servers.',
    remediation: 'Run w32tm /resync. Ensure Windows Time service is running. Set NTP via GPO. Allow UDP 123 to time.windows.com.', severity: 'Medium' },

  { id: 'WIN-05', area: 'Windows Enrollment', errorCode: '0x87D101F4', title: 'Device limit reached',
    symptoms: 'Enrollment rejected with device limit message.',
    likelyRootCause: 'Default or custom Enrollment Restriction policy limits devices per user.',
    remediation: 'Increase device limit in Devices > Enrollment restrictions > Device limit restrictions. Have user unenroll old devices.', severity: 'Medium' },

  { id: 'WIN-06', area: 'Windows Enrollment', errorCode: '0x80180005', title: 'User not authorized for enrollment',
    symptoms: 'Enrollment blocked; user not in MDM user scope.',
    likelyRootCause: 'Entra ID Mobility settings have MDM user scope set to "Some" and user is not in included group.',
    remediation: 'Go to Entra ID > Mobility > Microsoft Intune. Set MDM User Scope to All or add user to scope group.', severity: 'High' },

  { id: 'WIN-07', area: 'Windows Enrollment', errorCode: '80180001', title: 'OS version not supported',
    symptoms: 'Enrollment rejected; minimum OS version not met.',
    likelyRootCause: 'Enrollment Restriction policy has minimum OS version set and device does not meet it.',
    remediation: 'Check Devices > Enrollment restrictions > Platform restrictions. Update device OS or adjust minimum version policy.', severity: 'Medium' },

  { id: 'WIN-08', area: 'Windows Enrollment', errorCode: '0x80192EE7', title: 'Network connection failed during enrollment',
    symptoms: 'Enrollment fails with network error; device cannot reach Intune endpoints.',
    likelyRootCause: 'Proxy, firewall, or DNS blocking required Microsoft endpoints.',
    remediation: 'Verify device can reach *.manage.microsoft.com, *.microsoftonline.com. Review proxy bypass list and firewall rules for TCP 443.', severity: 'Medium' },

  { id: 'WIN-09', area: 'Windows Enrollment', errorCode: '0x80070057', title: 'Invalid parameter during enrollment',
    symptoms: 'MDM enrollment handshake fails with invalid parameter error.',
    likelyRootCause: 'Corrupted local MDM registry entries or previous partial enrollment left stale state.',
    remediation: 'Run MdmDiagnosticsTool.exe to collect logs. Delete stale HKLM\\SOFTWARE\\Microsoft\\Enrollments entries. Run dsregcmd /leave then re-join.', severity: 'Medium' },

  { id: 'WIN-10', area: 'Windows Enrollment', errorCode: '0x80CF0014', title: 'Company Portal not updated',
    symptoms: 'Enrollment or management action fails; old Company Portal version.',
    likelyRootCause: 'An older version of Company Portal does not support the required enrollment flow.',
    remediation: 'Update Company Portal from Microsoft Store or deploy latest version via Intune.', severity: 'Low' },

  { id: 'WIN-11', area: 'Windows Enrollment', errorCode: '80090030', title: 'TPM required but not available',
    symptoms: 'Enrollment or compliance fails; TPM not found.',
    likelyRootCause: 'Device lacks TPM 2.0, TPM is disabled in BIOS/UEFI, or firmware TPM not enabled.',
    remediation: 'Run tpm.msc to verify TPM status. Enable TPM in BIOS/UEFI. For VMs: use Hyper-V Gen 2 with virtual TPM enabled.', severity: 'High' },

  { id: 'WIN-12', area: 'Windows Enrollment', errorCode: '0x80040154', title: 'MDM agent COM class not registered',
    symptoms: 'Enrollment fails with COM registration error.',
    likelyRootCause: 'Corrupted Windows image, missing MDM DLLs, or Enrollment service disabled.',
    remediation: 'Run sfc /scannow and DISM /Online /Cleanup-Image /RestoreHealth. Verify DeviceEnroller service. Re-image if needed.', severity: 'High' },

  { id: 'WIN-13', area: 'Windows Enrollment', errorCode: '0x800700B7', title: 'Configuration already exists',
    symptoms: 'Re-enrollment fails; conflicting MDM configuration detected.',
    likelyRootCause: 'Previous MDM enrollment (SCCM co-management or another MDM) was not cleanly removed.',
    remediation: 'Run dsregcmd /leave. Remove stale HKLM\\SOFTWARE\\Microsoft\\Enrollments registry entries. Re-enroll after confirming clean state.', severity: 'Medium' },

  { id: 'WIN-14', area: 'Windows Enrollment', errorCode: '0x80CF0301', title: 'Intune client installation failed',
    symptoms: 'Intune management extension fails to install during enrollment.',
    likelyRootCause: 'Blocked by Group Policy, antivirus, or AppLocker; or Windows Installer service issues.',
    remediation: 'Verify msiserver service. Temporarily disable AV. Review AppLocker/WDAC. Check IME logs at C:\\ProgramData\\Microsoft\\IntuneManagementExtension\\Logs.', severity: 'Medium' },

  { id: 'WIN-15', area: 'Windows Enrollment', errorCode: 'MENROLL_E_DEVICENOTSUPPORTED', title: 'Device type not supported',
    symptoms: 'Enrollment fails; device edition not supported.',
    likelyRootCause: 'Windows Home edition does not include MDM enrollment APIs.',
    remediation: 'Verify Windows edition with winver. Upgrade to Windows Pro or Enterprise. Education edition required for education devices.', severity: 'Medium' },

  // ── Windows Autopilot / ESP ──────────────────────────────────────────────────
  { id: 'AP-01', area: 'Windows Autopilot / ESP', errorCode: '0x80070774', title: 'Autopilot profile not assigned',
    symptoms: 'Autopilot deployment shows no profile; device goes through standard OOBE.',
    likelyRootCause: 'Hardware hash not registered or no Autopilot profile assigned to device/group.',
    remediation: 'Verify device in Devices > Windows Enrollment > Devices. Check profile assignment. Re-upload hardware hash if needed. Allow 15 min for sync.', severity: 'High' },

  { id: 'AP-02', area: 'Windows Autopilot / ESP', errorCode: '0x87D1313C', title: 'Enrollment Status Page timeout',
    symptoms: 'ESP times out waiting for apps or policies to install.',
    likelyRootCause: 'Required apps taking too long, large packages, or slow network during OOBE.',
    remediation: 'Increase ESP timeout in profile settings. Reduce required apps count. Check IME logs for blocking app. Mark non-critical apps as Available instead of Required.', severity: 'Medium' },

  { id: 'AP-03', area: 'Windows Autopilot / ESP', errorCode: '0x80070490', title: 'Autopilot – hardware hash / element not found',
    symptoms: 'Autopilot registration fails; device not recognized in Intune.',
    likelyRootCause: 'Outdated BIOS/UEFI, Secure Boot disabled, or hardware hash captured incorrectly.',
    remediation: 'Update BIOS, enable Secure Boot + TPM 2.0. Re-capture hash with Get-WindowsAutoPilotInfo. Re-import CSV. Wait up to 24h after import.', severity: 'High' },

  { id: 'AP-04', area: 'Windows Autopilot / ESP', errorCode: '0x8007064C', title: 'Autopilot – device already registered',
    symptoms: 'Duplicate hardware hash; registration fails.',
    likelyRootCause: 'Device previously registered in another tenant and not deregistered.',
    remediation: 'Previous tenant must deregister the device. Contact OEM/reseller for new devices. File Microsoft support request if previous tenant unreachable.', severity: 'Medium' },

  { id: 'AP-05', area: 'Windows Autopilot / ESP', errorCode: '0x8018002A', title: 'Autopilot profile download failed',
    symptoms: 'Profile download step fails during Autopilot OOBE.',
    likelyRootCause: 'Network not available during OOBE, proxy blocking Autopilot endpoints, or token expired.',
    remediation: 'Verify connectivity to *.microsoft.com endpoints at OOBE. Check proxy bypass for Autopilot URLs. Re-assign profile and sync.', severity: 'High' },

  // ── Azure AD Join / Hybrid Join ──────────────────────────────────────────────
  { id: 'AAD-01', area: 'Azure AD Join', errorCode: '0x801c0003', title: 'Azure AD join failed – user not authorized',
    symptoms: 'Device cannot join Azure AD during Autopilot or manual AADJ.',
    likelyRootCause: 'Azure AD "Users may join devices" setting restricted, or user reached device join limit.',
    remediation: 'Check Entra ID > Devices > Device settings > Users may join devices. Increase max devices per user. Verify Intune/AAD P1 license.', severity: 'High' },

  { id: 'AAD-02', area: 'Hybrid Azure AD Join', errorCode: '0x80180017', title: 'Hybrid Azure AD join – SCP not configured',
    symptoms: 'Hybrid AADJ fails; devices not registering with Azure AD.',
    likelyRootCause: 'Azure AD Connect has not configured SCP, or SCP points to wrong tenant.',
    remediation: 'Run AAD Connect and enable Hybrid AADJ. Verify SCP in AD Sites & Services. Ensure DCs have connectivity to login.microsoftonline.com. Run dsregcmd /status.', severity: 'High' },

  // ── Certificates / SCEP / PKCS ───────────────────────────────────────────────
  { id: 'CERT-01', area: 'Certificates', errorCode: '0x80090016', title: 'Certificate enrollment failed (SCEP/PKCS)',
    symptoms: 'PKCS or SCEP certificate profile fails to deploy.',
    likelyRootCause: 'NDES connector misconfiguration, expired CA certificate, or network connectivity to NDES server.',
    remediation: 'Check NDES connector status in Tenant administration > Certificate connectors. Verify NDES URL accessibility. Review NDES connector logs.', severity: 'High' },

  { id: 'CERT-02', area: 'Certificates', errorCode: '0x80092013', title: 'Certificate revocation check failed',
    symptoms: 'Certificate-based enrollment or SCEP/PKCS deployment fails with CRL error.',
    likelyRootCause: 'Device cannot reach CRL distribution point or OCSP responder due to network/proxy restrictions.',
    remediation: 'Identify CRL URL with certutil -URL. Ensure device can reach CRL on port 80. Add CRL/OCSP to proxy bypass. Test with certutil -verify -urlfetch.', severity: 'Medium' },

  { id: 'CERT-03', area: 'Certificates', errorCode: 'ERR_MACOS_SCEP', title: 'macOS SCEP certificate enrollment failed',
    symptoms: 'SCEP certificate profile fails to deploy to macOS devices.',
    likelyRootCause: 'NDES server unreachable from Mac, certificate template permissions incorrect, or Intune Certificate Connector unhealthy.',
    remediation: 'Verify Certificate Connector health in Tenant administration. Check Mac can reach NDES URL. Review IIS logs on NDES server. Check macOS Console for profile errors.', severity: 'Medium' },

  // ── Conditional Access ───────────────────────────────────────────────────────
  { id: 'CA-01', area: 'Conditional Access', errorCode: 'CAE_53003', title: 'Conditional Access – device compliance required',
    symptoms: 'User blocked from resource; device not compliant or not enrolled.',
    likelyRootCause: 'Device not enrolled, compliance not yet evaluated, or a compliance setting failing (BitLocker, OS version).',
    remediation: 'Enroll device via Company Portal. Wait 15 min for compliance evaluation. Check Company Portal for failing settings. Sync manually if compliant but still blocked.', severity: 'High' },

  { id: 'CA-02', area: 'Conditional Access', errorCode: 'AADSTS53000', title: 'Device not compliant – access blocked by CA',
    symptoms: 'AADSTS53000 error on sign-in; device marked non-compliant.',
    likelyRootCause: 'Compliance grace period elapsed, requirement not met, or device not registered in Azure AD.',
    remediation: 'Use What If tool in CA to identify blocking policy. Review Intune compliance reports. Check grace period settings. Ensure policy targets correct group.', severity: 'High' },

  { id: 'CA-03', area: 'Conditional Access', errorCode: '0x80180025', title: 'Enrollment blocked by Conditional Access',
    symptoms: 'CA policy blocks device during enrollment – chicken-and-egg scenario.',
    likelyRootCause: 'CA requires compliant or Hybrid-joined device but device has not yet enrolled.',
    remediation: 'Temporarily exclude user from CA during initial enrollment. Use Autopilot to pre-provision before applying CA. Check Entra ID sign-in logs for blocking policy.', severity: 'High' },

  { id: 'CA-04', area: 'Conditional Access', errorCode: 'AADSTS50105', title: 'User not assigned to application',
    symptoms: 'User cannot sign in to Company Portal; application not assigned.',
    likelyRootCause: 'Enterprise application "Microsoft Intune" has user assignment required and user is not assigned.',
    remediation: 'Entra ID > Enterprise applications > Microsoft Intune > Users and groups. Add user or group. Or set Assignment required to No for open access.', severity: 'High' },

  { id: 'CA-05', area: 'Conditional Access', errorCode: 'AADSTS700016', title: 'Application not found in tenant',
    symptoms: 'Microsoft Intune or Company Portal application missing from tenant.',
    likelyRootCause: 'Enterprise application deleted or never consented in the tenant.',
    remediation: 'Search Entra ID > Enterprise applications for Microsoft Intune and Company Portal. Re-consent via M365 Admin Center. Verify with Get-MgServicePrincipal in PowerShell.', severity: 'High' },

  // ── iOS / iPadOS ─────────────────────────────────────────────────────────────
  { id: 'iOS-01', area: 'iOS Enrollment', errorCode: '80180018', title: 'Device enrolled with different identity',
    symptoms: 'iOS/macOS enrollment fails; residual profile from previous MDM.',
    likelyRootCause: 'Device previously enrolled with different Apple ID or MDM and not properly unenrolled.',
    remediation: 'Remove existing MDM profile in Settings > General > VPN & Device Management. Re-assign in Apple Business Manager. Wipe and re-enroll if needed.', severity: 'Medium' },

  { id: 'iOS-02', area: 'iOS Enrollment', errorCode: '0x80180035', title: 'Enrollment profile not found (ADE/DEP)',
    symptoms: 'ADE/DEP enrollment fails; no profile to assign.',
    likelyRootCause: 'Device serial not synced from Apple Business Manager, or no ADE profile assigned.',
    remediation: 'Sync ABM in Intune: Devices > iOS/iPadOS > Enrollment program tokens > Sync. Verify serial appears. Assign ADE profile to device or group.', severity: 'High' },

  { id: 'iOS-03', area: 'iOS Enrollment', errorCode: '0x87D13B91', title: 'ADE/DEP enrollment failed – profile download',
    symptoms: 'ADE profile download fails during Setup Assistant.',
    likelyRootCause: 'Device not assigned in ABM, token expired, or network blocking albert.apple.com.',
    remediation: 'Verify device assigned to MDM server in ABM. Check ADE token expiry. Ensure device reaches albert.apple.com and gdmf.apple.com on TCP 443.', severity: 'High' },

  { id: 'iOS-04', area: 'iOS/macOS Enrollment', errorCode: '0x87D13B92', title: 'APNs certificate mismatch or expired',
    symptoms: 'MDM commands cannot be sent to iOS/macOS devices.',
    likelyRootCause: 'APNs certificate expired or renewed with wrong Apple ID causing certificate UID mismatch.',
    remediation: 'Renew APNs using the SAME Apple ID as original. Download CSR from Intune, upload to push.apple.com, upload new .pem back. If wrong Apple ID: re-enroll all devices.', severity: 'High' },

  { id: 'iOS-05', area: 'iOS Enrollment', errorCode: 'PROFILE_INSTALLATION_FAILED', title: 'iOS configuration profile installation failed',
    symptoms: 'Configuration profile pushed from Intune fails to install on iOS device.',
    likelyRootCause: 'Conflicting existing profile, payload not supported on device OS version, or supervised-only settings pushed to unsupervised device.',
    remediation: 'Check OS version meets payload minimum. Verify supervised-only settings not pushed to BYOD devices. Remove conflicting profiles. Check device logs in Settings > VPN & Device Management.', severity: 'Medium' },

  { id: 'iOS-06', area: 'iOS Enrollment', errorCode: '0x87D1041C', title: 'Device compliance policy not applied (iOS)',
    symptoms: 'iOS device shows non-compliant after enrollment.',
    likelyRootCause: 'Compliance evaluation not yet completed, jailbreak detection triggered, or OS below minimum.',
    remediation: 'Wait up to 8 hours for initial compliance evaluation. Force sync via Company Portal. Check jailbreak detection status. Verify OS meets minimum version.', severity: 'Medium' },

  { id: 'iOS-07', area: 'iOS/Android Enrollment', errorCode: '0x80180036', title: 'Push notification service error (APNs/FCM)',
    symptoms: 'Intune cannot communicate with device; push certificate invalid.',
    likelyRootCause: 'Apple MDM Push Certificate expired, or FCM token invalid for Android.',
    remediation: 'Renew APNs certificate in Tenant administration > Apple MDM Push certificate using same Apple ID. For Android: verify Google Play Services active and FCM not blocked by firewall.', severity: 'Medium' },

  { id: 'iOS-08', area: 'iOS/Android Enrollment', errorCode: '0x87D13B8E', title: 'Policy application failed – app configuration',
    symptoms: 'App configuration policy fails to apply after enrollment.',
    likelyRootCause: 'Incorrect bundle ID, managed app not installed, or policy targets wrong group.',
    remediation: 'Verify app bundle ID in configuration policy. Ensure target app is deployed and installed. Check policy assignment. Review App configuration status in Intune device diagnostics.', severity: 'Medium' },

  // ── macOS ────────────────────────────────────────────────────────────────────
  { id: 'MAC-01', area: 'macOS Enrollment', errorCode: '0x87D13B94', title: 'macOS MDM enrollment – user-approved required',
    symptoms: 'macOS device enrolled but MDM capabilities limited; not user-approved.',
    likelyRootCause: 'User did not explicitly approve the MDM profile in System Settings.',
    remediation: 'Open System Settings > Privacy & Security > Profiles and approve MDM profile. For full management without user approval: use ADE/DEP via Apple Business Manager.', severity: 'Medium' },

  // ── Android Enterprise ────────────────────────────────────────────────────────
  { id: 'AND-01', area: 'Android Enrollment', errorCode: '0x87D13B93', title: 'Android Enterprise – work profile failed',
    symptoms: 'Android Enterprise Work Profile enrollment fails during Company Portal setup.',
    likelyRootCause: 'Google Play Services outdated, device not Google Play Protect certified, or Managed Google Play not linked.',
    remediation: 'Update Google Play Services. Verify device is Play Protect certified. Check Managed Google Play link in Tenant administration > Android. Clear Company Portal data and retry.', severity: 'High' },

  { id: 'AND-02', area: 'Android Enrollment', errorCode: 'ANDROID_MANAGEMENT_0x3', title: 'Android Fully Managed – DPC not set',
    symptoms: 'Android fully managed (COBO) enrollment fails; DPC not provisioned.',
    likelyRootCause: 'QR code or NFC token not scanned during initial setup; device went through normal setup flow.',
    remediation: 'Factory reset and scan QR/NFC immediately at Welcome screen. Do not tap through standard setup. Verify enrollment token not expired (90-day limit). Check zero-touch config JSON.', severity: 'High' },

  { id: 'AND-03', area: 'Android Enrollment', errorCode: '0x8018002B', title: 'Android device admin enrollment blocked',
    symptoms: 'Legacy Android DA enrollment blocked; only Android Enterprise supported.',
    likelyRootCause: 'Google deprecated DA APIs; Intune blocks DA enrollment by default.',
    remediation: 'Migrate to Android Enterprise: work profile for BYOD, fully managed for corporate. If DA temporarily needed, enable in Enrollment restrictions. Plan migration timeline for end users.', severity: 'Medium' },

  { id: 'AND-04', area: 'Android Enrollment', errorCode: '0x8018002A', title: 'Enrollment blocked – platform restriction (Android)',
    symptoms: 'Android enrollment blocked by platform restriction policy.',
    likelyRootCause: 'Enrollment Restriction policy blocks Android or specific Android enrollment type.',
    remediation: 'Check Devices > Enrollment restrictions > Device type restrictions. Ensure Android Enterprise types are set to Allow. Verify user assigned correct restriction profile priority.', severity: 'Medium' },

  // ── BitLocker & Security ──────────────────────────────────────────────────────
  { id: 'BL-01', area: 'BitLocker', errorCode: '0x8031004A', title: 'BitLocker – no compatible TPM found',
    symptoms: 'BitLocker encryption policy cannot be applied; no compatible TPM.',
    likelyRootCause: 'No TPM 2.0, TPM disabled in BIOS/UEFI, or policy requires TPM startup key without TPM.',
    remediation: 'Run tpm.msc to verify TPM 2.0. Enable TPM in BIOS/UEFI. For VMs: use Hyper-V Gen 2 with virtual TPM. Configure BitLocker policy to allow non-TPM encryption with startup PIN if needed.', severity: 'High' },

  { id: 'BL-02', area: 'BitLocker', errorCode: '0x80284001', title: 'BitLocker recovery key escrow failed',
    symptoms: 'BitLocker recovery key cannot be escrowed to Azure AD / Intune.',
    likelyRootCause: 'Device not Azure AD joined, network issue during key upload, or key already backed up.',
    remediation: 'Verify AADJ state with dsregcmd /status. Force key backup: manage-bde -protectors -adbackup C:. Check Azure AD > Devices > BitLocker keys tab. Enable escrow policy.', severity: 'Medium' },

  // ── Intune Management Extension ───────────────────────────────────────────────
  { id: 'IME-01', area: 'IME / Scripts', errorCode: 'IME_0x87D10196', title: 'IME – script execution failed',
    symptoms: 'PowerShell script deployed via IME fails to execute.',
    likelyRootCause: 'Script execution policy blocking, 32/64-bit PowerShell mismatch, or script syntax errors.',
    remediation: 'Check IME logs at C:\\ProgramData\\Microsoft\\IntuneManagementExtension\\Logs. Verify run context (SYSTEM vs user). Ensure script is signed or execution policy allows. Test with PsExec in correct context.', severity: 'Medium' },

  { id: 'IME-02', area: 'IME / Scripts', errorCode: 'IME_WIN32_0x8007010B', title: 'Win32 app – directory not found during install',
    symptoms: 'Win32 app deployed via Intune fails with directory not found.',
    likelyRootCause: '.intunewin package references a path that does not exist, or content extraction failed.',
    remediation: 'Verify .intunewin created with correct source folder. Check IME logs for exact failing path. Ensure SYSTEM account can access path. Re-package with Intune Win32 Content Prep Tool if needed.', severity: 'Medium' },

  { id: 'IME-03', area: 'IME / Apps', errorCode: '0x80CF4017', title: 'Intune Management Extension not installed',
    symptoms: 'PowerShell scripts or Win32 apps not executing; IME absent.',
    likelyRootCause: 'IME only installs when a PS script or Win32/LOB app is assigned. If no such assignment exists, IME is absent.',
    remediation: 'Assign at least one PowerShell script or Win32 app to trigger IME installation. Verify IME service: Get-Service IntuneManagementExtension. Check IME installation logs.', severity: 'Medium' },

  // ── Co-management / ConfigMgr ─────────────────────────────────────────────────
  { id: 'CO-01', area: 'Co-management', errorCode: '0x87D10D4C', title: 'Co-management enrollment conflict',
    symptoms: 'Device enrolled in both SCCM and Intune; workload conflicts or duplicate policies.',
    likelyRootCause: 'Co-management workloads not properly configured, or device switched MDM authority without clean re-enrollment.',
    remediation: 'Review co-management workload slider in ConfigMgr. Decide which workloads go to Intune vs ConfigMgr. Avoid assigning same policy type from both tools. Check co-management status in ConfigMgr > Monitoring.', severity: 'Medium' },

  // ── Enrollment – Licensing / Subscription ─────────────────────────────────────
  { id: 'LIC-01', area: 'Licensing', errorCode: '0x80180024', title: 'Intune subscription expired or not found',
    symptoms: 'All enrollment fails; subscription not active.',
    likelyRootCause: 'Trial expired, licenses removed, or billing issue with Microsoft subscription.',
    remediation: 'Check M365 Admin Center > Billing > Subscriptions. Assign Intune or M365 E3/E5 licenses. Verify MDM authority in Tenant administration > Tenant status. Contact Microsoft billing if needed.', severity: 'High' },

  { id: 'LIC-02', area: 'Licensing', errorCode: '0x80072EE6', title: 'Enrollment URL not reachable',
    symptoms: 'Enrollment discovery fails; URL cannot be resolved.',
    likelyRootCause: 'DNS CNAME record for EnterpriseEnrollment is missing or incorrect.',
    remediation: 'Create CNAME: EnterpriseEnrollment.<domain> > EnterpriseEnrollment.manage.microsoft.com. Also create EnterpriseRegistration CNAME. Verify with nslookup. Allow 24-48h for DNS propagation.', severity: 'High' },

  { id: 'LIC-03', area: 'Licensing', errorCode: '0x80180028', title: 'Account not found in directory',
    symptoms: 'Enrollment fails; user account not found in tenant.',
    likelyRootCause: 'User deleted, is a guest account, or UPN domain not verified in tenant.',
    remediation: 'Verify user in Entra ID > Users > All users. Ensure UPN domain is verified. Guest accounts cannot enroll: a member account is required. Re-create user if accidentally deleted.', severity: 'High' },

  // ── Service Availability ───────────────────────────────────────────────────────
  { id: 'SVC-01', area: 'Service Availability', errorCode: '0x80CF0022', title: 'Service temporarily unavailable',
    symptoms: 'Intune returns 503 / service unavailable during enrollment or policy sync.',
    likelyRootCause: 'Azure/Intune service degradation or scheduled maintenance window.',
    remediation: 'Check Azure Service Health at https://status.azure.com. Wait 15-30 min and retry. Check M365 Admin Center > Health > Service health for active incidents. Open support ticket if issue persists over 1 hour.', severity: 'Low' },

  { id: 'SVC-02', area: 'Service Availability', errorCode: '0x87D1041A', title: 'Device check-in failure – MDM heartbeat missed',
    symptoms: 'Device shows "not contacted" or stale in Intune.',
    likelyRootCause: 'Device powered off, offline for extended period, or MDM client service stopped.',
    remediation: 'Power on device and connect to internet. Trigger manual sync from Company Portal or Intune portal. Check Task Scheduler OMADMClient task. Retire stale devices if no longer in use.', severity: 'Low' },

];
