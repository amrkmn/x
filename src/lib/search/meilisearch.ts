import type { SearchIndexEntry } from '$lib/types';

export interface MeilisearchConfig {
    host: string;
    apiKey?: string;
}

export interface SearchFilters {
    query?: string;
    source?: string;
    category?: string;
    lang?: string;
    nsfw?: boolean;
    page?: number;
    limit?: number;
}

export interface MeilisearchHit extends SearchIndexEntry {
    id?: string;
}

export interface MeilisearchSearchResponse {
    hits: MeilisearchHit[];
    estimatedTotalHits: number;
}

interface MeilisearchFacetResponse {
    facetDistribution?: {
        formattedSourceName?: Record<string, number>;
        category?: Record<string, number>;
        lang?: Record<string, number>;
    };
}

interface MeilisearchClient {
    host: string;
    apiKey: string;
}

interface SearchRequest {
    q: string;
    limit: number;
    offset: number;
    filter?: string[];
}

interface FacetRequest {
    q: string;
    limit: 0;
    facets: string[];
}

let client: MeilisearchClient | null = null;

export function initMeilisearch(config: MeilisearchConfig) {
    if (!config.host) {
        console.warn('Meilisearch not configured');
        return null;
    }
    client = { host: config.host, apiKey: config.apiKey ?? '' };
    return client;
}

export function transformMeilisearchHit(hit: MeilisearchHit): SearchIndexEntry {
    const extension: SearchIndexEntry = {
        name: hit.name,
        pkg: hit.pkg,
        apk: hit.apk,
        lang: hit.lang,
        code: hit.code,
        version: hit.version,
        nsfw: hit.nsfw,
        repoUrl: hit.repoUrl,
        sourceName: hit.sourceName,
        formattedSourceName: hit.formattedSourceName,
        category: hit.category
    };
    if (hit.iconUrl) extension.iconUrl = hit.iconUrl;
    return extension;
}

export async function searchExtensions(filters: SearchFilters): Promise<MeilisearchSearchResponse> {
    if (!client) {
        throw new Error('Meilisearch client not initialized');
    }

    const filterConditions: string[] = [];

    if (filters.source && filters.source !== 'all') {
        filterConditions.push(`formattedSourceName = "${filters.source}"`);
    }
    if (filters.category && filters.category !== 'all') {
        filterConditions.push(`category = "${filters.category}"`);
    }
    if (filters.lang && filters.lang !== 'all') {
        filterConditions.push(`lang = "${filters.lang}"`);
    }
    if (filters.nsfw === false) {
        filterConditions.push('nsfw = 0');
    }

    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    const body: SearchRequest = {
        q: filters.query || '',
        limit,
        offset
    };

    if (filterConditions.length > 0) body.filter = filterConditions;

    const response = await fetch(`${client.host}/indexes/extensions/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${client.apiKey}`
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`Meilisearch error: ${response.status} ${response.statusText}`);
    }

    // SAFETY: Meilisearch returned a successful search response; its API contract matches this type.
    return (await response.json()) as MeilisearchSearchResponse;
}

export async function getFilterOptions(): Promise<{
    sources: string[];
    categories: string[];
    languages: string[];
}> {
    if (!client) {
        throw new Error('Meilisearch client not initialized');
    }

    const response = await fetch(`${client.host}/indexes/extensions/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${client.apiKey}`
        },
        body: JSON.stringify({
            q: '',
            limit: 0,
            facets: ['formattedSourceName', 'category', 'lang']
        } satisfies FacetRequest)
    });

    if (!response.ok) {
        throw new Error(`Meilisearch error: ${response.status} ${response.statusText}`);
    }

    // SAFETY: Meilisearch returned a successful facet response; its API contract matches this type.
    const result = (await response.json()) as MeilisearchFacetResponse;

    return {
        sources: Object.keys(result.facetDistribution?.formattedSourceName || {}),
        categories: Object.keys(result.facetDistribution?.category || {}),
        languages: Object.keys(result.facetDistribution?.lang || {})
    };
}
