<script lang="ts">
    import ExtensionCategory from '$lib/components/ExtensionCategory.svelte';
    import MirrorSelector from '$lib/components/MirrorSelector.svelte';
    import { selectedDomain } from '$lib/stores/mirror';

    let { data } = $props();
    let { extensions, domains } = $derived(data);
</script>

<svelte:head>
    <title>Mihon & Aniyomi Extensions | Home</title>
    <meta
        name="description"
        content="Browse and download the latest Mihon and Aniyomi extensions. Secure, fast, and community-maintained repository."
    />
    <link rel="canonical" href="https://x.noz.one/" />
</svelte:head>

<div class="container">
    <div class="page-header">
        <h1>Mihon & Aniyomi Extensions</h1>
        <a href="/search" class="btn btn-secondary header-btn"> Search </a>
    </div>

    <MirrorSelector {domains} />

    {#each Object.entries(extensions) as [category, repos]}
        <ExtensionCategory {category} {repos} selectedDomain={$selectedDomain} />
    {/each}
</div>
