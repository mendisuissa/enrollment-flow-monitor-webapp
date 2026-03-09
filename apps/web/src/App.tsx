import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ViewName } from '@efm/shared';
type ExtendedViewName = ViewName | 'permissionCheck' | 'enrollmentErrorCatalog';
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

  // Detect mobile - reactive
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="app-shell">
      <div className="surface topbar">
        <div className="topbar-left">
          <div className="logo-pill">
            <img src="/logo.png" alt="Modern Endpoint logo" className="logo-img" />
            <div className="logo-text">
              <div className="logo-title">Modern Endpoint</div>
              <div className="logo-sub">Enterprise Architecture Journal</div>
            </div>
          </div>
          {!isMobile && (
            <div className="topbar-titles">
              <div className="topbar-title">Enrollment Flow Monitor Web App</div>
              <div className="topbar-subtitle">
                {auth.connected ? `Signed in: ${auth.upn}` : 'Not connected'}
              </div>
            </div>
          )}
        </div>
        <div className="topbar-actions">
          {isMobile ? (
            <button className="btn btn-hamburger" onClick={() => setSidebarOpen(true)}>☰</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onCycleTheme}>
                Theme: {themePreference === 'system' ? `System (${effectiveTheme})` : themePreference}
              </button>
              {!auth.connected ? (
                <button className="btn btn-primary" onClick={() => { window.location.href = '/api/auth/login'; }}>Sign in</button>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={onRefresh} disabled={isRefreshing}>
                    {isRefreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <div className="user-menu">
                    <button className="btn btn-secondary" onClick={() => setIsUserMenuOpen((current) => !current)}>
                      {auth.displayName || auth.upn || 'Account'}
                    </button>
                    {isUserMenuOpen && (
                      <div className="user-menu-pop">
                        <div className="menu-user">{auth.upn || 'Connected user'}</div>
                        <button className="btn btn-danger" onClick={onDisconnect}>Disconnect</button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {isMobile && (
        <div className="mobile-action-bar surface">
          <div className="topbar-subtitle">
            {auth.connected ? `Signed in: ${auth.upn}` : 'Not connected'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={onCycleTheme}>Theme</button>
            {!auth.connected ? (
              <button className="btn btn-primary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => { window.location.href = '/api/auth/login'; }}>Sign in</button>
            ) : (
              <button className="btn btn-primary" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={onRefresh} disabled={isRefreshing}>
                {isRefreshing ? '...' : 'Refresh'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile sidebar drawer - outside content-grid, same as Intune pattern */}
      {isMobile && sidebarOpen && (
        <div className="sidebar-drawer-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="sidebar-drawer" onClick={e => e.stopPropagation()}>
            <button className="drawer-close-btn" onClick={() => setSidebarOpen(false)}>✕</button>
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
              <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8, textAlign: 'left' }} onClick={() => { onExport('csv'); setSidebarOpen(false); }} disabled={!auth.connected}>Export CSV</button>
              <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8, textAlign: 'left' }} onClick={() => { onExport('json'); setSidebarOpen(false); }} disabled={!auth.connected}>Export JSON</button>
              <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 8, textAlign: 'left' }} onClick={() => { onCopyRunbook(); setSidebarOpen(false); }} disabled={!auth.connected}>Copy Runbook</button>
              <button className="btn btn-secondary" style={{ width: '100%', textAlign: 'left' }} onClick={() => { onOpenLogs(); setSidebarOpen(false); }} disabled={!auth.connected}>Open Logs</button>
            </div>
          </div>
        </div>
      )}

      <div className="content-grid">
        {/* Sidebar - always in DOM, hidden on mobile via CSS */}
        <div className="panel sidebar">
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
          </div>
        </div>

        <div className="panel">
          {!auth.connected ? (
            <div className="empty-state">
              <div className="empty-state-title">Public preview enabled</div>
              <div>Sign in to load live tenant data for this view.</div>
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
              <table className="data-table">
                <thead>
                  <tr>
                    {headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr
                      key={String(row['id'] ?? index)}
                      className={`table-row ${selectedIndex === index ? 'active' : ''}`}
                      onClick={() => setSelectedIndex(index)}
                    >
                      {headers.map((header) => (
                        <td key={`${index}-${header}`}>{toText(row[header])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
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
    </div>
  );
}