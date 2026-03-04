import { Router } from 'express';
import fs from 'fs/promises';
import { config } from '../config.js';
import { normalizeStatus } from '../engines/normalization.js';
import { buildIncidents } from '../engines/incidents.js';
import { getDataBundle } from '../graph/provider.js';
import { logger } from '../utils/logger.js';
import { toCsv } from '../utils/safe.js';
import { PrismaIncidentRepository } from '../storage/incidentRepository.js';
const incidentRepo = new PrismaIncidentRepository();
function ensureConnected(req, res, next) {
    if (config.mockMode || req.session?.accessToken) {
        next();
        return;
    }
    res.status(401).json({ message: 'Not connected. Click Connect first.' });
}
async function getViewData(accessToken) {
    const bundle = await getDataBundle(accessToken);
    const statuses = [];
    for (const row of bundle.appStatuses ?? []) {
        const normalized = await normalizeStatus(row);
        statuses.push({
            ...row,
            normalizedCategory: normalized.normalizedCategory,
            cause: normalized.cause,
            confidence: normalized.confidence,
            recommendedActions: normalized.recommendedActions,
            const: incidents = buildIncidents(statuses),
            try: {
                await: incidentRepo.upsertMany(incidents)
            }, catch(error) {
                logger.warn({ err: error }, 'Incident persistence failed; continuing with in-memory incidents.');
            },
            const: mergedUsers = new Map(),
            for(, user, of, bundle) { }, : .users ?? []
        });
        {
            const upn = (user.userPrincipalName ?? '').trim().toLowerCase();
            if (!upn) {
                continue;
            }
            mergedUsers.set(upn, {
                id: user.id,
                displayName: user.displayName,
                userPrincipalName: user.userPrincipalName,
                mail: user.mail
            });
        }
        for (const device of bundle.devices ?? []) {
            const upn = (device.userPrincipalName ?? '').trim().toLowerCase();
            if (!upn || mergedUsers.has(upn)) {
                continue;
            }
            mergedUsers.set(upn, {
                id: `device:${upn}`,
                displayName: device.userDisplayName || upn.split('@')[0],
                userPrincipalName: upn,
                mail: upn
            });
        }
        for (const status of statuses) {
            if (status.targetType !== 'user') {
                continue;
            }
            const candidate = (status.targetName ?? '').trim().toLowerCase();
            if (!candidate.includes('@') || mergedUsers.has(candidate)) {
                continue;
            }
            mergedUsers.set(candidate, {
                id: `status:${candidate}`,
                displayName: status.targetName,
                userPrincipalName: candidate,
                mail: candidate
            });
        }
        const users = Array.from(mergedUsers.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
        try {
            const view = String(req.params.view).toLowerCase();
            const data = await getViewData(req.session.accessToken);
            if (view === 'dashboard') {
                return res.json({ rows: [buildDashboard(data)], message: 'Dashboard loaded.' });
            }
            // ...existing code...
            return res.status(400).json({ message: `Unsupported view: ${view}` });
        }
        catch (error) {
            // Log the full error object
            console.error('API /view error:', error);
            if (error instanceof Error) {
                return res.status(500).json({ message: error.message, stack: error.stack, error });
            }
            else {
                return res.status(500).json({ message: 'Failed to load view.', error });
            }
        }
    }
    ;
    const macDevices = data.devices.filter((device) => (device.operatingSystem ?? '').toLowerCase().includes('mac'));
    const autopilotReady = windowsDevices.filter((device) => (device.complianceState ?? '').toLowerCase() === 'compliant');
    const userDriven = windowsDevices.filter((device) => (device.userPrincipalName ?? '').includes('@'));
    const automatic = windowsDevices.filter((device) => !(device.userPrincipalName ?? '').includes('@'));
    const enrollmentHealth = [
        { category: 'Compliant', count: autopilotReady.length },
        { category: 'Non-compliant', count: Math.max(0, windowsDevices.length - autopilotReady.length) },
        { category: 'Stale Sync (>7 days)', count: windowsDevices.filter((device) => {
                const stamp = Date.parse(device.lastSyncDateTime ?? '');
                if (Number.isNaN(stamp))
                    return false;
                return (Date.now() - stamp) / (1000 * 60 * 60 * 24) > 7;
            }).length }
    ];
    return {
        totalDevices: data.devices.length,
        windowsEnrollmentDevices: windowsDevices.length,
        autopilotUserDrivenDevices: userDriven.length,
        autopilotAutomaticDevices: automatic.length,
        mobileEnrollmentDevices: mobileDevices.length,
        macEnrollmentDevices: macDevices.length,
        topEnrollmentStates: enrollmentHealth,
        lastRefresh: new Date().toISOString()
    };
}
function buildDevicesGrid(data) {
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
function buildStaticComingSoonGrid(flow) {
    return [{
            id: `${flow.toLowerCase().replace(/\s+/g, '-')}-coming-soon`,
            flow,
            status: 'Coming next',
            details: `${flow} telemetry is scaffolded and will be connected in the next iteration.`
        }];
}
function buildStatusesGrid(data) {
    return data.statuses.map((row) => ({
        id: row.id,
        appName: row.appName,
        targetType: row.targetType,
        targetName: row.targetName,
        installState: row.installState,
        errorCode: row.errorCode || 'Unknown',
        errorDescription: row.errorDescription || 'Unknown',
        normalizedCategory: row.normalizedCategory || 'Unknown',
        confidence: row.confidence,
        lastReportedDateTime: row.lastReportedDateTime,
        recommendedActions: row.recommendedActions,
        details: `App: ${row.appName}\nState: ${row.installState}\nErrorCode: ${row.errorCode || 'Unknown'}\nErrorDescription: ${row.errorDescription || 'Unknown'}\nCategory: ${row.normalizedCategory || 'Unknown'}`
    }));
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
        recommendedActions: row.recommendedActions.join(' | '),
        details: `App: ${row.appName}\nTarget: ${row.targetName}\nCategory: ${row.normalizedCategory || 'Unknown'}\nCause: ${row.cause || 'Unknown'}\nConfidence: ${row.confidence}`
    }));
    if (rows.length > 0) {
        return rows;
    }
    const deviceFallback = data.devices
        .filter((device) => (device.deviceName ?? '').trim().length > 0)
        .slice(0, 200)
        .map((device) => {
        const compliance = (device.complianceState ?? 'unknown').toLowerCase();
        const isHealthy = compliance === 'compliant';
        const category = isHealthy ? 'DeviceHealth' : 'ComplianceRisk';
        const cause = isHealthy
            ? 'Device is reporting compliant state; app-level telemetry is not currently available.'
            : `Device reports ${device.complianceState} compliance state.`;
        return {
            id: `device-ocr:${device.id}`,
            appName: 'Device Compliance Baseline',
            targetName: device.deviceName,
            normalizedCategory: category,
            confidence: isHealthy ? 0.45 : 0.7,
            errorCode: isHealthy ? '-' : 'DEVICE_NONCOMPLIANT',
            errorDescription: isHealthy ? 'Compliant device baseline signal.' : 'Non-compliant device signal from managedDevices.',
            cause,
            recommendedActions: isHealthy
                ? 'Assign at least one required app and wait for Intune status telemetry to populate OCR app analysis.'
                : 'Open device in Intune and review compliance policies, app assignment state, and recent check-in.',
            details: `Device: ${device.deviceName}\nCompliance: ${device.complianceState}\nOS: ${device.operatingSystem} ${device.osVersion}\nLast Sync: ${device.lastSyncDateTime}`
        };
    });
    if (deviceFallback.length > 0) {
        return deviceFallback;
    }
    return [
        {
            id: 'ocr-empty',
            appName: 'No OCR telemetry yet',
            targetName: '-',
            normalizedCategory: 'DataUnavailable',
            confidence: 0,
            errorCode: '-',
            errorDescription: 'No app installation status rows were returned from Graph.',
            cause: 'Either there are currently no app status events, or delegated permissions are not sufficient.',
            recommendedActions: 'Grant admin consent for DeviceManagementApps.Read.All and refresh again.',
            details: 'OCR needs app status telemetry. Verify Microsoft Graph delegated permissions and Intune app assignment/status availability.'
        }
    ];
}
export const apiRouter = Router();
apiRouter.use(ensureConnected);
apiRouter.get('/refresh', async (req, res) => {
    try {
        const data = await getViewData(req.session.accessToken);
        const dashboard = buildDashboard(data);
        res.json({
            message: 'Refresh completed.',
            dashboard,
            counts: {
                windowsEnrollment: data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('windows')).length,
                mobileEnrollment: data.devices.filter((d) => {
                    const os = (d.operatingSystem ?? '').toLowerCase();
                    return os.includes('ios') || os.includes('android') || os.includes('ipados');
                }).length,
                macEnrollment: data.devices.filter((d) => (d.operatingSystem ?? '').toLowerCase().includes('mac')).length,
                incidents: data.incidents.length
            }
        });
    }
    catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Refresh failed.' });
    }
});
apiRouter.get('/view/:view', async (req, res) => {
    try {
        const view = String(req.params.view).toLowerCase();
        const data = await getViewData(req.session.accessToken);
        if (view === 'dashboard') {
            return res.json({ rows: [buildDashboard(data)], message: 'Dashboard loaded.' });
        }
        if (view === 'windowsautopilot') {
            const rows = buildAutopilotAllGrid(data);
            return res.json({ rows, message: rows.length ? 'Device Preparation (All) loaded.' : 'No enrollment devices returned by endpoint.' });
        }
        if (view === 'autopilotuserdriven') {
            const rows = buildAutopilotUserDrivenGrid(data);
            return res.json({ rows, message: rows.length ? 'Device Preparation - User-Driven loaded.' : 'No user-driven enrollment rows available.' });
        }
        if (view === 'autopilotpreprovisioning') {
            const rows = buildAutopilotPreProvisioningGrid(data);
            return res.json({ rows, message: rows.length ? 'Device Preparation - Automatic loaded.' : 'No automatic/pre-provisioning rows available.' });
        }
        if (view === 'windowsenrollment') {
            const rows = buildDevicesGrid(data);
            return res.json({ rows, message: rows.length ? 'Windows Enrollment loaded.' : 'No managed devices returned by endpoint.' });
        }
        if (view === 'mobileenrollment') {
            const rows = buildStaticComingSoonGrid('Mobile Enrollment');
            return res.json({ rows, message: 'Mobile Enrollment loaded (scaffolded).' });
        }
        if (view === 'macenrollment') {
            const rows = buildStaticComingSoonGrid('macOS Enrollment');
            return res.json({ rows, message: 'macOS Enrollment loaded (scaffolded).' });
        }
        if (view === 'ocr') {
            const rows = buildOcrGrid(data);
            const message = data.statuses.length
                ? 'OCR analysis loaded.'
                : (data.devices.length
                    ? 'OCR loaded from device compliance baseline because app install status telemetry is empty.'
                    : 'OCR loaded with diagnostics only. No app status telemetry returned; check Graph delegated permissions and Intune app status availability.');
            return res.json({ rows, message });
        }
        if (view === 'incidents') {
            return res.json({ rows: data.incidents, message: data.incidents[0]?.isPlaceholder ? 'No active incidents in current window.' : 'Incidents loaded.' });
        }
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
        return res.status(400).json({ message: `Unsupported view: ${view}` });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load view.';
        let friendly = message;
        if (message.includes('403')) {
            friendly = 'Endpoint access denied (403). Check Graph delegated permissions/admin consent.';
        }
        else if (message.includes('Request not applicable to target tenant')) {
            friendly = 'This view requires an Intune-enabled tenant. Please sign in with a supported account.';
        }
        return res.status(500).json({ message: friendly });
    }
});
apiRouter.get('/app-statuses', async (req, res) => {
    try {
        const data = await getViewData(req.session.accessToken);
        res.json({ rows: buildStatusesGrid(data), message: 'App statuses loaded.' });
    }
    catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load app statuses.' });
    }
});
apiRouter.get('/incidents/recent', async (_req, res) => {
    try {
        const rows = await incidentRepo.listRecent(50);
        res.json({ rows, message: 'Recent incidents loaded.' });
    }
    catch {
        res.json({ rows: [], message: 'Recent incidents unavailable.' });
    }
});
apiRouter.post('/runbook', async (req, res) => {
    const row = req.body;
    const actions = Array.isArray(row?.recommendedActions) ? row?.recommendedActions : [];
    if ((row?.installState ?? '').toLowerCase().includes('fail') && actions.length > 0) {
        const runbook = actions.map((action, index) => `${index + 1}. ${action}`).join('\n');
        return res.json({ runbook });
    }
    return res.json({ runbook: '1. Validate user licensing and MDM scope.\n2. Re-check network/proxy/TLS path.\n3. Inspect Intune + Entra logs around the timestamp.' });
});
apiRouter.post('/ocr/explain', async (req, res) => {
    try {
        const input = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!input) {
            return res.status(400).json({ message: 'Provide OCR/manual text before analysis.' });
        }
        const syntheticRow = {
            id: 'manual-ocr-input',
            appId: 'manual',
            appName: 'Manual OCR Input',
            targetType: 'device',
            targetId: 'manual',
            targetName: 'Manual',
            installState: 'failed',
            errorCode: input,
            errorDescription: input,
            lastReportedDateTime: new Date().toISOString(),
            normalizedCategory: 'Unknown',
            cause: 'Unknown',
            confidence: 0,
            recommendedActions: []
        };
        const explanation = await normalizeStatus(syntheticRow);
        return res.json({
            category: explanation.normalizedCategory,
            confidence: explanation.confidence,
            cause: explanation.cause,
            recommendedActions: explanation.recommendedActions,
            evidence: explanation.evidence
        });
    }
    catch (error) {
        return res.status(500).json({ message: error instanceof Error ? error.message : 'OCR explanation failed.' });
    }
});
apiRouter.get('/export', async (req, res) => {
    try {
        const view = String(req.query.view ?? 'dashboard').toLowerCase();
        const format = String(req.query.format ?? 'json').toLowerCase();
        const data = await getViewData(req.session.accessToken);
        let rows = [];
        switch (view) {
            case 'windowsautopilot':
                rows = buildAutopilotAllGrid(data);
                break;
            case 'autopilotuserdriven':
                rows = buildAutopilotUserDrivenGrid(data);
                break;
            case 'autopilotpreprovisioning':
                rows = buildAutopilotPreProvisioningGrid(data);
                break;
            case 'windowsenrollment':
                rows = buildDevicesGrid(data);
                break;
            case 'mobileenrollment':
                rows = buildStaticComingSoonGrid('Mobile Enrollment');
                break;
            case 'macenrollment':
                rows = buildStaticComingSoonGrid('macOS Enrollment');
                break;
            case 'ocr':
                rows = buildOcrGrid(data);
                break;
            case 'incidents':
                rows = data.incidents;
                break;
            case 'settings':
                rows = [{ ...config.severityThresholds, mockMode: config.mockMode }];
                break;
            case 'dashboard':
            default:
                rows = [buildDashboard(data)];
                break;
        }
        if (format === 'csv') {
            const csv = toCsv(rows);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=${view}.csv`);
            return res.send(csv);
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=${view}.json`);
        return res.send(JSON.stringify(rows, null, 2));
    }
    catch (error) {
        return res.status(500).json({ message: error instanceof Error ? error.message : 'Export failed.' });
    }
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
//# sourceMappingURL=api.js.map