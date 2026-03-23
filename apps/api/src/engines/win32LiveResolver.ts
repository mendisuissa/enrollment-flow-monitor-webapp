export type Win32SearchMode = 'quick' | 'deep';
export type Win32SourceType = 'winget' | 'silentinstallhq' | 'vendor';

export type Win32ResolvedRecord = {
  id: string;
  name: string;
  publisher: string;
  packageId?: string;
  sourceType: Win32SourceType;
  sourceLabel: string;
  sourceUrl: string;
  sourceTitle: string;
  confidence: 'high' | 'medium';
  installCommand: string;
  uninstallCommand: string;
  detectionScript: string;
  detectionSummary: string;
  notes: string[];
  evidence: string[];
};

export type Win32SearchResponse = {
  query: string;
  mode: Win32SearchMode;
  bestMatch: {
    id: string;
    name: string;
    publisher: string;
    packageId?: string;
    source: Win32SourceType;
    confidence: 'high' | 'medium';
    installCommand: string;
    uninstallCommand: string;
    detectScript: string;
    whySelected: string;
    notes: string[];
    evidence: string[];
    sourceUrl?: string;
  } | null;
  alternatives: Array<{
    title: string;
    source: 'winget' | 'silentinstallhq' | 'vendor';
    url: string;
    note: string;
  }>;
  checkedSources: string[];
  message: string;
};

type WingetSearchRow = {
  packageIdentifier: string;
  name: string;
  publisher: string;
  sourceUrl: string;
};

type SilentInstallRow = {
  title: string;
  url: string;
  installCommand?: string;
  uninstallCommand?: string;
  notes: string[];
  evidence: string[];
};

const USER_AGENT = 'ModernEndpoint/1.0';
const DROP_WORDS = new Set(['installer', 'setup', 'silent', 'client', 'enterprise', 'workplace', 'vpn']);
const SYNONYMS: Record<string, string[]> = {
  chrome: ['google chrome', 'chrome enterprise'],
  brave: ['brave browser'],
  firefox: ['mozilla firefox'],
  vscode: ['visual studio code', 'vs code'],
  teams: ['microsoft teams'],
  anyconnect: ['cisco anyconnect', 'cisco secure client', 'cisco secure mobility client'],
  zoom: ['zoom workplace', 'zoom'],
  acrobat: ['adobe acrobat reader', 'acrobat reader']
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slug(text: string) {
  return normalize(text).replace(/\s+/g, '-') || 'app';
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (m) => m.toUpperCase());
}

