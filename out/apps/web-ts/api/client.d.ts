export declare const api: import("axios").AxiosInstance;
export interface ViewResponse {
    rows: Record<string, unknown>[];
    message: string;
}
export declare function getAuthStatus(): Promise<{
    connected: boolean;
    upn: string;
    tenantId: string;
    displayName: string;
    hasWritePermissions: boolean;
}>;
export declare function getView(view: string): Promise<ViewResponse>;
export declare function refreshData(): Promise<{
    message: string;
}>;
export declare function copyRunbook(row: Record<string, unknown> | null): Promise<{
    runbook: string;
}>;
export declare function getLogs(): Promise<ViewResponse>;
export declare function deviceSync(deviceId: string): Promise<{
    success: boolean;
    message: string;
}>;
export declare function deviceReboot(deviceId: string): Promise<{
    success: boolean;
    message: string;
}>;
export declare function deviceAutopilotReset(deviceId: string): Promise<{
    success: boolean;
    message: string;
}>;
export declare function deviceBulkAction(deviceIds: string[], action: 'sync' | 'reboot' | 'autopilotReset'): Promise<{
    success: boolean;
    results: Array<{
        id: string;
        ok: boolean;
        error?: string;
    }>;
}>;
