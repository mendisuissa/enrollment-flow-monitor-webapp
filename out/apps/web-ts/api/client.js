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
//# sourceMappingURL=client.js.map