<script lang="ts">
    import ExtensionRow from '$lib/components/ExtensionRow.svelte';
    import { debounce } from '$lib/search/debounce.js';
    import {
        getFilterOptions,
        initMeilisearch,
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
    import { findSourceByFormattedName, formatSourceName } from '$lib/search/utils.js';
    import type { AppData } from '$lib/types.js';
    import { parseSearchIndex } from '$lib/validation.js';
    import { onMount } from 'svelte';

    interface Props {
        data: AppData;
    }

    const { data: _data }: Props = $props();

    let initializing = $state(true);
    let searching = $state(false);
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
    let meilisearchEnabled = $state(false);
    let minisearchReady = $state(false);
    let loadingOfflineIndex = $state(false);
    let forceMinisearch = $state(false);
    let searchReady = $state(false);

    let query = $state('');
    let selectedSource = $state('all');
    let selectedCategory = $state('all');
    let selectedLanguage = $state('all');
    let showNSFW = $state(true);
    let sort = $state<'relevance' | 'asc' | 'desc'>('relevance');

    let searchRequestId = 0;
    let minisearchLoadPromise: Promise<void> | null = null;
    let queryUrlSyncTimer: ReturnType<typeof setTimeout> | null = null;

    function syncQueryToUrl() {
        if (queryUrlSyncTimer) clearTimeout(queryUrlSyncTimer);
        queryUrlSyncTimer = setTimeout(() => {
            const params = new URLSearchParams(window.location.search);
            if (query) params.set('q', query);
            else params.delete('q');
            params.set('page', '1');
            window.history.replaceState({}, '', `?${params.toString()}`);
            // Keep local state in sync without clobbering input focus:
            currentPage = 1;
        }, 350);
    }

    function handleQueryInput() {
        currentPage = 1;
        syncQueryToUrl();
    }

    function clearQuery() {
        if (queryUrlSyncTimer) clearTimeout(queryUrlSyncTimer);
        query = '';
        currentPage = 1;
        const params = new URLSearchParams(window.location.search);
        params.delete('q');
        params.set('page', '1');
        window.history.replaceState({}, '', `?${params.toString()}`);
        document.getElementById('search-input')?.focus();
    }

    function setSort(direction: 'relevance' | 'asc' | 'desc') {
        updateParams({ sort: direction === 'relevance' ? null : direction });
    }

    const hasActiveFilters = $derived(
        query !== '' ||
            selectedSource !== 'all' ||
            selectedCategory !== 'all' ||
            selectedLanguage !== 'all' ||
            !showNSFW ||
            forceMinisearch ||
            sort !== 'relevance' ||
            resultsPerPage !== 10
    );

    function resetFilters() {
        if (queryUrlSyncTimer) clearTimeout(queryUrlSyncTimer);
        query = '';
        selectedSource = 'all';
        selectedCategory = 'all';
        selectedLanguage = 'all';
        showNSFW = true;
        forceMinisearch = false;
        sort = 'relevance';
        resultsPerPage = 10;
        currentPage = 1;
        window.history.replaceState({}, '', window.location.pathname);
    }

    function parsePage(value: string | null): number {
        const parsed = Number.parseInt(value ?? '1', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    }

    function readUrlParams() {
        const params = new URLSearchParams(window.location.search);
        query = params.get('q') ?? '';
        selectedSource = findSourceByFormattedName(params.get('source') ?? 'all', sources);
        selectedCategory = params.get('category') ?? 'all';
        selectedLanguage = params.get('lang') ?? 'all';
        showNSFW = params.get('nsfw') !== '0';
        currentPage = parsePage(params.get('page'));
        const rawSort = params.get('sort');
        sort =
            rawSort === 'desc' || rawSort === 'name-desc'
                ? 'desc'
                : rawSort === 'asc' || rawSort === 'name-asc'
                  ? 'asc'
                  : 'relevance';
        const rawPerPage = Number.parseInt(params.get('perPage') ?? '10', 10);
        resultsPerPage = [10, 20, 50].includes(rawPerPage) ? rawPerPage : 10;
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
        selectedSource = findSourceByFormattedName(selectedSource, sources);
    }

    async function ensureMinisearchReady() {
        if (minisearchReady) return;
        if (minisearchLoadPromise) {
            await minisearchLoadPromise;
            return;
        }

        minisearchLoadPromise = (async () => {
            loadingOfflineIndex = true;

            const response = await fetch('/indexes.json');
            if (!response.ok) {
                throw new Error(`Failed to fetch indexes.json: ${response.status}`);
            }

            const allExtensions = parseSearchIndex(await response.json());
            initMinisearch(allExtensions);
            minisearchReady = true;
            applyFilterOptions(getFilterOptionsFallback());
            readUrlParams();
        })();

        try {
            await minisearchLoadPromise;
        } finally {
            loadingOfflineIndex = false;
            minisearchLoadPromise = null;
        }
    }

    async function performSearch(
        requestId: number,
        q: string,
        source: string,
        category: string,
        lang: string,
        nsfw: boolean,
        page: number,
        offlineOnly: boolean,
        sortOrder: string,
        limit: number
    ) {
        const filters = {
            query: q || undefined,
            source: source !== 'all' ? formatSourceName(source) : undefined,
            category: category !== 'all' ? category : undefined,
            lang: lang !== 'all' ? lang : undefined,
            nsfw,
            page,
            limit,
            sort:
                sortOrder === 'relevance'
                    ? undefined
                    : sortOrder === 'desc'
                      ? 'name-desc'
                      : 'name-asc'
        };

        try {
            if (meilisearchEnabled && !offlineOnly) {
                const searchResults = await searchExtensions(filters);
                if (requestId !== searchRequestId) return;

                results = searchResults.hits.map(transformMeilisearchHit);
                totalHits = searchResults.estimatedTotalHits || searchResults.hits.length;
                totalPages = Math.max(1, Math.ceil(totalHits / resultsPerPage));
                currentPage = page;
                hasSearched = true;
                usingFallback = false;
                error = null;
                return;
            }

            if (!isMinisearchReady()) {
                await ensureMinisearchReady();
            }

            const fallbackResults = searchExtensionsFallback(filters);
            if (requestId !== searchRequestId) return;

            results = fallbackResults.hits;
            totalHits = fallbackResults.estimatedTotalHits;
            totalPages = Math.max(1, Math.ceil(totalHits / resultsPerPage));
            currentPage = page;
            hasSearched = true;
            usingFallback = true;
            error = null;
        } catch {
            if (requestId !== searchRequestId) return;

            if (!isMinisearchReady()) {
                try {
                    await ensureMinisearchReady();
                } catch {
                    // fall through to shared error handling
                }
            }

            if (isMinisearchReady()) {
                try {
                    const fallbackResults = searchExtensionsFallback(filters);
                    results = fallbackResults.hits;
                    totalHits = fallbackResults.estimatedTotalHits;
                    totalPages = Math.max(1, Math.ceil(totalHits / resultsPerPage));
                    currentPage = page;
                    hasSearched = true;
                    usingFallback = true;
                    error = null;
                    return;
                } catch {
                    // fall through to shared error handling
                }
            }

            error = 'Search is unavailable. Please try again later.';
            results = [];
            totalHits = 0;
            totalPages = 1;
            hasSearched = true;
        } finally {
            if (requestId === searchRequestId) {
                searching = false;
            }
        }
    }

    const debouncedSearch = debounce(
        (
            requestId: number,
            q: string,
            source: string,
            category: string,
            lang: string,
            nsfw: boolean,
            page: number,
            offlineOnly: boolean,
            sortOrder: string,
            limit: number
        ) => {
            void performSearch(
                requestId,
                q,
                source,
                category,
                lang,
                nsfw,
                page,
                offlineOnly,
                sortOrder,
                limit
            );
        },
        300
    );

    $effect(() => {
        if (!searchReady) return;

        const requestId = ++searchRequestId;
        searching = true;
        error = null;

        debouncedSearch(
            requestId,
            query,
            selectedSource,
            selectedCategory,
            selectedLanguage,
            showNSFW,
            currentPage,
            forceMinisearch,
            sort,
            resultsPerPage
        );
    });

    onMount(async () => {
        const handlePopState = () => readUrlParams();
        window.addEventListener('popstate', handlePopState);
        readUrlParams();

        try {
            const meiliConfig = {
                host: import.meta.env.PUBLIC_MEILISEARCH_HOST || '',
                apiKey: import.meta.env.PUBLIC_MEILISEARCH_DEFAULT_SEARCH_KEY
            };

            if (meiliConfig.host) {
                initMeilisearch(meiliConfig);
                meilisearchEnabled = true;
            }
        } catch (e) {
            console.error('Failed to initialize Meilisearch:', e);
        }

        try {
            if (meilisearchEnabled) {
                applyFilterOptions(await getFilterOptions());
                readUrlParams();
            } else {
                await ensureMinisearchReady();
            }
        } catch (e) {
            console.error('Failed to initialize search:', e);

            if (!meilisearchEnabled) {
                error = 'Search is unavailable. Please try again later.';
            }
        } finally {
            searchReady = meilisearchEnabled || minisearchReady;
            initializing = false;
        }

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (queryUrlSyncTimer) clearTimeout(queryUrlSyncTimer);
        };
    });
</script>

<div class="container container-wide">
    <div class="page-header">
        <h1>Search Extensions</h1>
        <a href="/" class="btn btn-secondary header-btn" data-astro-prefetch="hover">Home</a>
    </div>
    <div class="search-container search-with-clear">
        <label for="search-input" class="visually-hidden"
            >Search extensions by name or package</label
        >
        <input
            id="search-input"
            type="text"
            class="search-input"
            placeholder="Search by name or package..."
            autocomplete="off"
            spellcheck={false}
            bind:value={query}
            oninput={handleQueryInput}
        />
        {#if query}
            <button
                type="button"
                class="btn btn-secondary btn-sm search-clear"
                onclick={clearQuery}
                aria-label="Clear search"
            >
                Clear
            </button>
        {/if}
    </div>
    <div class="filter-bar">
        <div class="filter-group filter-cat">
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
        <div class="filter-group filter-src">
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
        <div class="filter-group filter-lang">
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
        <div class="filter-group filter-sort3">
            <span class="filter-label" id="sort-label">Sort:</span>
            <div class="sort-segment" role="group" aria-labelledby="sort-label">
                <button
                    type="button"
                    class={`btn btn-sm sort-seg-btn ${sort === 'relevance' ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={sort === 'relevance'}
                    aria-label="Sort by relevance"
                    onclick={() => setSort('relevance')}
                >
                    Relevance
                </button>
                <button
                    type="button"
                    class={`btn btn-sm sort-seg-btn ${sort === 'asc' ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={sort === 'asc'}
                    aria-label="Sort names A to Z"
                    onclick={() => setSort('asc')}
                >
                    A–Z
                </button>
                <button
                    type="button"
                    class={`btn btn-sm sort-seg-btn ${sort === 'desc' ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={sort === 'desc'}
                    aria-label="Sort names Z to A"
                    onclick={() => setSort('desc')}
                >
                    Z–A
                </button>
            </div>
        </div>
        <div class="filter-group filter-nsfwbox">
            <label class="filter-check">
                <input
                    type="checkbox"
                    checked={showNSFW}
                    onchange={(e) => updateParams({ nsfw: e.currentTarget.checked ? null : '0' })}
                />
                <span>Show NSFW</span>
            </label>
        </div>
        <div class="filter-group filter-reset-cell">
            <button
                type="button"
                class="btn btn-secondary btn-sm"
                disabled={!hasActiveFilters}
                onclick={resetFilters}
            >
                Reset filters
            </button>
        </div>
    </div>
    <div class="results-toolbar">
        <div class="results-status" role="status" aria-live="polite">
            {#if initializing}
                Loading extensions…
            {:else if searching}
                Searching…
            {:else if hasSearched}
                {#if totalHits > 0}
                    Showing {Math.min((currentPage - 1) * resultsPerPage + 1, totalHits)} to {Math.min(
                        currentPage * resultsPerPage,
                        totalHits
                    )} of {totalHits} results
                {:else}
                    No results found{query ? ` for "${query}"` : ''}.
                {/if}
            {/if}
        </div>
        <label class="perpage-label" for="perpage-select">
            Per page:
            <select
                id="perpage-select"
                class="perpage-select"
                value={resultsPerPage.toString()}
                onchange={(e) =>
                    updateParams({
                        perPage: e.currentTarget.value === '10' ? null : e.currentTarget.value
                    })}
            >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
            </select>
        </label>
    </div>
    <div class="table-container" aria-busy={searching || initializing}>
        <table class="extensions-table">
            <thead>
                <tr>
                    <th scope="col" style="width: 60px;">Icon</th>
                    <th scope="col">Name / Package</th>
                    <th scope="col">Version / Lang</th>
                    <th scope="col" style="width: 150px;">Action</th>
                </tr>
            </thead>
            <tbody>
                {#if (initializing || searching) && results.length === 0}
                    {#each Array.from({ length: 5 }) as _, i (i)}
                        <tr class="skeleton-row" aria-hidden="true">
                            <td class="icon-cell"><div class="skeleton-bar skeleton-icon"></div></td
                            >
                            <td class="info-cell"
                                ><div class="skeleton-bar" style="width: 70%;"></div>
                                <div
                                    class="skeleton-bar skeleton-sub"
                                    style="width: 45%;"
                                ></div></td
                            >
                            <td class="meta-cell"
                                ><div class="skeleton-bar" style="width: 60px;"></div></td
                            >
                            <td class="action-cell"
                                ><div
                                    class="skeleton-bar"
                                    style="width: 64px; height: 30px;"
                                ></div></td
                            >
                        </tr>
                    {/each}
                {:else}
                    {#each results as ext (ext.formattedSourceName + ';' + ext.pkg)}
                        <ExtensionRow extension={ext} repoUrl={ext.repoUrl} />
                    {/each}
                {/if}
            </tbody>
        </table>
    </div>
    {#if totalPages > 1}
        {@const startPage = Math.max(1, currentPage - 2)}
        {@const endPage = Math.min(totalPages, startPage + 4)}
        <div class="pagination-container">
            <nav class="pagination-controls" aria-label="Search results pages">
                <button
                    class="btn btn-secondary btn-sm"
                    disabled={currentPage === 1}
                    onclick={() => updateParams({ page: '1' })}
                    title="First page"
                    aria-label="Go to first page"
                >
                    &lt;&lt;
                </button>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={currentPage === 1}
                    aria-label="Go to previous page"
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
                            aria-label={`Go to page ${pageNum}`}
                            aria-current={pageNum === currentPage ? 'page' : undefined}
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
                    aria-label="Go to next page"
                    onclick={() => updateParams({ page: (currentPage + 1).toString() })}
                >
                    &gt;
                </button>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={currentPage === totalPages}
                    title="Last page"
                    aria-label="Go to last page"
                    onclick={() => updateParams({ page: totalPages.toString() })}
                >
                    &gt;&gt;
                </button>
            </nav>
        </div>
    {/if}

    {#if !initializing && !searching && results.length === 0 && hasSearched && hasActiveFilters}
        <div style="text-align: center; padding: 12px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick={resetFilters}>
                Clear filters
            </button>
        </div>
    {/if}
    {#if error}
        <div role="alert" style="text-align: center; margin-top: 50px; color: red;">{error}</div>
    {/if}
    {#if meilisearchEnabled}
        <div class="search-backend">
            {#if usingFallback}
                <span>Using offline search</span>
                <span aria-hidden="true">·</span>
            {/if}
            <label class="filter-check">
                <input
                    type="checkbox"
                    checked={forceMinisearch}
                    disabled={loadingOfflineIndex}
                    onchange={() => (forceMinisearch = !forceMinisearch)}
                />
                <span>{loadingOfflineIndex ? 'Loading offline search…' : 'Offline search'}</span>
            </label>
        </div>
    {:else if usingFallback}
        <div class="search-backend">
            <span>Using offline search</span>
        </div>
    {/if}
</div>
