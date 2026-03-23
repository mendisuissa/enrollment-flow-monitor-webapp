import { safeArray } from '../utils/safe.js';

const GRAPH_BASE = 'https://graph.microsoft.com';

interface GraphListPayload {
  value?: unknown;
  '@odata.nextLink'?: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function graphRequest<T>(accessToken: string, path: string, maxRetries = 3): Promise<T> {
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
      return await response.json() as T;
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

export async function graphList(accessToken: string, path: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let nextPath: string | undefined = path;

  while (nextPath) {
    const payload: GraphListPayload = await graphRequest<GraphListPayload>(accessToken, nextPath);
    all.push(...safeArray<Record<string, unknown>>(payload.value));

    const next: string = typeof payload['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : '';
    if (!next) {
      nextPath = undefined;
      continue;
    }

    nextPath = next.startsWith(GRAPH_BASE) ? next.replace(GRAPH_BASE, '') : next;
  }

  return all;
}
