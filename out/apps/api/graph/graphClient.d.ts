export declare class TokenExpiredError extends Error {
    constructor();
}
export declare function graphRequest<T>(accessToken: string, path: string, maxRetries?: number): Promise<T>;
export declare function graphList(accessToken: string, path: string): Promise<Record<string, unknown>[]>;
