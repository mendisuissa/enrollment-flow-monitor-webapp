export declare function safeArray<T>(value: unknown): T[];
export declare function asString(value: unknown, fallback?: string): string;
export declare function safeDate(value: unknown): string;
export declare function toCsv(rows: Record<string, unknown>[]): string;
