import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
let cachedRules = null;
async function loadRules() {
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
            cachedRules = Array.isArray(parsed.rules) ? parsed.rules : [];
            return cachedRules;
        }
        catch {
            continue;
        }
    }
    cachedRules = [];
    return cachedRules;
}
export async function normalizeStatus(row) {
    const rules = await loadRules();
    const corpus = `${row.errorCode} ${row.errorDescription} ${row.installState}`.toLowerCase();
    for (const rule of rules) {
        if (!rule.enabled)
            continue;
        const matched = rule.anyMatches.some((token) => corpus.includes(token.toLowerCase()));
        if (!matched)
            continue;
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
//# sourceMappingURL=normalization.js.map