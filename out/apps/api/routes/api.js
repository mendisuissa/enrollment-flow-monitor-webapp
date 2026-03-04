import { Router } from 'express';
import fs from 'fs/promises';
import { config } from '../config.js';
import { normalizeStatus } from '../engines/normalization.js';
import { buildIncidents } from '../engines/incidents.js';
import { getDataBundle } from '../graph/provider.js';
import { logger } from '../utils/logger.js';
import { PrismaIncidentRepository } from '../storage/incidentRepository.js';
const incidentRepo = new PrismaIncidentRepository();
function ensureConnected(req, res, next) {
    if (config.mockMode || req.session?.accessToken)
        return next();
    res.status(401).json({ message: 'Not connected. Click Connect first.' });
}
async function getViewData(accessToken) {
    const bundle = await getDataBundle(accessToken);
    // Normalize app status rows (if any)
    const statuses = [];
    for (const row of bundle.appStatuses ?? []) {
        const normalized = await normalizeStatus(row);
        statuses.push({
            ...row,
            normalizedCategory: normalized.normalizedCategory,
            cause: normalized.cause,
            confidence: normalized.confidence,
            recommendedActions: normalized.recommendedActions
        });
    }
    // Build + persist incidents (best effort)
    const incidents = buildIncidents(statuses);
    try {
        await incidentRepo.upsertMany(incidents);
    }
    catch (error) {
        logger.warn({ err: error }, 'Incident persistence failed; continuing with in-memory incidents.');
    }
    return {
        apps: bundle.apps ?? [],
        devices: bundle.devices ?? [],
        users: bundle.users ?? [],
        statuses,
        incidents
    };
}
function buildDashboard(data) {
    const windowsDevices = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('windows'));
    const mobileDevices = data.devices.filter((d) => {
        const os = (d.operatingSystem ?? '').toLowerCase();
        return os.includes('ios') || os.includes('android') || os.includes('ipados');
    });
    const macDevices = data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('mac'));
    const autopilotReady = windowsDevices.filter((d) => (d.complianceState ?? '').toLowerCase() === 'compliant');
    const userDriven = windowsDevices.filter((d) => (d.userPrincipalName ?? '').includes('@'));
    const automatic = windowsDevices.filter((d) => !(d.userPrincipalName ?? '').includes('@'));
    const stale = windowsDevices.filter((d) => {
        const stamp = Date.parse(d.lastSyncDateTime ?? '');
        if (Number.isNaN(stamp))
            return false;
        return (Date.now() - stamp) / (1000 * 60 * 60 * 24) > 7;
    }).length;
    return {
        totalDevices: data.devices.length,
        windowsEnrollmentDevices: windowsDevices.length,
        autopilotUserDrivenDevices: userDriven.length,
        autopilotAutomaticDevices: automatic.length,
        mobileEnrollmentDevices: mobileDevices.length,
        macEnrollmentDevices: macDevices.length,
        topEnrollmentStates: [
            { category: 'Compliant', count: autopilotReady.length },
            { category: 'Non-compliant', count: Math.max(0, windowsDevices.length - autopilotReady.length) },
            { category: 'Stale Sync (>7 days)', count: stale }
        ],
        lastRefresh: new Date().toISOString()
    };
}
function buildWindowsEnrollmentGrid(data) {
    return data.devices.map((device) => ({
        id: device.id,
        deviceName: device.deviceName,
        operatingSystem: device.operatingSystem,
        osVersion: device.osVersion,
        complianceState: device.complianceState,
        lastSyncDateTime: device.lastSyncDateTime,
        userPrincipalName: device.userPrincipalName,
        details: `Device: ${device.deviceName}\nOS: ${device.operatingSystem} ${device.osVersion}\nCompliance: ${device.complianceState}\nLast Sync: ${device.lastSyncDateTime}`
    }));
}
function buildAutopilotAllGrid(data) {
    return data.devices.map((device) => ({
        id: device.id,
        serialNumber: device.serialNumber ?? '-',
        deviceName: device.deviceName,
        userPrincipalName: device.userPrincipalName || '-',
        joinType: device.joinType ?? 'unknown',
        enrollmentType: device.deviceEnrollmentType ?? 'unknown',
        complianceState: device.complianceState,
        lastSyncDateTime: device.lastSyncDateTime,
        details: `Device: ${device.deviceName}\nUPN: ${device.userPrincipalName || '-'}\nJoin Type: ${device.joinType ?? 'unknown'}\nEnrollment Type: ${device.deviceEnrollmentType ?? 'unknown'}`
    }));
}
function buildAutopilotUserDrivenGrid(data) {
    return buildAutopilotAllGrid(data).filter((row) => String(row.userPrincipalName).includes('@'));
}
function buildAutopilotPreProvisioningGrid(data) {
    return buildAutopilotAllGrid(data).filter((row) => !String(row.userPrincipalName).includes('@'));
}
function buildOcrGrid(data) {
    const rows = data.statuses.map((row) => ({
        id: row.id,
        appName: row.appName,
        targetName: row.targetName,
        normalizedCategory: row.normalizedCategory || 'Unknown',
        confidence: row.confidence,
        errorCode: row.errorCode || 'Unknown',
        errorDescription: row.errorDescription || 'Unknown',
        cause: row.cause || 'Unknown',
        recommendedActions: (row.recommendedActions ?? []).join(' | '),
        details: `App: ${row.appName}\nTarget: ${row.targetName}\nCategory: ${row.normalizedCategory || 'Unknown'}\nCause: ${row.cause || 'Unknown'}\nConfidence: ${row.confidence}`
    }));
    if (rows.length > 0)
        return rows;
    // Fallback: show device baseline if app status telemetry is empty
    const deviceFallback = data.devices.slice(0, 200).map((device) => ({
        id: `device-ocr:${device.id}`,
        appName: 'Device Compliance Baseline',
        targetName: device.deviceName,
        normalizedCategory: (device.complianceState ?? '').toLowerCase() === 'compliant' ? 'DeviceHealth' : 'ComplianceRisk',
        confidence: (device.complianceState ?? '').toLowerCase() === 'compliant' ? 0.45 : 0.7,
        errorCode: (device.complianceState ?? '').toLowerCase() === 'compliant' ? '-' : 'DEVICE_NONCOMPLIANT',
        errorDescription: (device.complianceState ?? '').toLowerCase() === 'compliant' ? 'Compliant device baseline signal.' : 'Non-compliant device signal from managedDevices.',
        cause: (device.complianceState ?? '').toLowerCase() === 'compliant'
            ? 'Device is reporting compliant state; app-level telemetry is not currently available.'
            : `Device reports ${device.complianceState} compliance state.`,
        recommendedActions: (device.complianceState ?? '').toLowerCase() === 'compliant'
            ? 'Assign at least one required app and wait for Intune status telemetry to populate.'
            : 'Open device in Intune and review compliance policies and recent check-in.',
        details: `Device: ${device.deviceName}\nCompliance: ${device.complianceState}\nOS: ${device.operatingSystem} ${device.osVersion}\nLast Sync: ${device.lastSyncDateTime}`
    }));
    return deviceFallback.length
        ? deviceFallback
        : [{
                id: 'ocr-empty',
                appName: 'No OCR telemetry yet',
                targetName: '-',
                normalizedCategory: 'DataUnavailable',
                confidence: 0,
                errorCode: '-',
                errorDescription: 'No app installation status rows were returned from Graph.',
                cause: 'Either there are currently no app status events, or delegated permissions are not sufficient.',
                recommendedActions: 'Grant admin consent for required Graph delegated permissions and refresh again.',
                details: 'OCR needs app status telemetry. Verify Microsoft Graph delegated permissions and Intune app status availability.'
            }];
}
function buildPermissionCheck() {
    return [{
            id: 'permission-check',
            connected: Boolean(config.mockMode || true),
            mockMode: config.mockMode,
            configuredScopes: (config.entra?.scopes ?? []).join(' '),
            recommendedScopes: 'openid profile offline_access User.Read User.ReadBasic.All DeviceManagementManagedDevices.Read.All DeviceManagementApps.Read.All',
            details: `Configured scopes:\n${(config.entra?.scopes ?? []).join(' ')}\n\n` +
                `Recommended (Intune enrollment + app status):\n` +
                `DeviceManagementManagedDevices.Read.All\nDeviceManagementApps.Read.All\nUser.ReadBasic.All\n\n` +
                `Remember: delegated permissions require admin consent in Entra ID.`
        }];
}
function buildEnrollmentErrorCatalog() {
    return enrollmentErrorCatalog;
}
export const apiRouter = Router();
apiRouter.use(ensureConnected);
apiRouter.get('/debug/token', (req, res) => {
    const token = req.session?.accessToken;
    if (!token)
        return res.status(401).json({ connected: false });
    res.json({
        connected: true,
        user: req.session?.account ?? null,
        tokenPreview: token.slice(0, 40) + '...',
        scopes: (config.entra?.scopes ?? []).join(' ')
    });
});
// בדיקת Graph בסיסית (GET) כדי להבין אם הטננט באמת "חי"
apiRouter.get('/debug/graph', async (req, res) => {
    const token = req.session?.accessToken;
    if (!token)
        return res.status(401).json({ message: 'Not connected' });
    const p = typeof req.query.path === 'string' ? req.query.path : '/v1.0/organization';
    try {
        // פה אתה צריך להשתמש באותה פונקציה/Provider שיש לך ב-graph/provider.js
        // לדוגמה: const data = await graphGet(p, token);
        // אם אין לך graphGet – תגיד לי איך provider ממומש ואני אתאים שורה-בשורה.
        const data = await getDataBundle(token); // זמני: רק כדי לראות שזה בכלל עובד
        res.json({ ok: true, path: p, data });
    }
    catch (e) {
        res.status(500).json({ ok: false, message: e?.message ?? 'Graph failed' });
    }
});
apiRouter.get('/refresh', async (req, res) => {
    try {
        await getViewData(req.session.accessToken);
        res.json({ message: 'Refresh completed.' });
    }
    catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Refresh failed.' });
    }
});
apiRouter.get('/view/:view', async (req, res) => {
    try {
        const view = String(req.params.view);
        const data = await getViewData(req.session.accessToken);
        if (view === 'dashboard')
            return res.json({ rows: [buildDashboard(data)], message: 'Dashboard loaded.' });
        if (view === 'windowsAutopilot')
            return res.json({ rows: buildAutopilotAllGrid(data), message: 'Device Preparation (All) loaded.' });
        if (view === 'autopilotUserDriven')
            return res.json({ rows: buildAutopilotUserDrivenGrid(data), message: 'Device Preparation - User-Driven loaded.' });
        if (view === 'autopilotPreProvisioning')
            return res.json({ rows: buildAutopilotPreProvisioningGrid(data), message: 'Device Preparation - Automatic loaded.' });
        if (view === 'windowsEnrollment')
            return res.json({ rows: buildWindowsEnrollmentGrid(data), message: 'Windows Enrollment loaded.' });
        if (view === 'mobileEnrollment') {
            const mobileRows = data.devices
                .filter((d) => {
                const os = (d.operatingSystem ?? '').toLowerCase();
                return os.includes('ios') || os.includes('android') || os.includes('ipados');
            })
                .map((d) => ({
                id: d.id,
                deviceName: d.deviceName,
                operatingSystem: d.operatingSystem,
                osVersion: d.osVersion,
                complianceState: d.complianceState,
                lastSyncDateTime: d.lastSyncDateTime,
                userDisplayName: d.userDisplayName,
                userPrincipalName: d.userPrincipalName,
                details: `Device: ${d.deviceName}\nOS: ${d.operatingSystem} ${d.osVersion}\nCompliance: ${d.complianceState}\nUPN: ${d.userPrincipalName || '-'}\nLast Sync: ${d.lastSyncDateTime}`
            }));
            return res.json({ rows: mobileRows, message: 'Mobile Enrollment loaded.' });
        }
        if (view === 'macEnrollment')
            return res.json({ rows: [{ id: 'mac-coming-soon', status: 'Coming soon', details: 'macOS enrollment view is scaffolded.' }], message: 'macOS Enrollment loaded (scaffolded).' });
        if (view === 'ocr')
            return res.json({ rows: buildOcrGrid(data), message: 'OCR loaded.' });
        if (view === 'incidents')
            return res.json({ rows: data.incidents, message: data.incidents[0]?.isPlaceholder ? 'No active incidents in current window.' : 'Incidents loaded.' });
        if (view === 'settings') {
            const settings = {
                incidentWindowMinutes: config.incidentWindowMinutes,
                incidentThresholdCount: config.incidentThresholdCount,
                severityThresholds: config.severityThresholds,
                refreshIntervalSeconds: config.refreshIntervalSeconds,
                mockMode: config.mockMode
            };
            return res.json({ rows: [settings], message: 'Settings loaded.' });
        }
        // Extended views used by the UI
        if (String(req.params.view) === 'permissionCheck')
            return res.json({ rows: buildPermissionCheck(), message: 'Permission check loaded.' });
        if (String(req.params.view) === 'enrollmentErrorCatalog')
            return res.json({ rows: buildEnrollmentErrorCatalog(), message: 'Enrollment Error Catalog loaded.' });
        return res.status(400).json({ message: `Unsupported view: ${req.params.view}` });
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to load view.';
        return res.status(500).json({ message: msg });
    }
});
apiRouter.post('/runbook', async (req, res) => {
    const row = req.body;
    const actions = Array.isArray(row?.recommendedActions) ? row.recommendedActions : [];
    if ((row?.installState ?? '').toLowerCase().includes('fail') && actions.length > 0) {
        const runbook = actions.map((a, i) => `${i + 1}. ${a}`).join('\n');
        return res.json({ runbook });
    }
    return res.json({
        runbook: '1. Validate user licensing and MDM scope.\n' +
            '2. Re-check network/proxy/TLS path.\n' +
            '3. Inspect Intune + Entra logs around the timestamp.'
    });
});
apiRouter.get('/logs', async (_req, res) => {
    try {
        const raw = await fs.readFile(config.logFile, 'utf8');
        const lines = raw.split('\n').filter(Boolean);
        res.json({ rows: lines.slice(-200).map((line, index) => ({ id: String(index), line })), message: 'Log tail loaded.' });
    }
    catch {
        res.json({ rows: [{ id: '0', line: 'No logs found yet.' }], message: 'Logs unavailable.' });
    }
});
apiRouter.get('/logs/download', async (_req, res) => {
    try {
        const raw = await fs.readFile(config.logFile, 'utf8');
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename=app.log');
        res.send(raw);
    }
    catch {
        res.status(404).send('No logs available.');
    }
});
export default apiRouter;
//# sourceMappingURL=api.js.map