import { getSeverity } from '@efm/shared';
import { config } from '../config.js';
function toWindowStart(minutes) {
    return Date.now() - minutes * 60_000;
}
function pickNextAction(category, errorCode, actions) {
    if (actions.length > 0)
        return actions[0];
    const normalized = `${category} ${errorCode}`.toLowerCase();
    if (normalized.includes('network') || normalized.includes('dns') || normalized.includes('ee7'))
        return 'Validate network reachability to Intune and Entra endpoints.';
    if (normalized.includes('license') || normalized.includes('subscription'))
        return 'Confirm affected users have a valid Intune or Microsoft 365 license assigned.';
    if (normalized.includes('conditional') || normalized.includes('aadsts'))
        return 'Review Conditional Access and user assignment before retrying enrollment.';
    if (normalized.includes('compliance'))
        return 'Open the impacted device and review compliance evaluation plus last sync status.';
    return 'Open the remediation drawer and validate the recommended runbook before retrying.';
}
function pickOwner(category) {
    const normalized = category.toLowerCase();
    if (normalized.includes('conditional') || normalized.includes('identity'))
        return 'Identity Team';
    if (normalized.includes('network') || normalized.includes('dns'))
        return 'Network Team';
    if (normalized.includes('license') || normalized.includes('policy') || normalized.includes('compliance'))
        return 'Endpoint Team';
    return 'Enrollment Operations';
}
function pickPriority(severity, impactedCount) {
    if (severity === 'Critical' || (severity === 'High' && impactedCount >= Math.max(config.severityThresholds.High + 2, 8)))
        return 'P1';
    if (severity === 'High' || impactedCount >= config.severityThresholds.Medium)
        return 'P2';
    return 'P3';
}
function pickSlaState(lastSeen, priority) {
    const ageMinutes = Math.max(0, (Date.now() - new Date(lastSeen).getTime()) / 60000);
    const breach = priority === 'P1' ? 240 : priority === 'P2' ? 720 : 1440;
    if (ageMinutes >= breach)
        return 'Breached';
    if (ageMinutes >= breach * 0.6)
        return 'AtRisk';
    return 'Healthy';
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
        const baseSeverity = getSeverity(rows.length, config.severityThresholds);
        const severity = rows.length >= Math.max(config.severityThresholds.High + 4, 10) ? 'Critical' : baseSeverity;
        const avgConfidence = rows.reduce((sum, row) => sum + Number(row.confidence ?? 0), 0) / rows.length;
        const allActions = Array.from(new Set(rows.flatMap((row) => row.recommendedActions ?? []).filter(Boolean)));
        const priority = pickPriority(severity, rows.length);
        const nextBestAction = pickNextAction(first.normalizedCategory, first.errorCode || 'Unknown', allActions);
        const remediationSteps = allActions.slice(0, 4);
        const verificationSteps = [
            'Refresh the affected device or user timeline after remediation.',
            'Confirm the failure cluster count starts trending down.',
            'Validate a fresh enrollment or app install succeeds for one impacted device.'
        ];
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
            summary: `${first.appName}: ${rows.length} failures in rolling window`,
            priority,
            nextBestAction,
            rootCauseConfidence: Number(avgConfidence.toFixed(2)),
            owner: pickOwner(first.normalizedCategory),
            status: rows.length >= config.severityThresholds.High ? 'Investigating' : 'New',
            slaState: pickSlaState(last.lastReportedDateTime, priority),
            likelyCause: first.cause || 'Review remediation steps and Graph details to confirm the root cause.',
            remediationSteps,
            verificationSteps,
            details: [
                `Incident: ${first.appName}`,
                `Category: ${first.normalizedCategory}`,
                `Error code: ${first.errorCode || 'Unknown'}`,
                `Priority: ${priority}`,
                `Severity: ${severity}`,
                `Owner: ${pickOwner(first.normalizedCategory)}`,
                `Status: ${rows.length >= config.severityThresholds.High ? 'Investigating' : 'New'}`,
                `Root cause confidence: ${Math.round(avgConfidence * 100)}%`,
                `Likely cause: ${first.cause || 'Review remediation steps and Graph details to confirm the root cause.'}`,
                `Next best action: ${nextBestAction}`,
                '',
                'Remediation steps:',
                ...remediationSteps.map((step, index) => `${index + 1}. ${step}`),
                '',
                'Verification steps:',
                ...verificationSteps.map((step, index) => `${index + 1}. ${step}`)
            ].join('\n')
        });
    }
    incidents.sort((a, b) => {
        const rank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
        const bySeverity = rank[b.severity] - rank[a.severity];
        if (bySeverity !== 0)
            return bySeverity;
        const pRank = { P1: 3, P2: 2, P3: 1 };
        const byPriority = pRank[b.priority ?? 'P3'] - pRank[a.priority ?? 'P3'];
        if (byPriority !== 0)
            return byPriority;
        return b.impactedCount - a.impactedCount;
    });
    if (incidents.length === 0) {
        return [];
    }
    return incidents;
}
const CATEGORY_LABELS = {
    authentication: 'Authentication failure during enrollment',
    deviceLimit: 'Device limit reached',
    deviceNotSupported: 'Device type or platform not supported',
    notLicensed: 'User not licensed for Intune',
    userAbandonment: 'User abandoned enrollment flow',
    accountValidation: 'Account validation failed',
    aadTokenError: 'Azure AD token error',
};
const CATEGORY_ACTIONS = {
    authentication: [
        'Check Entra ID Sign-in logs for the affected users — filter by Intune app in the last 2 hours.',
        'Review Conditional Access policies — ensure enrollment is not blocked by a new or modified policy.',
        'Verify MDM Terms of Use have been accepted by all affected users.',
    ],
    deviceLimit: [
        'Go to Enrollment Restrictions → Device Limit and increase the per-user limit.',
        'Remove stale/duplicate device records from Entra ID for affected users.',
        'Check if users are in a group with a lower custom device limit override.',
    ],
    deviceNotSupported: [
        'Go to Enrollment Restrictions → Device Type and ensure the platform is set to Allow.',
        'Check if the device manufacturer or model is on a blocked list.',
        'Verify the OS version meets the minimum requirement in restrictions.',
    ],
    notLicensed: [
        'Assign an Intune or EMS E3/E5 license to affected users in Entra ID.',
        'Wait 15 minutes for license propagation, then retry enrollment.',
        'Verify license includes the Intune service plan (not just the bundle).',
    ],
    userAbandonment: [
        'Follow up with affected users and ask them to retry enrollment.',
        'Verify Company Portal is up to date on the device.',
        'Check for blocking prompts the user may have dismissed (Terms of Use, MFA).',
    ],
    accountValidation: [
        'Verify the UPN is correct and the account exists in Entra ID.',
        'Check if the account is a guest/external user — these cannot enroll by default.',
        'Ensure the user is in scope for MDM enrollment in Entra ID → Mobility.',
    ],
    aadTokenError: [
        'Ask affected users to sign out and sign back in with their work account.',
        'Check if MFA is enforced — users may need to complete MFA first.',
        'Review Entra ID Sign-in logs for the specific token failure reason.',
    ],
};
function categoryToOwner(category) {
    if (['authentication', 'aadTokenError', 'accountValidation'].includes(category))
        return 'Identity Team';
    if (['deviceLimit', 'deviceNotSupported'].includes(category))
        return 'Endpoint Team';
    if (category === 'notLicensed')
        return 'IT Operations';
    return 'Enrollment Operations';
}
export function buildEnrollmentIncidents(failures, thresholds) {
    if (!failures || failures.length === 0)
        return [];
    const grouped = new Map();
    for (const f of failures) {
        const cat = (f.failureCategory ?? 'unknown').toLowerCase();
        const os = (f.os ?? 'unknown').toLowerCase();
        const key = `enrollment|${cat}|${os}`;
        const existing = grouped.get(key) ?? [];
        existing.push(f);
        grouped.set(key, existing);
    }
    const incidents = [];
    for (const [key, rows] of grouped.entries()) {
        const parts = key.split('|');
        const category = parts[1];
        const os = parts[2];
        const sorted = rows.slice().sort((a, b) => (a.failureDateTime ?? '').localeCompare(b.failureDateTime ?? ''));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const count = rows.length;
        const severity = count >= thresholds.High ? 'High' :
            count >= thresholds.Medium ? 'Medium' :
                count >= thresholds.Low ? 'Low' : 'Low';
        const priority = severity === 'High' ? 'P1' :
            severity === 'Medium' ? 'P2' : 'P3';
        const label = CATEGORY_LABELS[category] ?? `Enrollment failure — ${category}`;
        const actions = CATEGORY_ACTIONS[category] ?? [
            'Review the enrollment failure details in Enrollment Failures view.',
            'Check Intune service health for any ongoing outages.',
        ];
        const platformLabel = os.charAt(0).toUpperCase() + os.slice(1);
        incidents.push({
            id: key,
            signature: key,
            appId: 'enrollment',
            appName: `Enrollment — ${platformLabel}`,
            normalizedCategory: label,
            errorCode: category,
            impactedCount: count,
            firstSeen: first.failureDateTime ?? new Date().toISOString(),
            lastSeen: last.failureDateTime ?? new Date().toISOString(),
            severity,
            summary: `${count} ${platformLabel} enrollment failure${count !== 1 ? 's' : ''} — ${label}`,
            priority,
            nextBestAction: actions[0],
            rootCauseConfidence: 0.85,
            owner: categoryToOwner(category),
            status: count >= thresholds.Medium ? 'Investigating' : 'New',
            slaState: 'Healthy',
            likelyCause: label,
            remediationSteps: actions,
            verificationSteps: [
                'Refresh Enrollment Failures view and verify the failure count is decreasing.',
                'Confirm a fresh enrollment succeeds for one of the affected users.',
                'Check Intune audit logs to confirm the remediation action was applied.',
            ],
            details: [
                `Incident: ${label}`,
                `Platform: ${platformLabel}`,
                `Category: ${category}`,
                `Priority: ${priority}`,
                `Severity: ${severity}`,
                `Owner: ${categoryToOwner(category)}`,
                `Status: ${count >= thresholds.Medium ? 'Investigating' : 'New'}`,
                `Root cause confidence: 85%`,
                `Likely cause: ${label}`,
                `Next best action: ${actions[0]}`,
                '',
                'Remediation steps:',
                ...actions.map((a, i) => `${i + 1}. ${a}`),
                '',
                'Verification steps:',
                '1. Refresh Enrollment Failures view and verify the failure count is decreasing.',
                '2. Confirm a fresh enrollment succeeds for one of the affected users.',
                '3. Check Intune audit logs to confirm the remediation action was applied.',
            ].join('\n'),
        });
    }
    return incidents.sort((a, b) => {
        const rank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
        return rank[b.severity] - rank[a.severity];
    });
}
//# sourceMappingURL=incidents.js.map