import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ViewName } from '@efm/shared';
type ExtendedViewName = ViewName | 'auditLogs' | 'privacy';
import { api, copyRunbook, getAuthStatus, getLogs, getView, refreshData, deviceSync, deviceReboot, deviceAutopilotReset, deviceBulkAction, getExportUrl } from './api/client.js';
import { recognize } from 'tesseract.js';

type Row = Record<string, unknown>;
type ThemePreference = 'system' | 'light' | 'dark';
type Toast = { id: number; kind: 'info' | 'success' | 'error'; message: string };

const views: Array<{ id: ExtendedViewName; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'windowsEnrollment', label: 'Windows Enrollment', icon: '🪟' },
  { id: 'linuxEnrollment', label: 'Linux Enrollment', icon: '🐧' },
  { id: 'mobileEnrollment', label: 'Mobile Enrollment', icon: '📱' },
  { id: 'macEnrollment', label: 'macOS Enrollment', icon: '🍎' },
  { id: 'ocr', label: 'OCR', icon: '🧠' },
  { id: 'incidents', label: 'Incidents', icon: '🚨' },
  { id: 'permissionCheck', label: 'Permission Check', icon: '🔑' },
  { id: 'enrollmentErrorCatalog', label: 'Enrollment Error Catalog', icon: '📚' },
  { id: 'reports', label: 'Reports', icon: '📈' },
  { id: 'readinessChecklist', label: 'Readiness Checklist', icon: '✅' },
  { id: 'auditLogs', label: 'Audit Logs', icon: '📋' },
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
  const [auth, setAuth] = useState({ connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false });
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
      setAuth({ connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false });
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

    // Handle custom views
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
    if (currentView === 'dashboard') {
      setRows([]);
      setSelectedIndex(null);
      setIsViewLoading(true);
      setStatusMessage('Loading dashboard...');
      getView('dashboard').then(result => {
        const data = result.rows?.[0] as any;
        setDashboardData(data ?? null);
        setStatusMessage('Dashboard loaded.');
        addAuditLog('View Dashboard', 'Dashboard loaded', 'info');
      }).catch(() => setStatusMessage('Dashboard load failed.')).finally(() => setIsViewLoading(false));
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

  // ── Audit Logs ───────────────────────────────────────────
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

  async function runGraphQuery() {
    if (!graphQuery.trim()) return;
    setGraphLoading(true);
    setGraphResult('');
    try {
      const res = await api.get(`/debug/graph?path=/${graphQuery.replace(/^\//, '')}`);
      setGraphResult(JSON.stringify(res.data, null, 2));
    } catch (e: any) {
      setGraphResult(JSON.stringify({ error: e?.message ?? 'Query failed' }, null, 2));
    } finally {
      setGraphLoading(false);
    }
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
      const label = action === 'sync' ? 'Sync' : action === 'reboot' ? 'Reboot' : 'Autopilot Reset';
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

  // Dashboard KPI state
  const [dashboardData, setDashboardData] = useState<any>(null);

  // ── Device Remediation state ─────────────────────────────
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    action: 'sync' | 'reboot' | 'autopilotReset' | 'bulk-sync' | 'bulk-reboot' | 'bulk-reset' | null;
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

  // Graph Query Drawer state
  const [graphDrawerOpen, setGraphDrawerOpen] = useState(false);
  const [graphQuery, setGraphQuery] = useState('deviceManagement/managedDevices?$top=5&$select=deviceName,operatingSystem,complianceState,userPrincipalName');
  const [graphResult, setGraphResult] = useState<string>('');
  const [graphLoading, setGraphLoading] = useState(false);

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

  // Global search + filter chips combined
  const filteredRows = useMemo(() => {
    let result = rows;
    const q = (globalSearch || inlineSearch).toLowerCase().trim();
    if (q) {
      result = result.filter(row =>
        Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))
      );
    }
    // Apply filter chips
    if (activeFilters.has('non-compliant')) {
      result = result.filter(r => String(r['complianceState'] ?? '').toLowerCase().includes('non'));
    }
    if (activeFilters.has('windows')) {
      result = result.filter(r => String(r['operatingSystem'] ?? r['platform'] ?? '').toLowerCase().includes('windows'));
    }
    if (activeFilters.has('active-today')) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      result = result.filter(r => {
        const ts = r['lastSyncDateTime'] ?? r['enrolledDateTime'] ?? r['lastCheckInTime'];
        return ts ? new Date(String(ts)).getTime() > cutoff : false;
      });
    }
    if (activeFilters.has('errors')) {
      result = result.filter(r => String(r['enrollmentState'] ?? r['status'] ?? '').toLowerCase().includes('fail')
        || String(r['complianceState'] ?? '').toLowerCase().includes('error'));
    }
    return result;
  }, [rows, globalSearch, inlineSearch, activeFilters]);

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
            {!isMobile && (
              <span className="topbar-subtitle">
                {auth.connected ? `● Signed in: ${auth.upn}` : '● Public preview mode'}
              </span>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          {/* Search — always visible */}
          <button className="btn btn-secondary search-trigger-btn" onClick={() => { setSearchOpen(true); setTimeout(() => globalSearchRef.current?.focus(), 50); }} title="Search (Ctrl+K)">
            <span>🔍</span>
            {!isMobile && <span style={{ color: 'var(--text-dim)', fontSize: '10px', fontFamily: 'DM Mono, monospace' }}>Ctrl+K</span>}
          </button>

          {/* Graph Query — icon only on mobile */}
          {auth.connected && (
            <button className="btn btn-secondary" onClick={() => setGraphDrawerOpen(true)} title="Advanced Graph Query">
              {isMobile ? '⚡' : '⚡ Graph Query'}
            </button>
          )}

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
              <button className="btn btn-primary topbar-refresh-btn" onClick={onRefresh} disabled={isRefreshing} title="Refresh data">
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
                © {new Date().getFullYear()} <a href="https://modernendpoint.tech" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--amber)', textDecoration: 'none', fontWeight: 700 }}>modernendpoint.tech</a> · by Menahem Suissa ·{' '}
                <button style={{ background: 'none', border: 'none', color: 'var(--amber)', cursor: 'pointer', fontWeight: 700, fontSize: 'inherit', fontFamily: 'inherit', padding: 0 }} onClick={() => setCurrentView('privacy' as ExtendedViewName)}>Privacy Policy</button>
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
          ) : currentView === 'dashboard' ? (
            <div className="dashboard-shell">
              <div className="dashboard-header">
                <div>
                  <div className="dashboard-title">📊 Dashboard</div>
                  <div className="dashboard-subtitle">
                    {dashboardData ? `Last refresh: ${new Date(dashboardData.lastRefresh ?? '').toLocaleTimeString()}` : 'Loading...'}
                  </div>
                </div>
                <button className="btn btn-primary" onClick={onRefresh} disabled={isRefreshing}>
                  {isRefreshing ? '↻ Refreshing…' : '↻ Refresh'}
                </button>
              </div>

              {isViewLoading || !dashboardData ? (
                <div className="kpi-row">
                  {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 88, borderRadius: 12 }} />)}
                </div>
              ) : (
                <>
                  {/* KPI Cards */}
                  <div className="kpi-row">
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon-blue">🖥️</div>
                      <div className="kpi-value">{dashboardData.totalDevices ?? 0}</div>
                      <div className="kpi-label">Total Devices</div>
                      <div className="kpi-indicator kpi-indicator-blue">All Platforms</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon-amber">🪟</div>
                      <div className="kpi-value">{dashboardData.windowsEnrollmentDevices ?? 0}</div>
                      <div className="kpi-label">Windows Devices</div>
                      <div className="kpi-indicator kpi-indicator-amber">Enrolled</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon-green">✅</div>
                      <div className="kpi-value">
                        {(dashboardData.topEnrollmentStates ?? []).find((s: any) => s.category === 'Compliant')?.count ?? 0}
                      </div>
                      <div className="kpi-label">Compliant Devices</div>
                      <div className="kpi-indicator kpi-indicator-green">Policy OK</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon-red">⚠️</div>
                      <div className="kpi-value">
                        {(dashboardData.topEnrollmentStates ?? []).find((s: any) => s.category === 'Non-compliant')?.count ?? 0}
                      </div>
                      <div className="kpi-label">Non-Compliant</div>
                      <div className="kpi-indicator kpi-indicator-red">Action Required</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon-teal">📱</div>
                      <div className="kpi-value">{dashboardData.mobileEnrollmentDevices ?? 0}</div>
                      <div className="kpi-label">Mobile Devices</div>
                      <div className="kpi-indicator kpi-indicator-teal">iOS + Android</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-icon kpi-icon-purple">🍎</div>
                      <div className="kpi-value">{dashboardData.macEnrollmentDevices ?? 0}</div>
                      <div className="kpi-label">macOS Devices</div>
                      <div className="kpi-indicator kpi-indicator-blue">Mac Fleet</div>
                    </div>
                  </div>

                  {/* Compliance bar */}
                  <div className="dashboard-section-title">Compliance Breakdown</div>
                  <div className="compliance-bars">
                    {(dashboardData.topEnrollmentStates ?? []).map((s: any) => {
                      const total = dashboardData.totalDevices || 1;
                      const pct = Math.round((s.count / total) * 100);
                      const color = s.category === 'Compliant' ? 'var(--green)' : s.category === 'Non-compliant' ? 'var(--red)' : 'var(--amber)';
                      return (
                        <div key={s.category} className="compliance-bar-row">
                          <div className="cbr-label">{s.category}</div>
                          <div className="cbr-track">
                            <div className="cbr-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <div className="cbr-count" style={{ color }}>{s.count} <span className="cbr-pct">({pct}%)</span></div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Platform breakdown */}
                  <div className="dashboard-section-title">Platform Overview</div>
                  <div className="platform-grid">
                    {[
                      { label: 'Windows', value: dashboardData.windowsEnrollmentDevices, icon: '🪟', color: 'var(--amber)' },
                      { label: 'Linux', value: dashboardData.linuxEnrollmentDevices, icon: '🐧', color: 'var(--blue)' },
                      { label: 'Mobile (iOS/Android)', value: dashboardData.mobileEnrollmentDevices, icon: '📱', color: 'var(--teal)' },
                      { label: 'macOS', value: dashboardData.macEnrollmentDevices, icon: '🍎', color: 'var(--purple)' },
                    ].map(p => (
                      <div key={p.label} className="platform-tile">
                        <span className="pt-icon">{p.icon}</span>
                        <span className="pt-value" style={{ color: p.color }}>{p.value ?? 0}</span>
                        <span className="pt-label">{p.label}</span>
                      </div>
                    ))}
                  </div>
                </>
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
                <button className="btn btn-primary" onClick={() => generateEnrollmentPDF(reportData, addToast)}>⬇ Export PDF</button>
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

          ) : currentView === 'auditLogs' ? (
            <div className="audit-shell">
              <div className="audit-header">
                <div>
                  <div className="audit-title">📋 Audit Logs</div>
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
                  { title: '5. Audit Logs', content: 'In-app audit logs record actions you perform (device sync, reboot, reset commands) within your browser session. These logs are stored in memory only and cleared when you close or refresh the browser. You may export them as CSV at any time.' },
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
                {/* ── Filter Chips ── */}
                {isDeviceView && (
                  <div className="filter-chips-row">
                    {[
                      { id: 'non-compliant', label: '⚠️ Non-Compliant', color: 'red' },
                      { id: 'windows',       label: '🪟 Windows Only',   color: 'blue' },
                      { id: 'active-today',  label: '🟢 Active Today',   color: 'green' },
                      { id: 'errors',        label: '❌ Errors Only',    color: 'red' },
                    ].map(chip => (
                      <button
                        key={chip.id}
                        className={`filter-chip filter-chip-${chip.color} ${activeFilters.has(chip.id) ? 'active' : ''}`}
                        onClick={() => toggleFilter(chip.id)}
                      >{chip.label}</button>
                    ))}
                    {activeFilters.size > 0 && (
                      <button className="filter-chip-clear" onClick={() => setActiveFilters(new Set())}>Clear filters ✕</button>
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
                      placeholder="Search devices, users, serial numbers..."
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
                        disabled={actionLoading === 'bulk'}
                        onClick={() => openConfirm('bulk-sync')}
                      >🔄 Sync {selectedDevices.size}</button>
                      <button
                        className="bulk-btn bulk-btn-reboot"
                        disabled={actionLoading === 'bulk'}
                        onClick={() => openConfirm('bulk-reboot')}
                      >⚡ Reboot {selectedDevices.size}</button>
                      <button
                        className="bulk-btn bulk-btn-reset"
                        disabled={actionLoading === 'bulk'}
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
                              <button className="view-json-btn" title="View JSON" onClick={e => { e.stopPropagation(); setJsonModalRow(row); }}>{ '{}'}</button>
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
                                    ) : toText(row[header])}
                                  </td>
                                ))}
                                <td onClick={e => e.stopPropagation()}>
                                  <div className="row-actions">
                                    <button className="view-json-btn" title="View JSON" onClick={() => setJsonModalRow(row)}>{ '{}'}</button>
                                    {isDeviceView && devId && (<>
                                      <button className={`daction-btn daction-sync ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                        disabled={!!actionLoading} title={auth.hasWritePermissions ? 'Sync device' : '🔒 Requires Write Access'}
                                        onClick={() => openConfirm('sync', row)}>
                                        {isActing ? '⏳' : auth.hasWritePermissions ? '🔄' : '🔒'}
                                      </button>
                                      <button className={`daction-btn daction-reboot ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                        disabled={!!actionLoading} title={auth.hasWritePermissions ? 'Reboot device' : '🔒 Requires Write Access'}
                                        onClick={() => openConfirm('reboot', row)}>
                                        {isActing ? '⏳' : auth.hasWritePermissions ? '⚡' : '🔒'}
                                      </button>
                                      <button className={`daction-btn daction-reset ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`}
                                        disabled={!!actionLoading} title={auth.hasWritePermissions ? 'Autopilot Reset' : '🔒 Requires Write Access'}
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
              {confirmModal.action?.includes('reset') ? '⚠️' : confirmModal.action?.includes('reboot') ? '⚡' : '🔄'}
            </div>
            <div className="confirm-title">
              {confirmModal.action === 'sync' && 'Sync Device'}
              {confirmModal.action === 'reboot' && 'Reboot Device'}
              {confirmModal.action === 'autopilotReset' && 'Autopilot Reset'}
              {confirmModal.action === 'bulk-sync' && `Sync ${confirmModal.count} Devices`}
              {confirmModal.action === 'bulk-reboot' && `Reboot ${confirmModal.count} Devices`}
              {confirmModal.action === 'bulk-reset' && `Reset ${confirmModal.count} Devices`}
            </div>
            <div className="confirm-body">
              {confirmModal.action === 'autopilotReset' ? (
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
                className={`btn ${confirmModal.action?.includes('reset') || confirmModal.action?.includes('reboot') ? 'btn-danger' : 'btn-primary'}`}
                onClick={executeAction}
              >
                {confirmModal.action === 'sync' || confirmModal.action === 'bulk-sync' ? '🔄 Confirm Sync'
                  : confirmModal.action === 'reboot' || confirmModal.action === 'bulk-reboot' ? '⚡ Confirm Reboot'
                  : '♻️ Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Graph Query Drawer ── */}
      {graphDrawerOpen && (
        <div className="graph-drawer-overlay" onClick={() => setGraphDrawerOpen(false)}>
          <div className="graph-drawer" onClick={e => e.stopPropagation()}>
            <div className="graph-drawer-header">
              <div>
                <div className="graph-drawer-title">⚡ Advanced Graph Query</div>
                <div className="graph-drawer-sub">Run Microsoft Graph API queries directly against your tenant</div>
              </div>
              <button className="json-close-btn" onClick={() => setGraphDrawerOpen(false)}>✕</button>
            </div>

            <div className="graph-drawer-body">
              <div className="graph-query-label">GET https://graph.microsoft.com/v1.0/</div>
              <div className="graph-query-row">
                <input
                  className="graph-query-input"
                  value={graphQuery}
                  onChange={e => setGraphQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runGraphQuery()}
                  placeholder="deviceManagement/managedDevices?$top=10"
                  spellCheck={false}
                />
                <button
                  className="btn btn-primary"
                  onClick={runGraphQuery}
                  disabled={graphLoading}
                  style={{ flexShrink: 0 }}
                >
                  {graphLoading ? '...' : '▶ Run'}
                </button>
              </div>

              {/* Quick templates */}
              <div className="graph-templates">
                <div className="graph-template-label">Quick templates:</div>
                <div className="graph-template-list">
                  {[
                    { label: 'All Devices', q: 'deviceManagement/managedDevices?$top=10&$select=deviceName,operatingSystem,complianceState,userPrincipalName' },
                    { label: 'Non-Compliant', q: 'deviceManagement/managedDevices?$filter=complianceState eq \'noncompliant\'&$top=10' },
                    { label: 'Autopilot Devices', q: 'deviceManagement/windowsAutopilotDeviceIdentities?$top=10' },
                    { label: 'Enrollment Config', q: 'deviceManagement/deviceEnrollmentConfigurations' },
                    { label: 'Users', q: 'users?$top=10&$select=displayName,userPrincipalName,accountEnabled' },
                  ].map(t => (
                    <button key={t.label} className="graph-template-btn" onClick={() => {
                      setGraphQuery(t.q);
                      setGraphResult('');
                    }}>{t.label}</button>
                  ))}
                </div>
              </div>

              {/* Result */}
              {graphResult && (
                <div className="graph-result-wrap">
                  <div className="graph-result-header">
                    <span className="graph-result-label">Response</span>
                    <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => {
                      navigator.clipboard.writeText(graphResult);
                      addToast('success', 'JSON copied!');
                    }}>⧉ Copy</button>
                  </div>
                  <pre className="graph-result-pre">{graphResult}</pre>
                </div>
              )}
              {graphLoading && (
                <div className="graph-loading">
                  <div className="skeleton" style={{ height: 24 }} />
                  <div className="skeleton" style={{ height: 24 }} />
                  <div className="skeleton" style={{ height: 24 }} />
                </div>
              )}
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