import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, copyRunbook, getAuthStatus, getView, refreshData, deviceSync, deviceReboot, deviceAutopilotReset, deviceBulkAction, getExportUrl, getIncidentWorkflows, saveIncidentWorkflow } from './api/client.js';
import { recognize } from 'tesseract.js';
const SAVED_VIEW_STORAGE_KEY = 'efm-saved-views-v1';
// ── Trial banner ────────────────────────────────────────────────────────────
const TRIAL_STORAGE_KEY = 'efm-trial-start-v1';
const TRIAL_DAYS_TOTAL = 30;
const TRIAL_EXEMPT_EMAILS = ['menahem@365-poc.com', 'menahem@modernendpoint.tech'];
function getTrialDaysLeft(upn) {
    if (TRIAL_EXEMPT_EMAILS.includes(upn.toLowerCase()))
        return Infinity;
    try {
        let stored = window.localStorage.getItem(TRIAL_STORAGE_KEY);
        if (!stored) {
            stored = Date.now().toString();
            window.localStorage.setItem(TRIAL_STORAGE_KEY, stored);
        }
        const elapsed = Math.floor((Date.now() - parseInt(stored)) / 86_400_000);
        return Math.max(0, TRIAL_DAYS_TOTAL - elapsed);
    }
    catch {
        return TRIAL_DAYS_TOTAL;
    }
}
// ────────────────────────────────────────────────────────────────────────────
const DEVICE_FILTER_CHIPS = [
    { id: 'non-compliant', label: '⚠️ Non-Compliant', color: 'red' },
    { id: 'stale', label: '🕒 Stale Sync', color: 'amber' },
    { id: 'windows', label: '🪟 Windows Only', color: 'blue' },
    { id: 'unknown-user', label: '👤 Unknown User', color: 'purple' },
    { id: 'errors', label: '❌ Errors Only', color: 'red' }
];
const INCIDENT_FILTER_CHIPS = [
    { id: 'p1', label: '🔥 P1', color: 'red' },
    { id: 'critical', label: '🚨 Critical', color: 'red' },
    { id: 'investigating', label: '🧭 Investigating', color: 'blue' },
    { id: 'unassigned', label: '🪪 Unassigned', color: 'amber' },
    { id: 'no-notes', label: '📝 No Notes', color: 'purple' },
    { id: 'resolved', label: '✅ Resolved', color: 'green' }
];
const views = [
    { id: 'dashboard', label: 'Command Center', icon: '🎛️' },
    { id: 'windowsEnrollment', label: 'Windows Enrollment', icon: '🪟' },
    { id: 'linuxEnrollment', label: 'Linux Enrollment', icon: '🐧' },
    { id: 'mobileEnrollment', label: 'Mobile Enrollment', icon: '📱' },
    { id: 'macEnrollment', label: 'macOS Enrollment', icon: '🍎' },
    { id: 'ocr', label: 'OCR', icon: '🧠' },
    { id: 'incidents', label: 'Fix Queue', icon: '🚨' },
    { id: 'permissionCheck', label: 'Access Validation', icon: '🔑' },
    { id: 'enrollmentErrorCatalog', label: 'Failure Catalog', icon: '📚' },
    { id: 'reports', label: 'Executive Reports', icon: '📈' },
    { id: 'readinessChecklist', label: 'Readiness Risks', icon: '✅' },
    { id: 'auditLogs', label: 'Audit Trail', icon: '📋' }
];
function toText(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'object')
        return JSON.stringify(value, null, 2);
    return String(value);
}
function isLikelyIsoDate(value) {
    if (typeof value !== 'string')
        return false;
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.trim());
}
function formatDateTimeDisplay(value) {
    const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    if (!raw || !isLikelyIsoDate(raw))
        return toText(value);
    const date = new Date(raw);
    if (Number.isNaN(date.getTime()))
        return raw;
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    }).format(date);
}
function formatTimeDisplay(value) {
    const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    if (!raw || !isLikelyIsoDate(raw))
        return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime()))
        return '';
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
    }).format(date);
}
function formatRelativeTime(value) {
    const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    if (!raw || !isLikelyIsoDate(raw))
        return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime()))
        return '';
    const diffMs = date.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const minutes = Math.round(absMs / 60000);
    if (minutes < 1)
        return 'just now';
    if (minutes < 60)
        return `${diffMs < 0 ? '' : 'in '}${minutes} min${minutes === 1 ? '' : 's'}${diffMs < 0 ? ' ago' : ''}`;
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return `${diffMs < 0 ? '' : 'in '}${hours} hr${hours === 1 ? '' : 's'}${diffMs < 0 ? ' ago' : ''}`;
    const days = Math.round(hours / 24);
    return `${diffMs < 0 ? '' : 'in '}${days} day${days === 1 ? '' : 's'}${diffMs < 0 ? ' ago' : ''}`;
}
function isDateLikeHeader(header) {
    return /date|time|sync|checkin|enroll/i.test(header);
}
function getPriorityTone(priority) {
    const normalized = String(priority ?? 'P3').toUpperCase();
    if (normalized === 'P1')
        return 'critical';
    if (normalized === 'P2')
        return 'warning';
    return 'neutral';
}
function getStatusTone(status) {
    const normalized = String(status ?? 'New').toLowerCase();
    if (normalized === 'new')
        return 'critical';
    if (normalized === 'investigating')
        return 'warning';
    if (normalized === 'mitigating')
        return 'info';
    if (normalized === 'resolved')
        return 'success';
    return 'neutral';
}
function getIncidentSortScore(row) {
    const priority = String(row['priority'] ?? 'P3').toUpperCase();
    const status = String(row['status'] ?? 'New');
    const severity = String(row['severity'] ?? 'Low');
    const impactedCount = Number(row['impactedCount'] ?? 0);
    const priorityRank = priority === 'P1' ? 0 : priority === 'P2' ? 1 : 2;
    const severityRank = severity === 'Critical' ? 0 : severity === 'High' ? 1 : severity === 'Medium' ? 2 : 3;
    const statusRank = status === 'New' ? 0 : status === 'Investigating' ? 1 : status === 'Mitigating' ? 2 : 3;
    return priorityRank * 100000 + severityRank * 10000 + statusRank * 1000 - impactedCount;
}
function renderTableValue(header, value) {
    if (isDateLikeHeader(header) && isLikelyIsoDate(value)) {
        const relative = formatRelativeTime(value);
        const timeText = formatTimeDisplay(value);
        return (_jsxs("div", { className: "datetime-cell", children: [_jsx("div", { className: "datetime-main", children: formatDateTimeDisplay(value) }), _jsxs("div", { className: "datetime-sub-row", children: [timeText && _jsx("div", { className: "datetime-sub", children: timeText }), relative && _jsx("div", { className: "datetime-relative-pill", children: relative })] })] }));
    }
    return toText(value);
}
export default function App() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const sidebarRef = useRef(null);
    const [currentView, setCurrentView] = useState('dashboard');
    const [rows, setRows] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(null);
    const [statusMessage, setStatusMessage] = useState('Ready');
    const [detailsSummary, setDetailsSummary] = useState('Select a row to view details.');
    const [detailsText, setDetailsText] = useState('');
    const [auth, setAuth] = useState({ connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false });
    const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const isTrialExpired = auth.connected && !isSubscribed && getTrialDaysLeft(auth.upn) === 0;
    const [ocrImageFile, setOcrImageFile] = useState(null);
    const [ocrInputText, setOcrInputText] = useState('');
    const [ocrStatusText, setOcrStatusText] = useState('OCR: Not started');
    const [ocrAssistantAnswer, setOcrAssistantAnswer] = useState('');
    const [ocrBusy, setOcrBusy] = useState(false);
    const [themePreference, setThemePreference] = useState(() => {
        const stored = window.localStorage.getItem('efm-theme');
        if (stored === 'light' || stored === 'dark' || stored === 'system')
            return stored;
        return 'system';
    });
    const [effectiveTheme, setEffectiveTheme] = useState('light');
    const [toasts, setToasts] = useState([]);
    const [isViewLoading, setIsViewLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const fileInputRef = useRef(null);
    // ✅ FIX: badge counts state for sidebar
    const [badgeCounts, setBadgeCounts] = useState({});
    const [incidentWorkflows, setIncidentWorkflows] = useState({});
    const [incidentOwnerDraft, setIncidentOwnerDraft] = useState('');
    const [incidentStatusDraft, setIncidentStatusDraft] = useState('New');
    const [incidentNotesDraft, setIncidentNotesDraft] = useState('');
    const [incidentWorkflowSaving, setIncidentWorkflowSaving] = useState(false);
    function addToast(kind, message) {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setToasts((previous) => [...previous, { id, kind, message }]);
    }
    function statusKind(message) {
        const normalized = message.toLowerCase();
        if (normalized.includes('fail') || normalized.includes('error'))
            return 'error';
        if (normalized.includes('not') || normalized.includes('no ') || normalized.includes('empty'))
            return 'warn';
        return 'ok';
    }
    function openDashboardView(view) {
        setCurrentView(view);
        setSelectedIndex(null);
        setSidebarOpen(false);
        if (view === 'incidents')
            setDetailsSummary('Fix Queue');
        if (view === 'windowsEnrollment')
            setDetailsSummary('Windows Enrollment');
        if (view === 'readinessChecklist')
            setDetailsSummary('Readiness Checklist');
        if (view === 'reports')
            setDetailsSummary('Executive Reports');
    }
    const incidentWorkflowStatuses = ['New', 'Investigating', 'Mitigating', 'Resolved'];
    const selectedIncident = currentView === 'incidents' && selectedIndex !== null ? rows[selectedIndex] ?? null : null;
    const selectedIncidentSignature = String(selectedIncident?.['signature'] ?? '');
    function syncIncidentWorkflowDraft(row) {
        const signature = String(row?.['signature'] ?? '');
        const persisted = signature ? incidentWorkflows[signature] : undefined;
        setIncidentOwnerDraft(String(persisted?.owner ?? row?.['owner'] ?? 'Unassigned'));
        setIncidentStatusDraft((persisted?.status ?? row?.['status'] ?? 'New'));
        setIncidentNotesDraft(String(persisted?.notes ?? row?.['notes'] ?? ''));
    }
    const headers = useMemo(() => {
        const first = rows[0];
        if (!first)
            return [];
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
                }
                catch {
                    setIsSubscribed(false);
                }
            }
            return result;
        }
        catch {
            const fallback = { connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false };
            setAuth(fallback);
            return fallback;
        }
    }
    function setConnectedPanel(summary, extra) {
        const identity = auth.displayName || auth.upn || 'Connected user';
        setDetailsSummary(summary);
        setDetailsText(extra ?? `Signed in as ${identity}. Tenant data is available.`);
    }
    async function loadView(view) {
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
                }
                catch {
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
                const count = view === 'incidents'
                    ? safeRows.filter((r) => !r.isPlaceholder).length
                    : safeRows.length;
                next[view] = count;
                if (view === 'dashboard' && safeRows[0]) {
                    const row = safeRows[0];
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
                setDetailsText(auth.connected
                    ? 'The endpoint returned an empty dataset. This is handled safely.'
                    : 'You can browse the interface before signing in. Use Sign in to continue.');
            }
            else {
                const first = safeRows[0];
                setDetailsSummary(toText(first['name'] ?? first['deviceName'] ?? first['displayName'] ?? first['summary'] ?? `${view} row selected`));
                setDetailsText(toText(first['details'] ?? first));
            }
        }
        catch (error) {
            setRows([]);
            setSelectedIndex(null);
            const message = error instanceof Error ? error.message : 'Failed to load view.';
            setStatusMessage(message);
            if (auth.connected) {
                setDetailsSummary('Load failed');
                setDetailsText(message);
            }
            else {
                setDetailsSummary('Guest preview');
                setDetailsText('You can browse the interface before signing in. Use Sign in to continue.');
            }
            addToast('error', 'View load failed.');
        }
        finally {
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
            setStatusMessage('Failure Catalog: Browse known errors and fixes.');
            setDetailsSummary('Failure Catalog');
            setDetailsText('Select an error card to see details and remediation steps.');
            return;
        }
        if (currentView === 'reports') {
            setRows([]);
            setSelectedIndex(null);
            setConnectedPanel('Reports', 'Signed in. Loading enrollment analytics...');
            setStatusMessage('Executive Reports: Loading enrollment analytics...');
            getView('reports').then(result => {
                const data = result.rows?.[0];
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
            getView('readinessChecklist').then(result => {
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
                const data = result.rows?.[0];
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
            if (themePreference === 'system')
                apply();
        };
        media.addEventListener('change', onMediaChange);
        return () => media.removeEventListener('change', onMediaChange);
    }, [themePreference]);
    useEffect(() => {
        if (toasts.length === 0)
            return;
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
                const data = result.rows?.[0];
                setDashboardData(data ?? null);
                setStatusMessage(result.message || 'Dashboard loaded.');
                setConnectedPanel('Dashboard overview', 'Signed in. Dashboard metrics loaded successfully.');
            }
            else if (currentView === 'reports') {
                const result = await getView('reports');
                setReportData(result.rows?.[0] ?? null);
                setStatusMessage(result.message || 'Reports loaded.');
                setConnectedPanel('Reports', 'Signed in. Reports data loaded successfully.');
            }
            else if (currentView === 'readinessChecklist') {
                const result = await getView('readinessChecklist');
                setChecklistItems(result.rows ?? []);
                setStatusMessage(result.message || 'Readiness checklist loaded.');
                setConnectedPanel('Readiness Risks', 'Signed in. Checklist data loaded successfully.');
            }
            else {
                await loadView(currentView);
            }
            addToast('success', 'Data refreshed.');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Refresh failed';
            setStatusMessage(message);
            setDetailsSummary('Refresh failed');
            setDetailsText(message);
            addToast('error', 'Refresh failed.');
        }
        finally {
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
    const [auditLogs, setAuditLogs] = useState([]);
    function addAuditLog(action, details, result = 'info') {
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
        if (isMobile)
            setSidebarOpen(false);
    }
    function onExport(format) {
        window.open(getExportUrl(currentView, format), '_blank');
    }
    // ── Device action helpers ─────────────────────────────────
    function getDeviceId(row) { return String(row['id'] ?? row['deviceId'] ?? ''); }
    function getDeviceName(row) {
        return toText(row['deviceName'] ?? row['displayName'] ?? row['name'] ?? 'Unknown Device');
    }
    function openConfirm(action, row) {
        // Gate on write permissions
        if (!auth.hasWritePermissions) {
            setUpgradeAction(action ?? 'this action');
            setUpgradeModalOpen(true);
            return;
        }
        if (row) {
            setConfirmModal({ open: true, action, deviceId: getDeviceId(row), deviceName: getDeviceName(row) });
        }
        else {
            setConfirmModal({ open: true, action, count: selectedDevices.size });
        }
    }
    function toggleFilter(filter) {
        setActiveFilters(prev => {
            const next = new Set(prev);
            if (next.has(filter))
                next.delete(filter);
            else
                next.add(filter);
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
        if (!name)
            return;
        const nextView = {
            id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name,
            view: currentView,
            search: globalSearch || inlineSearch,
            filters: Array.from(activeFilters)
        };
        setSavedViews(prev => [nextView, ...prev.filter(item => !(item.view === nextView.view && item.name === nextView.name))].slice(0, 12));
        addToast('success', `Saved view: ${name}`);
    }
    function applySavedView(view) {
        setCurrentView(view.view);
        setInlineSearch(view.search);
        setGlobalSearch('');
        setActiveFilters(new Set(view.filters));
        addToast('info', `Loaded view: ${view.name}`);
    }
    function removeSavedView(viewId) {
        setSavedViews(prev => prev.filter(item => item.id !== viewId));
        addToast('success', 'Saved view removed.');
    }
    async function executeAction() {
        const { action, deviceId, count } = confirmModal;
        setConfirmModal(m => ({ ...m, open: false }));
        if (!action)
            return;
        const isBulk = action.startsWith('bulk-');
        if (isBulk) {
            setActionLoading('bulk');
            const ids = Array.from(selectedDevices);
            const bulkMap = {
                'bulk-sync': 'sync', 'bulk-reboot': 'reboot', 'bulk-reset': 'autopilotReset'
            };
            try {
                const res = await deviceBulkAction(ids, bulkMap[action]);
                const ok = res.results.filter(r => r.ok).length;
                addToast('success', `Bulk action: ${ok}/${ids.length} devices succeeded`);
                addAuditLog(`Bulk ${bulkMap[action]}`, `${ok}/${ids.length} devices affected`, ok === ids.length ? 'success' : 'fail');
                setSelectedDevices(new Set());
            }
            catch (e) {
                addToast('error', `Bulk action failed: ${e?.message ?? 'Unknown error'}`);
                addAuditLog(`Bulk ${action}`, `Failed: ${e?.message ?? 'Unknown'}`, 'fail');
            }
            finally {
                setActionLoading(null);
            }
            return;
        }
        if (!deviceId)
            return;
        setActionLoading(deviceId);
        try {
            if (action === 'sync')
                await deviceSync(deviceId);
            else if (action === 'reboot')
                await deviceReboot(deviceId);
            else if (action === 'autopilotReset')
                await deviceAutopilotReset(deviceId);
            const label = action === 'sync' ? 'Sync' : action === 'reboot' ? 'Reboot' : 'Autopilot Reset';
            addToast('success', `${label} command sent successfully`);
            addAuditLog(label, `Device: ${confirmModal.deviceName} (${deviceId})`, 'success');
        }
        catch (e) {
            addToast('error', `Action failed: ${e?.message ?? 'Unknown error'}`);
            addAuditLog(action, `Failed on ${confirmModal.deviceName}: ${e?.message ?? 'Unknown'}`, 'fail');
        }
        finally {
            setActionLoading(null);
        }
    }
    function toggleDeviceSelect(deviceId) {
        setSelectedDevices(prev => {
            const next = new Set(prev);
            if (next.has(deviceId))
                next.delete(deviceId);
            else
                next.add(deviceId);
            return next;
        });
    }
    function toggleSelectAll() {
        if (selectedDevices.size === filteredRows.length) {
            setSelectedDevices(new Set());
        }
        else {
            setSelectedDevices(new Set(filteredRows.map(r => getDeviceId(r)).filter(Boolean)));
        }
    }
    // Device views that support remediation actions
    const DEVICE_VIEWS = ['windowsEnrollment', 'linuxEnrollment', 'mobileEnrollment', 'macEnrollment'];
    const isDeviceView = DEVICE_VIEWS.includes(currentView);
    async function onSaveIncidentWorkflow() {
        if (!selectedIncidentSignature)
            return;
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
        }
        catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Failed to save incident workflow.');
        }
        finally {
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
        }
        catch (error) {
            setOcrStatusText('OCR: Failed (manual text needed)');
            setStatusMessage(error instanceof Error ? error.message : 'OCR failed. Paste text manually.');
        }
        finally {
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
            const payload = response.data;
            const category = typeof payload.category === 'string' && payload.category.trim().length > 0 ? payload.category : 'Unknown';
            const confidence = Number.isFinite(payload.confidence) ? payload.confidence : 0;
            const cause = typeof payload.cause === 'string' && payload.cause.trim().length > 0
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to generate OCR explanation.';
            const fallback = ['Explanation failed.', `Reason: ${message}`, 'Try pasting only the exact error sentence and run again.'].join('\n');
            setOcrAssistantAnswer(fallback);
            setDetailsSummary('OCR Explanation Failed');
            setDetailsText(fallback);
            setStatusMessage(message);
            addToast('error', 'OCR explanation failed.');
        }
        finally {
            setOcrBusy(false);
        }
    }
    function onCycleTheme() {
        setThemePreference((current) => {
            if (current === 'system')
                return 'light';
            if (current === 'light')
                return 'dark';
            return 'system';
        });
    }
    // ── Failure Catalog data (30 known errors) ──────────────────────
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
    const [errorFilter, setErrorFilter] = useState('all');
    const [expandedError, setExpandedError] = useState(null);
    // Reports state
    const [reportData, setReportData] = useState(null);
    // Readiness Risks state
    const [checklistScenario, setChecklistScenario] = useState('autopilot');
    const [checklistItems, setChecklistItems] = useState([]);
    // Tutorial modal state
    const [tutorialOpen, setTutorialOpen] = useState(false);
    // Dashboard KPI state
    const [dashboardData, setDashboardData] = useState(null);
    // ── Device Remediation state ─────────────────────────────
    const [selectedDevices, setSelectedDevices] = useState(new Set());
    const [confirmModal, setConfirmModal] = useState({ open: false, action: null });
    const [actionLoading, setActionLoading] = useState(null);
    const [inlineSearch, setInlineSearch] = useState('');
    const inlineSearchRef = useRef(null);
    // ── Upgrade Access / Permission Modal ────────────────────
    const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
    const [upgradeAction, setUpgradeAction] = useState('');
    // ── Filter Chips ─────────────────────────────────────────
    const [activeFilters, setActiveFilters] = useState(new Set());
    const [savedViews, setSavedViews] = useState(() => {
        try {
            const raw = window.localStorage.getItem(SAVED_VIEW_STORAGE_KEY);
            if (!raw)
                return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    });
    useEffect(() => {
        try {
            window.localStorage.setItem(SAVED_VIEW_STORAGE_KEY, JSON.stringify(savedViews));
        }
        catch {
            // ignore storage errors
        }
    }, [savedViews]);
    // ── Global Search (Ctrl+K) ───────────────────────────────
    const [globalSearch, setGlobalSearch] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const globalSearchRef = useRef(null);
    // ── JSON Viewer Modal ────────────────────────────────────
    const [jsonModalRow, setJsonModalRow] = useState(null);
    // Ctrl+K shortcut
    useEffect(() => {
        const handler = (e) => {
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
            e.platforms.includes(errorFilter);
        return matchesSearch && matchesFilter;
    });
    // Global search + smart filters combined
    const filteredRows = useMemo(() => {
        let result = rows;
        const q = (globalSearch || inlineSearch).toLowerCase().trim();
        if (q) {
            result = result.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q)));
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
                result = result.filter(r => String(r['enrollmentState'] ?? r['status'] ?? '').toLowerCase().includes('fail') ||
                    String(r['complianceState'] ?? '').toLowerCase().includes('error') ||
                    String(r['complianceState'] ?? '').toLowerCase().includes('unknown'));
            }
        }
        return result;
    }, [rows, globalSearch, inlineSearch, activeFilters, currentView, isDeviceView]);
    const visibleFilterChips = currentView === 'incidents' ? INCIDENT_FILTER_CHIPS : isDeviceView ? DEVICE_FILTER_CHIPS : [];
    const sortedIncidentRows = useMemo(() => {
        if (currentView !== 'incidents')
            return filteredRows;
        return [...filteredRows].sort((left, right) => {
            const scoreDifference = getIncidentSortScore(left) - getIncidentSortScore(right);
            if (scoreDifference !== 0)
                return scoreDifference;
            return Number(right['impactedCount'] ?? 0) - Number(left['impactedCount'] ?? 0);
        });
    }, [currentView, filteredRows]);
    const scopedSavedViews = savedViews.filter(view => view.view === currentView);
    // Detect mobile — reactive to window resize
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const handler = (e) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    // ── PDF Export ───────────────────────────────────────────
    async function generateEnrollmentPDF(data, toast) {
        if (!data)
            return;
        toast('info', 'Generating PDF report...');
        try {
            // Load jsPDF dynamically from CDN
            await new Promise((resolve, reject) => {
                if (window.jspdf) {
                    resolve();
                    return;
                }
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                s.onload = () => resolve();
                s.onerror = reject;
                document.head.appendChild(s);
            });
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const W = 210, H = 297;
            const navy = [13, 27, 42], navyMid = [22, 32, 50], navyLight = [30, 45, 66];
            const amber = [245, 158, 11], teal = [14, 165, 233], green = [16, 185, 129];
            const red = [239, 68, 68], purple = [99, 102, 241];
            const txt = [232, 237, 245], muted = [122, 144, 171];
            // Load both logo versions as base64
            const loadImg = async (path) => {
                try {
                    const resp = await fetch(path);
                    if (!resp.ok)
                        return '';
                    const buf = await resp.arrayBuffer();
                    let bin = '';
                    new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
                    return btoa(bin);
                }
                catch (_) {
                    return '';
                }
            };
            const logoAmberB64 = await loadImg('/logo.png'); // amber, full opacity
            const logoWatermarkB64 = await loadImg('/logo_watermark.png'); // amber, 15% opacity
            const drawPageShell = (pg, total) => {
                // Background
                doc.setFillColor(...navy);
                doc.rect(0, 0, W, H, 'F');
                // Watermark — amber logo pre-baked at low opacity, centered
                if (logoWatermarkB64) {
                    try {
                        doc.addImage(`data:image/png;base64,${logoWatermarkB64}`, 'PNG', W / 2 - 45, H / 2 - 45, 90, 90, 'wm', 'NONE');
                    }
                    catch (_) { }
                }
                // Header bar
                doc.setFillColor(...navyMid);
                doc.rect(0, 0, W, 20, 'F');
                doc.setFillColor(...amber);
                doc.rect(0, 20, W, 0.7, 'F');
                // Logo in header (amber, clear)
                if (logoAmberB64) {
                    try {
                        doc.addImage(`data:image/png;base64,${logoAmberB64}`, 'PNG', 6, 2, 16, 16, 'hdr', 'NONE');
                    }
                    catch (_) { }
                }
                doc.setTextColor(...amber);
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.text('MODERN ENDPOINT', 25, 8);
                doc.setTextColor(...muted);
                doc.setFontSize(5.5);
                doc.setFont('helvetica', 'normal');
                doc.text('Enterprise Architecture Journal', 25, 13);
                doc.setTextColor(...amber);
                doc.setFontSize(11);
                doc.setFont('helvetica', 'bold');
                doc.text('Enrollment Flow Monitor — Report', W - 8, 9, { align: 'right' });
                doc.setTextColor(...muted);
                doc.setFontSize(5.5);
                doc.setFont('helvetica', 'normal');
                doc.text(`Generated: ${new Date().toLocaleString()}`, W - 8, 15, { align: 'right' });
                // Footer
                doc.setFillColor(...navyMid);
                doc.rect(0, H - 10, W, 10, 'F');
                doc.setFillColor(...amber);
                doc.rect(0, H - 10, W, 0.4, 'F');
                doc.setTextColor(...muted);
                doc.setFontSize(5.5);
                doc.text('enrollment.modernendpoint.tech  ·  Enrollment Flow Monitor', 8, H - 3.5);
                doc.text(`© ${new Date().getFullYear()} modernendpoint.tech — Confidential`, W / 2, H - 3.5, { align: 'center' });
                doc.text(`Page ${pg} of ${total}`, W - 8, H - 3.5, { align: 'right' });
            };
            let y = 0;
            const section = (title) => {
                doc.setFillColor(...navyLight);
                doc.rect(8, y, W - 16, 7, 'F');
                doc.setFillColor(...amber);
                doc.rect(8, y, 1.2, 7, 'F');
                doc.setTextColor(...txt);
                doc.setFontSize(6.5);
                doc.setFont('helvetica', 'bold');
                doc.text(title.toUpperCase(), 13, y + 4.8);
                y += 11;
            };
            // ── PAGE 1 ──────────────────────────────────────────
            drawPageShell(1, 2);
            y = 25;
            // KPI row
            const kw = (W - 16 - 9) / 4, kh = 22;
            const kpis = [
                ['Total Devices', String(data.totalDevices ?? 0), teal],
                ['Compliance Rate', `${data.overallComplianceRate ?? 0}%`, green],
                ['Active Incidents', String(data.activeIncidents ?? 0), (data.activeIncidents ?? 0) > 0 ? red : green],
                ['Platforms', String((data.platformBreakdown ?? []).length), purple],
            ];
            kpis.forEach(([label, val, col], i) => {
                const x = 8 + i * (kw + 3);
                doc.setFillColor(...navyLight);
                doc.roundedRect(x, y, kw, kh, 2, 2, 'F');
                doc.setFillColor(...col);
                doc.roundedRect(x, y, kw, 2, 1, 1, 'F');
                doc.setTextColor(...col);
                doc.setFontSize(16);
                doc.setFont('helvetica', 'bold');
                doc.text(val, x + kw / 2, y + kh / 2 + 2, { align: 'center' });
                doc.setTextColor(...muted);
                doc.setFontSize(5.5);
                doc.setFont('helvetica', 'normal');
                doc.text(label, x + kw / 2, y + kh - 2.5, { align: 'center' });
            });
            y += kh + 8;
            // Platform breakdown
            section('Platform Breakdown');
            (data.platformBreakdown ?? []).forEach((p) => {
                const tot = p.count || 1, pct = p.compliant / tot;
                const bx = 50, bw = W - 50 - 36, bh = 5;
                doc.setTextColor(...txt);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.text(p.platform, 10, y + 3.8);
                doc.setFillColor(...navyLight);
                doc.roundedRect(bx, y, bw, bh, 2, 2, 'F');
                doc.setFillColor(...green);
                doc.roundedRect(bx, y, bw * pct, bh, 2, 2, 'F');
                if (p.nonCompliant > 0) {
                    doc.setFillColor(...red);
                    doc.roundedRect(bx + bw * pct, y, bw * (p.nonCompliant / tot), bh, 2, 2, 'F');
                }
                doc.setTextColor(...muted);
                doc.setFontSize(6);
                doc.text(`${p.compliant} ✓  ${p.nonCompliant} ✗  / ${p.count}`, W - 8, y + 4, { align: 'right' });
                y += 10;
            });
            y += 4;
            // Health scores
            const hs = data.healthScores ?? [];
            if (hs.length > 0) {
                section('Platform Health Scores');
                const cw = (W - 16 - (hs.length - 1) * 3) / hs.length, ch = 28;
                hs.forEach((h, i) => {
                    const cx = 8 + i * (cw + 3);
                    doc.setFillColor(...navyLight);
                    doc.roundedRect(cx, y, cw, ch, 2, 2, 'F');
                    const sc = h.score >= 75 ? green : h.score >= 50 ? amber : red;
                    doc.setTextColor(...sc);
                    doc.setFontSize(14);
                    doc.setFont('helvetica', 'bold');
                    doc.text(String(h.score), cx + cw / 2, y + 14, { align: 'center' });
                    doc.setFontSize(5);
                    doc.setFont('helvetica', 'normal');
                    doc.text('/100', cx + cw / 2, y + 19, { align: 'center' });
                    doc.setTextColor(...txt);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'bold');
                    doc.text(h.platform, cx + cw / 2, y + 25, { align: 'center' });
                });
                y += ch + 8;
            }
            // ── PAGE 2 ──────────────────────────────────────────
            doc.addPage();
            drawPageShell(2, 2);
            y = 25;
            // Top errors table
            const errs = data.topErrors ?? [];
            if (errs.length > 0) {
                section('Top Enrollment Errors');
                const sevC = { High: red, Medium: amber, Low: teal };
                errs.slice(0, 12).forEach((e, i) => {
                    const rh = 8, ry = y;
                    doc.setFillColor(...(i % 2 === 0 ? navyLight : navyMid));
                    doc.rect(8, ry, W - 16, rh, 'F');
                    doc.setTextColor(...muted);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`#${i + 1}`, 11, ry + 5.5);
                    const sc = sevC[e.severity] ?? teal;
                    doc.setFillColor(...sc);
                    doc.roundedRect(18, ry + 1.5, 13, 5, 1, 1, 'F');
                    doc.setTextColor(255, 255, 255);
                    doc.setFontSize(4.5);
                    doc.setFont('helvetica', 'bold');
                    doc.text((e.severity || 'LOW').toUpperCase(), 24.5, ry + 5.2, { align: 'center' });
                    doc.setTextColor(...teal);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'bold');
                    doc.text(String(e.errorCode), 34, ry + 5.5);
                    doc.setTextColor(...txt);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'normal');
                    doc.text(String(e.title || '').substring(0, 68), 70, ry + 5.5);
                    doc.setTextColor(...amber);
                    doc.setFontSize(6);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`${e.count} devices`, W - 10, ry + 5.5, { align: 'right' });
                    y += rh + 1;
                });
                y += 6;
            }
            // Executive summary
            section('Executive Summary');
            doc.setFillColor(...navyLight);
            doc.roundedRect(8, y, W - 16, 38, 2, 2, 'F');
            doc.setFillColor(...amber);
            doc.rect(8, y, 1.2, 38, 'F');
            const lines = [
                `Total managed devices: ${data.totalDevices ?? 'N/A'}`,
                `Overall compliance rate: ${data.overallComplianceRate ?? 'N/A'}%`,
                `Active incidents: ${data.activeIncidents ?? 0}`,
                `Platforms monitored: ${(data.platformBreakdown ?? []).map((p) => p.platform).join(', ')}`,
                `Report generated: ${new Date().toLocaleString()}`,
                `Source: Enrollment Flow Monitor · enrollment.modernendpoint.tech`,
            ];
            lines.forEach((line, i) => {
                doc.setTextColor(...(i === lines.length - 1 ? muted : txt));
                doc.setFontSize(7);
                doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
                doc.text(line, 14, y + 7 + i * 5.5);
            });
            doc.save(`enrollment-report-${new Date().toISOString().slice(0, 10)}.pdf`);
            toast('success', 'PDF exported successfully!');
        }
        catch (err) {
            console.error('PDF generation error:', err);
            toast('error', 'PDF generation failed — check console');
        }
    }
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("div", { className: "surface topbar", children: [_jsxs("div", { className: "topbar-left", children: [isMobile && (_jsx("button", { className: "btn-hamburger", onClick: () => setSidebarOpen(true), children: "\u2630" })), _jsxs("div", { className: "logo-pill", children: [_jsx("div", { className: "logo-mark-sq", children: "EF" }), _jsxs("div", { className: "logo-text", children: [_jsx("span", { className: "logo-title", children: "Modern Endpoint" }), _jsx("span", { className: "logo-sub", children: "Enterprise Architecture Journal" })] })] }), _jsxs("div", { className: "topbar-titles", children: [_jsx("span", { className: "topbar-title", children: "Enrollment Flow Monitor" }), !isMobile && (_jsx("span", { className: "topbar-subtitle", children: auth.connected ? `● Signed in: ${auth.upn}` : '● Public preview mode' }))] })] }), _jsxs("div", { className: "topbar-actions", children: [_jsx("button", { className: "btn btn-secondary", style: { fontSize: 11, marginBottom: 16, alignSelf: 'flex-start' }, onClick: () => setCurrentView(auth.connected ? 'dashboard' : 'home'), children: "\u2190 Back" }), _jsx("span", { children: "\uD83D\uDD0D" }), !isMobile && _jsx("span", { style: { color: 'var(--text-dim)', fontSize: '10px', fontFamily: 'DM Mono, monospace' }, children: "Ctrl+K" }), !isMobile && (_jsx("button", { className: "btn btn-secondary", onClick: onCycleTheme, children: themePreference === 'system' ? `Theme: ${effectiveTheme}` : `Theme: ${themePreference}` })), auth.connected && !isMobile && (auth.hasWritePermissions ? (_jsxs("span", { className: "status-connected-pill perm-write", children: [_jsx("span", { className: "status-dot-pulse" }), "Write Access"] })) : (_jsx("button", { className: "perm-readonly-pill", onClick: () => setUpgradeModalOpen(true), title: "Upgrade to Write Access", children: "\uD83D\uDD12 Read Only" }))), !auth.connected ? (_jsx("button", { className: "btn btn-primary", onClick: () => { window.location.href = '/api/auth/login'; }, children: isMobile ? 'Sign in' : '🔑 Sign in' })) : (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-primary topbar-refresh-btn", onClick: onRefresh, disabled: isRefreshing || isTrialExpired, title: isTrialExpired ? '🔒 Trial expired — upgrade to refresh' : 'Refresh data', children: isRefreshing ? '↻' : '↻ Refresh' }), _jsxs("div", { className: "user-menu", style: { position: 'relative' }, children: [_jsxs("div", { className: "user-chip-btn", onClick: () => setIsUserMenuOpen((current) => !current), children: [_jsx("div", { className: "user-chip-avatar", children: (auth.displayName || auth.upn || 'U')[0].toUpperCase() }), !isMobile && _jsx("span", { className: "user-chip-name", children: auth.displayName || auth.upn?.split('@')[0] || 'Account' })] }), isUserMenuOpen && (_jsxs("div", { className: "user-menu-pop", children: [_jsx("div", { className: "menu-user", children: auth.upn || 'Connected user' }), isMobile && (_jsxs("button", { className: "btn btn-secondary text-left", onClick: onCycleTheme, style: { width: '100%' }, children: ["Theme: ", themePreference] })), _jsx("button", { className: "btn btn-danger", onClick: onDisconnect, children: "Disconnect" })] }))] })] }))] })] }), auth.connected && (() => {
                const daysLeft = getTrialDaysLeft(auth.upn);
                if (daysLeft === Infinity)
                    return null; // exempt user — no banner
                if (isSubscribed)
                    return null; // paid subscriber — no banner
                if (trialBannerDismissed && daysLeft > 0)
                    return null; // dismissed (not expired)
                const isUrgent = daysLeft > 0 && daysLeft <= 7;
                const isExpired = daysLeft === 0;
                const progress = Math.round(((TRIAL_DAYS_TOTAL - daysLeft) / TRIAL_DAYS_TOTAL) * 100);
                const color = isExpired ? '#ef4444' : isUrgent ? '#f59e0b' : '#22c55e';
                return (_jsxs("div", { style: {
                        display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', minHeight: 36,
                        background: isExpired ? '#1a0a0a' : isUrgent ? '#1a1600' : '#141a1f',
                        borderBottom: `1px solid ${color}33`,
                        flexWrap: 'wrap', fontFamily: "'DM Mono', monospace", fontSize: 12,
                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 4,
                                border: `1px solid ${color}44`, background: `${color}14`, flexShrink: 0 }, children: [_jsx("div", { style: { width: 5, height: 5, borderRadius: '50%', background: color,
                                        animation: isUrgent ? 'efm-blink 1s ease-in-out infinite' : 'none' } }), _jsx("span", { style: { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', color, textTransform: 'uppercase' }, children: isExpired ? 'Trial Ended' : isUrgent ? 'Expiring Soon' : 'Trial Active' })] }), _jsx("span", { style: { color: '#94a3b8', whiteSpace: 'nowrap' }, children: isExpired
                                ? _jsxs(_Fragment, { children: [_jsx("b", { style: { color: '#e2e8f0', fontWeight: 500 }, children: auth.upn }), " \u2014 trial ended, upgrade to restore access"] })
                                : _jsxs(_Fragment, { children: ["Signed in: ", auth.upn, " \u00A0\u00B7\u00A0 ", _jsxs("b", { style: { color, fontWeight: 500 }, children: [daysLeft, " ", daysLeft === 1 ? 'day' : 'days', " remaining"] })] }) }), !isUrgent && !isExpired && ['All features', 'Export CSV/JSON', 'Full support'].map(f => (_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#475569' }, children: [_jsx("span", { style: { width: 4, height: 4, borderRadius: '50%', background: '#22c55e', display: 'inline-block' } }), f] }, f))), _jsx("div", { style: { flex: 1 } }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }, children: [_jsx("div", { style: { width: 88, height: 2, background: '#2a2f3d', borderRadius: 99, overflow: 'hidden' }, children: _jsx("div", { style: { width: `${progress}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .4s' } }) }), _jsxs("span", { style: { fontSize: 11, color: '#475569' }, children: [TRIAL_DAYS_TOTAL - Math.min(daysLeft, TRIAL_DAYS_TOTAL), "/", TRIAL_DAYS_TOTAL, " days"] })] }), _jsxs("button", { onClick: () => window.open('https://moderne.gumroad.com/l/cynmjz', '_blank'), style: {
                                padding: '4px 14px', borderRadius: 5, fontSize: 11, fontFamily: 'inherit', fontWeight: 500,
                                cursor: 'pointer', border: `1px solid ${color}55`, background: `${color}14`, color, flexShrink: 0,
                            }, children: ["\u2191 ", isExpired ? 'Restore Access' : isUrgent ? 'Upgrade Now' : 'Upgrade to Pro'] }), !isExpired && (_jsx("button", { onClick: () => setTrialBannerDismissed(true), style: {
                                background: 'none', border: 'none', cursor: 'pointer', color: '#334155', fontSize: 14, padding: 4,
                            }, children: "\u2715" })), _jsx("style", { children: `@keyframes efm-blink { 0%,100%{opacity:1} 50%{opacity:.2} }` })] }));
            })(), _jsxs("div", { className: isMobile ? "flex flex-col gap-3" : "content-grid", children: [isMobile ? (sidebarOpen && (_jsx("div", { ref: sidebarRef, className: "fixed inset-0 bg-black bg-opacity-40 z-50 flex", onClick: () => setSidebarOpen(false), children: _jsx("div", { className: "panel w-64 h-full overflow-auto", onClick: e => e.stopPropagation(), children: _jsxs("div", { className: "nav-list", children: [views.map((view) => (_jsxs("button", { className: `nav-btn ${currentView === view.id ? 'active' : ''}`, onClick: () => { setCurrentView(view.id); setSidebarOpen(false); }, children: [_jsx("span", { className: `nav-icon ${view.id === 'windowsEnrollment' ? 'nav-icon-device' : ''}`, children: view.icon }), _jsx("span", { className: "nav-label", children: view.label }), badgeCounts[view.id] ? (_jsx("span", { className: "badge", title: "Count", children: badgeCounts[view.id] })) : null] }, view.id))), _jsx("div", { className: "section-divider" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => { onExport('csv'); setSidebarOpen(false); }, disabled: !auth.connected || isTrialExpired, children: "Export CSV" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => { onExport('json'); setSidebarOpen(false); }, disabled: !auth.connected || isTrialExpired, children: "Export JSON" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => { onCopyRunbook(); setSidebarOpen(false); }, disabled: !auth.connected || isTrialExpired, children: "Copy Runbook" }), auth.connected && (_jsx("button", { className: "btn btn-danger text-left", onClick: () => { void onDisconnect(); setSidebarOpen(false); }, children: "Disconnect" })), _jsx("div", { className: "section-divider" }), _jsxs("a", { className: "btn-ai-sidebar", href: "https://chatgpt.com/g/g-698c483ab6888191a8ac539d2944f696-m-intune-architect-ai-enterprise-edition", target: "_blank", rel: "noopener noreferrer", onClick: () => setSidebarOpen(false), children: [_jsx("span", { className: "ai-icon", children: "\uD83E\uDD16" }), _jsxs("span", { className: "ai-text", children: [_jsx("span", { className: "ai-label", children: "M-Intune Architect AI" }), _jsx("span", { className: "ai-sub", children: "Enterprise Edition" })] })] })] }) }) }))) : (_jsx("div", { className: "panel", children: _jsxs("div", { className: "nav-list", children: [views.map((view) => (_jsxs("button", { className: `nav-btn ${currentView === view.id ? 'active' : ''}`, onClick: () => setCurrentView(view.id), children: [_jsx("span", { className: `nav-icon ${view.id === 'windowsEnrollment' ? 'nav-icon-device' : ''}`, children: view.icon }), _jsx("span", { className: "nav-label", children: view.label }), badgeCounts[view.id] ? (_jsx("span", { className: "badge", title: "Count", children: badgeCounts[view.id] })) : null] }, view.id))), _jsx("div", { className: "section-divider" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => onExport('csv'), disabled: !auth.connected || isTrialExpired, children: "Export CSV" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => onExport('json'), disabled: !auth.connected || isTrialExpired, children: "Export JSON" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: onCopyRunbook, disabled: !auth.connected || isTrialExpired, children: "Copy Runbook" }), _jsx("div", { className: "section-divider" }), _jsxs("a", { className: "btn-ai-sidebar", href: "https://chatgpt.com/g/g-698c483ab6888191a8ac539d2944f696-m-intune-architect-ai-enterprise-edition", target: "_blank", rel: "noopener noreferrer", children: [_jsx("span", { className: "ai-icon", children: "\uD83E\uDD16" }), _jsxs("span", { className: "ai-text", children: [_jsx("span", { className: "ai-label", children: "M-Intune Architect AI" }), _jsx("span", { className: "ai-sub", children: "Enterprise Edition" })] })] })] }) })), _jsx("div", { className: "panel", children: !auth.connected ? (_jsxs("div", { className: "welcome-screen", children: [_jsxs("div", { className: "welcome-hero", children: [_jsx("div", { className: "welcome-logo-mark", children: "EF" }), _jsx("h1", { className: "welcome-title", children: "Enrollment Flow Monitor" }), _jsx("p", { className: "welcome-tagline", children: "The all-in-one Intune enrollment intelligence platform for IT Admins \u2014 diagnose failures, track compliance, and roll out with confidence." }), _jsxs("div", { className: "welcome-actions", children: [_jsx("button", { className: "btn btn-primary welcome-signin-btn", onClick: () => { window.location.href = '/api/auth/login'; }, children: "\uD83D\uDD11 Sign in with Microsoft" }), _jsx("button", { className: "btn welcome-tutorial-btn", onClick: () => setTutorialOpen(true), children: "\u25B6 Watch Tutorial" })] })] }), _jsxs("div", { className: "welcome-features", children: [_jsxs("div", { className: "welcome-feature", children: [_jsx("span", { className: "wf-icon", children: "\uD83D\uDCDA" }), _jsxs("div", { className: "wf-text", children: [_jsx("div", { className: "wf-title", children: "Failure Catalog" }), _jsx("div", { className: "wf-desc", children: "53 known enrollment errors with remediation steps" })] })] }), _jsxs("div", { className: "welcome-feature", children: [_jsx("span", { className: "wf-icon", children: "\uD83D\uDCC8" }), _jsxs("div", { className: "wf-text", children: [_jsx("div", { className: "wf-title", children: "Live Reports" }), _jsx("div", { className: "wf-desc", children: "Health scores, compliance rates & platform breakdown" })] })] }), _jsxs("div", { className: "welcome-feature", children: [_jsx("span", { className: "wf-icon", children: "\u2705" }), _jsxs("div", { className: "wf-text", children: [_jsx("div", { className: "wf-title", children: "Readiness Risks" }), _jsx("div", { className: "wf-desc", children: "Pre-flight for Autopilot, ADE, Android Enterprise" })] })] }), _jsxs("div", { className: "welcome-feature", children: [_jsx("span", { className: "wf-icon", children: "\uD83E\uDD16" }), _jsxs("div", { className: "wf-text", children: [_jsx("div", { className: "wf-title", children: "AI Assistant" }), _jsx("div", { className: "wf-desc", children: "M-Intune Architect AI \u2014 Enterprise Edition" })] })] })] }), _jsxs("div", { className: "welcome-footer", children: ["\u00A9 ", new Date().getFullYear(), " ", _jsx("a", { href: "https://modernendpoint.tech", target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--amber)', textDecoration: 'none', fontWeight: 700 }, children: "modernendpoint.tech" }), " \u00B7 by Menahem Suissa \u00B7", ' ', _jsx("button", { style: { background: 'none', border: 'none', color: 'var(--amber)', cursor: 'pointer', fontWeight: 700, fontSize: 'inherit', fontFamily: 'inherit', padding: 0 }, onClick: () => setCurrentView('privacy'), children: "Privacy Policy" })] }), tutorialOpen && (_jsx("div", { className: "tutorial-overlay", onClick: () => setTutorialOpen(false), children: _jsxs("div", { className: "tutorial-modal", onClick: e => e.stopPropagation(), children: [_jsxs("div", { className: "tutorial-modal-header", children: [_jsx("div", { className: "tutorial-modal-title", children: "\u25B6 Getting Started with Enrollment Flow Monitor" }), _jsx("button", { className: "tutorial-close-btn", onClick: () => setTutorialOpen(false), children: "\u2715" })] }), _jsx("div", { className: "tutorial-video-wrap", children: _jsx("iframe", { src: "https://www.youtube-nocookie.com/embed/VoLX31W2kOI?rel=0&modestbranding=1", title: "Enrollment Flow Monitor \u2013 Tutorial", referrerPolicy: "strict-origin-when-cross-origin", allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share", allowFullScreen: true }) }), _jsxs("div", { className: "tutorial-chapters", children: [_jsx("div", { className: "tutorial-chapter-label", children: "What's covered:" }), _jsxs("div", { className: "tutorial-chapter-list", children: [_jsx("span", { className: "tutorial-chapter", children: "00:00 \u2014 Overview & Sign-in" }), _jsx("span", { className: "tutorial-chapter", children: "01:30 \u2014 Error Catalog" }), _jsx("span", { className: "tutorial-chapter", children: "03:00 \u2014 Reports & Health Score" }), _jsx("span", { className: "tutorial-chapter", children: "05:00 \u2014 Readiness Risks" }), _jsx("span", { className: "tutorial-chapter", children: "07:00 \u2014 AI Assistant" })] })] })] }) }))] })) : currentView === 'dashboard' ? (_jsxs("div", { className: "dashboard-shell", children: [_jsxs("div", { className: "dashboard-header", children: [_jsxs("div", { children: [_jsx("div", { className: "dashboard-title", children: "\uD83C\uDF9B\uFE0F Command Center" }), _jsx("div", { className: "dashboard-subtitle", children: dashboardData ? `Last refresh: ${new Date(dashboardData.lastRefresh ?? '').toLocaleTimeString()}` : 'Loading...' })] }), _jsx("button", { className: "btn btn-primary", onClick: onRefresh, disabled: isRefreshing || isTrialExpired, children: isRefreshing ? '↻ Refreshing…' : '↻ Refresh' })] }), isViewLoading || !dashboardData ? (_jsx("div", { className: "kpi-row", children: [1, 2, 3, 4].map(i => _jsx("div", { className: "skeleton", style: { height: 88, borderRadius: 12 } }, i)) })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "command-center-grid polished", children: [_jsxs("button", { type: "button", className: "hero-score-card hero-card-prominent dashboard-nav-card", onClick: () => openDashboardView('reports'), children: [_jsxs("div", { className: "hero-score-topline", children: [_jsxs("div", { children: [_jsx("div", { className: "hero-score-label", children: "Enrollment Health Score" }), _jsx("div", { className: "hero-score-value", children: dashboardData.healthScore ?? 0 })] }), _jsx("div", { className: `hero-score-status ${(dashboardData.healthScore ?? 0) >= 85 ? 'healthy' : (dashboardData.healthScore ?? 0) >= 70 ? 'watch' : 'risk'}`, children: (dashboardData.healthScore ?? 0) >= 85 ? 'Healthy' : (dashboardData.healthScore ?? 0) >= 70 ? 'Watch' : 'At Risk' })] }), _jsx("div", { className: "hero-score-sub", children: (dashboardData.healthScore ?? 0) >= 85 ? 'Tenant enrollment posture looks stable.' : (dashboardData.healthScore ?? 0) >= 70 ? 'Some signals require review before they become incidents.' : 'This tenant needs focused remediation in the next review cycle.' }), _jsxs("div", { className: "hero-score-highlights", children: [_jsxs("div", { className: "hero-highlight-pill", children: [_jsx("span", { className: "hero-highlight-value", children: dashboardData.activeIssues ?? 0 }), _jsx("span", { className: "hero-highlight-label", children: "Active issues" })] }), _jsxs("div", { className: "hero-highlight-pill", children: [_jsx("span", { className: "hero-highlight-value", children: dashboardData.readinessRisks ?? 0 }), _jsx("span", { className: "hero-highlight-label", children: "Readiness risks" })] }), _jsxs("div", { className: "hero-highlight-pill", children: [_jsx("span", { className: "hero-highlight-value", children: dashboardData.staleDevices ?? 0 }), _jsx("span", { className: "hero-highlight-label", children: "Stale devices" })] })] })] }), _jsxs("button", { type: "button", className: "command-mini-card critical subdued-card dashboard-nav-card", onClick: () => openDashboardView('incidents'), children: [_jsx("div", { className: "cmc-label", children: "Critical Issues" }), _jsx("div", { className: "cmc-value", children: dashboardData.activeCriticalIssues ?? 0 }), _jsx("div", { className: "cmc-sub", children: "Requires immediate triage" })] }), _jsxs("button", { type: "button", className: "command-mini-card warn subdued-card dashboard-nav-card", onClick: () => openDashboardView('readinessChecklist'), children: [_jsx("div", { className: "cmc-label", children: "Readiness Risks" }), _jsx("div", { className: "cmc-value", children: dashboardData.readinessRisks ?? 0 }), _jsx("div", { className: "cmc-sub", children: "Configuration & policy gaps" })] }), _jsxs("button", { type: "button", className: "command-mini-card info subdued-card dashboard-nav-card", onClick: () => openDashboardView('windowsEnrollment'), children: [_jsx("div", { className: "cmc-label", children: "Stale Devices" }), _jsx("div", { className: "cmc-value", children: dashboardData.staleDevices ?? 0 }), _jsx("div", { className: "cmc-sub", children: "No sync in the last 7 days" })] })] }), _jsxs("div", { className: "command-columns polished-columns", children: [_jsxs("div", { className: "command-card action-card-surface", children: [_jsx("div", { className: "dashboard-section-title", children: "Recommended Actions" }), _jsx("div", { className: "recommended-list upgraded-actions", children: (dashboardData.recommendedActions ?? []).map((action, index) => (_jsxs("button", { className: `recommended-action cardlike ${action.severity ?? 'info'}`, onClick: () => action.targetView ? setCurrentView(action.targetView) : undefined, children: [_jsxs("span", { className: "recommended-action-header", children: [_jsx("span", { className: "recommended-action-title", children: action.title }), _jsx("span", { className: `action-severity-badge ${action.severity ?? 'info'}`, children: String(action.severity ?? 'info') })] }), _jsx("span", { className: "recommended-action-rationale", children: action.rationale }), _jsx("span", { className: "recommended-action-cta", children: "Open recommended view \u2192" })] }, `${action.title}-${index}`))) })] }), _jsxs("div", { className: "command-card cause-card-surface", children: [_jsx("div", { className: "dashboard-section-title", children: "Top Root Causes" }), _jsx("div", { className: "root-cause-list refined-empty-state", children: ((dashboardData.topRootCauses ?? []).length ? dashboardData.topRootCauses : [{ category: 'No recurring failure clusters found', count: 0, empty: true }]).map((cause) => (cause.empty ? (_jsxs("button", { type: "button", className: "root-cause-empty dashboard-nav-card", onClick: () => openDashboardView('reports'), children: [_jsx("div", { className: "root-cause-empty-icon", children: "\u2713" }), _jsxs("div", { children: [_jsx("div", { className: "root-cause-empty-title", children: "No recurring causes detected" }), _jsx("div", { className: "root-cause-empty-sub", children: "No repeated failure pattern was detected in the recent review window." })] })] }, cause.category)) : (_jsxs("button", { type: "button", className: "root-cause-row elevated-row dashboard-nav-row", onClick: () => openDashboardView('incidents'), children: [_jsx("span", { className: "root-cause-name", children: cause.category }), _jsx("span", { className: "root-cause-count", children: cause.count })] }, cause.category)))) })] })] }), _jsx("div", { className: "dashboard-section-title", children: "Command Metrics" }), _jsxs("div", { className: "kpi-row", children: [_jsxs("button", { type: "button", className: "kpi-card dashboard-nav-card", onClick: () => openDashboardView('windowsEnrollment'), children: [_jsx("div", { className: "kpi-icon kpi-icon-blue", children: "\uD83D\uDDA5\uFE0F" }), _jsx("div", { className: "kpi-value", children: dashboardData.totalDevices ?? 0 }), _jsx("div", { className: "kpi-label", children: "Total Devices" }), _jsx("div", { className: "kpi-indicator kpi-indicator-blue", children: "All Platforms" })] }), _jsxs("button", { type: "button", className: "kpi-card dashboard-nav-card", onClick: () => openDashboardView('windowsEnrollment'), children: [_jsx("div", { className: "kpi-icon kpi-icon-amber", children: "\uD83E\uDE9F" }), _jsx("div", { className: "kpi-value", children: dashboardData.windowsEnrollmentDevices ?? 0 }), _jsx("div", { className: "kpi-label", children: "Windows Devices" }), _jsx("div", { className: "kpi-indicator kpi-indicator-amber", children: "Enrolled" })] }), _jsxs("button", { type: "button", className: "kpi-card dashboard-nav-card", onClick: () => openDashboardView('windowsEnrollment'), children: [_jsx("div", { className: "kpi-icon kpi-icon-green", children: "\u2705" }), _jsx("div", { className: "kpi-value", children: (dashboardData.topEnrollmentStates ?? []).find((s) => s.category === 'Compliant')?.count ?? 0 }), _jsx("div", { className: "kpi-label", children: "Compliant Devices" }), _jsx("div", { className: "kpi-indicator kpi-indicator-green", children: "Policy OK" })] }), _jsxs("button", { type: "button", className: "kpi-card dashboard-nav-card", onClick: () => openDashboardView('windowsEnrollment'), children: [_jsx("div", { className: "kpi-icon kpi-icon-red", children: "\u26A0\uFE0F" }), _jsx("div", { className: "kpi-value", children: (dashboardData.topEnrollmentStates ?? []).find((s) => s.category === 'Non-compliant')?.count ?? 0 }), _jsx("div", { className: "kpi-label", children: "Non-Compliant" }), _jsx("div", { className: "kpi-indicator kpi-indicator-red", children: "Action Required" })] })] }), _jsx("div", { className: "dashboard-section-title", children: "Compliance Breakdown" }), _jsx("div", { className: "compliance-bars", children: (dashboardData.topEnrollmentStates ?? []).map((s) => {
                                                const total = dashboardData.totalDevices || 1;
                                                const pct = Math.round((s.count / total) * 100);
                                                const color = s.category === 'Compliant' ? 'var(--green)' : s.category === 'Non-compliant' ? 'var(--red)' : 'var(--amber)';
                                                return (_jsxs("button", { type: "button", className: "compliance-bar-row dashboard-bar-button", onClick: () => openDashboardView('windowsEnrollment'), children: [_jsx("div", { className: "cbr-label", children: s.category }), _jsx("div", { className: "cbr-track", children: _jsx("div", { className: "cbr-fill", style: { width: `${pct}%`, background: color } }) }), _jsxs("div", { className: "cbr-count", style: { color }, children: [s.count, " ", _jsxs("span", { className: "cbr-pct", children: ["(", pct, "%)"] })] })] }, s.category));
                                            }) })] }))] })) : currentView === 'incidents' ? (_jsxs("div", { className: "fix-queue-shell", children: [_jsxs("div", { className: "dashboard-header", children: [_jsxs("div", { children: [_jsx("div", { className: "dashboard-title", children: "\uD83D\uDEA8 Fix Queue" }), _jsx("div", { className: "dashboard-subtitle", children: "Prioritized incidents with remediation guidance and next-best actions." })] }), _jsx("button", { className: "btn btn-primary", onClick: onRefresh, disabled: isRefreshing || isTrialExpired, children: isRefreshing ? '↻ Refreshing…' : '↻ Refresh' })] }), _jsx("div", { className: "fix-queue-list", children: sortedIncidentRows.length === 0 ? (_jsxs("section", { className: "fix-queue-empty-state", children: [_jsxs("div", { className: "fix-queue-empty-state__badges", children: [_jsx("span", { className: "queue-badge queue-badge--success", children: "Resolved" }), _jsx("span", { className: "queue-badge queue-badge--success", children: "Healthy" })] }), _jsx("h3", { children: "No active incidents" }), _jsx("p", { children: "No failed installs matched incident grouping rules for the selected timeframe." }), _jsxs("div", { className: "fix-meta-grid fix-meta-grid--maturity", children: [_jsxs("div", { children: [_jsx("span", { children: "Category" }), _jsx("strong", { children: "None" })] }), _jsxs("div", { children: [_jsx("span", { children: "Owner" }), _jsx("strong", { children: "Enrollment Operations" })] }), _jsxs("div", { children: [_jsx("span", { children: "Active incidents" }), _jsx("strong", { children: "0" })] }), _jsxs("div", { children: [_jsx("span", { children: "Confidence" }), _jsx("strong", { children: "Not applicable" })] })] }), _jsxs("div", { className: "fix-next-action fix-next-action--maturity", children: [_jsx("span", { children: "Next best action" }), _jsx("strong", { children: "Keep monitoring. No active remediation is required right now." })] })] })) : (sortedIncidentRows.map((row) => {
                                        const rowIndex = rows.findIndex((candidate) => String(candidate['id'] ?? candidate['signature'] ?? '') === String(row['id'] ?? row['signature'] ?? ''));
                                        const selected = selectedIndex === rowIndex;
                                        const priority = String(row['priority'] ?? 'P3');
                                        const severity = String(row['severity'] ?? 'Low');
                                        const status = String(row['status'] ?? 'New');
                                        const sla = String(row['slaState'] ?? 'Healthy');
                                        const remediation = Array.isArray(row['remediationSteps']) ? row['remediationSteps'] : [];
                                        const workflowUpdatedAt = row['workflowUpdatedAt'] ?? row['lastSeen'];
                                        const confidence = Number(row['rootCauseConfidence'] ?? 0);
                                        const notesText = String(row['notes'] ?? '').trim();
                                        return (_jsxs("button", { className: `fix-card fix-card--maturity fix-card--${getPriorityTone(priority)} ${selected ? 'active' : ''}`, onClick: () => setSelectedIndex(rowIndex), children: [_jsxs("div", { className: "fix-card-top", children: [_jsxs("div", { className: "fix-card-title-wrap", children: [_jsx("span", { className: `queue-badge queue-badge--${getPriorityTone(priority)}`, children: priority }), _jsx("span", { className: `queue-badge queue-badge--${getStatusTone(status)}`, children: status }), _jsx("span", { className: "queue-badge queue-badge--neutral", children: severity }), _jsx("span", { className: `sla-pill ${sla.toLowerCase()}`, children: sla })] }), _jsxs("span", { className: "fix-impact", children: [toText(row['impactedCount']), " impacted"] })] }), _jsxs("div", { className: "fix-card-title-row", children: [_jsx("div", { className: "fix-card-title", children: toText(row['appName']) }), _jsx("span", { className: "owner-pill", children: toText(row['owner'] || 'Unassigned') })] }), _jsx("div", { className: "fix-card-summary", children: toText(row['summary']) }), _jsxs("div", { className: "fix-meta-grid fix-meta-grid--maturity", children: [_jsxs("div", { children: [_jsx("span", { children: "Category" }), _jsx("strong", { children: toText(row['normalizedCategory']) })] }), _jsxs("div", { children: [_jsx("span", { children: "Confidence" }), _jsxs("strong", { children: [Math.round(confidence * 100), "%"] })] }), _jsxs("div", { children: [_jsx("span", { children: "Updated" }), _jsx("strong", { children: formatRelativeTime(workflowUpdatedAt) || 'Unknown' }), _jsxs("em", { children: [formatDateTimeDisplay(workflowUpdatedAt), " ", formatTimeDisplay(workflowUpdatedAt)] })] }), _jsxs("div", { children: [_jsx("span", { children: "Signature" }), _jsx("strong", { children: toText(row['signature']) })] })] }), _jsxs("div", { className: "fix-next-action fix-next-action--maturity", children: [_jsx("span", { children: "Next best action" }), _jsx("strong", { children: toText(row['nextBestAction']) })] }), _jsxs("div", { className: `fix-notes-preview ${notesText ? '' : 'is-empty'}`, children: [_jsx("span", { children: "Notes preview" }), _jsx("p", { children: notesText ? `${notesText.slice(0, 140)}${notesText.length > 140 ? '…' : ''}` : 'No notes yet. Open this incident to capture remediation progress.' })] }), remediation.length > 0 && (_jsx("ol", { className: "fix-steps", children: remediation.slice(0, 3).map((step, stepIndex) => _jsx("li", { children: step }, stepIndex)) }))] }, String(row['id'] ?? rowIndex)));
                                    })) })] })) : currentView === 'ocr' ? (_jsxs("div", { className: "ocr-shell", children: [isTrialExpired && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', margin: '0 0 12px', borderRadius: 6, background: '#1a0a0a', border: '1px solid #ef444433' }, children: [_jsx("span", { style: { fontSize: 13, color: '#ef4444', fontFamily: "'DM Mono',monospace" }, children: "\uD83D\uDD12 OCR & AI are disabled \u2014 trial expired. Upgrade to restore access." }), _jsx("button", { onClick: () => window.open('https://moderne.gumroad.com/l/cynmjz', '_blank'), style: { marginLeft: 'auto', padding: '3px 12px', borderRadius: 4, fontSize: 11, fontFamily: "'DM Mono',monospace", cursor: 'pointer', border: '1px solid #ef444455', background: '#ef444414', color: '#ef4444', flexShrink: 0 }, children: "\u2191 Upgrade" })] })), _jsxs("div", { className: "ocr-head", children: [_jsxs("div", { children: [_jsx("div", { className: "ocr-title", children: "OCR & Error Assistant" }), _jsx("div", { className: "ocr-subtitle", children: "Upload a screenshot or paste an error, then get actionable remediation guidance." })] }), _jsx("span", { className: `status-badge ${statusKind(ocrStatusText)}`, children: ocrStatusText })] }), _jsx("input", { ref: fileInputRef, type: "file", accept: "image/*", className: "hidden", onChange: (event) => {
                                        const file = event.target.files?.[0] ?? null;
                                        setOcrImageFile(file);
                                        if (file) {
                                            setOcrStatusText(`OCR: Image selected (${file.name})`);
                                            setStatusMessage('Image selected. Click Run OCR or type text manually.');
                                        }
                                    } }), _jsxs("div", { className: "ocr-actions", children: [_jsx("button", { className: "btn btn-secondary", onClick: onPickImage, disabled: ocrBusy || isTrialExpired, children: "Pick Image" }), _jsx("button", { className: "btn btn-secondary", onClick: onRunOcr, disabled: ocrBusy || isTrialExpired, children: "Run OCR" }), _jsx("button", { className: "btn btn-primary", onClick: onGetOcrExplanation, disabled: ocrBusy || isTrialExpired, children: "Get Explanation" })] }), _jsxs("div", { className: "ocr-grid", children: [_jsxs("div", { className: "ocr-card", children: [_jsx("h4", { children: "OCR / Manual Input" }), _jsx("textarea", { className: "textarea", style: { minHeight: 250 }, placeholder: "Paste error text manually or run OCR from image...", value: ocrInputText, onChange: (event) => setOcrInputText(event.target.value) })] }), _jsxs("div", { className: "ocr-card", children: [_jsx("h4", { children: "Assistant Answer" }), _jsx("textarea", { className: "textarea", style: { minHeight: 250 }, value: ocrAssistantAnswer, readOnly: true, placeholder: "No explanation yet. Pick image or paste text, then click Get Explanation." })] })] })] })) : currentView === 'enrollmentErrorCatalog' ? (_jsxs("div", { className: "error-catalog-shell", children: [_jsxs("div", { className: "error-catalog-header", children: [_jsxs("div", { children: [_jsx("div", { className: "error-catalog-title", children: "\uD83D\uDCDA Failure Catalog" }), _jsx("div", { className: "error-catalog-subtitle", children: "Known Intune & enrollment errors with remediation steps \u2014 sourced from Microsoft Docs" })] }), _jsx("a", { className: "btn-ai-inline", href: "https://chatgpt.com/g/g-698c483ab6888191a8ac539d2944f696-m-intune-architect-ai-enterprise-edition", target: "_blank", rel: "noopener noreferrer", children: "\uD83E\uDD16 Ask AI" })] }), _jsxs("div", { className: "error-catalog-filters", children: [_jsx("input", { className: "error-search", placeholder: "\uD83D\uDD0D Search by code, title or description...", value: errorSearch, onChange: e => setErrorSearch(e.target.value) }), _jsx("div", { className: "error-filter-chips", children: ['all', 'high', 'medium', 'low', 'Windows', 'iOS', 'Android', 'macOS'].map(f => (_jsx("button", { className: `filter-chip ${errorFilter === f ? 'active' : ''}`, onClick: () => setErrorFilter(f), children: f }, f))) })] }), _jsxs("div", { className: "error-catalog-count", children: [filteredErrors.length, " error", filteredErrors.length !== 1 ? 's' : '', " found"] }), _jsx("div", { className: "error-card-list", children: filteredErrors.map(err => (_jsxs("div", { className: `error-card sev-${err.severity}`, onClick: () => setExpandedError(expandedError === err.code ? null : err.code), children: [_jsxs("div", { className: "error-card-top", children: [_jsxs("div", { className: "error-card-left", children: [_jsx("span", { className: `sev-badge sev-${err.severity}`, children: err.severity.toUpperCase() }), _jsx("span", { className: "error-code", children: err.code }), _jsx("span", { className: "error-title", children: err.title })] }), _jsxs("div", { className: "error-card-right", children: [err.platforms.map(p => _jsx("span", { className: "platform-tag", children: p }, p)), _jsx("span", { className: "expand-icon", children: expandedError === err.code ? '▲' : '▼' })] })] }), expandedError === err.code && (_jsxs("div", { className: "error-card-body", children: [_jsx("p", { className: "error-description", children: err.description }), _jsxs("div", { className: "error-cause", children: [_jsx("strong", { children: "Root cause:" }), " ", err.cause] }), _jsx("div", { className: "error-actions-title", children: "Remediation steps:" }), _jsx("ol", { className: "error-actions-list", children: err.actions.map((a, i) => _jsx("li", { children: a }, i)) }), _jsx("a", { className: "error-ref-link", href: err.ref, target: "_blank", rel: "noopener noreferrer", children: "\uD83D\uDCC4 Microsoft Docs \u2197" })] }))] }, err.code))) })] })) : currentView === 'reports' ? (_jsxs("div", { className: "reports-shell", children: [_jsxs("div", { className: "reports-header", children: [_jsxs("div", { children: [_jsx("div", { className: "reports-title", children: "\uD83D\uDCC8 Enrollment Reports" }), _jsxs("div", { className: "reports-subtitle", children: ["Live analytics \u2014 generated ", reportData ? new Date(reportData.generatedAt).toLocaleString() : '...'] })] }), _jsx("button", { className: "btn btn-primary", onClick: () => generateEnrollmentPDF(reportData, addToast), disabled: isTrialExpired, children: "\u2B07 Export PDF" })] }), !reportData ? (_jsx("div", { className: "empty-state", children: _jsx("div", { className: "empty-state-title", children: "Loading reports..." }) })) : (_jsxs("div", { id: "reports-print-area", className: "reports-body", children: [_jsxs("div", { className: "kpi-row", children: [_jsxs("div", { className: "kpi-card", children: [_jsx("div", { className: "kpi-value", children: reportData.totalDevices }), _jsx("div", { className: "kpi-label", children: "Total Devices" })] }), _jsxs("div", { className: "kpi-card", children: [_jsxs("div", { className: "kpi-value green", children: [reportData.overallComplianceRate, "%"] }), _jsx("div", { className: "kpi-label", children: "Compliance Rate" })] }), _jsxs("div", { className: "kpi-card", children: [_jsx("div", { className: `kpi-value ${reportData.activeIncidents > 0 ? 'red' : 'green'}`, children: reportData.activeIncidents }), _jsx("div", { className: "kpi-label", children: "Active Incidents" })] }), _jsxs("div", { className: "kpi-card", children: [_jsx("div", { className: "kpi-value amber", children: reportData.platformBreakdown?.length ?? 0 }), _jsx("div", { className: "kpi-label", children: "Platforms" })] })] }), _jsx("div", { className: "reports-section-title", children: "Platform Health Score" }), _jsx("div", { className: "health-score-row", children: (reportData.healthScores ?? []).map((h) => (_jsxs("div", { className: "health-score-card", children: [_jsx("div", { className: "hs-platform", children: h.platform }), _jsx("div", { className: "hs-score-wrap", children: _jsx("div", { className: "hs-ring", style: { '--score': h.score }, children: _jsx("span", { className: "hs-number", children: h.score }) }) }), _jsxs("div", { className: "hs-stats", children: [_jsxs("span", { className: "hs-stat green", children: [h.compliant, " compliant"] }), _jsxs("span", { className: "hs-stat red", children: [h.enrolled - h.compliant, " non-compliant"] }), _jsxs("span", { className: "hs-stat muted", children: [h.enrolled, " total"] })] })] }, h.platform))) }), _jsx("div", { className: "reports-section-title", children: "Platform Breakdown" }), _jsx("div", { className: "platform-bars", children: (reportData.platformBreakdown ?? []).map((p) => (_jsxs("div", { className: "platform-bar-row", children: [_jsx("div", { className: "pb-label", children: p.platform }), _jsxs("div", { className: "pb-bar-wrap", children: [_jsx("div", { className: "pb-bar-compliant", style: { width: `${p.count > 0 ? (p.compliant / p.count) * 100 : 0}%` } }), _jsx("div", { className: "pb-bar-nc", style: { width: `${p.count > 0 ? (p.nonCompliant / p.count) * 100 : 0}%` } })] }), _jsxs("div", { className: "pb-counts", children: [_jsxs("span", { className: "green", children: [p.compliant, "\u2713"] }), _jsxs("span", { className: "red", children: [p.nonCompliant, "\u2717"] }), _jsxs("span", { className: "muted", children: ["/ ", p.count] })] })] }, p.platform))) }), (reportData.topErrors ?? []).length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "reports-section-title", children: "Top Enrollment Errors" }), _jsx("div", { className: "top-errors-list", children: (reportData.topErrors ?? []).map((e, i) => (_jsxs("div", { className: `top-error-row sev-${(e.severity ?? 'low').toLowerCase()}`, children: [_jsxs("span", { className: "te-rank", children: ["#", i + 1] }), _jsx("span", { className: `sev-badge sev-${(e.severity ?? 'low').toLowerCase()}`, children: e.severity }), _jsx("span", { className: "te-code", children: e.errorCode }), _jsx("span", { className: "te-title", children: e.title }), _jsxs("span", { className: "te-count", children: [e.count, " devices"] })] }, e.errorCode))) })] }))] }))] })) : currentView === 'readinessChecklist' ? (_jsxs("div", { className: "checklist-shell", children: [_jsx("div", { className: "checklist-header", children: _jsxs("div", { children: [_jsx("div", { className: "checklist-title", children: "\u2705 Enrollment Readiness Risks" }), _jsx("div", { className: "checklist-subtitle", children: "Pre-flight verification before rolling out a new enrollment scenario" })] }) }), _jsx("div", { className: "checklist-scenarios", children: [
                                        { id: 'autopilot', label: '🖥️ Windows Autopilot' },
                                        { id: 'ade-ios', label: '📱 ADE – iOS/iPadOS' },
                                        { id: 'ade-macos', label: '🍎 ADE – macOS' },
                                        { id: 'android-enterprise', label: '🤖 Android Enterprise' },
                                    ].map(s => (_jsx("button", { className: `scenario-btn ${checklistScenario === s.id ? 'active' : ''}`, onClick: () => {
                                            setChecklistScenario(s.id);
                                            getView(`readinessChecklist?scenario=${s.id}`).then(r => setChecklistItems(r.rows ?? [])).catch(() => setChecklistItems([]));
                                        }, children: s.label }, s.id))) }), checklistItems.length === 0 ? (_jsx("div", { className: "empty-state", children: _jsx("div", { className: "empty-state-title", children: "Loading checklist..." }) })) : (_jsxs("div", { className: "checklist-list", children: [['Devices', 'Licensing', 'Registration', 'ABM', 'Profile', 'Policy', 'Certificates', 'Network', 'Apps', 'Google', 'Device', 'Security', 'Health'].map(cat => {
                                            const items = checklistItems.filter((i) => i.category === cat);
                                            if (!items.length)
                                                return null;
                                            return (_jsxs("div", { className: "checklist-category", children: [_jsx("div", { className: "checklist-cat-label", children: cat }), items.map((item) => (_jsxs("div", { className: `checklist-item status-${item.status}`, children: [_jsx("span", { className: "ci-icon", children: item.status === 'pass' ? '✅' : item.status === 'warn' ? '⚠️' : item.status === 'fail' ? '❌' : '🔲' }), _jsxs("div", { className: "ci-content", children: [_jsx("div", { className: "ci-label", children: item.label }), _jsx("div", { className: "ci-desc", children: item.description }), _jsx("div", { className: "ci-detail", children: item.detail })] }), _jsx("a", { className: "ci-doc", href: item.docUrl, target: "_blank", rel: "noopener noreferrer", children: "Docs \u2197" })] }, item.id)))] }, cat));
                                        }), _jsxs("div", { className: "checklist-legend", children: [_jsx("span", { children: "\u2705 Auto-verified" }), _jsx("span", { children: "\u26A0\uFE0F Warning detected" }), _jsx("span", { children: "\u274C Failed" }), _jsx("span", { children: "\uD83D\uDD32 Manual check required" })] })] }))] })) : currentView === 'auditLogs' ? (_jsxs("div", { className: "audit-shell", children: [_jsxs("div", { className: "audit-header", children: [_jsxs("div", { children: [_jsx("div", { className: "audit-title", children: "\uD83D\uDCCB Audit Trail" }), _jsxs("div", { className: "audit-subtitle", children: ["User actions performed in this session \u2014 ", auditLogs.length, " events recorded"] })] }), _jsx("button", { className: "btn btn-secondary", style: { fontSize: 11 }, onClick: () => {
                                                const csv = ['Timestamp,User,Action,View,Details,Result',
                                                    ...auditLogs.map(l => `"${l.timestamp}","${l.user}","${l.action}","${l.view}","${l.details}","${l.result}"`)
                                                ].join('\n');
                                                const blob = new Blob([csv], { type: 'text/csv' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = 'audit-logs.csv';
                                                a.click();
                                                URL.revokeObjectURL(url);
                                                addToast('success', 'Audit logs exported');
                                            }, children: "\u2B07 Export CSV" })] }), auditLogs.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-title", children: "No actions recorded yet" }), _jsx("div", { children: "Actions you perform (Sync, Reboot, Reset, view navigation) will appear here." })] })) : (_jsx("div", { className: "audit-list", children: auditLogs.map(log => (_jsxs("div", { className: `audit-entry audit-${log.result}`, children: [_jsx("div", { className: "audit-icon", children: log.result === 'success' ? '✅' : log.result === 'fail' ? '❌' : 'ℹ️' }), _jsxs("div", { className: "audit-content", children: [_jsxs("div", { className: "audit-action-row", children: [_jsx("span", { className: "audit-action", children: log.action }), _jsx("span", { className: `audit-badge audit-badge-${log.result}`, children: log.result }), _jsxs("span", { className: "audit-view", children: ["in ", log.view] })] }), _jsx("div", { className: "audit-details", children: log.details })] }), _jsxs("div", { className: "audit-meta", children: [_jsx("div", { className: "audit-user", children: log.user }), _jsx("div", { className: "audit-time", children: new Date(log.timestamp).toLocaleTimeString() }), _jsx("div", { className: "audit-date", children: new Date(log.timestamp).toLocaleDateString() })] })] }, log.id))) }))] })) : currentView === 'privacy' ? (_jsxs("div", { className: "privacy-shell", children: [_jsxs("div", { className: "privacy-header", children: [_jsx("button", { className: "btn btn-secondary", style: { fontSize: 11, marginBottom: 16, alignSelf: 'flex-start' }, onClick: () => setCurrentView(auth.connected ? 'dashboard' : 'home'), children: "\u2190 Back" }), _jsx("h1", { className: "privacy-title", children: "Privacy Policy" }), _jsxs("p", { className: "privacy-effective", children: ["Effective date: January 1, 2025 \u00B7 ", _jsx("a", { href: "https://modernendpoint.tech", target: "_blank", rel: "noopener noreferrer", className: "privacy-site-link", children: "modernendpoint.tech" })] })] }), _jsx("div", { className: "privacy-body", children: [
                                        { title: '1. Introduction', content: 'Enrollment Flow Monitor ("the App") is operated by Menahem Suissa / modernendpoint.tech. This Privacy Policy explains how we collect, use, and protect information when you use the App to monitor Microsoft Intune enrollment data in your organization.' },
                                        { title: '2. Data We Access', content: "The App connects to Microsoft Graph API using delegated permissions granted by you or your organization's IT administrator. It accesses device management data including device names, compliance states, enrollment statuses, and user principal names solely to display them within the App interface." },
                                        { title: '3. Data Storage', content: "The App does not store, cache, or transmit your Microsoft tenant data to any external server owned by us. All Microsoft Graph data is fetched in real-time and displayed only in your browser session. Session data (authentication tokens) is stored server-side in an encrypted session for the duration of your login only." },
                                        { title: '4. Authentication & Permissions', content: 'Authentication is handled entirely through Microsoft Entra ID (Azure AD) using the official OAuth 2.0 authorization code flow. We request only the minimum Graph API permissions required. Privileged permissions (DeviceManagementManagedDevices.PrivilegedOperations.All) are requested separately, only when you explicitly choose to enable remote actions.' },
                                        { title: '5. Audit Trail', content: 'In-app audit logs record actions you perform (device sync, reboot, reset commands) within your browser session. These logs are stored in memory only and cleared when you close or refresh the browser. You may export them as CSV at any time.' },
                                        { title: '6. Third-Party Services', content: "The App integrates exclusively with Microsoft Graph API (graph.microsoft.com). No third-party analytics, advertising, or tracking services are used. The optional AI Assistant button links to an external ChatGPT-based tool; its use is governed by OpenAI's privacy policy." },
                                        { title: '7. Your Rights', content: 'You may disconnect your Microsoft account at any time using the "Disconnect" option in the user menu. This destroys your session and removes all cached authentication data.' },
                                        { title: '8. Contact', content: 'For any privacy-related questions, please visit modernendpoint.tech or contact Menahem Suissa directly through the website.' },
                                    ].map(section => (_jsxs("div", { className: "privacy-section", children: [_jsx("h2", { className: "privacy-section-title", children: section.title }), _jsx("p", { className: "privacy-section-body", children: section.content })] }, section.title))) })] })) : (isViewLoading ? (_jsxs("div", { children: [_jsx("div", { className: "skeleton" }), _jsx("div", { className: "skeleton" }), _jsx("div", { className: "skeleton" }), _jsx("div", { className: "skeleton" })] })) : rows.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-title", children: "No rows returned" }), _jsx("div", { children: statusMessage || 'No data for this view.' })] })) : (_jsxs(_Fragment, { children: [isDeviceView && (_jsxs("div", { className: "smart-toolbar", children: [_jsxs("div", { className: "smart-toolbar-row", children: [_jsxs("div", { className: "filter-chips-row", children: [visibleFilterChips.map(chip => (_jsx("button", { className: `filter-chip filter-chip-${chip.color} ${activeFilters.has(chip.id) ? 'active' : ''}`, onClick: () => toggleFilter(chip.id), children: chip.label }, chip.id))), (activeFilters.size > 0 || inlineSearch || globalSearch) && (_jsx("button", { className: "filter-chip-clear", onClick: clearFilters, children: "Clear filters \u2715" }))] }), _jsx("div", { className: "saved-views-actions", children: _jsx("button", { className: "btn btn-secondary", onClick: saveCurrentView, children: "\u2B50 Save current view" }) })] }), scopedSavedViews.length > 0 && (_jsxs("div", { className: "saved-views-row", children: [_jsx("div", { className: "saved-views-label", children: "Saved views" }), _jsx("div", { className: "saved-views-list", children: scopedSavedViews.map(view => (_jsxs("div", { className: "saved-view-pill", children: [_jsx("button", { type: "button", className: "saved-view-open", onClick: () => applySavedView(view), title: `Open ${view.name}`, children: view.name }), _jsx("button", { type: "button", className: "saved-view-remove", onClick: () => removeSavedView(view.id), "aria-label": `Remove ${view.name}`, title: "Remove saved view", children: "\u2715" })] }, view.id))) })] }))] })), _jsx("div", { className: "inline-search-wrap", children: _jsxs("div", { className: "inline-search-bar", children: [_jsx("span", { className: "inline-search-icon", children: "\uD83D\uDD0D" }), _jsx("input", { ref: inlineSearchRef, className: "inline-search-input", value: inlineSearch, onChange: e => { setInlineSearch(e.target.value); setGlobalSearch(''); }, placeholder: "Search devices, users, serial numbers..." }), (inlineSearch || globalSearch) && (_jsx("button", { className: "inline-search-clear", onClick: () => { setInlineSearch(''); setGlobalSearch(''); }, children: "\u2715" })), (inlineSearch || globalSearch) && (_jsxs("span", { className: "inline-search-count", children: [filteredRows.length, "/", rows.length] }))] }) }), isDeviceView && selectedDevices.size > 0 && (_jsxs("div", { className: "bulk-action-bar", children: [_jsxs("span", { className: "bulk-count", children: [selectedDevices.size, " device", selectedDevices.size !== 1 ? 's' : '', " selected"] }), _jsxs("div", { className: "bulk-actions", children: [_jsxs("button", { className: "bulk-btn bulk-btn-sync", disabled: actionLoading === 'bulk' || isTrialExpired, onClick: () => openConfirm('bulk-sync'), children: ["\uD83D\uDD04 Sync ", selectedDevices.size] }), _jsxs("button", { className: "bulk-btn bulk-btn-reboot", disabled: actionLoading === 'bulk' || isTrialExpired, onClick: () => openConfirm('bulk-reboot'), children: ["\u26A1 Reboot ", selectedDevices.size] }), _jsxs("button", { className: "bulk-btn bulk-btn-reset", disabled: actionLoading === 'bulk' || isTrialExpired, onClick: () => openConfirm('bulk-reset'), children: ["\u26A0\uFE0F Reset ", selectedDevices.size] }), _jsx("button", { className: "bulk-btn bulk-btn-clear", onClick: () => setSelectedDevices(new Set()), children: "\u2715 Clear" })] })] })), isMobile ? (_jsx("div", { className: "mobile-card-list", children: filteredRows.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-title", children: "No matching devices" }), _jsx("div", { children: "Try a different search term." })] })) : filteredRows.map((row, index) => {
                                        const devId = getDeviceId(row);
                                        const isSelected = selectedDevices.has(devId);
                                        const isActing = actionLoading === devId;
                                        const compState = String(row['complianceState'] ?? row['status'] ?? '').toLowerCase();
                                        return (_jsxs("div", { className: `mobile-data-card ${selectedIndex === index ? 'active' : ''} ${isSelected ? 'mdc-selected' : ''}`, onClick: () => setSelectedIndex(index), children: [_jsxs("div", { className: "mdc-header", children: [isDeviceView && devId && (_jsx("input", { type: "checkbox", className: "mdc-checkbox", checked: isSelected, onChange: () => toggleDeviceSelect(devId), onClick: e => e.stopPropagation() })), _jsx("span", { className: "mdc-title", children: toText(row['deviceName'] ?? row['displayName'] ?? row['name'] ?? row['title'] ?? `Row ${index + 1}`) }), compState && (_jsx("span", { className: `status-pill status-pill-${compState.includes('compliant') && !compState.includes('non') ? 'green' : compState.includes('non') ? 'red' : 'blue'}`, children: toText(row['complianceState'] ?? row['status'] ?? '') })), _jsxs("div", { className: "mdc-actions", children: [Boolean(row['id']) && (_jsx("button", { className: "copy-id-btn", title: "Copy ID", onClick: e => {
                                                                        e.stopPropagation();
                                                                        navigator.clipboard.writeText(String(row['id']));
                                                                        addToast('success', 'ID copied!');
                                                                    }, children: "\u29C9" })), _jsxs("button", { className: "view-json-btn", title: "Open record details", "aria-label": "Open record details", onClick: e => { e.stopPropagation(); setJsonModalRow(row); }, children: [_jsx("span", { className: "view-json-btn-icon", children: "\uD83D\uDDC2" }), _jsx("span", { className: "view-json-btn-label", children: "Record" })] })] })] }), headers.filter(h => h !== 'id' && h !== 'details' && h !== 'complianceState').slice(0, 3).map(h => (_jsxs("div", { className: "mdc-row", children: [_jsx("span", { className: "mdc-key", children: h }), _jsx("span", { className: "mdc-val", children: toText(row[h]) })] }, h))), isDeviceView && devId && (_jsxs("div", { className: "mdc-device-actions", children: [_jsxs("button", { className: `daction-btn daction-sync ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`, disabled: !!actionLoading, onClick: e => { e.stopPropagation(); openConfirm('sync', row); }, children: [isActing ? '⏳' : auth.hasWritePermissions ? '🔄' : '🔒', " Sync"] }), _jsxs("button", { className: `daction-btn daction-reboot ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`, disabled: !!actionLoading, onClick: e => { e.stopPropagation(); openConfirm('reboot', row); }, children: [isActing ? '⏳' : auth.hasWritePermissions ? '⚡' : '🔒', " Reboot"] }), _jsxs("button", { className: `daction-btn daction-reset ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`, disabled: !!actionLoading, onClick: e => { e.stopPropagation(); openConfirm('autopilotReset', row); }, children: [isActing ? '⏳' : auth.hasWritePermissions ? '♻️' : '🔒', " Reset"] })] }))] }, devId || index));
                                    }) })) : (
                                /* Desktop: enhanced table with actions */
                                _jsx("div", { className: "table-wrap", children: filteredRows.length === 0 ? (_jsxs("div", { className: "empty-state", style: { padding: '40px 20px' }, children: [_jsx("div", { className: "empty-state-title", children: "No matching devices" }), _jsx("div", { children: "Try a different search term." })] })) : (_jsxs("table", { className: "data-table data-table-enhanced", children: [_jsx("thead", { children: _jsxs("tr", { children: [isDeviceView && (_jsx("th", { style: { width: 36 }, children: _jsx("input", { type: "checkbox", checked: selectedDevices.size === filteredRows.length && filteredRows.length > 0, onChange: toggleSelectAll, title: "Select all", style: { cursor: 'pointer', accentColor: 'var(--amber)' } }) })), headers.map((header) => (_jsx("th", { children: header.replace(/([A-Z])/g, ' $1').trim() }, header))), _jsx("th", { style: { width: isDeviceView ? 200 : 72 }, children: "Actions" })] }) }), _jsx("tbody", { children: filteredRows.map((row, index) => {
                                                    const devId = getDeviceId(row);
                                                    const isSelected = selectedDevices.has(devId);
                                                    const isActing = actionLoading === devId;
                                                    const compState = String(row['complianceState'] ?? '').toLowerCase();
                                                    return (_jsxs("tr", { className: `table-row ${selectedIndex === index ? 'active' : ''} ${index % 2 === 1 ? 'zebra' : ''} ${isSelected ? 'row-selected' : ''}`, onClick: () => setSelectedIndex(index), children: [isDeviceView && (_jsx("td", { onClick: e => e.stopPropagation(), children: devId && _jsx("input", { type: "checkbox", checked: isSelected, onChange: () => toggleDeviceSelect(devId), style: { cursor: 'pointer', accentColor: 'var(--amber)' } }) })), headers.map((header) => (_jsx("td", { children: header === 'complianceState' || header === 'status' ? (_jsx("span", { className: `status-pill status-pill-${compState.includes('compliant') && !compState.includes('non') ? 'green' : compState.includes('non') ? 'red' : 'blue'}`, children: toText(row[header]) })) : (header === 'id' || (String(row[header] ?? '').length === 36 && String(row[header] ?? '').includes('-'))) ? (_jsxs("span", { className: "guid-cell", children: [_jsx("span", { className: "guid-text", children: toText(row[header]) }), _jsx("button", { className: "copy-id-btn", title: "Copy ID", onClick: e => {
                                                                                e.stopPropagation();
                                                                                navigator.clipboard.writeText(toText(row[header]));
                                                                                addToast('success', 'ID copied!');
                                                                            }, children: "\u29C9" })] })) : renderTableValue(header, row[header]) }, `${index}-${header}`))), _jsx("td", { onClick: e => e.stopPropagation(), children: _jsxs("div", { className: "row-actions", children: [_jsxs("button", { className: "view-json-btn", title: "Open record details", "aria-label": "Open record details", onClick: () => setJsonModalRow(row), children: [_jsx("span", { className: "view-json-btn-icon", children: "\uD83D\uDDC2" }), _jsx("span", { className: "view-json-btn-label", children: "Record" })] }), isDeviceView && devId && (_jsxs(_Fragment, { children: [_jsx("button", { className: `daction-btn daction-sync ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`, disabled: !!actionLoading || isTrialExpired, title: isTrialExpired ? '🔒 Trial expired' : auth.hasWritePermissions ? 'Sync device' : '🔒 Requires Write Access', onClick: () => openConfirm('sync', row), children: isActing ? '⏳' : auth.hasWritePermissions ? '🔄' : '🔒' }), _jsx("button", { className: `daction-btn daction-reboot ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`, disabled: !!actionLoading || isTrialExpired, title: isTrialExpired ? '🔒 Trial expired' : auth.hasWritePermissions ? 'Reboot device' : '🔒 Requires Write Access', onClick: () => openConfirm('reboot', row), children: isActing ? '⏳' : auth.hasWritePermissions ? '⚡' : '🔒' }), _jsx("button", { className: `daction-btn daction-reset ${isActing ? 'daction-loading' : ''} ${!auth.hasWritePermissions ? 'daction-locked' : ''}`, disabled: !!actionLoading || isTrialExpired, title: isTrialExpired ? '🔒 Trial expired' : auth.hasWritePermissions ? 'Autopilot Reset' : '🔒 Requires Write Access', onClick: () => openConfirm('autopilotReset', row), children: isActing ? '⏳' : auth.hasWritePermissions ? '♻️' : '🔒' })] }))] }) })] }, devId || index));
                                                }) })] })) }))] }))) }), _jsxs("div", { className: `panel detail-rail ${currentView === 'dashboard' ? 'dashboard-rail' : ''} ${!detailsText ? 'is-empty' : ''}`, children: [_jsx("div", { className: "font-semibold text-xl mb-2", children: "Summary" }), _jsx("div", { className: "text-sm mb-3", style: { color: 'var(--text-muted)' }, children: currentView === 'ocr' ? 'OCR Assistant Answer' : detailsSummary }), _jsx("div", { className: "font-semibold text-xl mb-2", children: "Details" }), _jsx("pre", { className: "text-xs whitespace-pre-wrap rounded-lg p-3", style: { background: 'var(--bg)', border: '1px solid var(--border)' }, children: currentView === 'ocr'
                                    ? (ocrAssistantAnswer || 'No explanation yet. Pick image or paste text, then click Get Explanation.')
                                    : detailsText }), currentView === 'incidents' && selectedIncident && !selectedIncident['isPlaceholder'] && (_jsxs("div", { className: "incident-workflow-card", children: [_jsxs("div", { className: "incident-workflow-header", children: [_jsx("div", { children: "Workflow" }), _jsx("span", { className: "incident-workflow-badge", children: incidentStatusDraft })] }), _jsx("label", { className: "incident-workflow-label", children: "Owner" }), _jsx("input", { className: "incident-workflow-input", value: incidentOwnerDraft, onChange: (e) => setIncidentOwnerDraft(e.target.value), placeholder: "Unassigned" }), _jsx("label", { className: "incident-workflow-label", children: "Status" }), _jsx("select", { className: "incident-workflow-input", value: incidentStatusDraft, onChange: (e) => setIncidentStatusDraft(e.target.value), children: incidentWorkflowStatuses.map((status) => (_jsx("option", { value: status, children: status }, status))) }), _jsx("label", { className: "incident-workflow-label", children: "Notes" }), _jsx("textarea", { className: "incident-workflow-notes", value: incidentNotesDraft, onChange: (e) => setIncidentNotesDraft(e.target.value), placeholder: "What are we doing next? Who owns the follow-up?" }), _jsxs("div", { className: "incident-workflow-meta", children: ["Signature: ", _jsx("span", { children: selectedIncidentSignature || 'N/A' })] }), _jsxs("div", { className: "incident-workflow-meta", children: ["Last updated: ", _jsxs("span", { children: [formatDateTimeDisplay(selectedIncident['workflowUpdatedAt'] ?? selectedIncident['lastSeen'] ?? 'Not saved yet'), " ", formatTimeDisplay(selectedIncident['workflowUpdatedAt'] ?? selectedIncident['lastSeen'])] })] }), _jsx("button", { className: "btn btn-primary incident-workflow-save", onClick: onSaveIncidentWorkflow, disabled: incidentWorkflowSaving || isTrialExpired, children: incidentWorkflowSaving ? 'Saving…' : 'Save Workflow' })] }))] })] }), _jsxs("div", { className: "surface footer", children: [_jsx("div", { className: `status-badge ${statusKind(statusMessage)}`, children: statusMessage }), _jsxs("div", { className: "footer-links", children: [_jsxs("span", { children: ["\u00A9 ", new Date().getFullYear(), " All rights reserved"] }), _jsx("a", { href: "https://modernendpoint.tech", target: "_blank", rel: "noopener noreferrer", className: "footer-link", children: "modernendpoint.tech" }), _jsx("span", { className: "footer-sep", children: "\u00B7" }), _jsx("span", { children: "by Menahem Suissa" }), _jsx("span", { className: "footer-sep", children: "\u00B7" }), _jsx("button", { className: "footer-link footer-link-btn", onClick: () => setCurrentView('privacy'), children: "Privacy Policy" })] })] }), toasts.length > 0 && (_jsx("div", { className: "toast-wrap", children: toasts.map((toast) => (_jsx("div", { className: `toast ${toast.kind}`, children: toast.message }, toast.id))) })), upgradeModalOpen && (_jsx("div", { className: "confirm-overlay", onClick: () => setUpgradeModalOpen(false), children: _jsxs("div", { className: "confirm-modal upgrade-modal", onClick: e => e.stopPropagation(), children: [_jsx("div", { className: "upgrade-shield", children: "\uD83D\uDEE1\uFE0F" }), _jsx("div", { className: "upgrade-badge", children: "Admin Permissions Required" }), _jsx("div", { className: "confirm-title", style: { fontSize: 17 }, children: "Upgrade Access" }), _jsxs("div", { className: "confirm-body", children: [_jsxs("p", { children: ["Remote actions like ", _jsx("strong", { style: { color: 'var(--amber)' }, children: upgradeAction === 'sync' ? 'Device Sync'
                                                : upgradeAction === 'reboot' ? 'Remote Reboot'
                                                    : upgradeAction?.includes('reset') ? 'Autopilot Reset'
                                                        : 'Remote Actions' }), " require elevated Microsoft Graph permissions."] }), _jsxs("div", { className: "upgrade-scope-list", children: [_jsxs("div", { className: "upgrade-scope", children: [_jsx("span", { className: "scope-dot scope-dot-purple" }), _jsxs("span", { children: ["DeviceManagementManagedDevices.", _jsx("strong", { children: "PrivilegedOperations.All" })] })] }), _jsxs("div", { className: "upgrade-scope", children: [_jsx("span", { className: "scope-dot scope-dot-blue" }), _jsxs("span", { children: ["DeviceManagementManagedDevices.", _jsx("strong", { children: "ReadWrite.All" })] })] })] }), _jsx("p", { className: "upgrade-note", children: "You'll be redirected to Microsoft to grant consent. This is a one-time action per tenant." })] }), _jsxs("div", { className: "confirm-actions", children: [_jsx("button", { className: "btn btn-secondary", onClick: () => setUpgradeModalOpen(false), children: "Cancel" }), _jsx("button", { className: "btn btn-primary upgrade-auth-btn", onClick: () => {
                                        setUpgradeModalOpen(false);
                                        window.location.href = '/api/auth/login?elevated=true';
                                    }, children: "\uD83D\uDD11 Authorize Now" })] })] }) })), confirmModal.open && (_jsx("div", { className: "confirm-overlay", onClick: () => setConfirmModal(m => ({ ...m, open: false })), children: _jsxs("div", { className: "confirm-modal", onClick: e => e.stopPropagation(), children: [_jsx("div", { className: "confirm-icon", children: confirmModal.action?.includes('reset') ? '⚠️' : confirmModal.action?.includes('reboot') ? '⚡' : '🔄' }), _jsxs("div", { className: "confirm-title", children: [confirmModal.action === 'sync' && 'Sync Device', confirmModal.action === 'reboot' && 'Reboot Device', confirmModal.action === 'autopilotReset' && 'Autopilot Reset', confirmModal.action === 'bulk-sync' && `Sync ${confirmModal.count} Devices`, confirmModal.action === 'bulk-reboot' && `Reboot ${confirmModal.count} Devices`, confirmModal.action === 'bulk-reset' && `Reset ${confirmModal.count} Devices`] }), _jsx("div", { className: "confirm-body", children: confirmModal.action === 'autopilotReset' ? (_jsxs(_Fragment, { children: [_jsxs("p", { children: ["Are you sure you want to ", _jsx("strong", { children: "Autopilot Reset" }), " ", _jsx("span", { className: "confirm-device-name", children: confirmModal.deviceName }), "?"] }), _jsxs("p", { className: "confirm-warning", children: ["\u26A0\uFE0F This will wipe the device and re-run Autopilot provisioning. ", _jsx("strong", { children: "This action cannot be undone." })] })] })) : confirmModal.action === 'bulk-reset' ? (_jsxs(_Fragment, { children: [_jsxs("p", { children: ["Are you sure you want to reset ", _jsxs("strong", { children: [confirmModal.count, " devices"] }), "?"] }), _jsxs("p", { className: "confirm-warning", children: ["\u26A0\uFE0F All selected devices will be wiped. ", _jsx("strong", { children: "This action cannot be undone." })] })] })) : confirmModal.action === 'reboot' ? (_jsxs("p", { children: ["Reboot ", _jsx("span", { className: "confirm-device-name", children: confirmModal.deviceName }), "? The device will restart immediately."] })) : confirmModal.action === 'bulk-reboot' ? (_jsxs("p", { children: ["Reboot ", _jsxs("strong", { children: [confirmModal.count, " devices"] }), "? All selected devices will restart."] })) : confirmModal.action === 'bulk-sync' ? (_jsxs("p", { children: ["Force policy sync on ", _jsxs("strong", { children: [confirmModal.count, " devices"] }), "?"] })) : (_jsxs("p", { children: ["Force policy sync on ", _jsx("span", { className: "confirm-device-name", children: confirmModal.deviceName }), "?"] })) }), _jsxs("div", { className: "confirm-actions", children: [_jsx("button", { className: "btn btn-secondary", onClick: () => setConfirmModal(m => ({ ...m, open: false })), children: "Cancel" }), _jsx("button", { className: `btn ${confirmModal.action?.includes('reset') || confirmModal.action?.includes('reboot') ? 'btn-danger' : 'btn-primary'}`, onClick: executeAction, children: confirmModal.action === 'sync' || confirmModal.action === 'bulk-sync' ? '🔄 Confirm Sync'
                                        : confirmModal.action === 'reboot' || confirmModal.action === 'bulk-reboot' ? '⚡ Confirm Reboot'
                                            : '♻️ Confirm Reset' })] })] }) })), searchOpen && (_jsx("div", { className: "search-overlay", onClick: () => { setSearchOpen(false); setGlobalSearch(''); }, children: _jsxs("div", { className: "search-modal", onClick: e => e.stopPropagation(), children: [_jsxs("div", { className: "search-modal-inner", children: [_jsx("span", { className: "search-modal-icon", children: "\uD83D\uDD0D" }), _jsx("input", { ref: globalSearchRef, className: "search-modal-input", value: globalSearch, onChange: e => setGlobalSearch(e.target.value), placeholder: "Search across all rows\u2026 (Esc to close)" }), globalSearch && _jsxs("span", { className: "search-modal-count", children: [filteredRows.length, " results"] })] }), globalSearch && filteredRows.length > 0 && (_jsxs("div", { className: "search-results-preview", children: [filteredRows.slice(0, 6).map((row, i) => (_jsxs("div", { className: "search-result-item", onClick: () => {
                                        const idx = rows.indexOf(row);
                                        setSelectedIndex(idx);
                                        setSearchOpen(false);
                                        setGlobalSearch('');
                                    }, children: [_jsx("span", { className: "sri-title", children: toText(row['deviceName'] ?? row['displayName'] ?? row['name'] ?? row['title'] ?? `Row ${i + 1}`) }), _jsx("span", { className: "sri-sub", children: toText(row['operatingSystem'] ?? row['area'] ?? row['platform'] ?? row['normalizedCategory'] ?? '') })] }, i))), filteredRows.length > 6 && (_jsxs("div", { className: "search-result-more", children: ["+", filteredRows.length - 6, " more \u2014 press Enter to apply filter"] }))] })), _jsxs("div", { className: "search-modal-footer", children: [_jsx("span", { children: "\u21B5 to filter table" }), _jsx("span", { children: "Esc to close" }), _jsx("span", { children: "Ctrl+K to reopen" })] })] }) })), jsonModalRow && (_jsx("div", { className: "json-overlay", onClick: () => setJsonModalRow(null), children: _jsxs("div", { className: "json-modal", onClick: e => e.stopPropagation(), children: [_jsxs("div", { className: "json-modal-header", children: [_jsxs("div", { className: "json-modal-title-wrap", children: [_jsx("span", { className: "json-modal-kicker", children: "Record details" }), _jsx("span", { className: "json-modal-title", children: toText(jsonModalRow['deviceName'] ?? jsonModalRow['displayName'] ?? jsonModalRow['name'] ?? jsonModalRow['id'] ?? 'Row') })] }), _jsxs("div", { className: "json-modal-actions", children: [_jsxs("button", { className: "btn btn-secondary json-copy-btn", onClick: () => {
                                                navigator.clipboard.writeText(JSON.stringify(jsonModalRow, null, 2));
                                                addToast('success', 'JSON copied!');
                                            }, children: [_jsx("span", { className: "json-copy-icon", children: "\uD83D\uDCCB" }), _jsx("span", { children: "Copy JSON" })] }), _jsx("button", { className: "json-close-btn", onClick: () => setJsonModalRow(null), children: "\u2715" })] })] }), _jsxs("div", { className: "json-body", children: [_jsxs("div", { className: "record-summary-grid", children: [_jsxs("div", { className: "record-summary-card", children: [_jsx("div", { className: "record-summary-label", children: "Device" }), _jsx("div", { className: "record-summary-value", children: toText(jsonModalRow['deviceName'] ?? jsonModalRow['displayName'] ?? jsonModalRow['name'] ?? 'Unknown') })] }), _jsxs("div", { className: "record-summary-card", children: [_jsx("div", { className: "record-summary-label", children: "Platform" }), _jsx("div", { className: "record-summary-value", children: toText(jsonModalRow['operatingSystem'] ?? jsonModalRow['platform'] ?? 'Unknown') })] }), _jsxs("div", { className: "record-summary-card", children: [_jsx("div", { className: "record-summary-label", children: "Compliance" }), _jsx("div", { className: "record-summary-value", children: toText(jsonModalRow['complianceState'] ?? jsonModalRow['status'] ?? 'Unknown') })] }), _jsxs("div", { className: "record-summary-card", children: [_jsx("div", { className: "record-summary-label", children: "Last sync" }), _jsx("div", { className: "record-summary-value", children: formatDateTimeDisplay(jsonModalRow['lastSyncDateTime'] ?? jsonModalRow['lastCheckInTime'] ?? jsonModalRow['enrolledDateTime'] ?? 'Unknown') }), _jsxs("div", { className: "record-summary-sub-row", children: [_jsx("div", { className: "record-summary-sub", children: formatTimeDisplay(jsonModalRow['lastSyncDateTime'] ?? jsonModalRow['lastCheckInTime'] ?? jsonModalRow['enrolledDateTime'] ?? '') }), _jsx("div", { className: "record-summary-pill", children: formatRelativeTime(jsonModalRow['lastSyncDateTime'] ?? jsonModalRow['lastCheckInTime'] ?? jsonModalRow['enrolledDateTime'] ?? '') })] })] })] }), _jsx("div", { className: "record-detail-list", children: Object.entries(jsonModalRow).map(([key, value]) => (_jsxs("div", { className: "record-detail-row", children: [_jsx("div", { className: "record-detail-key", children: key.replace(/([A-Z])/g, ' $1').trim() }), _jsx("div", { className: "record-detail-value", children: isDateLikeHeader(key) && isLikelyIsoDate(value)
                                                    ? (_jsxs("div", { className: "datetime-cell datetime-cell-inline", children: [_jsx("div", { className: "datetime-main", children: formatDateTimeDisplay(value) }), _jsxs("div", { className: "datetime-sub-row", children: [_jsx("div", { className: "datetime-sub", children: formatTimeDisplay(value) }), _jsx("div", { className: "datetime-relative-pill", children: formatRelativeTime(value) })] })] }))
                                                    : toText(value) || '—' })] }, key))) }), _jsxs("details", { className: "json-raw-section", children: [_jsxs("summary", { className: "json-raw-summary", children: [_jsxs("div", { children: [_jsx("div", { className: "json-raw-title", children: "Raw JSON" }), _jsx("div", { className: "json-raw-subtitle", children: "Open only when you need the full payload." })] }), _jsx("span", { className: "json-raw-toggle", children: "Expand" })] }), _jsx("pre", { className: "json-pre", children: JSON.stringify(jsonModalRow, null, 2) })] })] })] }) }))] }));
}
//# sourceMappingURL=App.js.map