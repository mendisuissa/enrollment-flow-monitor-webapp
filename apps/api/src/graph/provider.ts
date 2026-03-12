import fs from 'fs/promises';
import path from 'path';
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

interface SafeGraphListOptions {
  swallowExpected?: boolean;
  context?: string;
}

export class GraphDataError extends Error {
  readonly context: string;
  readonly causeMessage: string;

  constructor(context: string, causeMessage: string) {
    super(`${context}: ${causeMessage}`);
    this.name = 'GraphDataError';
    this.context = context;
    this.causeMessage = causeMessage;
  }
}

async function loadFixture<T>(name: string): Promise<T[]> {
  const fixturePath = path.resolve(process.cwd(), 'apps', 'api', 'fixtures', name);
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
  const joinType = asString(
    item.joinType ?? item.azureADJoinType ?? item.managedDeviceOwnerType ?? item.deviceOwnership,
    ''
  );

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
    msg.includes('Request not applicable to target tenant') ||
    msg.includes('BadRequest') ||
    msg.includes('Forbidden') ||
    msg.includes('Application is not authorized') ||
    msg.includes('Resource not found for the segment')
  );
}

function simplifyGraphError(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? 'Unknown Graph error');
  return raw
    .replace(/^Graph request failed \((\d+)\) on [^:]+:\s*/i, 'Graph $1: ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function safeGraphList(
  accessToken: string,
  url: string,
  options: SafeGraphListOptions = {}
): Promise<Record<string, unknown>[]> {
  try {
    return await graphList(accessToken, url);
  } catch (err: any) {
    if (options.swallowExpected && isExpectedGraphTenantError(err)) return [];
    throw new GraphDataError(options.context ?? url, simplifyGraphError(err));
  }
}

async function getGraphApps(accessToken: string): Promise<MobileApp[]> {
  const v1 = await safeGraphList(
    accessToken,
    '/v1.0/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime',
    { swallowExpected: true, context: 'Loading mobile apps from Graph' }
  );
  if (v1.length > 0) return v1.map(mapApp);

  const beta = await safeGraphList(
    accessToken,
    '/beta/deviceAppManagement/mobileApps?$select=id,displayName,publisher,lastModifiedDateTime',
    { swallowExpected: true, context: 'Loading mobile apps from Graph beta endpoint' }
  );
  return beta.map(mapApp);
}

async function getGraphAppStatuses(accessToken: string, apps: MobileApp[]): Promise<AppStatusRow[]> {
  const rows: AppStatusRow[] = [];

  for (const app of apps) {
    let deviceStatuses: Record<string, unknown>[] = [];
    let userStatuses: Record<string, unknown>[] = [];

    try {
      const deviceStatusesV1 = await safeGraphList(
        accessToken,
        `/v1.0/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`,
        { swallowExpected: true, context: `Loading device statuses for app ${app.displayName}` }
      );

      deviceStatuses = deviceStatusesV1.length
        ? deviceStatusesV1
        : await safeGraphList(accessToken, `/beta/deviceAppManagement/mobileApps/${app.id}/deviceStatuses`, {
            swallowExpected: true,
            context: `Loading beta device statuses for app ${app.displayName}`
          });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (
        msg.includes("Resource not found for the segment 'deviceStatuses'") ||
        msg.includes('deviceStatuses')
      ) {
        deviceStatuses = [];
      } else {
        throw err;
      }
    }

    try {
      const userStatusesV1 = await safeGraphList(
        accessToken,
        `/v1.0/deviceAppManagement/mobileApps/${app.id}/userStatuses`,
        { swallowExpected: true, context: `Loading user statuses for app ${app.displayName}` }
      );

      userStatuses = userStatusesV1.length
        ? userStatusesV1
        : await safeGraphList(accessToken, `/beta/deviceAppManagement/mobileApps/${app.id}/userStatuses`, {
            swallowExpected: true,
            context: `Loading beta user statuses for app ${app.displayName}`
          });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (
        msg.includes("Resource not found for the segment 'userStatuses'") ||
        msg.includes('userStatuses')
      ) {
        userStatuses = [];
      } else {
        throw err;
      }
    }

    rows.push(...deviceStatuses.map((x) => mapStatus(x, app, 'device')));
    rows.push(...userStatuses.map((x) => mapStatus(x, app, 'user')));
  }

  return rows;
}

async function getGraphUsers(accessToken: string): Promise<UserRow[]> {
  const users = await safeGraphList(accessToken, '/v1.0/users?$select=id,displayName,userPrincipalName,mail', {
    swallowExpected: true,
    context: 'Loading users from Graph'
  });
  if (users.length > 0) return users.map(mapUser);

  try {
    const me = await graphRequest<Record<string, unknown>>(accessToken, '/v1.0/me?$select=id,displayName,userPrincipalName,mail');
    return me?.id ? [mapUser(me)] : [];
  } catch {
    return [];
  }
}

async function getGraphDevices(accessToken: string): Promise<ManagedDevice[]> {
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

  let lastError: GraphDataError | null = null;

  for (const attempt of attempts) {
    try {
      const devices = await safeGraphList(accessToken, attempt.url, { context: attempt.context });
      return devices.map(mapDevice);
    } catch (error) {
      lastError = error instanceof GraphDataError
        ? error
        : new GraphDataError(attempt.context, simplifyGraphError(error));
    }
  }

  throw new GraphDataError(
    'Loading managed devices from Graph',
    lastError?.causeMessage ?? 'Unknown failure while calling managedDevices.'
  );
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

  let appStatuses: AppStatusRow[] = [];
  try {
    appStatuses = await getGraphAppStatuses(accessToken, apps);
  } catch (err: any) {
    console.error('App statuses load failed:', err?.message ?? err);
    appStatuses = [];
  }

  const [users, devices] = await Promise.all([
    getGraphUsers(accessToken),
    getGraphDevices(accessToken)
  ]);

  return { apps, appStatuses, users, devices };
}
