import MiniSearch from 'minisearch';

import type { SearchFilters } from './meilisearch.js';
import type { EnrichedExtension } from './types.js';

let miniSearch: MiniSearch | null = null;
let allExtensions: EnrichedExtension[] = [];

export function initMinisearch(extensions: EnrichedExtension[]) {
    allExtensions = extensions;

    miniSearch = new MiniSearch({
        idField: '_id',
        fields: ['name', 'pkg', 'lang', 'sourceName'],
        storeFields: [
            'name',
            'pkg',
            'apk',
            'apkUrl',
            'jarUrl',
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
            _id: `${ext.formattedSourceName};${ext.pkg}`
        }))
    );
}

export function isMinisearchReady(): boolean {
    return miniSearch !== null && allExtensions.length > 0;
}

export function searchExtensionsFallback(filters: SearchFilters) {
    if (!miniSearch) {
        throw new Error('MiniSearch not initialized');
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;

    let candidates: EnrichedExtension[];

    if (filters.query && filters.query.trim() !== '') {
        const hits = miniSearch.search(filters.query);
        candidates = hits
            .map((h) => allExtensions.find((e) => `${e.formattedSourceName};${e.pkg}` === h.id))
            .filter((e): e is EnrichedExtension => e !== undefined);
    } else {
        candidates = [...allExtensions];
    }

    if (filters.source && filters.source !== 'all')
        candidates = candidates.filter((e) => e.formattedSourceName === filters.source);
    if (filters.category && filters.category !== 'all')
        candidates = candidates.filter((e) => e.category === filters.category);
    if (filters.lang && filters.lang !== 'all')
        candidates = candidates.filter((e) => e.lang.toLowerCase() === filters.lang!.toLowerCase());
    if (filters.nsfw === false) candidates = candidates.filter((e) => e.nsfw === 0);

    if (filters.sort === 'name-asc') candidates.sort((a, b) => a.name.localeCompare(b.name));
    else if (filters.sort === 'name-desc') candidates.sort((a, b) => b.name.localeCompare(a.name));

    const totalHits = candidates.length;
    const offset = (page - 1) * limit;
    const hits = candidates.slice(offset, offset + limit);

    return { hits, estimatedTotalHits: totalHits };
}

export function getFilterOptionsFallback() {
    const sources = [...new Set(allExtensions.map((e) => e.formattedSourceName))];
    const categories = [...new Set(allExtensions.map((e) => e.category))];
    const seen = new Map<string, string>();
    for (const ext of allExtensions) {
        const key = ext.lang.toLowerCase();
        if (!seen.has(key)) seen.set(key, ext.lang);
    }
    const languages = [...seen.values()];

    return { sources, categories, languages };
}
