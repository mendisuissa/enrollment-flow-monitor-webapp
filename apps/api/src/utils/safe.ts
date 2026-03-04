export function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function asString(value: unknown, fallback = 'Unknown'): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function safeDate(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return new Date(0).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return 'NoData\n';
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escaped = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escaped(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
