/**
 * Formats a source name to lowercase with dots instead of spaces
 */
export function formatSourceName(sourceName: string): string {
    return sourceName.toLowerCase().replace(/\s+/g, '.');
}

/**
 * Finds a source by its formatted name from available sources
 */
export function findSourceByFormattedName(
    formattedName: string,
    availableSources: string[]
): string {
    if (formattedName === 'all') return 'all';
    return availableSources.find((source) => formatSourceName(source) === formattedName) ?? 'all';
}

/**
 * Strips a trailing `@branch` suffix from a repository source URL so it
 * points at the repo root rather than a non-URL `github.com/owner/repo@branch`.
 * e.g. `https://github.com/keiyoushi/extensions@repo` -> `https://github.com/keiyoushi/extensions`
 */
export function stripBranchSuffix(source: string): string {
    const at = source.lastIndexOf('@');
    return at === -1 ? source : source.slice(0, at);
}
