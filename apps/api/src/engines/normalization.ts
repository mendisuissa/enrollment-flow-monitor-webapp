import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppStatusRow, FailureExplanation, NormalizationRule } from '@efm/shared';

let cachedRules: NormalizationRule[] | null = null;

async function loadRules(): Promise<NormalizationRule[]> {
  if (cachedRules) {
    return cachedRules;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), 'config', 'normalization.rules.json'),
    path.resolve(process.cwd(), 'apps', 'api', 'config', 'normalization.rules.json'),
    path.resolve(currentDir, '../../apps/api/config/normalization.rules.json'),
    path.resolve(currentDir, '../../config/normalization.rules.json')
  ];

  for (const rulesPath of candidatePaths) {
    try {
      const raw = await fs.readFile(rulesPath, 'utf8');
      const parsed = JSON.parse(raw);
      cachedRules = Array.isArray(parsed.rules) ? parsed.rules as NormalizationRule[] : [];
      return cachedRules;
    } catch {
      continue;
    }
  }

  cachedRules = [];
  return cachedRules;
}

export async function normalizeStatus(row: AppStatusRow): Promise<FailureExplanation> {
  const rules = await loadRules();
  const corpus = `${row.errorCode} ${row.errorDescription} ${row.installState}`.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const matched = rule.anyMatches.some((token) => corpus.includes(token.toLowerCase()));
    if (!matched) continue;

    return {
      normalizedCategory: rule.failureCategory,
      cause: rule.cause,
      confidence: rule.confidence,
      recommendedActions: rule.recommendedActions,
      evidence: {
        lastReportedDateTime: row.lastReportedDateTime || 'Unknown',
        errorCode: row.errorCode || 'Unknown',
        errorDescription: row.errorDescription || 'Unknown'
      }
    };
  }

  return {
    normalizedCategory: 'Unknown',
    cause: 'No rule matched. Update normalization.rules.json for this pattern.',
    confidence: 0.2,
    recommendedActions: ['Collect full error text/code and add a stable matching term in normalization rules.'],
    evidence: {
      lastReportedDateTime: row.lastReportedDateTime || 'Unknown',
      errorCode: row.errorCode || 'Unknown',
      errorDescription: row.errorDescription || 'Unknown'
    }
  };
}
