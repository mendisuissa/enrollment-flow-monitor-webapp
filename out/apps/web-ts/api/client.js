import axios from 'axios';
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
export const api = axios.create({
    baseURL: apiBaseUrl,
    withCredentials: true
});
export async function getAuthStatus() {
    const response = await api.get('/auth/status');
    return response.data;
}
export async function getView(view) {
    const response = await api.get(`/view/${view}`);
    return response.data;
}
export async function refreshData() {
    const response = await api.get('/refresh');
    return response.data;
}
export async function copyRunbook(row) {
    const response = await api.post('/runbook', row ?? {});
    return response.data;
}
export async function getLogs() {
    const response = await api.get('/logs');
    return response.data;
}
// ── Device Remediation Actions ────────────────────────────
export async function deviceSync(deviceId) {
    const response = await api.post(`/devices/${deviceId}/sync`);
    return response.data;
}
export async function deviceReboot(deviceId) {
    const response = await api.post(`/devices/${deviceId}/reboot`);
    return response.data;
}
export async function deviceAutopilotReset(deviceId) {
    const response = await api.post(`/devices/${deviceId}/autopilotReset`);
    return response.data;
}
export async function deviceBulkAction(deviceIds, action) {
    const response = await api.post('/devices/bulk', { deviceIds, action });
    return response.data;
}
export function getExportUrl(view, format) {
    const base = apiBaseUrl || '/api';
    return `${base}/export?view=${encodeURIComponent(view)}&format=${encodeURIComponent(format)}`;
}
export async function getIncidentWorkflows() {
    const response = await api.get('/incidents/workflows');
    return response.data;
}
export async function saveIncidentWorkflow(signature, payload) {
    const response = await api.post(`/incidents/${encodeURIComponent(signature)}/workflow`, payload);
    return response.data;
}
export async function graphProxy(url) {
    const response = await api.post('/graph/proxy', { url });
    return response.data;
}
export async function getEnrollmentFailures() {
    const response = await api.get('/graph/enrollment-failures');
    return response.data;
}
export async function deviceRetire(deviceId) {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/retire`, { method: 'POST', credentials: 'include' });
    if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).message ?? 'Retire failed.');
    return res.json();
}
export async function deviceWipe(deviceId, keepEnrollmentData = false) {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/wipe`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepEnrollmentData }) });
    if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).message ?? 'Wipe failed.');
    return res.json();
}
export async function deviceCollectDiagnostics(deviceId) {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/collectDiagnostics`, { method: 'POST', credentials: 'include' });
    if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).message ?? 'Collect diagnostics failed.');
    return res.json();
}
export async function deviceRotateBitLockerKeys(deviceId) {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/rotateBitLockerKeys`, { method: 'POST', credentials: 'include' });
    if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).message ?? 'BitLocker key rotation failed.');
    return res.json();
}
export async function deviceResetPasscode(deviceId) {
    const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/resetPasscode`, { method: 'POST', credentials: 'include' });
    if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).message ?? 'Reset passcode failed.');
    return res.json();
}
//# sourceMappingURL=client.js.map