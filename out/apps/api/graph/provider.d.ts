import { AppStatusRow, ManagedDevice, MobileApp, UserRow } from '@efm/shared';
interface DataBundle {
    apps: MobileApp[];
    appStatuses: AppStatusRow[];
    users: UserRow[];
    devices: ManagedDevice[];
}
export declare function getDataBundle(accessToken?: string): Promise<DataBundle>;
export {};
