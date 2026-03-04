import { IncidentRow } from '@efm/shared';
import { prisma } from './prisma.js';

export interface IncidentRepository {
  upsertMany(rows: IncidentRow[]): Promise<void>;
  listRecent(limit: number): Promise<IncidentRow[]>;
}

interface PersistedIncidentRow {
  id: string;
  signature: string;
  appId: string;
  appName: string;
  normalizedCategory: string;
  errorCode: string;
  impactedCount: number;
  firstSeen: Date;
  lastSeen: Date;
  severity: string;
}

export class PrismaIncidentRepository implements IncidentRepository {
  async upsertMany(rows: IncidentRow[]): Promise<void> {
    for (const row of rows) {
      if (row.isPlaceholder) continue;

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

  async listRecent(limit: number): Promise<IncidentRow[]> {
    const incidents = await prisma.incident.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      take: limit
    });

    return incidents.map((incident: PersistedIncidentRow) => ({
      id: incident.id,
      signature: incident.signature,
      appId: incident.appId,
      appName: incident.appName,
      normalizedCategory: incident.normalizedCategory,
      errorCode: incident.errorCode,
      impactedCount: incident.impactedCount,
      firstSeen: incident.firstSeen.toISOString(),
      lastSeen: incident.lastSeen.toISOString(),
      severity: incident.severity as IncidentRow['severity'],
      summary: `${incident.appName}: ${incident.impactedCount} failures in rolling window`
    }));
  }
}
