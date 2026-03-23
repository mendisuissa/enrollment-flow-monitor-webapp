import { AppStatusRow, IncidentRow, getSeverity } from '@efm/shared';
import { config } from '../config.js';

function toWindowStart(minutes: number): number {
  return Date.now() - minutes * 60_000;
}

function pickNextAction(category: string, errorCode: string, actions: string[]): string {
  if (actions.length > 0) return actions[0];
  const normalized = `${category} ${errorCode}`.toLowerCase();
  if (normalized.includes('network') || normalized.includes('dns') || normalized.includes('ee7')) return 'Validate network reachability to Intune and Entra endpoints.';
  if (normalized.includes('license') || normalized.includes('subscription')) return 'Confirm affected users have a valid Intune or Microsoft 365 license assigned.';
  if (normalized.includes('conditional') || normalized.includes('aadsts')) return 'Review Conditional Access and user assignment before retrying enrollment.';
  if (normalized.includes('compliance')) return 'Open the impacted device and review compliance evaluation plus last sync status.';
  return 'Open the remediation drawer and validate the recommended runbook before retrying.';
}

function pickOwner(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes('conditional') || normalized.includes('identity')) return 'Identity Team';
  if (normalized.includes('network') || normalized.includes('dns')) return 'Network Team';
  if (normalized.includes('license') || normalized.includes('policy') || normalized.includes('compliance')) return 'Endpoint Team';
  return 'Enrollment Operations';
}

function pickPriority(severity: IncidentRow['severity'], impactedCount: number): 'P1' | 'P2' | 'P3' {
  if (severity === 'Critical' || (severity === 'High' && impactedCount >= Math.max(config.severityThresholds.High + 2, 8))) return 'P1';
  if (severity === 'High' || impactedCount >= config.severityThresholds.Medium) return 'P2';
  return 'P3';
}

function pickSlaState(lastSeen: string, priority: 'P1' | 'P2' | 'P3'): 'Healthy' | 'AtRisk' | 'Breached' {
  const ageMinutes = Math.max(0, (Date.now() - new Date(lastSeen).getTime()) / 60000);
  const breach = priority === 'P1' ? 240 : priority === 'P2' ? 720 : 1440;
  if (ageMinutes >= breach) return 'Breached';
  if (ageMinutes >= breach * 0.6) return 'AtRisk';
  return 'Healthy';
}

export function buildIncidents(statusRows: AppStatusRow[]): IncidentRow[] {
  const onlyFailed = statusRows.filter((row) => row.installState.toLowerCase().includes('fail'));
  const windowStart = toWindowStart(config.incidentWindowMinutes);

  const grouped = new Map<string, AppStatusRow[]>();

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

  const incidents: IncidentRow[] = [];

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
    if (bySeverity !== 0) return bySeverity;
    const pRank = { P1: 3, P2: 2, P3: 1 };
    const byPriority = pRank[b.priority ?? 'P3'] - pRank[a.priority ?? 'P3'];
    if (byPriority !== 0) return byPriority;
    return b.impactedCount - a.impactedCount;
  });

  if (incidents.length === 0) {
    return [];
  }

  return incidents;
}
