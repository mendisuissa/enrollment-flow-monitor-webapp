/**
 * Phase 3: Enrollment Error Catalog (static knowledge base).
 * Keep this list curated; UI renders columns dynamically.
 */
export const enrollmentErrorCatalog = [
    {
        id: 'ESP-01',
        area: 'Windows Autopilot / ESP',
        errorCode: '0x80180014',
        title: 'MDM enrollment failed (generic)',
        symptoms: 'Autopilot/ESP fails early, device not enrolled, Company Portal may not appear.',
        likelyRootCause: 'MDM user scope disabled, user not licensed for Intune, or enrollment restrictions blocking.',
        remediation: 'Verify Intune license + MDM user scope. Check Enrollment restrictions and device limits. Retry enrollment.',
        severity: 'High'
    },
    {
        id: 'ESP-02',
        area: 'Windows Autopilot / ESP',
        errorCode: '0x80180018',
        title: 'Device limit reached / enrollment blocked',
        symptoms: 'Enrollment fails after AAD join with device limit messaging.',
        likelyRootCause: 'User device limit reached, or enrollment restriction policy blocks platform/ownership.',
        remediation: 'Increase device limit or retire old devices. Review Enrollment restrictions (platform, ownership, device type).',
        severity: 'High'
    },
    {
        id: 'ESP-03',
        area: 'Windows Autopilot / ESP',
        errorCode: '0x80180026',
        title: 'MDM enrollment not allowed (policy)',
        symptoms: 'Autopilot shows enrollment error; MDM enrollment never completes.',
        likelyRootCause: 'MDM enrollment blocked by enrollment restrictions or Conditional Access requirements unmet.',
        remediation: 'Review Enrollment restrictions, CA policies (require compliant device/MFA), and excluded break-glass for testing.',
        severity: 'High'
    },
    {
        id: 'ESP-04',
        area: 'Windows Autopilot / ESP',
        errorCode: '0x800705B4',
        title: 'Operation timed out',
        symptoms: 'ESP steps hang and eventually time out.',
        likelyRootCause: 'Network/proxy/SSL inspection, blocked endpoints, slow device performance, or stuck app installs.',
        remediation: 'Validate Microsoft endpoints reachability, proxy bypass for Intune/CDN, check ESP app policies and app install logs.',
        severity: 'Medium'
    },
    {
        id: 'ESP-05',
        area: 'Windows Autopilot / ESP',
        errorCode: '0x80072F8F',
        title: 'TLS / certificate / time sync issue',
        symptoms: 'Enrollment fails contacting AAD/Intune; SSL errors in logs.',
        likelyRootCause: 'Incorrect system time, SSL interception, missing root CA, or TLS policy conflicts.',
        remediation: 'Fix time sync, verify TLS inspection exceptions for Microsoft endpoints, ensure trusted root CAs.',
        severity: 'High'
    },
    {
        id: 'ESP-06',
        area: 'Windows Autopilot / ESP',
        errorCode: '0x80072EE2',
        title: 'Network timeout to Microsoft service',
        symptoms: 'ESP cannot download apps/policies; intermittent failures.',
        likelyRootCause: 'Firewall/proxy throttling, DNS issues, or unstable network.',
        remediation: 'Check DNS, proxy, firewall allow-lists, and retry on stable network.',
        severity: 'Medium'
    },
    {
        id: 'ESP-07',
        area: 'Windows Autopilot / ESP',
        errorCode: '0x80070005',
        title: 'Access denied during provisioning',
        symptoms: 'ESP fails when applying settings or installing apps.',
        likelyRootCause: 'Local restrictions, security software, or app install context issues.',
        remediation: 'Review App install context (system vs user), disable conflicting security hardening temporarily for testing, validate permissions.',
        severity: 'Medium'
    },
    {
        id: 'ESP-08',
        area: 'Windows Hello for Business',
        errorCode: '0x801C0003',
        title: 'Device registration failure (AAD/WHfB)',
        symptoms: 'Windows Hello provisioning fails or user cannot set up PIN.',
        likelyRootCause: 'Tenant policy, device registration restrictions, or missing prerequisites (TPM/biometrics).',
        remediation: 'Review WHfB policy, TPM readiness, and device registration settings; validate AAD join state.',
        severity: 'Medium'
    },
    {
        id: 'ESP-09',
        area: 'Windows Hello for Business',
        errorCode: '0x801C03F3',
        title: 'Device authentication failed during registration',
        symptoms: 'WHfB registration fails with AAD join/registration errors.',
        likelyRootCause: 'Conditional Access / MFA device registration constraints or authentication policy mismatch.',
        remediation: 'Review CA policies impacting device registration; validate user can register device; check AAD sign-in logs.',
        severity: 'Medium'
    },
    {
        id: 'ESP-10',
        area: 'Autopilot',
        errorCode: '0x8018002A',
        title: 'Autopilot profile download failed',
        symptoms: 'Autopilot cannot fetch profile; stuck at initial OOBE.',
        likelyRootCause: 'Network/proxy blocks Autopilot endpoints, or device not registered correctly.',
        remediation: 'Validate Autopilot registration and internet access. Ensure required endpoints are reachable without SSL inspection.',
        severity: 'High'
    },
    {
        id: 'ESP-11',
        area: 'Autopilot',
        errorCode: '0x8018002B',
        title: 'Autopilot provisioning failed',
        symptoms: 'Provisioning steps fail after profile download.',
        likelyRootCause: 'Policy/app failures, ESP configuration too strict, or CA requirements.',
        remediation: 'Review ESP blocking apps, relax ESP, validate app install success, and check device provisioning logs.',
        severity: 'High'
    },
    {
        id: 'CP-01',
        area: 'Company Portal / MDM',
        errorCode: '0x87D1FDE8',
        title: 'Company Portal / agent cannot communicate',
        symptoms: 'Company Portal stuck, enrollment loop, or no check-in.',
        likelyRootCause: 'Proxy/TLS interception, blocked endpoints, or outdated Company Portal.',
        remediation: 'Validate endpoints, update Company Portal, and check Windows event logs and MDM diagnostic logs.',
        severity: 'Medium'
    },
    {
        id: 'CP-02',
        area: 'Company Portal / MDM',
        errorCode: '0x87D1041C',
        title: 'App installation failed (Intune)',
        symptoms: 'Required app fails repeatedly during ESP.',
        likelyRootCause: 'Incorrect detection rules, missing dependencies, or install context mismatch.',
        remediation: 'Fix detection rules, validate install command, ensure dependencies available, test on clean device.',
        severity: 'Medium'
    },
    {
        id: 'CA-01',
        area: 'Conditional Access',
        errorCode: 'AADSTS50076',
        title: 'MFA required / blocked during enrollment',
        symptoms: 'Enrollment/auth prompts repeat; sign-in fails.',
        likelyRootCause: 'CA policy requires MFA or compliant device before enrollment completes.',
        remediation: 'Adjust CA for enrollment flows (exclude Intune enrollment, require MFA after device registration), test with break-glass.',
        severity: 'High'
    },
    {
        id: 'CA-02',
        area: 'Conditional Access',
        errorCode: 'AADSTS53003',
        title: 'Access blocked by Conditional Access',
        symptoms: 'Sign-in blocked during OOBE/Company Portal.',
        likelyRootCause: 'CA policy blocks user/device state.',
        remediation: 'Check Entra sign-in logs, identify blocking policy, create enrollment exceptions or correct policy conditions.',
        severity: 'High'
    },
    {
        id: 'ENR-01',
        area: 'Enrollment restrictions',
        errorCode: 'DeviceTypeBlocked',
        title: 'Enrollment restriction: device type/ownership blocked',
        symptoms: 'User cannot enroll BYOD/corporate devices.',
        likelyRootCause: 'Enrollment restriction policy denies personal/corporate ownership or platform.',
        remediation: 'Review Tenant admin > Enrollment restrictions and update policy assignments.',
        severity: 'Medium'
    },
    {
        id: 'ENR-02',
        area: 'Enrollment',
        errorCode: 'UserNotLicensed',
        title: 'User missing Intune license',
        symptoms: 'Enrollment fails; device not visible in Intune.',
        likelyRootCause: 'No Intune-capable license assigned, or service plan disabled.',
        remediation: 'Assign license, ensure Intune service plan enabled, wait for propagation, retry.',
        severity: 'High'
    },
    {
        id: 'ENR-03',
        area: 'Enrollment',
        errorCode: 'MDMUserScopeDisabled',
        title: 'MDM user scope disabled',
        symptoms: 'Enrollment consistently fails for all users.',
        likelyRootCause: 'MDM user scope set to None or not including target users.',
        remediation: 'Set MDM user scope to All (or correct group) in Intune/Entra settings; retry.',
        severity: 'High'
    },
    {
        id: 'ENR-04',
        area: 'Certificate / Proxy',
        errorCode: 'SSLInspection',
        title: 'SSL inspection breaks enrollment/auth',
        symptoms: 'Random 401/403/timeout, token exchange fails, Graph calls fail.',
        likelyRootCause: 'TLS interception replacing Microsoft cert chain.',
        remediation: 'Exclude Microsoft endpoints from inspection, or deploy required root CA and configure proxy correctly.',
        severity: 'High'
    },
    {
        id: 'TPM-01',
        area: 'TPM / Attestation',
        errorCode: '0x8028400C',
        title: 'TPM attestation failed',
        symptoms: 'WHfB or device attestation related failures.',
        likelyRootCause: 'TPM not ready, firmware issues, blocked attestation endpoints.',
        remediation: 'Update BIOS/TPM firmware, clear TPM (carefully), validate attestation endpoint access.',
        severity: 'Medium'
    },
    {
        id: 'KEY-01',
        area: 'Credential / Key',
        errorCode: '0x80090016',
        title: 'Keyset does not exist',
        symptoms: 'WHfB or auth token issues; user can’t create PIN.',
        likelyRootCause: 'Corrupt user profile keys, stale credentials.',
        remediation: 'Reset WHfB container/keys, remove NGC folder per guidance, re-enroll.',
        severity: 'Medium'
    },
    {
        id: 'KEY-02',
        area: 'Credential / Key',
        errorCode: '0x80090034',
        title: 'Key not found / invalid state',
        symptoms: 'Authentication fails after registration.',
        likelyRootCause: 'Corrupted key material or policy mismatch.',
        remediation: 'Reset credentials, re-register device, validate WHfB and authentication policies.',
        severity: 'Medium'
    },
    {
        id: 'IOS-01',
        area: 'iOS/iPadOS Enrollment',
        errorCode: 'MDMProfileInstallFailed',
        title: 'MDM profile install failed on iOS',
        symptoms: 'Profile install fails or is removed.',
        likelyRootCause: 'APNs not configured, Apple enrollment profile issues, or device restrictions.',
        remediation: 'Verify APNs certificate, enrollment program token (ADE), and device assignment.',
        severity: 'High'
    },
    {
        id: 'AND-01',
        area: 'Android Enrollment',
        errorCode: 'AndroidEnterpriseSetupFailed',
        title: 'Android Enterprise setup not completed',
        symptoms: 'Android enrollment cannot create work profile / device admin.',
        likelyRootCause: 'Android Enterprise not connected or missing required configurations.',
        remediation: 'Connect Android Enterprise, assign enrollment profiles, verify Google services access.',
        severity: 'Medium'
    },
];
//# sourceMappingURL=enrollmentErrors.js.map