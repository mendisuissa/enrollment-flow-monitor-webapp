import { prisma } from './prisma.js';
export class PrismaIncidentRepository {
    async upsertMany(rows) {
        for (const row of rows) {
            if (row.isPlaceholder)
                continue;
            await prisma.incident.upsert({
                where: { signature: row.signature },
                update: {
                    impactedCount: row.impactedCount,
                    severity: row.severity,
                    lastSeen: new Date(row.lastSeen)
                },
                create: {
                    signature: row.signature,
                    appId: row.appId,
                    appName: row.appName,
                    normalizedCategory: row.normalizedCategory,
                    errorCode: row.errorCode,
                    impactedCount: row.impactedCount,
                    firstSeen: new Date(row.firstSeen),
                    lastSeen: new Date(row.lastSeen),
                    severity: row.severity
                }
            });
        }
    }
    async listRecent(limit) {
        const incidents = await prisma.incident.findMany({
            orderBy: [{ updatedAt: 'desc' }],
            take: limit
        });
        return incidents.map((incident) => ({
            id: incident.id,
            signature: incident.signature,
            appId: incident.appId,
            appName: incident.appName,
            normalizedCategory: incident.normalizedCategory,
            errorCode: incident.errorCode,
            impactedCount: incident.impactedCount,
            firstSeen: incident.firstSeen.toISOString(),
            lastSeen: incident.lastSeen.toISOString(),
            severity: incident.severity,
            summary: `${incident.appName}: ${incident.impactedCount} failures in rolling window`
        }));
    }
}
//# sourceMappingURL=incidentRepository.js.map