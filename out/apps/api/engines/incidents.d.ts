import { AppStatusRow, IncidentRow } from '@efm/shared';
export declare function buildIncidents(statusRows: AppStatusRow[]): IncidentRow[];
interface EnrollmentFailureRow {
    failureDateTime: string | null;
    failureReason: string;
    failureCategory: string | null;
    os: string | null;
    osVersion: string | null;
    userPrincipalName: string | null;
    enrollmentMethod: string | null;
    deviceId: string | null;
    correlationId: string | null;
}
export declare function buildEnrollmentIncidents(failures: EnrollmentFailureRow[], thresholds: {
    Low: number;
    Medium: number;
    High: number;
}): IncidentRow[];
export {};
