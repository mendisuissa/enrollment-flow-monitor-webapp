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
        userPrincipalName: asString(item.userPrincipalName),
        serialNumber: asString(item.serialNumber, ''),
        joinType: asString(item.joinType, ''),
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
    return (msg.includes('Request not applicable to target tenant') || // Intune not enabled / not applicable
        msg.includes('BadRequest') ||
        msg.includes('Forbidden') ||
        msg.includes('Application is not authorized') ||
        msg.includes('Resource not found for the segment') // deviceStatuses/userStatuses not supported for this app type
    );
}
async function safeGraphList(accessToken, url) {
    try {
        return await graphList(accessToken, url);
    }
    catch (err) {
        // IMPORTANT: do not crash the whole dashboard on expected tenant/scope/endpoint limitations
        if (isExpectedGraphTenantError(err))
            return [];
        throw err;
    }
}
async function getGraphApps(accessToken) {
    // If the tenant/user doesn't have DeviceManagementApps scopes/admin consent -> return [] (do not crash)
    const v1 = await safeGraphList(accessToken, '/v1.0/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime');
    if (v1.length > 0)
        return v1.map(mapApp);
    const beta = await safeGraphList(accessToken, '/beta/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime');
    return beta.map(mapApp);
}
async function getGraphAppStatuses(accessToken, apps) {
    const rows = [];
    for (const app of apps) {
        // deviceStatuses (try v1 then beta; if unsupported -> [])
        const deviceStatusesV1 = await safeGraphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`);
        const deviceStatuses = deviceStatusesV1.length
            ? deviceStatusesV1
            : await safeGraphList(accessToken, `/beta/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`);
        rows.push(...deviceStatuses.map((x) => mapStatus(x, app, 'device')));
        // userStatuses (try v1 then beta; if unsupported -> [])
        const userStatusesV1 = await safeGraphList(accessToken, `/v1.0/deviceAppManagement/mobileApps/${app.id}/userStatuses`);
        const userStatuses = userStatusesV1.length
            ? userStatusesV1
            : await safeGraphList(accessToken, `/beta/deviceAppManagement/mobileApps/${app.id}/userStatuses`);
        rows.push(...userStatuses.map((x) => mapStatus(x, app, 'user')));
    }
    return rows;
}
async function getGraphUsers(accessToken) {
    const users = await safeGraphList(accessToken, '/v1.0/users?$select=id,displayName,userPrincipalName,mail');
    if (users.length > 0)
        return users.map(mapUser);
    // fallback to /me (this usually works even in limited tenants)
    try {
        const me = await graphRequest(accessToken, '/v1.0/me?$select=id,displayName,userPrincipalName,mail');
        return me?.id ? [mapUser(me)] : [];
    }
    catch {
        return [];
    }
}
async function getGraphDevices(accessToken) {
    // If Intune isn't enabled / user lacks MDM scopes -> return [] (do not crash)
    const devices = await safeGraphList(accessToken, '/v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName,serialNumber,joinType,deviceEnrollmentType');
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