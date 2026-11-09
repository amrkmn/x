export function formatSourceName(sourceName: string): string {
    return sourceName.toLowerCase().replace(/\s+/g, '.');
}

export function findSourceByFormattedName(
    formattedName: string,
    availableSources: string[]
): string {
    if (formattedName === 'all') return 'all';
    return availableSources.find((source) => formatSourceName(source) === formattedName) ?? 'all';
}

export interface ParsedSource {
    url: string;
    branch?: string;
}

export function parseSourceUrl(source: string): ParsedSource {
    const idx = source.lastIndexOf('@');
    if (idx === -1) return { url: source };
    const url = source.slice(0, idx);
    const branch = source.slice(idx + 1);
    return branch ? { url, branch } : { url };
}

/**
 * Strips `@branch` so the URL points at the repo root.
 * e.g. `https://github.com/keiyoushi/extensions@repo` -> `https://github.com/keiyoushi/extensions`
 */
export function stripBranchSuffix(source: string): string {
    return parseSourceUrl(source).url;
}
