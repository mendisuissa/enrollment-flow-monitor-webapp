import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { asString, safeDate } from '../utils/safe.js';
import { graphList, graphRequest } from './graphClient.js';
export class GraphDataError extends Error {
    context;
    causeMessage;
    constructor(context, causeMessage) {
        super(`${context}: ${causeMessage}`);
        this.name = 'GraphDataError';
        this.context = context;
        this.causeMessage = causeMessage;
    }
}
async function loadFixture(name) {
    const fixturePath = path.resolve(process.cwd(), 'apps', 'api', 'fixtures', name);
    const raw = await fs.readFile(fixturePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
}
function mapApp(item) {
    return {
        id: asString(item.id),
        displayName: asString(item.displayName),
        publisher: asString(item.publisher),
        platform: asString(item['@odata.type'] ?? item.platform, 'unknown'),
        lastModifiedDateTime: safeDate(item.lastModifiedDateTime)
    };
}
function mapDevice(item) {
    const joinType = asString(item.joinType ?? item.azureADJoinType ?? item.managedDeviceOwnerType ?? item.deviceOwnership, '');
    return {
        id: asString(item.id),
        deviceName: asString(item.deviceName),
        operatingSystem: asString(item.operatingSystem),
        osVersion: asString(item.osVersion),
        complianceState: asString(item.complianceState, 'unknown'),
        lastSyncDateTime: safeDate(item.lastSyncDateTime),
        userDisplayName: asString(item.userDisplayName),
        userPrincipalName: asString(item.userPrincipalName),
        serialNumber: asString(item.serialNumber, ''),
        joinType,
        deviceEnrollmentType: asString(item.deviceEnrollmentType, '')
    };
}
function mapUser(item) {
    return {
        id: asString(item.id),
        displayName: asString(item.displayName),
        userPrincipalName: asString(item.userPrincipalName),
        mail: asString(item.mail, '')
    };
}
function mapStatus(item, app, targetType) {
    const errorCode = asString(item.errorCode, 'Unknown');
    const errorDescription = asString(item.errorDescription, 'Unknown');
    const installState = asString(item.installState, asString(item.status, 'Unknown')).toLowerCase();
    return {
        id: asString(item.id),
        appId: app.id,
        appName: app.displayName,
        targetType,
        targetId: asString(item.deviceId ?? item.userId),
        targetName: asString(item.deviceDisplayName ?? item.userDisplayName, 'Unknown'),
        installState,
        errorCode,
        errorDescription,
        lastReportedDateTime: safeDate(item.lastReportedDateTime),
        normalizedCategory: 'Unknown',
        cause: 'Unknown',
        confidence: 0,
        recommendedActions: []
    };
}
function isExpectedGraphTenantError(err) {
    const msg = String(err?.message ?? '');
    return (msg.includes('Request not applicable to target tenant') ||
        msg.includes('BadRequest') ||
        msg.includes('Forbidden') ||
        msg.includes('Application is not authorized') ||
        msg.includes('Resource not found for the segment'));
}
function simplifyGraphError(err) {
    const raw = String(err?.message ?? err ?? 'Unknown Graph error');
    return raw
        .replace(/^Graph request failed \((\d+)\) on [^:]+:\s*/i, 'Graph $1: ')
        .replace(/\s+/g, ' ')
        .trim();
}
async function safeGraphList(accessToken, url, options = {}) {
    try {
        return await graphList(accessToken, url);
    }
    catch (err) {
        if (options.swallowExpected && isExpectedGraphTenantError(err))
            return [];
        throw new GraphDataError(options.context ?? url, simplifyGraphError(err));
    }
}
async function getGraphApps(accessToken) {
    const v1 = await safeGraphList(accessToken, '/v1.0/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime', { swallowExpected: true, context: 'Loading mobile apps from Graph' });
    if (v1.length > 0)
        return v1.map(mapApp);
    const beta = await safeGraphList(accessToken, '/beta/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime', { swallowExpected: true, context: 'Loading mobile apps from Graph beta endpoint' });
    return beta.map(mapApp);
}
async function getGraphAppStatuses(accessToken, apps) {
    const rows = [];
    for (const app of apps) {
        let deviceStatuses = [];
        let userStatuses = [];
        try {
            const deviceStatusesV1 = await safeGraphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`, { swallowExpected: true, context: `Loading device statuses for app ${app.displayName}` });
            deviceStatuses = deviceStatusesV1.length
                ? deviceStatusesV1
                : await safeGraphList(accessToken, `/beta/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`, {
                    swallowExpected: true,
                    context: `Loading beta device statuses for app ${app.displayName}`
                });
        }
        catch (err) {
            const msg = String(err?.message ?? err);
            if (msg.includes("Resource not found for the segment 'deviceStatuses'") ||
                msg.includes('deviceStatuses')) {
                deviceStatuses = [];
            }
            else {
                throw err;
            }
        }
        try {
            const userStatusesV1 = await safeGraphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${app.id}/userStatuses`, { swallowExpected: true, context: `Loading user statuses for app ${app.displayName}` });
            userStatuses = userStatusesV1.length
                ? userStatusesV1
                : await safeGraphList(accessToken, `/beta/deviceAppManagement/mobileApps/${app.id}/userStatuses`, {
                    swallowExpected: true,
                    context: `Loading beta user statuses for app ${app.displayName}`
                });
        }
        catch (err) {
            const msg = String(err?.message ?? err);
            if (msg.includes("Resource not found for the segment 'userStatuses'") ||
                msg.includes('userStatuses')) {
                userStatuses = [];
            }
            else {
                throw err;
            }
        }
        rows.push(...deviceStatuses.map((x) => mapStatus(x, app, 'device')));
        rows.push(...userStatuses.map((x) => mapStatus(x, app, 'user')));
    }
    return rows;
}
async function getGraphUsers(accessToken) {
    const users = await safeGraphList(accessToken, '/v1.0/users?$select=id,displayName,userPrincipalName,mail', {
        swallowExpected: true,
        context: 'Loading users from Graph'
    });
    if (users.length > 0)
        return users.map(mapUser);
    try {
        const me = await graphRequest(accessToken, '/v1.0/me?$select=id,displayName,userPrincipalName,mail');
        return me?.id ? [mapUser(me)] : [];
    }
    catch {
        return [];
    }
}
async function getGraphDevices(accessToken) {
    const attempts = [
        {
            url: '/v1.0/deviceManagement/managedDevices?$top=200&$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName,serialNumber,deviceEnrollmentType',
            context: 'Loading managed devices from Graph (v1.0 selected fields)'
        },
        {
            url: '/v1.0/deviceManagement/managedDevices?$top=200&$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName,serialNumber',
            context: 'Loading managed devices from Graph (v1.0 reduced field set)'
        },
        {
            url: '/v1.0/deviceManagement/managedDevices?$top=200',
            context: 'Loading managed devices from Graph (v1.0 full payload fallback)'
        },
        {
            url: '/beta/deviceManagement/managedDevices?$top=200&$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName,serialNumber,deviceEnrollmentType,joinType',
            context: 'Loading managed devices from Graph beta fallback'
        }
    ];
    let lastError = null;
    for (const attempt of attempts) {
        try {
            const devices = await safeGraphList(accessToken, attempt.url, { context: attempt.context });
            return devices.map(mapDevice);
        }
        catch (error) {
            lastError = error instanceof GraphDataError
                ? error
                : new GraphDataError(attempt.context, simplifyGraphError(error));
        }
    }
    throw new GraphDataError('Loading managed devices from Graph', lastError?.causeMessage ?? 'Unknown failure while calling managedDevices.');
}
export async function getDataBundle(accessToken) {
    if (config.mockMode || !accessToken) {
        const [apps, appStatuses, users, devices] = await Promise.all([
            loadFixture('apps.json'),
            loadFixture('appStatuses.json'),
            loadFixture('users.json'),
            loadFixture('devices.json')
        ]);
        return { apps, appStatuses, users, devices };
    }
    const apps = await getGraphApps(accessToken);
    let appStatuses = [];
    try {
        appStatuses = await getGraphAppStatuses(accessToken, apps);
    }
    catch (err) {
        console.error('App statuses load failed:', err?.message ?? err);
        appStatuses = [];
    }
    const [users, devices] = await Promise.all([
        getGraphUsers(accessToken),
        getGraphDevices(accessToken)
    ]);
    return { apps, appStatuses, users, devices };
}
//# sourceMappingURL=provider.js.map