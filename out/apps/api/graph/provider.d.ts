import { AppStatusRow, ManagedDevice, MobileApp, UserRow } from '@efm/shared';
interface DataBundle {
    apps: MobileApp[];
    appStatuses: AppStatusRow[];
    users: UserRow[];
    devices: ManagedDevice[];
}
export declare class GraphDataError extends Error {
    readonly context: string;
    readonly causeMessage: string;
    constructor(context: string, causeMessage: string);
}
export declare function getDataBundle(accessToken?: string): Promise<DataBundle>;
export {};
