export declare const config: {
    port: number;
    nodeEnv: any;
    mockMode: boolean;
    databaseUrl: any;
    logFile: any;
    sessionSecret: any;
    webAppUrl: any;
    corsOrigins: any;
    refreshIntervalSeconds: number;
    incidentWindowMinutes: number;
    incidentThresholdCount: number;
    severityThresholds: {
        Low: number;
        Medium: number;
        High: number;
    };
    entra: {
        tenantId: any;
        clientId: any;
        clientSecret: any;
        redirectUri: any;
        scopes: any;
    };
};
export declare function authConfigured(): boolean;
