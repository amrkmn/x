<script lang="ts">
    import { goto } from '$app/navigation';
    import { page } from '$app/state';
    import { browser } from '$app/environment';
    import type { Extension } from '$lib/types';
    import { onMount } from 'svelte';

    import ExtensionRow from '$lib/components/ExtensionRow.svelte';
    import Fuse from 'fuse.js';

    interface EnrichedExtension extends Extension {
        repoUrl: string;
        sourceName: string;
        formattedSourceName: string;
    }

    let { data } = $props();
    let repoData = $derived(data.extensions);

    let query = $derived(browser ? (page.url.searchParams.get('q') ?? '') : '');
    let extensions = $state<EnrichedExtension[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    const formatSourceName = (sourceName: string) => {
        return sourceName.toLowerCase().replace(/\s+/g, '.');
    };

    const findSourceByFormattedName = (formattedName: string, availableSources: string[]) => {
        if (formattedName === 'all') return 'all';
        return (
            availableSources.find((source) => formatSourceName(source) === formattedName) ?? 'all'
        );
    };

    function updateParams(updates: Record<string, string | null>) {
        const params = new URLSearchParams(page.url.searchParams);
        for (const [key, value] of Object.entries(updates)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
        }
        goto(`?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
    }

    onMount(async () => {
        try {
            const promises = [];

            for (const category in repoData) {
                for (const repo of repoData[category]) {
                    const promise = fetch(repo.path)
                        .then((res) => res.json())
                        .then((extList: Extension[]) => {
                            const repoFolder = repo.path.substring(0, repo.path.lastIndexOf('/'));
                            return extList.map((ext) => ({
                                ...ext,
                                repoUrl: repoFolder,
                                sourceName: repo.name,
                                formattedSourceName: formatSourceName(repo.name)
                            }));
                        })
                        .catch((err) => {
                            console.error(`Failed to load extensions from ${repo.name}`, err);
                            return [];
                        });
                    promises.push(promise);
                }
            }

            const results = await Promise.all(promises);
            extensions = results.flat();
        } catch (e) {
            console.error(e);
            error = 'Failed to load extension data.';
        } finally {
            loading = false;
        }
    });

    let fuse = $derived(
        new Fuse(extensions, {
            keys: ['name', 'pkg'],
            threshold: 0.4
        })
    );

    let sources = $derived.by(() => {
        const _sources = extensions.map((ext) => ext.sourceName);
        return [...new Set(['all', ...Array.from(_sources).sort()])];
    });

    let languages = $derived.by(() => {
        const _langs = extensions.map((ext) => ext.lang);
        return [...new Set(['all', ...Array.from(_langs).sort()])];
    });

    let selectedSource = $derived(
        browser
            ? findSourceByFormattedName(page.url.searchParams.get('source') ?? 'all', sources)
            : 'all'
    );
    let selectedLanguage = $derived(browser ? (page.url.searchParams.get('lang') ?? 'all') : 'all');
    let showNSFW = $derived(browser ? page.url.searchParams.get('nsfw') !== '0' : true);

    let results = $derived.by(() => {
        let filtered = extensions;

        if (query) filtered = fuse.search(query).map((result) => result.item);
        if (selectedSource !== 'all')
            filtered = filtered.filter((ext) => ext.sourceName === selectedSource);
        if (selectedLanguage !== 'all')
            filtered = filtered.filter((ext) => ext.lang === selectedLanguage);
        if (!showNSFW) filtered = filtered.filter((ext) => ext.nsfw !== 1);

        return filtered;
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
                        {source === 'all' ? 'All Sources' : source}
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
                        {lang === 'all' ? 'All Languages' : lang}
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
                {#each results.slice(0, 50) as ext (ext.formattedSourceName + ';' + ext.pkg)}
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
