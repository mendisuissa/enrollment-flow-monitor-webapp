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
//# sourceMappingURL=client.js.map