<script lang="ts">
    import { browser } from '$app/environment';
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { onMount } from 'svelte';

    import ExtensionRow from '$lib/components/ExtensionRow.svelte';
    import { debounce } from '$lib/search/debounce.js';
    import {
        getFilterOptions,
        initMeilisearch,
        searchExtensions,
        transformMeilisearchHit
    } from '$lib/search/meilisearch.js';
    import type { EnrichedExtension } from '$lib/search/types.js';
    import { findSourceByFormattedName, formatSourceName } from '$lib/search/utils.js';

    // Component state (must be declared before derived state that uses them)
    let loading = $state(true);
    let error = $state<string | null>(null);
    let results = $state<EnrichedExtension[]>([]);
    let sources = $state<string[]>(['all']);
    let categories = $state<string[]>(['all']);
    let languages = $state<string[]>(['all']);

    // Derived state from URL parameters
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

    // URL parameter management
    function updateParams(updates: Record<string, string | null>) {
        const params = new URLSearchParams(page.url.searchParams);
        for (const [key, value] of Object.entries(updates)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
        }
        goto(`?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
    }

    // Initialize Meilisearch
    onMount(async () => {
        try {
            const meiliConfig = {
                host: import.meta.env.VITE_MEILISEARCH_HOST || '',
                apiKey: import.meta.env.VITE_MEILISEARCH_DEFAULT_SEARCH_KEY
            };

            if (!meiliConfig.host) {
                error = 'Meilisearch is not configured.';
                return;
            }

            initMeilisearch(meiliConfig);
        } catch (e) {
            console.error(e);
            error = 'Failed to initialize Meilisearch.';
        } finally {
            loading = false;
        }
    });

    // Debounced search with 300ms delay
    const debouncedSearch = debounce(
        (query: string, source: string, category: string, lang: string, nsfw: boolean) => {
            searchExtensions(
                {
                    query: query || undefined,
                    source: source !== 'all' ? formatSourceName(source) : undefined,
                    category: category !== 'all' ? category : undefined,
                    lang: lang !== 'all' ? lang : undefined,
                    nsfw: nsfw
                },
                50
            )
                .then((searchResults) => {
                    results = searchResults.hits.map(transformMeilisearchHit);
                })
                .catch((err) => {
                    console.error('Meilisearch error:', err);
                    error = 'Search failed. Please try again.';
                });
        },
        300
    );

    // Reactive search effect
    $effect(() => {
        if (!browser) return;
        debouncedSearch(query, selectedSource, selectedCategory, selectedLanguage, showNSFW);
    });

    // Load filter options from Meilisearch
    $effect(() => {
        if (!browser) return;
        getFilterOptions()
            .then((options) => {
                sources = [...new Set(['all', ...options.sources.sort()])];
                categories = [...new Set(['all', ...options.categories.sort()])];
                languages = [...new Set(['all', ...options.languages.sort()])];
            })
            .catch((err) => {
                console.error('Failed to load filter options:', err);
            });
    });
</script>

<div class="container">
    <div class="page-header">
        <h1>Search Extensions</h1>
        <a href="/" class="btn btn-secondary header-btn"> Home </a>
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
    {#if results.length === 0 && !loading}
        <div style="text-align: center; padding: 20px;">No results found.</div>
    {/if}
    {#if loading}
        <div style="text-align: center; padding: 20px;">Loading extensions...</div>
    {/if}
    {#if error}
        <div style="text-align: center; margin-top: 50px; color: red;">{error}</div>
    {/if}
</div>
