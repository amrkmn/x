<script lang="ts">
    import ExtensionRow from '$lib/components/ExtensionRow.svelte';
    import { createSearchState } from './search.svelte.js';

    const search = createSearchState();
</script>

<svelte:head>
    <title
        >{search.query ? `Search results for "${search.query}"` : 'Search Extensions'} - Mihon & Aniyomi</title
    >
    <meta
        name="description"
        content="Search and filter Mihon and Aniyomi extensions by name, source, language, and category. Find exactly what you need."
    />
    <link rel="canonical" href="https://x.noz.one/search" />
</svelte:head>

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
            value={search.query}
            oninput={(e) => search.updateParams({ q: e.currentTarget.value || null })}
        />
    </div>
    <div class="filter-bar">
        <div class="filter-group">
            <label for="category-filter">Category:</label>
            <select
                id="category-filter"
                value={search.selectedCategory}
                onchange={(e) =>
                    search.updateParams({
                        category: e.currentTarget.value === 'all' ? null : e.currentTarget.value
                    })}
            >
                {#each search.categories as category (category)}
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
                value={search.selectedSource}
                onchange={(e) => {
                    const val = search.formatSourceName(e.currentTarget.value);
                    search.updateParams({ source: val === 'all' ? null : val });
                }}
            >
                {#each search.sources as source (source)}
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
                value={search.selectedLanguage}
                onchange={(e) =>
                    search.updateParams({
                        lang: e.currentTarget.value === 'all' ? null : e.currentTarget.value
                    })}
            >
                {#each search.languages as lang (lang)}
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
                    checked={search.showNSFW}
                    onchange={(e) =>
                        search.updateParams({ nsfw: e.currentTarget.checked ? null : '0' })}
                />
                <span>Show NSFW</span>
            </label>
        </div>
        {#if search.minisearchReady && search.isMeilisearchEnabled}
            <div class="filter-group filter-checkbox">
                <label>
                    <input
                        type="checkbox"
                        checked={search.forceMinisearch}
                        onchange={() => search.toggleEngine()}
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
                {#each search.results as ext (ext.formattedSourceName + ';' + ext.pkg)}
                    <ExtensionRow extension={ext} repoUrl={ext.repoUrl} />
                {/each}
            </tbody>
        </table>
    </div>
    {#if search.totalPages > 1}
        {@const startPage = Math.max(1, search.currentPage - 2)}
        {@const endPage = Math.min(search.totalPages, startPage + 4)}
        <div class="pagination-container">
            <div class="pagination-info">
                Showing {Math.min(
                    (search.currentPage - 1) * search.resultsPerPage + 1,
                    search.totalHits
                )} to {Math.min(search.currentPage * search.resultsPerPage, search.totalHits)} of {search.totalHits}
                results
            </div>
            <div class="pagination-controls">
                <button
                    class="btn btn-secondary btn-sm"
                    disabled={search.currentPage === 1}
                    onclick={() => search.updateParams({ page: '1' })}
                    title="First page"
                >
                    &lt;&lt;
                </button>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={search.currentPage === 1}
                    onclick={() =>
                        search.updateParams({
                            page:
                                search.currentPage === 1
                                    ? null
                                    : (search.currentPage - 1).toString()
                        })}
                >
                    &lt;
                </button>

                <div class="page-numbers">
                    {#each Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i) as pageNum}
                        <button
                            class="btn btn-sm {pageNum === search.currentPage
                                ? 'btn-primary'
                                : 'btn-secondary'}"
                            onclick={() =>
                                search.updateParams({
                                    page: pageNum === 1 ? null : pageNum.toString()
                                })}
                        >
                            {pageNum}
                        </button>
                    {/each}
                </div>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={search.currentPage === search.totalPages}
                    onclick={() =>
                        search.updateParams({ page: (search.currentPage + 1).toString() })}
                >
                    &gt;
                </button>

                <button
                    class="btn btn-secondary btn-sm"
                    disabled={search.currentPage === search.totalPages}
                    onclick={() => search.updateParams({ page: search.totalPages.toString() })}
                    title="Last page"
                >
                    &gt;&gt;
                </button>
            </div>
        </div>
    {/if}

    {#if search.loading}
        <div style="text-align: center; padding: 20px;">Loading extensions...</div>
    {:else if search.results.length === 0 && search.hasSearched}
        <div style="text-align: center; padding: 20px;">No results found.</div>
    {/if}
    {#if search.error}
        <div style="text-align: center; margin-top: 50px; color: red;">{search.error}</div>
    {/if}
    {#if search.usingFallback}
        <div style="text-align: center; padding: 8px; opacity: 0.5; font-size: 0.8em;">
            Using offline search
        </div>
    {/if}
</div>
