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
}>;
export declare function getView(view: string): Promise<ViewResponse>;
export declare function refreshData(): Promise<{
    message: string;
}>;
export declare function copyRunbook(row: Record<string, unknown> | null): Promise<{
    runbook: string;
}>;
export declare function getLogs(): Promise<ViewResponse>;
