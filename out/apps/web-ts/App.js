import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, copyRunbook, getAuthStatus, getLogs, getView, refreshData } from './api/client.js';
import { recognize } from 'tesseract.js';
const views = [
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
    { id: 'settings', label: 'Settings', icon: '⚙️' }
];
function toText(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'object')
        return JSON.stringify(value, null, 2);
    return String(value);
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
    const [auth, setAuth] = useState({ connected: false, upn: '', tenantId: '', displayName: '' });
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
        }
        catch {
            setAuth({ connected: false, upn: '', tenantId: '', displayName: '' });
        }
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
        try {
            setIsViewLoading(true);
            const result = await getView(view);
            const safeRows = Array.isArray(result.rows) ? result.rows : [];
            setRows(safeRows);
            setSelectedIndex(safeRows.length > 0 ? 0 : null);
            setStatusMessage(result.message || `${view} loaded.`);
            if (safeRows.length === 0) {
                setDetailsSummary('No data returned for this view.');
                setDetailsText('The endpoint returned an empty dataset. This is handled safely.');
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
            setStatusMessage(error instanceof Error ? error.message : 'Failed to load view.');
            setDetailsSummary('Load failed');
            setDetailsText('Friendly error handling kept the UI stable.');
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
            setStatusMessage('Enrollment Error Catalog: Not implemented yet.');
            setDetailsSummary('Enrollment Error Catalog');
            setDetailsText('This feature will show a catalog of known enrollment errors and solutions.');
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
            await refreshData();
            await loadView(currentView);
            addToast('success', 'Data refreshed.');
        }
        catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Refresh failed');
            addToast('error', 'Refresh failed.');
        }
        finally {
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
    function onExport(format) {
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
            const cause = typeof payload.cause === 'string' && payload.cause.trim().length > 0 ? payload.cause : 'No explicit cause returned by analyzer.';
            const actions = Array.isArray(payload.recommendedActions) ? payload.recommendedActions.filter((action) => typeof action === 'string' && action.trim().length > 0) : [];
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
            const fallback = [
                'Explanation failed.',
                `Reason: ${message}`,
                'Try pasting only the exact error sentence and run again.'
            ].join('\n');
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
    // Detect mobile
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches;
    return (_jsxs("div", { className: "app-shell", children: [isMobile && (_jsxs("div", { className: "surface topbar flex items-center justify-between", children: [_jsx("div", { className: "text-xl font-semibold", children: "Enrollment Flow Monitor Web App" }), _jsx("button", { className: "px-3 py-2 rounded bg-slate-900 text-white", onClick: () => setSidebarOpen(true), children: "\u2630" })] })), _jsxs("div", { className: "surface topbar", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("img", { src: "/logo.png", alt: "Modern Endpoint logo", className: "h-10 w-auto rounded" }), _jsxs("div", { children: [_jsx("div", { className: "text-2xl font-semibold tracking-tight", children: "Enrollment Flow Monitor Web App" }), _jsx("div", { className: "topbar-subtitle", children: auth.connected ? `Signed in: ${auth.upn} | Tenant: ${auth.tenantId || 'Unknown'}` : 'Not connected' })] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { className: "btn btn-secondary", onClick: onCycleTheme, children: ["Theme: ", themePreference === 'system' ? `System (${effectiveTheme})` : themePreference] }), !auth.connected ? (_jsx("button", { className: "btn btn-primary", onClick: () => { window.location.href = '/api/auth/login'; }, children: "Sign in" })) : (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-primary", onClick: onRefresh, disabled: isRefreshing, children: isRefreshing ? 'Refreshing...' : 'Refresh' }), _jsxs("div", { className: "user-menu", children: [_jsx("button", { className: "btn btn-secondary", onClick: () => setIsUserMenuOpen((current) => !current), children: auth.displayName || auth.upn || 'Account' }), isUserMenuOpen && (_jsxs("div", { className: "user-menu-pop", children: [_jsx("div", { className: "menu-user", children: auth.upn || 'Connected user' }), _jsx("button", { className: "btn btn-danger", onClick: onDisconnect, children: "Disconnect" })] }))] })] }))] })] }), _jsxs("div", { className: isMobile ? "flex flex-col gap-3" : "content-grid", children: [isMobile ? (sidebarOpen && (_jsx("div", { ref: sidebarRef, className: "fixed inset-0 bg-black bg-opacity-40 z-50 flex", onClick: () => setSidebarOpen(false), children: _jsx("div", { className: "panel w-64 h-full overflow-auto", onClick: e => e.stopPropagation(), children: _jsxs("div", { className: "nav-list", children: [views.map((view) => (_jsxs("button", { className: `nav-btn ${currentView === view.id ? 'active' : ''}`, onClick: () => { setCurrentView(view.id); setSidebarOpen(false); }, children: [_jsx("span", { className: `nav-icon ${view.id === 'windowsEnrollment' ? 'nav-icon-device' : ''}`, children: view.icon }), _jsx("span", { children: view.label })] }, view.id))), _jsx("div", { className: "section-divider" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => { onExport('csv'); setSidebarOpen(false); }, disabled: !auth.connected, children: "Export CSV" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => { onExport('json'); setSidebarOpen(false); }, disabled: !auth.connected, children: "Export JSON" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => { onCopyRunbook(); setSidebarOpen(false); }, disabled: !auth.connected, children: "Copy Runbook" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => { onOpenLogs(); setSidebarOpen(false); }, disabled: !auth.connected, children: "Open Logs" })] }) }) }))) : (_jsx("div", { className: "panel", children: _jsxs("div", { className: "nav-list", children: [views.map((view) => (_jsxs("button", { className: `nav-btn ${currentView === view.id ? 'active' : ''}`, onClick: () => setCurrentView(view.id), children: [_jsx("span", { className: `nav-icon ${view.id === 'windowsEnrollment' ? 'nav-icon-device' : ''}`, children: view.icon }), _jsx("span", { children: view.label })] }, view.id))), _jsx("div", { className: "section-divider" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => onExport('csv'), disabled: !auth.connected, children: "Export CSV" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: () => onExport('json'), disabled: !auth.connected, children: "Export JSON" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: onCopyRunbook, disabled: !auth.connected, children: "Copy Runbook" }), _jsx("button", { className: "btn btn-secondary text-left", onClick: onOpenLogs, disabled: !auth.connected, children: "Open Logs" })] }) })), _jsx("div", { className: "panel", children: !auth.connected ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-title", children: "Public preview enabled" }), _jsx("div", { children: "Sign in to load live tenant data for this view." })] })) : currentView === 'ocr' ? (_jsxs("div", { className: "ocr-shell", children: [_jsxs("div", { className: "ocr-head", children: [_jsxs("div", { children: [_jsx("div", { className: "ocr-title", children: "OCR & Error Assistant" }), _jsx("div", { className: "ocr-subtitle", children: "Upload a screenshot or paste an error, then get actionable remediation guidance." })] }), _jsx("span", { className: `status-badge ${statusKind(ocrStatusText)}`, children: ocrStatusText })] }), _jsx("input", { ref: fileInputRef, type: "file", accept: "image/*", className: "hidden", onChange: (event) => {
                                        const file = event.target.files?.[0] ?? null;
                                        setOcrImageFile(file);
                                        if (file) {
                                            setOcrStatusText(`OCR: Image selected (${file.name})`);
                                            setStatusMessage('Image selected. Click Run OCR or type text manually.');
                                        }
                                    } }), _jsxs("div", { className: "ocr-actions", children: [_jsx("button", { className: "btn btn-secondary", onClick: onPickImage, disabled: ocrBusy, children: "Pick Image" }), _jsx("button", { className: "btn btn-secondary", onClick: onRunOcr, disabled: ocrBusy, children: "Run OCR" }), _jsx("button", { className: "btn btn-primary", onClick: onGetOcrExplanation, disabled: ocrBusy, children: "Get Explanation" })] }), _jsxs("div", { className: "ocr-grid", children: [_jsxs("div", { className: "ocr-card", children: [_jsx("h4", { children: "OCR / Manual Input" }), _jsx("textarea", { className: "textarea", style: { minHeight: 250 }, placeholder: "Paste error text manually or run OCR from image...", value: ocrInputText, onChange: (event) => setOcrInputText(event.target.value) })] }), _jsxs("div", { className: "ocr-card", children: [_jsx("h4", { children: "Assistant Answer" }), _jsx("textarea", { className: "textarea", style: { minHeight: 250 }, value: ocrAssistantAnswer, readOnly: true, placeholder: "No explanation yet. Pick image or paste text, then click Get Explanation." })] })] })] })) : (isViewLoading ? (_jsxs("div", { children: [_jsx("div", { className: "skeleton" }), _jsx("div", { className: "skeleton" }), _jsx("div", { className: "skeleton" }), _jsx("div", { className: "skeleton" })] })) : rows.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-title", children: "No rows returned" }), _jsx("div", { children: statusMessage || 'No data for this view.' })] })) : (_jsxs("table", { className: "data-table", children: [_jsx("thead", { children: _jsx("tr", { children: headers.map((header) => (_jsx("th", { children: header }, header))) }) }), _jsx("tbody", { children: rows.map((row, index) => (_jsx("tr", { className: `table-row ${selectedIndex === index ? 'active' : ''}`, onClick: () => setSelectedIndex(index), children: headers.map((header) => (_jsx("td", { children: toText(row[header]) }, `${index}-${header}`))) }, String(row['id'] ?? index)))) })] }))) }), _jsxs("div", { className: "panel", children: [_jsx("div", { className: "font-semibold text-xl mb-2", children: "Summary" }), _jsx("div", { className: "text-sm mb-3", style: { color: 'var(--text-muted)' }, children: currentView === 'ocr' ? 'OCR Assistant Answer' : detailsSummary }), _jsx("div", { className: "font-semibold text-xl mb-2", children: "Details" }), _jsx("pre", { className: "text-xs whitespace-pre-wrap rounded-lg p-3", style: { background: 'var(--bg)', border: '1px solid var(--border)' }, children: currentView === 'ocr' ? (ocrAssistantAnswer || 'No explanation yet. Pick image or paste text, then click Get Explanation.') : detailsText })] })] }), _jsxs("div", { className: "surface footer", children: [_jsx("div", { className: `status-badge ${statusKind(statusMessage)}`, children: statusMessage }), _jsx("div", { children: "All rights reserved to modern endpoint.tech (by Menahem Suissa)." })] }), toasts.length > 0 && (_jsx("div", { className: "toast-wrap", children: toasts.map((toast) => (_jsx("div", { className: `toast ${toast.kind}`, children: toast.message }, toast.id))) }))] }));
}
//# sourceMappingURL=App.js.map