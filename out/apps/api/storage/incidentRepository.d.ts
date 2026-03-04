import { IncidentRow } from '@efm/shared';
export interface IncidentRepository {
    upsertMany(rows: IncidentRow[]): Promise<void>;
    listRecent(limit: number): Promise<IncidentRow[]>;
}
export declare class PrismaIncidentRepository implements IncidentRepository {
    upsertMany(rows: IncidentRow[]): Promise<void>;
    listRecent(limit: number): Promise<IncidentRow[]>;
}
