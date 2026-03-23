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
export declare function resolveWin32Search(query: string, mode: Win32SearchMode): Promise<Win32SearchResponse>;
