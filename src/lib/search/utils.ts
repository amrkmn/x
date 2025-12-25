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
