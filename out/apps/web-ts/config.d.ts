export declare const config: {
    port: number;
    nodeEnv: string;
    mockMode: boolean;
    databaseUrl: string;
    logFile: string;
    sessionSecret: string;
    webAppUrl: string;
    corsOrigins: string[];
    refreshIntervalSeconds: number;
    incidentWindowMinutes: number;
    incidentThresholdCount: number;
    severityThresholds: {
        Low: number;
        Medium: number;
        High: number;
    };
    entra: {
        tenantId: string;
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        scopes: string[];
        scopesWrite: string[];
    };
};
export declare function authConfigured(): boolean;
