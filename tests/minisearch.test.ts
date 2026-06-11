import { expect, test } from 'bun:test';
import {
    getFilterOptionsFallback,
    initMinisearch,
    searchExtensionsFallback
} from '../src/lib/search/minisearch';
import type { SearchIndexEntry } from '../src/lib/types';

const entries: SearchIndexEntry[] = [
    {
        name: 'Alpha Reader',
        pkg: 'alpha.reader',
        version: '1.0.0',
        lang: 'en',
        apk: 'alpha.apk',
        nsfw: 0,
        repoUrl: '/alpha',
        sourceName: 'Alpha Source',
        formattedSourceName: 'alpha.source',
        category: 'mihon'
    },
    {
        name: 'Beta Anime',
        pkg: 'beta.anime',
        version: '2.0.0',
        lang: 'ja',
        apk: 'beta.apk',
        nsfw: 1,
        repoUrl: '/beta',
        sourceName: 'Beta Source',
        formattedSourceName: 'beta.source',
        category: 'aniyomi'
    }
];

test('MiniSearch fallback filters by source and nsfw', () => {
    initMinisearch(entries);

    const result = searchExtensionsFallback({
        source: 'alpha.source',
        nsfw: false,
        page: 1,
        limit: 10
    });

    expect(result.estimatedTotalHits).toBe(1);
    expect(result.hits[0].pkg).toBe('alpha.reader');
});

test('MiniSearch fallback derives filter options from prebuilt index data', () => {
    initMinisearch(entries);

    const options = getFilterOptionsFallback();

    expect(options.sources).toEqual(['alpha.source', 'beta.source']);
    expect(options.categories).toEqual(['mihon', 'aniyomi']);
    expect(options.languages).toEqual(['en', 'ja']);
});
