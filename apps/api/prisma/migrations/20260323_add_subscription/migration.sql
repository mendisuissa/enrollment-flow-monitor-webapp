CREATE TABLE "Subscription" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "email"         TEXT NOT NULL,
    "gumroadSaleId" TEXT,
    "status"        TEXT NOT NULL DEFAULT 'active',
    "subscribedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"     DATETIME,
    "updatedAt"     DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Subscription_email_key" ON "Subscription"("email");
CREATE UNIQUE INDEX "Subscription_gumroadSaleId_key" ON "Subscription"("gumroadSaleId");
