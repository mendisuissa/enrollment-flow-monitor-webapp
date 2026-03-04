import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { asString, safeDate } from '../utils/safe.js';
import { graphList, graphRequest } from './graphClient.js';
async function loadFixture(name) {
    const fixturePath = path.resolve(process.cwd(), 'fixtures', name);
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
    return {
        id: asString(item.id),
        deviceName: asString(item.deviceName),
        operatingSystem: asString(item.operatingSystem),
        osVersion: asString(item.osVersion),
        complianceState: asString(item.complianceState, 'unknown'),
        lastSyncDateTime: safeDate(item.lastSyncDateTime),
        userDisplayName: asString(item.userDisplayName),
        userPrincipalName: asString(item.userPrincipalName)
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
async function getGraphApps(accessToken) {
    try {
        const v1 = await graphList(accessToken, '/v1.0/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime');
        if (v1.length > 0) {
            return v1.map(mapApp);
        }
        const beta = await graphList(accessToken, '/beta/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime');
        return beta.map(mapApp);
    }
    catch (error) {
        // Detect unsupported tenant error
        if (error?.message?.includes('Request not applicable to target tenant')) {
            // Return empty array, caller will handle
            return [];
        }
        throw error;
    }
}
async function getGraphAppStatuses(accessToken, apps) {
    const rows = [];
    for (const app of apps) {
        try {
            const deviceStatuses = await graphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`);
            rows.push(...deviceStatuses.map((x) => mapStatus(x, app, 'device')));
        }
        catch (error) {
            if (error?.message?.includes('Request not applicable to target tenant')) {
                // Skip unsupported tenant error
                continue;
            }
            throw error;
        }
        try {
            const userStatuses = await graphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${app.id}/userStatuses`);
            rows.push(...userStatuses.map((x) => mapStatus(x, app, 'user')));
        }
        catch (error) {
            if (error?.message?.includes('Request not applicable to target tenant')) {
                continue;
            }
            throw error;
        }
    }
    return rows;
}
async function getGraphUsers(accessToken) {
    try {
        const users = await graphList(accessToken, '/v1.0/users?$select=id,displayName,userPrincipalName,mail');
        if (users.length > 0)
            return users.map(mapUser);
    }
    catch {
    }
    const me = await graphRequest(accessToken, '/v1.0/me?$select=id,displayName,userPrincipalName,mail');
    return me?.id ? [mapUser(me)] : [];
}
async function getGraphDevices(accessToken) {
    const devices = await graphList(accessToken, '/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName');
    return devices.map(mapDevice);
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
    const [appStatuses, users, devices] = await Promise.all([
        getGraphAppStatuses(accessToken, apps),
        getGraphUsers(accessToken),
        getGraphDevices(accessToken)
    ]);
    return { apps, appStatuses, users, devices };
}
//# sourceMappingURL=provider.js.map