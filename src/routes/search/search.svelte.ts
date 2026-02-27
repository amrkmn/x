import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { onMount } from 'svelte';

import { debounce } from '$lib/search/debounce.js';
import {
    getFilterOptions,
    initMeilisearch,
    isMeilisearchEnabled,
    searchExtensions,
    transformMeilisearchHit
} from '$lib/search/meilisearch.js';
import {
    getFilterOptionsFallback,
    initMinisearch,
    isMinisearchReady,
    searchExtensionsFallback
} from '$lib/search/minisearch.js';
import type { EnrichedExtension } from '$lib/search/types.js';
import type { AppData } from '$lib/types.js';
import { findSourceByFormattedName, formatSourceName } from '$lib/search/utils.js';

export function createSearchState() {
    // State
    let loading = $state(true);
    let error = $state<string | null>(null);
    let results = $state<EnrichedExtension[]>([]);
    let sources = $state<string[]>(['all']);
    let categories = $state<string[]>(['all']);
    let languages = $state<string[]>(['all']);
    let currentPage = $state(1);
    let totalPages = $state(1);
    let totalHits = $state(0);
    let resultsPerPage = $state(10);
    let hasSearched = $state(false);
    let usingFallback = $state(false);
    let minisearchReady = $state(false); // tracks when MiniSearch finishes loading
    let forceMinisearch = $state(false); // user-controlled engine toggle

    // Derived from URL
    let query = $derived(browser ? (page.url.searchParams.get('q') ?? '') : '');
    let selectedSource = $derived(
        browser
            ? findSourceByFormattedName(page.url.searchParams.get('source') ?? 'all', sources)
            : 'all'
    );
    let selectedCategory = $derived(
        browser ? (page.url.searchParams.get('category') ?? 'all') : 'all'
    );
    let selectedLanguage = $derived(browser ? (page.url.searchParams.get('lang') ?? 'all') : 'all');
    let showNSFW = $derived(browser ? page.url.searchParams.get('nsfw') !== '0' : true);
    let pageParam = $derived(browser ? parseInt(page.url.searchParams.get('page') ?? '1') : 1);

    // URL parameter management
    function updateParams(updates: Record<string, string | null>) {
        const params = new URLSearchParams(page.url.searchParams);

        const filterChanges = Object.keys(updates).filter((key) => key !== 'page');
        if (filterChanges.length > 0) {
            params.set('page', '1');
        }

        for (const [key, value] of Object.entries(updates)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
        }
        goto(`?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
    }

    function applyFilterOptions(options: {
        sources: string[];
        categories: string[];
        languages: string[];
    }) {
        sources = [...new Set(['all', ...options.sources.sort()])];
        categories = [...new Set(['all', ...options.categories.sort()])];
        languages = [...new Set(['all', ...options.languages.sort()])];
    }

    // Debounced search — tries Meilisearch, falls back to MiniSearch
    const debouncedSearch = debounce(
        (
            query: string,
            source: string,
            category: string,
            lang: string,
            nsfw: boolean,
            page: number
        ) => {
            const filters = {
                query: query || undefined,
                source: source !== 'all' ? formatSourceName(source) : undefined,
                category: category !== 'all' ? category : undefined,
                lang: lang !== 'all' ? lang : undefined,
                nsfw,
                page,
                limit: resultsPerPage
            };

            const runMeiliSearch =
                isMeilisearchEnabled() && !forceMinisearch
                    ? searchExtensions(filters)
                    : Promise.reject(new Error('Meilisearch not configured'));

            runMeiliSearch
                .then((searchResults) => {
                    results = searchResults.hits.map(transformMeilisearchHit);
                    totalHits = searchResults.estimatedTotalHits || searchResults.hits.length;
                    totalPages = Math.ceil(totalHits / resultsPerPage);
                    currentPage = page;
                    hasSearched = true;
                    usingFallback = false;
                })
                .catch(() => {
                    if (isMinisearchReady()) {
                        try {
                            const fallbackResults = searchExtensionsFallback(filters);
                            results = fallbackResults.hits;
                            totalHits = fallbackResults.estimatedTotalHits;
                            totalPages = Math.ceil(totalHits / resultsPerPage);
                            currentPage = page;
                            hasSearched = true;
                            usingFallback = true;
                        } catch (fallbackErr) {
                            console.error('Fallback search failed:', fallbackErr);
                            error = 'Search is unavailable. Please try again later.';
                            hasSearched = true;
                        }
                    } else {
                        error = 'Search is unavailable. Please try again later.';
                        hasSearched = true;
                    }
                })
                .finally(() => {
                    loading = false;
                });
        },
        300
    );

    // Reactive search effect — owns loading state
    $effect(() => {
        if (!browser) return;
        // Read forceMinisearch here so Svelte tracks it as a dependency —
        // toggling the engine checkbox will re-run this effect
        void forceMinisearch;
        currentPage = pageParam;
        loading = true;
        error = null;
        debouncedSearch(
            query,
            selectedSource,
            selectedCategory,
            selectedLanguage,
            showNSFW,
            pageParam
        );
    });

    // Load filter options from Meilisearch; if not configured or fails, use fallback.
    // Reactive on minisearchReady so it retries once MiniSearch finishes loading.
    $effect(() => {
        if (!browser) return;
        if (!isMeilisearchEnabled()) {
            // populate from MiniSearch once it's ready
            if (minisearchReady) {
                applyFilterOptions(getFilterOptionsFallback());
            }
            return;
        }
        getFilterOptions()
            .then(applyFilterOptions)
            .catch(() => {
                if (minisearchReady) {
                    applyFilterOptions(getFilterOptionsFallback());
                }
            });
    });

    // Initialize Meilisearch + load extension data for MiniSearch fallback
    onMount(async () => {
        try {
            const meiliConfig = {
                host: import.meta.env.VITE_MEILISEARCH_HOST || '',
                apiKey: import.meta.env.VITE_MEILISEARCH_DEFAULT_SEARCH_KEY
            };
            if (meiliConfig.host) {
                initMeilisearch(meiliConfig);
            }
        } catch (e) {
            console.error('Failed to initialize Meilisearch:', e);
        }

        // Use data already fetched by the layout loader — no duplicate request
        const appData = page.data as AppData;

        try {
            const allExtensions: EnrichedExtension[] = [];

            for (const [category, repos] of Object.entries(appData.extensions)) {
                for (const repo of repos) {
                    try {
                        const indexRes = await fetch(repo.path);
                        if (!indexRes.ok) continue;
                        const index = await indexRes.json();
                        const formattedSourceName = formatSourceName(repo.name);
                        const repoPath = repo.path.split('/').slice(0, -1).join('/');

                        for (const ext of index) {
                            allExtensions.push({
                                ...ext,
                                nsfw: typeof ext.nsfw === 'number' ? ext.nsfw : ext.nsfw ? 1 : 0,
                                category,
                                sourceName: repo.name,
                                formattedSourceName,
                                repoUrl: repoPath
                            });
                        }
                    } catch {
                        // skip repos that fail to load
                    }
                }
            }

            if (allExtensions.length > 0) {
                initMinisearch(allExtensions);
                minisearchReady = true; // triggers $effect to retry filter options if needed
                // If an initial search already failed with an error, clear it — the search
                // $effect will re-run because minisearchReady is now tracked via the
                // filter $effect; but to also re-run search, we clear error and nudge it.
                if (error) {
                    error = null;
                    loading = true;
                    debouncedSearch(
                        query,
                        selectedSource,
                        selectedCategory,
                        selectedLanguage,
                        showNSFW,
                        pageParam
                    );
                }
            }
        } catch (e) {
            console.error('Failed to load extension data for fallback search:', e);
        }
        // Note: loading is intentionally NOT set here — debouncedSearch owns that via its .finally()
    });

    return {
        get loading() {
            return loading;
        },
        get error() {
            return error;
        },
        get results() {
            return results;
        },
        get sources() {
            return sources;
        },
        get categories() {
            return categories;
        },
        get languages() {
            return languages;
        },
        get currentPage() {
            return currentPage;
        },
        get totalPages() {
            return totalPages;
        },
        get totalHits() {
            return totalHits;
        },
        get resultsPerPage() {
            return resultsPerPage;
        },
        get hasSearched() {
            return hasSearched;
        },
        get usingFallback() {
            return usingFallback;
        },
        get forceMinisearch() {
            return forceMinisearch;
        },
        get minisearchReady() {
            return minisearchReady;
        },
        toggleEngine() {
            forceMinisearch = !forceMinisearch;
        },
        get isMeilisearchEnabled() {
            return isMeilisearchEnabled();
        },
        get query() {
            return query;
        },
        get selectedSource() {
            return selectedSource;
        },
        get selectedCategory() {
            return selectedCategory;
        },
        get selectedLanguage() {
            return selectedLanguage;
        },
        get showNSFW() {
            return showNSFW;
        },
        updateParams,
        formatSourceName
    };
}
