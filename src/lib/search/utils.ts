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

/**
 * Strips `@branch` so the URL points at the repo root.
 * e.g. `https://github.com/keiyoushi/extensions@repo` -> `https://github.com/keiyoushi/extensions`
 */
export function stripBranchSuffix(source: string): string {
    const at = source.lastIndexOf('@');
    return at === -1 ? source : source.slice(0, at);
}
