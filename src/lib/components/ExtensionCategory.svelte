<script lang="ts">
    import ExtensionCard from './ExtensionCard.svelte';
    import type { ExtensionRepo } from '$lib/types';

    interface Props {
        category: string;
        repos: ExtensionRepo[];
        selectedDomain: string;
    }

    let { category, repos, selectedDomain }: Props = $props();

    let protocol = $derived(category.toLowerCase() === 'mihon' ? 'tachiyomi' : 'aniyomi');
    let title = $derived(category.charAt(0).toUpperCase() + category.slice(1));
</script>

<div class={category}>
    <h2>{title} Extensions</h2>
    <div class="grid">
        {#each repos as repo}
            <ExtensionCard {repo} {protocol} {selectedDomain} />
        {/each}
    </div>
</div>
