import MiniSearch from 'minisearch';
import type { SearchFilters } from './meilisearch.js';
import type { EnrichedExtension } from './types.js';

let miniSearch: MiniSearch | null = null;
let allExtensions: EnrichedExtension[] = [];

/**
 * Initialize MiniSearch index from fetched extension data.
 * Call this once with all extensions loaded from index.min.json files.
 */
export function initMinisearch(extensions: EnrichedExtension[]) {
    allExtensions = extensions;

    miniSearch = new MiniSearch({
        idField: '_id',
        fields: ['name', 'pkg', 'lang', 'sourceName'],
        storeFields: [
            'name',
            'pkg',
            'apk',
            'lang',
            'code',
            'version',
            'nsfw',
            'repoUrl',
            'sourceName',
            'formattedSourceName',
            'category'
        ],
        searchOptions: {
            prefix: true,
            fuzzy: 0.2,
            boost: { name: 2, pkg: 1.5, sourceName: 1 }
        }
    });

    miniSearch.addAll(
        extensions.map((ext) => ({
            ...ext,
            // MiniSearch requires a unique numeric/string id field
            _id: `${ext.formattedSourceName};${ext.pkg}`
        }))
    );
}

export function isMinisearchReady(): boolean {
    return miniSearch !== null && allExtensions.length > 0;
}

/**
 * Search extensions using MiniSearch with same filters as Meilisearch.
 * Returns same shape: { hits, estimatedTotalHits }
 */
export function searchExtensionsFallback(filters: SearchFilters): {
    hits: EnrichedExtension[];
    estimatedTotalHits: number;
} {
    if (!miniSearch) {
        throw new Error('MiniSearch not initialized');
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;

    // Get candidate set — either full-text search or all extensions
    let candidates: EnrichedExtension[];

    if (filters.query && filters.query.trim() !== '') {
        const hits = miniSearch.search(filters.query);
        // hits are sorted by score descending; map back to EnrichedExtension
        candidates = hits
            .map((h) => allExtensions.find((e) => `${e.formattedSourceName};${e.pkg}` === h.id))
            .filter((e): e is EnrichedExtension => e !== undefined);
    } else {
        candidates = [...allExtensions];
    }

    // Apply filters
    if (filters.source && filters.source !== 'all')
        candidates = candidates.filter((e) => e.formattedSourceName === filters.source);
    if (filters.category && filters.category !== 'all')
        candidates = candidates.filter((e) => e.category === filters.category);
    if (filters.lang && filters.lang !== 'all')
        candidates = candidates.filter((e) => e.lang.toLowerCase() === filters.lang!.toLowerCase());
    if (filters.nsfw === false) candidates = candidates.filter((e) => e.nsfw === 0);

    const totalHits = candidates.length;
    const offset = (page - 1) * limit;
    const hits = candidates.slice(offset, offset + limit);

    return { hits, estimatedTotalHits: totalHits };
}

/**
 * Derive filter options from the loaded extension data.
 * Replaces Meilisearch facet queries when in fallback mode.
 */
export function getFilterOptionsFallback(): {
    sources: string[];
    categories: string[];
    languages: string[];
} {
    const sources = [...new Set(allExtensions.map((e) => e.formattedSourceName))];
    const categories = [...new Set(allExtensions.map((e) => e.category))];
    // Deduplicate case-insensitively but preserve original casing (e.g. zh-Hant, pt-BR)
    const seen = new Map<string, string>();
    for (const ext of allExtensions) {
        const key = ext.lang.toLowerCase();
        if (!seen.has(key)) seen.set(key, ext.lang);
    }
    const languages = [...seen.values()];

    return { sources, categories, languages };
}
