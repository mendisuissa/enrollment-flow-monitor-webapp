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
    async listWorkflows() {
        const workflows = await prisma.incidentWorkflow.findMany({
            orderBy: [{ updatedAt: 'desc' }]
        });
        return workflows.map((workflow) => ({
            signature: workflow.incidentSignature,
            owner: workflow.owner,
            status: workflow.status,
            notes: workflow.notes,
            updatedAt: workflow.updatedAt.toISOString()
        }));
    }
    async upsertWorkflow(input) {
        const workflow = await prisma.incidentWorkflow.upsert({
            where: { incidentSignature: input.signature },
            update: {
                owner: input.owner,
                status: input.status,
                notes: input.notes
            },
            create: {
                incidentSignature: input.signature,
                owner: input.owner,
                status: input.status,
                notes: input.notes
            }
        });
        return {
            signature: workflow.incidentSignature,
            owner: workflow.owner,
            status: workflow.status,
            notes: workflow.notes,
            updatedAt: workflow.updatedAt.toISOString()
        };
    }
}
//# sourceMappingURL=incidentRepository.js.map