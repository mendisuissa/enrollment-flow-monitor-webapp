CREATE TABLE IF NOT EXISTS "SignInEvent" (
    "id"                TEXT     NOT NULL PRIMARY KEY,
    "createdAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType"         TEXT     NOT NULL DEFAULT 'login_success',
    "userPrincipalName" TEXT,
    "displayName"       TEXT,
    "tenantId"          TEXT,
    "ipAddress"         TEXT,
    "userAgent"         TEXT
);
