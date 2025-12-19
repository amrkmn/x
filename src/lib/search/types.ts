import type { Extension } from '$lib/types';

/**
 * Extension enriched with repository and source information
 */
export interface EnrichedExtension extends Extension {
    repoUrl: string;
    sourceName: string;
    formattedSourceName: string;
    category: string;
}

/**
 * Repository information from data.json
 */
export interface RepoInfo {
    name: string;
    path: string;
    commit: string;
}

/**
 * Repository data grouped by category
 */
export interface RepoData {
    [category: string]: RepoInfo[];
}
