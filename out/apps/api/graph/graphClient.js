import { safeArray } from '../utils/safe.js';
const GRAPH_BASE = 'https://graph.microsoft.com';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function graphRequest(accessToken, path, maxRetries = 3) {
    let attempt = 0;
    let delay = 500;
    while (attempt <= maxRetries) {
        const response = await fetch(`${GRAPH_BASE}${path}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json'
            }
        });
        if (response.ok) {
            return await response.json();
        }
        if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
            await sleep(delay);
            delay *= 2;
            attempt += 1;
            continue;
        }
        const text = await response.text();
        throw new Error(`Graph request failed (${response.status}) on ${path}: ${text || response.statusText}`);
    }
    throw new Error(`Graph request exhausted retries on ${path}`);
}
export async function graphList(accessToken, path) {
    const all = [];
    let nextPath = path;
    while (nextPath) {
        const payload = await graphRequest(accessToken, nextPath);
        all.push(...safeArray(payload.value));
        const next = typeof payload['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : '';
        if (!next) {
            nextPath = undefined;
            continue;
        }
        nextPath = next.startsWith(GRAPH_BASE) ? next.replace(GRAPH_BASE, '') : next;
    }
    return all;
}
//# sourceMappingURL=graphClient.js.map