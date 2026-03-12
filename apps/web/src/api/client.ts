import axios from 'axios';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true
});

export interface ViewResponse {
  rows: Record<string, unknown>[];
  message: string;
}

export async function getAuthStatus() {
  const response = await api.get('/auth/status');
  return response.data as { connected: boolean; upn: string; tenantId: string; displayName: string; hasWritePermissions: boolean };
}

export async function getView(view: string): Promise<ViewResponse> {
  const response = await api.get(`/view/${view}`);
  return response.data as ViewResponse;
}

export async function refreshData() {
  const response = await api.get('/refresh');
  return response.data as { message: string };
}

export async function copyRunbook(row: Record<string, unknown> | null) {
  const response = await api.post('/runbook', row ?? {});
  return response.data as { runbook: string };
}

export async function getLogs() {
  const response = await api.get('/logs');
  return response.data as ViewResponse;
}

// ── Device Remediation Actions ────────────────────────────
export async function deviceSync(deviceId: string) {
  const response = await api.post(`/devices/${deviceId}/sync`);
  return response.data as { success: boolean; message: string };
}

export async function deviceReboot(deviceId: string) {
  const response = await api.post(`/devices/${deviceId}/reboot`);
  return response.data as { success: boolean; message: string };
}

export async function deviceAutopilotReset(deviceId: string) {
  const response = await api.post(`/devices/${deviceId}/autopilotReset`);
  return response.data as { success: boolean; message: string };
}

export async function deviceBulkAction(deviceIds: string[], action: 'sync' | 'reboot' | 'autopilotReset') {
  const response = await api.post('/devices/bulk', { deviceIds, action });
  return response.data as { success: boolean; results: Array<{ id: string; ok: boolean; error?: string }> };
}


export function getExportUrl(view: string, format: 'json' | 'csv') {
  const base = apiBaseUrl || '/api';
  return `${base}/export?view=${encodeURIComponent(view)}&format=${encodeURIComponent(format)}`;
}
