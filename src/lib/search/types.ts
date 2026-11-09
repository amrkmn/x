import type { SearchIndexEntry } from '$lib/types';

export interface EnrichedExtension extends SearchIndexEntry {}

export interface SearchFilters {
    query?: string;
    source?: string;
    category?: string;
    lang?: string;
    nsfw?: boolean;
    page?: number;
    limit?: number;
    sort?: string;
}
