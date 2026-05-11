<script lang="ts">
    import ExtensionRow from '$lib/components/ExtensionRow.svelte';
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

    interface Props {
        data: AppData;
    }

    const { data }: Props = $props();

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
    let minisearchReady = $state(false);
    let forceMinisearch = $state(false);

    // URL-based state
    let query = $state('');
    let selectedSource = $state('all');
    let selectedCategory = $state('all');
    let selectedLanguage = $state('all');
    let showNSFW = $state(true);

    function readUrlParams() {
        const params = new URLSearchParams(window.location.search);
        query = params.get('q') ?? '';
        selectedSource = findSourceByFormattedName(params.get('source') ?? 'all', sources);
        selectedCategory = params.get('category') ?? 'all';
        selectedLanguage = params.get('lang') ?? 'all';
        showNSFW = params.get('nsfw') !== '0';
        currentPage = parseInt(params.get('page') ?? '1');
    }

    function updateParams(updates: Record<string, string | null>) {
        const params = new URLSearchParams(window.location.search);

        const filterChanges = Object.keys(updates).filter((key) => key !== 'page');
        if (filterChanges.length > 0) {
            params.set('page', '1');
        }

        for (const [key, value] of Object.entries(updates)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
        }
        window.history.replaceState({}, '', `?${params.toString()}`);
        readUrlParams();
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

    // Debounced search
    const debouncedSearch = debounce(
        (
            q: string,
            source: string,
            category: string,
            lang: string,
            nsfw: boolean,
            page: number
        ) => {
            const filters = {
                query: q || undefined,
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
                        } catch {
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

    // Reactive search
    $effect(() => {
        void forceMinisearch;
        currentPage = parseInt(new URLSearchParams(window.location.search).get('page') ?? '1');
        loading = true;
        error = null;
        debouncedSearch(
            query,
            selectedSource,
            selectedCategory,
            selectedLanguage,
            showNSFW,
            currentPage
        );
    });

    // Load filter options
    $effect(() => {
        if (!isMeilisearchEnabled()) {
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

    // Initialize
    onMount(async () => {
        readUrlParams();

        try {
            const meiliConfig = {
                host: import.meta.env.PUBLIC_MEILISEARCH_HOST || '',
                apiKey: import.meta.env.PUBLIC_MEILISEARCH_DEFAULT_SEARCH_KEY
            };
            if (meiliConfig.host) {
                initMeilisearch(meiliConfig);
            }
        } catch (e) {
            console.error('Failed to initialize Meilisearch:', e);
        }

        try {
            const allExtensions: EnrichedExtension[] = [];

            for (const [category, repos] of Object.entries(data.extensions)) {
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
                        // skip
                    }
                }
            }

            if (allExtensions.length > 0) {
                initMinisearch(allExtensions);
                minisearchReady = true;
                if (error) {
                    error = null;
                    loading = true;
                    debouncedSearch(
                        query,
                        selectedSource,
                        selectedCategory,
                        selectedLanguage,
                        showNSFW,
                        currentPage
                    );
                }
            }
        } catch (e) {
            console.error('Failed to load extension data for fallback search:', e);
        }
    });
</script>

<div class="container">
    <div class="page-header">
        <h1>Search Extensions</h1>
        <a href="/" class="btn btn-secondary header-btn">Home</a>
    </div>
    <div class="search-container">
        <input
            type="text"
            class="search-input"
            placeholder="Search by name or package..."
            value={query}
            oninput={(e) => updateParams({ q: e.currentTarget.value || null })}
        />
    </div>
    <div class="filter-bar">
        <div class="filter-group">
            <label for="category-filter">Category:</label>
            <select
                id="category-filter"
                value={selectedCategory}
                onchange={(e) =>
                    updateParams({
                        category: e.currentTarget.value === 'all' ? null : e.currentTarget.value
                    })}
            >
                {#each categories as category (category)}
                    <option value={category}>
                        {category}
                    </option>
                {/each}
            </select>
        </div>
        <div class="filter-group">
            <label for="source-filter">Source:</label>
            <select
                id="source-filter"
                value={selectedSource}
                onchange={(e) => {
                    const val = formatSourceName(e.currentTarget.value);
                    updateParams({ source: val === 'all' ? null : val });
                }}
            >
                {#each sources as source (source)}
                    <option value={source}>
                        {source}
                    </option>
                {/each}
            </select>
        </div>
        <div class="filter-group">
            <label for="language-filter">Language:</label>
            <select
                id="language-filter"
                value={selectedLanguage}
                onchange={(e) =>
                    updateParams({
                        lang: e.currentTarget.value === 'all' ? null : e.currentTarget.value
                    })}
            >
                {#each languages as lang (lang)}
                    <option value={lang}>
                        {lang}
                    </option>
                {/each}
            </select>
        </div>
        <div class="filter-group filter-checkbox">
            <label>
                <input
                    type="checkbox"
                    checked={showNSFW}
                    onchange={(e) => updateParams({ nsfw: e.currentTarget.checked ? null : '0' })}
                />
                <span>Show NSFW</span>
            </label>
        </div>
        {#if minisearchReady && isMeilisearchEnabled()}
            <div class="filter-group filter-checkbox">
                <label>
                    <input
                        type="checkbox"
                        checked={forceMinisearch}
                        onchange={() => (forceMinisearch = !forceMinisearch)}
                    />
                    <span>Use offline search</span>
                </label>
            </div>
        {/if}
    </div>
    <div class="table-container">
        <table class="extensions-table">
            <thead>
                <tr>
                    <th style="width: 60px;">Icon</th>
                    <th>Name / Package</th>
                    <th>Version / Lang</th>
                    <th style="width: 100px;">Action</th>
                </tr>
            </thead>
            <tbody>
                {#each results as ext (ext.formattedSourceName + ';' + ext.pkg)}
                    <ExtensionRow extension={ext} repoUrl={ext.repoUrl} />
                {/each}
            </tbody>
        </table>
    </div>
    {#if totalPages > 1}
        {@const startPage = Math.max(1, currentPage - 2)}
        {@const endPage = Math.min(totalPages, startPage + 4)}
        <div class="pagination-container">
            <div class="pagination-info">
                Showing {Math.min((currentPage - 1) * resultsPerPage + 1, totalHits)} to {Math.min(
                    currentPage * resultsPerPage,
                    totalHits
                )} of {totalHits}
                results
            </div>
            <div class="pagination-controls">
                <button
                    class="btn btn-secondary btn-sm"
                    disabled={currentPage === 1}
                    onclick={() => updateParams({ page: '1' })}
                    title="First page"
                >
                    &lt;&lt;
                </button>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={currentPage === 1}
                    onclick={() =>
                        updateParams({
                            page: currentPage === 1 ? null : (currentPage - 1).toString()
                        })}
                >
                    &lt;
                </button>

                <div class="page-numbers">
                    {#each Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i) as pageNum}
                        <button
                            class="btn btn-sm {pageNum === currentPage
                                ? 'btn-primary'
                                : 'btn-secondary'}"
                            onclick={() =>
                                updateParams({
                                    page: pageNum === 1 ? null : pageNum.toString()
                                })}
                        >
                            {pageNum}
                        </button>
                    {/each}
                </div>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={currentPage === totalPages}
                    onclick={() => updateParams({ page: (currentPage + 1).toString() })}
                >
                    &gt;
                </button>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={currentPage === totalPages}
                    onclick={() => updateParams({ page: totalPages.toString() })}
                    title="Last page"
                >
                    &gt;&gt;
                </button>
            </div>
        </div>
    {/if}

    {#if loading}
        <div style="text-align: center; padding: 20px;">Loading extensions...</div>
    {:else if results.length === 0 && hasSearched}
        <div style="text-align: center; padding: 20px;">No results found.</div>
    {/if}
    {#if error}
        <div style="text-align: center; margin-top: 50px; color: red;">{error}</div>
    {/if}
    {#if usingFallback}
        <div style="text-align: center; padding: 8px; opacity: 0.5; font-size: 0.8em;">
            Using offline search
        </div>
    {/if}
</div>
