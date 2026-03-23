import { IncidentRow, IncidentWorkflowRecord, IncidentWorkflowStatus } from '@efm/shared';
export interface IncidentRepository {
    upsertMany(rows: IncidentRow[]): Promise<void>;
    listRecent(limit: number): Promise<IncidentRow[]>;
    listWorkflows(): Promise<IncidentWorkflowRecord[]>;
    upsertWorkflow(input: {
        signature: string;
        owner: string;
        status: IncidentWorkflowStatus;
        notes: string;
    }): Promise<IncidentWorkflowRecord>;
}
export declare class PrismaIncidentRepository implements IncidentRepository {
    upsertMany(rows: IncidentRow[]): Promise<void>;
    listRecent(limit: number): Promise<IncidentRow[]>;
    listWorkflows(): Promise<IncidentWorkflowRecord[]>;
    upsertWorkflow(input: {
        signature: string;
        owner: string;
        status: IncidentWorkflowStatus;
        notes: string;
    }): Promise<IncidentWorkflowRecord>;
}
