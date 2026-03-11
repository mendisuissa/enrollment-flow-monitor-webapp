import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ViewName } from '@efm/shared';
type ExtendedViewName = ViewName | 'permissionCheck' | 'enrollmentErrorCatalog' | 'reports' | 'readinessChecklist';
import { api, copyRunbook, getAuthStatus, getLogs, getView, refreshData } from './api/client.js';
import { recognize } from 'tesseract.js';

type Row = Record<string, unknown>;
type ThemePreference = 'system' | 'light' | 'dark';
type Toast = { id: number; kind: 'info' | 'success' | 'error'; message: string };

const views: Array<{ id: ExtendedViewName; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'windowsAutopilot', label: 'Device Preparation (All)', icon: '🖥️' },
  { id: 'autopilotUserDriven', label: 'Device Preparation - User-Driven', icon: '👤' },
  { id: 'autopilotPreProvisioning', label: 'Device Preparation - Automatic', icon: '⚙️' },
  { id: 'windowsEnrollment', label: 'Windows Enrollment', icon: '🪟' },
  { id: 'mobileEnrollment', label: 'Mobile Enrollment', icon: '📱' },
  { id: 'macEnrollment', label: 'macOS Enrollment', icon: '🍎' },
  { id: 'ocr', label: 'OCR', icon: '🧠' },
  { id: 'incidents', label: 'Incidents', icon: '🚨' },
  { id: 'permissionCheck', label: 'Permission Check', icon: '🔑' },
  { id: 'enrollmentErrorCatalog', label: 'Enrollment Error Catalog', icon: '📚' },
  { id: 'reports', label: 'Reports', icon: '📈' },
  { id: 'readinessChecklist', label: 'Readiness Checklist', icon: '✅' },
  { id: 'settings', label: 'Settings', icon: '⚙️' }
];

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
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
  const [auth, setAuth] = useState({ connected: false, upn: '', tenantId: '', displayName: '' });
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

  // ✅ FIX: badge counts state for sidebar
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});

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

  const headers = useMemo(() => {
    const first = rows[0];
    if (!first) return [] as string[];
    return Object.keys(first).filter((key) => key !== 'details');
  }, [rows]);

  async function loadAuth() {
    try {
      const result = await getAuthStatus();
      setAuth(result);
    } catch {
      setAuth({ connected: false, upn: '', tenantId: '', displayName: '' });
    }
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

    try {
      setIsViewLoading(true);
      const result = await getView(view);
      const safeRows = Array.isArray(result.rows) ? result.rows : [];
      setRows(safeRows);
      setSelectedIndex(safeRows.length > 0 ? 0 : null);
      setStatusMessage(result.message || `${view} loaded.`);

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
          next['mobileEnrollment'] = Number(row.mobileEnrollmentDevices ?? 0);
          next['macEnrollment'] = Number(row.macEnrollmentDevices ?? 0);
          next['windowsAutopilot'] = Number(row.windowsEnrollmentDevices ?? 0);
          next['autopilotUserDriven'] = Number(row.autopilotUserDrivenDevices ?? 0);
          next['autopilotPreProvisioning'] = Number(row.autopilotAutomaticDevices ?? 0);
        }

        if (view === 'enrollmentErrorCatalog') {
          next['enrollmentErrorCatalog'] = safeRows.length;
        }

        return next;
      });

      if (safeRows.length === 0) {
        setDetailsSummary('No data returned for this view.');
        setDetailsText('The endpoint returned an empty dataset. This is handled safely.');
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
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load view.');
      setDetailsSummary('Load failed');
      setDetailsText('Friendly error handling kept the UI stable.');
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
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Public preview mode. Sign in to load tenant data.');
      setDetailsSummary('Guest preview');
      setDetailsText('You can browse the interface before signing in. Use Sign in to continue.');
      return;
    }

    // Handle new placeholder views
    if (currentView === 'permissionCheck') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Permission Check: Not implemented yet.');
      setDetailsSummary('Permission Check');
      setDetailsText('This feature will check required permissions for enrollment scenarios.');
      return;
    }
    if (currentView === 'enrollmentErrorCatalog') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Enrollment Error Catalog: Browse known errors and fixes.');
      setDetailsSummary('Enrollment Error Catalog');
      setDetailsText('Select an error card to see details and remediation steps.');
      return;
    }
    if (currentView === 'reports') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Reports: Loading enrollment analytics...');
      getView('reports' as any).then(result => {
        const data = result.rows?.[0] as any;
        setReportData(data ?? null);
        setStatusMessage('Reports loaded.');
      }).catch(() => setStatusMessage('Reports load failed.'));
      return;
    }
    if (currentView === 'readinessChecklist') {
      setRows([]);
      setSelectedIndex(null);
      setStatusMessage('Readiness Checklist loaded.');
      getView('readinessChecklist' as any).then(result => {
        setChecklistItems(result.rows ?? []);
      }).catch(() => setChecklistItems([]));
      return;
    }

    void loadView(currentView);
  }, [auth.connected, currentView]);

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
      await refreshData();
      await loadView(currentView);
      addToast('success', 'Data refreshed.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Refresh failed');
      addToast('error', 'Refresh failed.');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function onDisconnect() {
    await api.post('/auth/logout');
    setAuth({ connected: false, upn: '', tenantId: '', displayName: '' });
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

  async function onOpenLogs() {
    const result = await getLogs();
    const safeRows = Array.isArray(result.rows) ? result.rows : [];
    setRows(safeRows);
    setSelectedIndex(safeRows.length ? 0 : null);
    setStatusMessage('Logs loaded in grid.');
    window.open('/api/logs/download', '_blank');
    addToast('info', 'Logs opened in a new tab.');
  }

  function onExport(format: 'json' | 'csv') {
    window.open(`/api/export?view=${currentView}&format=${format}`, '_blank');
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
      const result = await recognize(ocrImageFile, 'eng');
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
      setOcrStatusText('OCR: Failed (manual text needed)');
      setStatusMessage(error instanceof Error ? error.message : 'OCR failed. Paste text manually.');
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

  // ── Enrollment Error Catalog data (30 known errors) ──────────────────────
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

  const [errorSearch, setErrorSearch] = useState('');
  const [errorFilter, setErrorFilter] = useState<'all' | 'high' | 'medium' | 'low' | 'Windows' | 'iOS' | 'Android' | 'macOS'>('all');
  const [expandedError, setExpandedError] = useState<string | null>(null);

  // Reports state
  const [reportData, setReportData] = useState<any>(null);

  // Readiness Checklist state
  const [checklistScenario, setChecklistScenario] = useState<'autopilot' | 'ade-ios' | 'ade-macos' | 'android-enterprise'>('autopilot');
  const [checklistItems, setChecklistItems] = useState<any[]>([]);

  // Tutorial modal state
  const [tutorialOpen, setTutorialOpen] = useState(false);

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

  const filteredErrors = ERROR_CATALOG.filter(e => {
    const matchesSearch = !errorSearch ||
      e.title.toLowerCase().includes(errorSearch.toLowerCase()) ||
      e.code.toLowerCase().includes(errorSearch.toLowerCase()) ||
      e.description.toLowerCase().includes(errorSearch.toLowerCase());
    const matchesFilter = errorFilter === 'all' ||
      e.severity === errorFilter ||
      e.platforms.includes(errorFilter as string);
    return matchesSearch && matchesFilter;
  });

  // Global search filtered rows
  const filteredRows = useMemo(() => {
    if (!globalSearch.trim()) return rows;
    const q = globalSearch.toLowerCase();
    return rows.filter(row =>
      Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))
    );
  }, [rows, globalSearch]);

  // Detect mobile — reactive to window resize
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="app-shell">
      <div className="surface topbar">
        <div className="topbar-left">
          {isMobile && (
            <button className="btn-hamburger" onClick={() => setSidebarOpen(true)}>&#9776;</button>
          )}
          <div className="logo-pill">
            <div className="logo-mark-sq">EF</div>
            <div className="logo-text">
              <span className="logo-title">Modern Endpoint</span>
              <span className="logo-sub">Enterprise Architecture Journal</span>
            </div>
          </div>
          <div className="topbar-titles">
            <span className="topbar-title">Enrollment Flow Monitor</span>
            <span className="topbar-subtitle">
              {auth.connected ? `● Signed in: ${auth.upn}` : '● Public preview mode'}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          {/* Global search button */}
          <button className="btn btn-secondary search-trigger-btn" onClick={() => { setSearchOpen(true); setTimeout(() => globalSearchRef.current?.focus(), 50); }}>
            <span>🔍</span>
            {!isMobile && <span style={{ color: 'var(--text-dim)', fontSize: '10px', fontFamily: 'DM Mono, monospace' }}>Ctrl+K</span>}
          </button>
          {auth.connected && (
            <span className="status-connected-pill"><span className="status-dot-pulse" />Connected</span>
          )}
          <button className="btn btn-secondary" onClick={onCycleTheme}>
            Theme: {themePreference === 'system' ? `System (${effectiveTheme})` : themePreference}
          </button>
          {!auth.connected ? (
            <button className="btn btn-primary" onClick={() => { window.location.href = '/api/auth/login'; }}>Sign in</button>
          ) : (
            <>
              <button className="btn btn-primary" onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing ? 'Refreshing…' : '↻ Refresh'}
              </button>
              <div className="user-menu">
                <div className="user-chip-btn" onClick={() => setIsUserMenuOpen((current) => !current)}>
                  <div className="user-chip-avatar">{(auth.displayName || auth.upn || 'U')[0].toUpperCase()}</div>
                  <span className="user-chip-name">{auth.displayName || auth.upn?.split('@')[0] || 'Account'}</span>
                </div>
                {isUserMenuOpen && (
                  <div className="user-menu-pop">
                    <div className="menu-user">{auth.upn || 'Connected user'}</div>
                    <button className="btn btn-danger" onClick={onDisconnect}>Disconnect</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

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
                  <button className="btn btn-secondary text-left" onClick={() => { onExport('csv'); setSidebarOpen(false); }} disabled={!auth.connected}>Export CSV</button>
                  <button className="btn btn-secondary text-left" onClick={() => { onExport('json'); setSidebarOpen(false); }} disabled={!auth.connected}>Export JSON</button>
                  <button className="btn btn-secondary text-left" onClick={() => { onCopyRunbook(); setSidebarOpen(false); }} disabled={!auth.connected}>Copy Runbook</button>
                  <button className="btn btn-secondary text-left" onClick={() => { onOpenLogs(); setSidebarOpen(false); }} disabled={!auth.connected}>Open Logs</button>
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
              <button className="btn btn-secondary text-left" onClick={() => onExport('csv')} disabled={!auth.connected}>Export CSV</button>
              <button className="btn btn-secondary text-left" onClick={() => onExport('json')} disabled={!auth.connected}>Export JSON</button>
              <button className="btn btn-secondary text-left" onClick={onCopyRunbook} disabled={!auth.connected}>Copy Runbook</button>
              <button className="btn btn-secondary text-left" onClick={onOpenLogs} disabled={!auth.connected}>Open Logs</button>
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

        <div className="panel">
          {!auth.connected ? (
            <div className="welcome-screen">
              <div className="welcome-hero">
                <div className="welcome-logo-mark">EF</div>
                <h1 className="welcome-title">Enrollment Flow Monitor</h1>
                <p className="welcome-tagline">
                  The all-in-one Intune enrollment intelligence platform for IT Admins —
                  diagnose failures, track compliance, and roll out with confidence.
                </p>
                <div className="welcome-actions">
                  <button className="btn btn-primary welcome-signin-btn" onClick={() => { window.location.href = '/api/auth/login'; }}>
                    🔑 Sign in with Microsoft
                  </button>
                  <button className="btn welcome-tutorial-btn" onClick={() => setTutorialOpen(true)}>
                    ▶ Watch Tutorial
                  </button>
                </div>
              </div>

              <div className="welcome-features">
                <div className="welcome-feature">
                  <span className="wf-icon">📚</span>
                  <div className="wf-text">
                    <div className="wf-title">Error Catalog</div>
                    <div className="wf-desc">53 known enrollment errors with remediation steps</div>
                  </div>
                </div>
                <div className="welcome-feature">
                  <span className="wf-icon">📈</span>
                  <div className="wf-text">
                    <div className="wf-title">Live Reports</div>
                    <div className="wf-desc">Health scores, compliance rates & platform breakdown</div>
                  </div>
                </div>
                <div className="welcome-feature">
                  <span className="wf-icon">✅</span>
                  <div className="wf-text">
                    <div className="wf-title">Readiness Checklist</div>
                    <div className="wf-desc">Pre-flight for Autopilot, ADE, Android Enterprise</div>
                  </div>
                </div>
                <div className="welcome-feature">
                  <span className="wf-icon">🤖</span>
                  <div className="wf-text">
                    <div className="wf-title">AI Assistant</div>
                    <div className="wf-desc">M-Intune Architect AI — Enterprise Edition</div>
                  </div>
                </div>
              </div>

              <div className="welcome-footer">
                All rights reserved to modernendpoint.tech · by Menahem Suissa
              </div>

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
                        src="https://www.youtube.com/embed/n3MOS2xdMNw?rel=0&modestbranding=1"
                        title="Enrollment Flow Monitor – Tutorial"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                    <div className="tutorial-chapters">
                      <div className="tutorial-chapter-label">What's covered:</div>
                      <div className="tutorial-chapter-list">
                        <span className="tutorial-chapter">00:00 — Overview & Sign-in</span>
                        <span className="tutorial-chapter">01:30 — Error Catalog</span>
                        <span className="tutorial-chapter">03:00 — Reports & Health Score</span>
                        <span className="tutorial-chapter">05:00 — Readiness Checklist</span>
                        <span className="tutorial-chapter">07:00 — AI Assistant</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : currentView === 'ocr' ? (
            <div className="ocr-shell">
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
                <button className="btn btn-secondary" onClick={onPickImage} disabled={ocrBusy}>Pick Image</button>
                <button className="btn btn-secondary" onClick={onRunOcr} disabled={ocrBusy}>Run OCR</button>
                <button className="btn btn-primary" onClick={onGetOcrExplanation} disabled={ocrBusy}>Get Explanation</button>
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
                  <div className="error-catalog-title">📚 Enrollment Error Catalog</div>
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
                <button className="btn btn-primary" onClick={() => {
                  const el = document.getElementById('reports-print-area');
                  if (el) { window.print(); }
                }}>⬇ Export PDF</button>
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
                  <div className="checklist-title">✅ Enrollment Readiness Checklist</div>
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
                {/* Global search bar when active */}
                {globalSearch && (
                  <div className="table-search-bar">
                    <span>🔍</span>
                    <input
                      className="table-search-input"
                      value={globalSearch}
                      onChange={e => setGlobalSearch(e.target.value)}
                      placeholder={`Filter ${filteredRows.length} of ${rows.length} rows...`}
                      autoFocus
                    />
                    <button className="table-search-clear" onClick={() => setGlobalSearch('')}>✕</button>
                  </div>
                )}
                {/* Mobile: stacked cards */}
                {isMobile ? (
                  <div className="mobile-card-list">
                    {filteredRows.map((row, index) => (
                      <div
                        key={String(row['id'] ?? index)}
                        className={`mobile-data-card ${selectedIndex === index ? 'active' : ''}`}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <div className="mdc-header">
                          <span className="mdc-title">
                            {toText(row['deviceName'] ?? row['displayName'] ?? row['name'] ?? row['title'] ?? `Row ${index + 1}`)}
                          </span>
                          <div className="mdc-actions">
                            {row['id'] && (
                              <button className="copy-id-btn" title="Copy ID" onClick={e => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(String(row['id']));
                                addToast('success', 'ID copied!');
                              }}>⧉</button>
                            )}
                            <button className="view-json-btn" title="View JSON" onClick={e => {
                              e.stopPropagation();
                              setJsonModalRow(row);
                            }}>{ '{}'}</button>
                          </div>
                        </div>
                        {headers.filter(h => h !== 'id' && h !== 'details').slice(0, 4).map(h => (
                          <div key={h} className="mdc-row">
                            <span className="mdc-key">{h}</span>
                            <span className="mdc-val">{toText(row[h])}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Desktop: enhanced table */
                  <div className="table-wrap">
                    <table className="data-table data-table-enhanced">
                      <thead>
                        <tr>
                          {headers.map((header) => (
                            <th key={header}>{header}</th>
                          ))}
                          <th style={{ width: 72 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((row, index) => (
                          <tr
                            key={String(row['id'] ?? index)}
                            className={`table-row ${selectedIndex === index ? 'active' : ''} ${index % 2 === 1 ? 'zebra' : ''}`}
                            onClick={() => setSelectedIndex(index)}
                          >
                            {headers.map((header) => (
                              <td key={`${index}-${header}`}>
                                {header === 'id' || (String(row[header] ?? '').length === 36 && String(row[header] ?? '').includes('-')) ? (
                                  <span className="guid-cell">
                                    <span className="guid-text">{toText(row[header])}</span>
                                    <button className="copy-id-btn" title="Copy ID" onClick={e => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(toText(row[header]));
                                      addToast('success', 'ID copied!');
                                    }}>⧉</button>
                                  </span>
                                ) : toText(row[header])}
                              </td>
                            ))}
                            <td>
                              <button className="view-json-btn" title="View raw JSON" onClick={e => {
                                e.stopPropagation();
                                setJsonModalRow(row);
                              }}>{ '{}'}</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )
          )}
        </div>

        <div className="panel">
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
        </div>
      </div>

      <div className="surface footer">
        <div className={`status-badge ${statusKind(statusMessage)}`}>{statusMessage}</div>
        <div>All rights reserved to modern endpoint.tech (by Menahem Suissa).</div>
      </div>

      {toasts.length > 0 && (
        <div className="toast-wrap">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.kind}`}>{toast.message}</div>
          ))}
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

      {/* ── JSON Viewer Modal ── */}
      {jsonModalRow && (
        <div className="json-overlay" onClick={() => setJsonModalRow(null)}>
          <div className="json-modal" onClick={e => e.stopPropagation()}>
            <div className="json-modal-header">
              <span className="json-modal-title">
                {'{ }'} Raw JSON — {toText(jsonModalRow['deviceName'] ?? jsonModalRow['displayName'] ?? jsonModalRow['name'] ?? jsonModalRow['id'] ?? 'Row')}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(jsonModalRow, null, 2));
                  addToast('success', 'JSON copied!');
                }}>⧉ Copy</button>
                <button className="json-close-btn" onClick={() => setJsonModalRow(null)}>✕</button>
              </div>
            </div>
            <div className="json-body">
              <pre className="json-pre">{JSON.stringify(jsonModalRow, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}