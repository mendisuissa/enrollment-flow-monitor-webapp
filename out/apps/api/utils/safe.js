export function safeArray(value) {
    return Array.isArray(value) ? value : [];
}
export function asString(value, fallback = 'Unknown') {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}
export function safeDate(value) {
    if (typeof value !== 'string' || value.length === 0) {
        return new Date(0).toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
export function toCsv(rows) {
    if (!rows.length)
        return 'NoData\n';
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const escaped = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((header) => escaped(row[header])).join(','));
    }
    return `${lines.join('\n')}\n`;
}
//# sourceMappingURL=safe.js.map