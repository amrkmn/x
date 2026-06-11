<script lang="ts">
    import ExtensionRow from '$lib/components/ExtensionRow.svelte';
    import { onMount } from 'svelte';

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

    interface Props {
        data: AppData;
    }

    const { data: _data }: Props = $props();
    void _data;

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

    let searchRequestId = 0;
    let minisearchLoadPromise: Promise<void> | null = null;

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
        offlineOnly: boolean
    ) {
        const filters = {
            query: q || undefined,
            source: source !== 'all' ? formatSourceName(source) : undefined,
            category: category !== 'all' ? category : undefined,
            lang: lang !== 'all' ? lang : undefined,
            nsfw,
            page,
            limit: resultsPerPage
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
            offlineOnly: boolean
        ) => {
            void performSearch(requestId, q, source, category, lang, nsfw, page, offlineOnly);
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
            forceMinisearch
        );
    });

    onMount(async () => {
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
        {#if meilisearchEnabled}
            <div class="filter-group filter-checkbox">
                <label>
                    <input
                        type="checkbox"
                        checked={forceMinisearch}
                        disabled={loadingOfflineIndex}
                        onchange={() => (forceMinisearch = !forceMinisearch)}
                    />
                    <span
                        >{loadingOfflineIndex
                            ? 'Loading offline search…'
                            : 'Use offline search'}</span
                    >
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

    {#if initializing || searching}
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
