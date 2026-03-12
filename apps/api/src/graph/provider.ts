import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppStatusRow, ManagedDevice, MobileApp, UserRow } from '@efm/shared';
import { config } from '../config.js';
import { asString, safeDate } from '../utils/safe.js';
import { graphList, graphRequest } from './graphClient.js';

interface DataBundle {
  apps: MobileApp[];
  appStatuses: AppStatusRow[];
  users: UserRow[];
  devices: ManagedDevice[];
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const fixturesDir = path.resolve(currentDir, '../../fixtures');

async function loadFixture<T>(name: string): Promise<T[]> {
  const fixturePath = path.resolve(fixturesDir, name);
  const raw = await fs.readFile(fixturePath, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? (data as T[]) : [];
}

function mapApp(item: Record<string, unknown>): MobileApp {
  return {
    id: asString(item.id),
    displayName: asString(item.displayName),
    publisher: asString(item.publisher),
    platform: asString(item['@odata.type'] ?? item.platform, 'unknown'),
    lastModifiedDateTime: safeDate(item.lastModifiedDateTime)
  };
}

function mapDevice(item: Record<string, unknown>): ManagedDevice {
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

function mapUser(item: Record<string, unknown>): UserRow {
  return {
    id: asString(item.id),
    displayName: asString(item.displayName),
    userPrincipalName: asString(item.userPrincipalName),
    mail: asString(item.mail, '')
  };
}

function mapStatus(item: Record<string, unknown>, app: MobileApp, targetType: 'device' | 'user'): AppStatusRow {
  const errorCode = asString(item.errorCode, 'Unknown');
  const errorDescription = asString(item.errorDescription, 'Unknown');
  const installState = asString(item.installState, asString(item.status, 'Unknown')).toLowerCase();

  return {
    id: asString(item.id),
    appId: app.id,
    appName: app.displayName,
    targetType,
    targetId: asString((item as any).deviceId ?? (item as any).userId),
    targetName: asString((item as any).deviceDisplayName ?? (item as any).userDisplayName, 'Unknown'),
    installState,
    errorCode,
    errorDescription,
    lastReportedDateTime: safeDate((item as any).lastReportedDateTime),
    normalizedCategory: 'Unknown',
    cause: 'Unknown',
    confidence: 0,
    recommendedActions: []
  };
}

function isExpectedGraphTenantError(err: any): boolean {
  const msg = String(err?.message ?? '');
  return (
    msg.includes('Request not applicable to target tenant') || // Intune not enabled / not applicable
    msg.includes('BadRequest') ||
    msg.includes('Forbidden') ||
    msg.includes('Application is not authorized') ||
    msg.includes('Resource not found for the segment') // deviceStatuses/userStatuses not supported for this app type
  );
}

async function safeGraphList(accessToken: string, url: string): Promise<Record<string, unknown>[]> {
  try {
    return await graphList(accessToken, url);
  } catch (err: any) {
    if (isExpectedGraphTenantError(err)) return [];
    throw err;
  }
}

function getGraphErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? 'Unknown Graph error');
}

async function getGraphApps(accessToken: string): Promise<MobileApp[]> {
  // If the tenant/user doesn't have DeviceManagementApps scopes/admin consent -> return [] (do not crash)
  const v1 = await safeGraphList(
    accessToken,
    '/v1.0/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime'
  );
  if (v1.length > 0) return v1.map(mapApp);

  const beta = await safeGraphList(
    accessToken,
    '/beta/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime'
  );
  return beta.map(mapApp);
}

async function getGraphAppStatuses(accessToken: string, apps: MobileApp[]): Promise<AppStatusRow[]> {
  const rows: AppStatusRow[] = [];

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

async function getGraphUsers(accessToken: string): Promise<UserRow[]> {
  const users = await safeGraphList(accessToken, '/v1.0/users?$select=id,displayName,userPrincipalName,mail');
  if (users.length > 0) return users.map(mapUser);

  // fallback to /me (this usually works even in limited tenants)
  try {
    const me = await graphRequest<Record<string, unknown>>(accessToken, '/v1.0/me?$select=id,displayName,userPrincipalName,mail');
    return me?.id ? [mapUser(me)] : [];
  } catch {
    return [];
  }
}

async function getGraphDevices(accessToken: string): Promise<ManagedDevice[]> {
  const candidates = [
    '/v1.0/deviceManagement/managedDevices?$top=100&$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userDisplayName,userPrincipalName,serialNumber,deviceEnrollmentType',
    '/v1.0/deviceManagement/managedDevices?$top=100',
    '/beta/deviceManagement/managedDevices?$top=100'
  ];

  let lastError: unknown;

  for (const url of candidates) {
    try {
      const devices = await graphList(accessToken, url);
      return devices.map(mapDevice);
    } catch (err: unknown) {
      lastError = err;
      const message = getGraphErrorMessage(err);
      const isRecoverable =
        message.includes('BadRequest') ||
        message.includes('Resource not found for the segment') ||
        message.includes('Invalid filter clause') ||
        message.includes('Could not find a property named');

      if (!isRecoverable) {
        throw new Error(`managedDevices failed on ${url}: ${message}`);
      }
    }
  }

  throw new Error(`managedDevices failed after all fallbacks: ${getGraphErrorMessage(lastError)}`);
}

export async function getDataBundle(accessToken?: string): Promise<DataBundle> {
  if (config.mockMode || !accessToken) {
    const [apps, appStatuses, users, devices] = await Promise.all([
      loadFixture<MobileApp>('apps.json'),
      loadFixture<AppStatusRow>('appStatuses.json'),
      loadFixture<UserRow>('users.json'),
      loadFixture<ManagedDevice>('devices.json')
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