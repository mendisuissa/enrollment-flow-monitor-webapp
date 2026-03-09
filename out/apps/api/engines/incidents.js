import { getSeverity } from '@efm/shared';
import { config } from '../config.js';
function toWindowStart(minutes) {
    return Date.now() - minutes * 60_000;
}
export function buildIncidents(statusRows) {
    const onlyFailed = statusRows.filter((row) => row.installState.toLowerCase().includes('fail'));
    const windowStart = toWindowStart(config.incidentWindowMinutes);
    const grouped = new Map();
    for (const row of onlyFailed) {
        const timestamp = new Date(row.lastReportedDateTime).getTime();
        if (Number.isFinite(timestamp) && timestamp < windowStart) {
            continue;
        }
        const signature = `${row.appId}|${row.normalizedCategory}|${row.errorCode || 'Unknown'}`;
        const current = grouped.get(signature) ?? [];
        current.push(row);
        grouped.set(signature, current);
    }
    const incidents = [];
    for (const [signature, rows] of grouped.entries()) {
        if (rows.length < config.incidentThresholdCount) {
            continue;
        }
        const sortedByTime = rows.slice().sort((a, b) => a.lastReportedDateTime.localeCompare(b.lastReportedDateTime));
        const first = sortedByTime[0];
        const last = sortedByTime[sortedByTime.length - 1];
        const severity = getSeverity(rows.length, config.severityThresholds);
        incidents.push({
            id: signature,
            signature,
            appId: first.appId,
            appName: first.appName,
            normalizedCategory: first.normalizedCategory,
            errorCode: first.errorCode || 'Unknown',
            impactedCount: rows.length,
            firstSeen: first.lastReportedDateTime,
            lastSeen: last.lastReportedDateTime,
            severity,
            summary: `${first.appName}: ${rows.length} failures in rolling window`
        });
    }
    incidents.sort((a, b) => {
        const rank = { High: 3, Medium: 2, Low: 1 };
        const bySeverity = rank[b.severity] - rank[a.severity];
        if (bySeverity !== 0)
            return bySeverity;
        return b.impactedCount - a.impactedCount;
    });
    if (incidents.length === 0) {
        return [{
                id: 'none',
                signature: 'none',
                appId: '',
                appName: 'No active incidents',
                normalizedCategory: 'None',
                errorCode: '',
                impactedCount: 0,
                firstSeen: new Date(0).toISOString(),
                lastSeen: new Date(0).toISOString(),
                severity: 'Low',
                isPlaceholder: true,
                summary: 'No failed installs matched incident grouping rules for the selected timeframe.'
            }];
    }
    return incidents;
}
//# sourceMappingURL=incidents.js.map