function htmlDecode(text: string) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(text: string) {
  return htmlDecode(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tokenize(text: string) {
  return normalize(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !DROP_WORDS.has(token));
}

function expandQueries(query: string, mode: Win32SearchMode) {
  const trimmed = query.trim();
  const values = new Set<string>([trimmed]);
  const normalized = normalize(trimmed);
  const tokens = tokenize(trimmed);

  for (const token of tokens) {
    for (const synonym of SYNONYMS[token] ?? []) values.add(synonym);
  }

  if (SYNONYMS[normalized]) {
    for (const synonym of SYNONYMS[normalized]) values.add(synonym);
  }

  if (tokens.length > 1) {
    values.add(titleCase(tokens.join(' ')));
    values.add(tokens.join(' '));
  }

  if (mode === 'deep') {
    for (const value of [...values]) {
      values.add(`${value} silent install`);
      values.add(`${value} install uninstall`);
    }
  }

  return [...values].filter(Boolean);
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url} (${response.status}).`);
  return await response.text();
}

async function searchWingetCatalog(query: string): Promise<WingetSearchRow[]> {
  const html = await fetchText(`https://winget.run/search?query=${encodeURIComponent(query)}`);
  const matches = html.matchAll(/\/pkg\/([^"'?#<\s]+)\/([^"'?#<\s]+)/g);
  const seen = new Set<string>();
  const rows: WingetSearchRow[] = [];

  for (const match of matches) {
    const publisher = decodeURIComponent(match[1] ?? '').trim();
    const name = decodeURIComponent(match[2] ?? '').trim();
    if (!publisher || !name) continue;
    const packageIdentifier = `${publisher}.${name}`;
    if (seen.has(packageIdentifier)) continue;
    seen.add(packageIdentifier);
    rows.push({
      packageIdentifier,
      name: name.replace(/[-_.]+/g, ' '),
      publisher,
      sourceUrl: `https://winget.run/pkg/${publisher}/${name}`
    });
    if (rows.length >= 10) break;
  }

  return rows;
}

function extractCommandsFromHtml(html: string) {
  const blocks = [
    ...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi),
    ...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)
  ].map((match) => stripTags(match[1] ?? ''));

  const candidates = blocks
    .map((line) => line.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))
    .flat()
    .filter((line) => /(msiexec|setup\.exe|\.exe\s|\.msi|\/quiet|\/qn|\/S|\/silent|\/verysilent|uninstall|winget install|winget uninstall)/i.test(line));

  const installCommand = candidates.find((line) => !/uninstall/i.test(line) && /(msiexec|winget install|\/quiet|\/qn|\/s|\/silent|\/verysilent)/i.test(line));
  const uninstallCommand = candidates.find((line) => /uninstall|msiexec\s+\/x|winget uninstall/i.test(line));
  return { installCommand: installCommand?.trim(), uninstallCommand: uninstallCommand?.trim(), evidence: candidates.slice(0, 8) };
}

async function searchSilentInstallHq(query: string): Promise<SilentInstallRow[]> {
  const html = await fetchText(`https://silentinstallhq.com/?s=${encodeURIComponent(query)}`);
  const urls = [...html.matchAll(/href=["'](https:\/\/silentinstallhq\.com\/[^"'#]+)["']/gi)]
    .map((match) => match[1])
    .filter((url): url is string => Boolean(url) && !url.includes('/?s='));
  const uniqueUrls = [...new Set(urls)].slice(0, 5);
  const rows: SilentInstallRow[] = [];

  for (const url of uniqueUrls) {
    try {
      const articleHtml = await fetchText(url);
      const titleMatch = articleHtml.match(/<title>([\s\S]*?)<\/title>/i);
      const title = stripTags(titleMatch?.[1] ?? url);
      const commands = extractCommandsFromHtml(articleHtml);
      if (!commands.installCommand && !commands.uninstallCommand) continue;
      rows.push({
        title,
        url,
        installCommand: commands.installCommand,
        uninstallCommand: commands.uninstallCommand,
        notes: ['Commands captured from Silent Install HQ. Validate against your exact installer media before production use.'],
        evidence: commands.evidence
      });
    } catch {
      // ignore item
    }
  }

  return rows;
}

function buildDetectScript(appName: string) {
  const escapedName = appName.replace(/'/g, "''");
  return `$appName = '${escapedName}'\n$registryPaths = @(\n  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'\n)\n$found = Get-ItemProperty -Path $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like \"*$appName*\" }\nif ($found) {\n  Write-Output \"Detected via registry\"\n  exit 0\n}\nexit 1`;
}

function scoreResult(query: string, candidateName: string, publisher: string, sourceType: Win32SourceType, hasBothCommands: boolean) {
  const qTokens = tokenize(query);
  const cTokens = tokenize(candidateName);
  let score = 0;
  for (const token of qTokens) {
    if (cTokens.includes(token)) score += 30;
    if (normalize(publisher).includes(token)) score += 10;
  }
  if (normalize(candidateName) === normalize(query)) score += 80;
  if (sourceType === 'winget') score += 20;
  if (hasBothCommands) score += 25;
  return score;
}

export async function resolveWin32Search(query: string, mode: Win32SearchMode): Promise<Win32SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      query: '',
      mode,
      bestMatch: null,
      alternatives: [],
      checkedSources: [],
      message: 'Enter an application name to resolve packaging commands.'
    };
  }

  const queries = expandQueries(trimmed, mode);
  const checkedSources: string[] = [];
  const candidates: Array<Win32ResolvedRecord & { score: number }> = [];
  const altMap = new Map<string, { title: string; source: 'winget' | 'silentinstallhq' | 'vendor'; url: string; note: string }>();

  try {
    checkedSources.push('WinGet');
    for (const q of queries) {
      const rows = await searchWingetCatalog(q);
      for (const row of rows) {
        if (candidates.some((item) => item.packageId === row.packageIdentifier)) continue;
        candidates.push({
          id: `winget-${slug(row.packageIdentifier)}`,
          name: row.name,
          publisher: row.publisher,
          packageId: row.packageIdentifier,
          sourceType: 'winget',
          sourceLabel: 'WinGet',
          sourceUrl: row.sourceUrl,
          sourceTitle: row.packageIdentifier,
          confidence: 'high',
          installCommand: `winget install --id ${row.packageIdentifier} --exact --silent --accept-source-agreements --accept-package-agreements`,
          uninstallCommand: `winget uninstall --id ${row.packageIdentifier} --exact --silent`,
          detectionScript: buildDetectScript(row.name),
          detectionSummary: 'Generated detection script based on app name and standard registry uninstall locations.',
          notes: [
            'Install and uninstall commands are source-backed by the WinGet package identifier.',
            'Validate generated detection logic in a packaging VM before production rollout.'
          ],
          evidence: [row.packageIdentifier, row.sourceUrl],
          score: scoreResult(trimmed, row.name, row.publisher, 'winget', true)
        });
        altMap.set(`winget:${row.packageIdentifier}`, {
          title: `${row.name} (${row.publisher})`,
          source: 'winget',
          url: row.sourceUrl,
          note: `WinGet package: ${row.packageIdentifier}`
        });
      }
    }
  } catch {
    // ignore
  }

  try {
    checkedSources.push('Silent Install HQ');
    for (const q of queries) {
      const rows = await searchSilentInstallHq(q);
      for (const row of rows) {
        const cleanTitle = row.title.replace(/\s*[-|].*$/, '').trim();
        const inferredName = cleanTitle.replace(/silent install.*$/i, '').replace(/how to guide.*$/i, '').trim() || trimmed;
        const hasBothCommands = Boolean(row.installCommand && row.uninstallCommand);
        if (!row.installCommand && !row.uninstallCommand) continue;
        if (candidates.some((item) => item.sourceUrl === row.url)) continue;
        candidates.push({
          id: `sihq-${slug(row.url)}`,
          name: inferredName,
          publisher: 'Community source',
          sourceType: 'silentinstallhq',
          sourceLabel: 'Silent Install HQ',
          sourceUrl: row.url,
          sourceTitle: row.title,
          confidence: hasBothCommands ? 'medium' : 'medium',
          installCommand: row.installCommand ?? '',
          uninstallCommand: row.uninstallCommand ?? '',
          detectionScript: buildDetectScript(inferredName),
          detectionSummary: 'Detection script generated from source-backed app title and common uninstall registry locations.',
          notes: row.notes,
          evidence: row.evidence,
          score: scoreResult(trimmed, inferredName, 'Community source', 'silentinstallhq', hasBothCommands)
        });
        altMap.set(`sihq:${row.url}`, {
          title: row.title,
          source: 'silentinstallhq',
          url: row.url,
          note: hasBothCommands ? 'Community article with install and uninstall commands.' : 'Community article with partial packaging guidance.'
        });
      }
    }
  } catch {
    // ignore
  }

  checkedSources.push('Vendor search');
  const vendorQueries = queries.slice(0, mode === 'deep' ? 4 : 2);
  for (const vendorQuery of vendorQueries) {
    const vendorUrl = `https://www.google.com/search?q=${encodeURIComponent(vendorQuery + ' silent install uninstall vendor')}`;
    altMap.set(`vendor:${vendorQuery}`, {
      title: `${vendorQuery} vendor search`,
      source: 'vendor',
      url: vendorUrl,
      note: 'Use this when WinGet and community sources do not return a reliable source-backed package.'
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const sourceBacked = candidates.filter((item) => Boolean(item.installCommand));
  const best = sourceBacked[0] ?? null;
  const alternatives = [...altMap.values()]
    .filter((item) => !best || item.url !== best.sourceUrl)
    .slice(0, mode === 'deep' ? 6 : 3);

  return {
    query: trimmed,
    mode,
    bestMatch: best
      ? {
          id: best.id,
          name: best.name,
          publisher: best.publisher,
          packageId: best.packageId,
          source: best.sourceType,
          confidence: best.confidence,
          installCommand: best.installCommand,
          uninstallCommand: best.uninstallCommand,
          detectScript: best.detectionScript,
          whySelected: `Best source-backed match from ${best.sourceLabel}.`,
          notes: best.notes,
          evidence: best.evidence,
          sourceUrl: best.sourceUrl
        }
      : null,
    alternatives,
    checkedSources,
    message: best
      ? `Resolved ${best.name} from ${best.sourceLabel}.`
      : 'No reliable source-backed package was found for this query. Review alternatives or switch to Deep Search for broader coverage.'
  };
}
