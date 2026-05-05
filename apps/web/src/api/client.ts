import axios from 'axios';
import type { IncidentWorkflowRecord, IncidentWorkflowStatus } from '@efm/shared';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true
});

// Redirect to login on any 401 — covers both token expiry and session loss (e.g. after server restart)
api.interceptors.response.use(
  response => response,
  error => {
    const status = error?.response?.status;
    if (status === 401) {
      window.location.href = '/api/auth/login';
      return new Promise(() => {}); // prevent error propagation
    }
    return Promise.reject(error);
  }
);

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

export async function getIncidentWorkflows() {
  const response = await api.get('/incidents/workflows');
  return response.data as { rows: IncidentWorkflowRecord[] };
}

export async function saveIncidentWorkflow(signature: string, payload: { owner: string; status: IncidentWorkflowStatus; notes: string }) {
  const response = await api.post(`/incidents/${encodeURIComponent(signature)}/workflow`, payload);
  return response.data as IncidentWorkflowRecord;
}

export async function graphProxy(url: string) {
  const response = await api.post('/graph/proxy', { url });
  return response.data;
}

export async function getEnrollmentFailures() {
  const response = await api.get('/graph/enrollment-failures');
  return response.data as { rows: Record<string, unknown>[]; message: string };
}

export async function deviceRetire(deviceId: string) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/retire`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message ?? 'Retire failed.');
  return res.json();
}

export async function deviceWipe(deviceId: string, keepEnrollmentData = false) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/wipe`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepEnrollmentData }) });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message ?? 'Wipe failed.');
  return res.json();
}

export async function deviceCollectDiagnostics(deviceId: string) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/collectDiagnostics`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message ?? 'Collect diagnostics failed.');
  return res.json();
}

export async function deviceRotateBitLockerKeys(deviceId: string) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/rotateBitLockerKeys`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message ?? 'BitLocker key rotation failed.');
  return res.json();
}

export async function deviceResetPasscode(deviceId: string) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/resetPasscode`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message ?? 'Reset passcode failed.');
  return res.json();
}
