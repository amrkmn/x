<script lang="ts">
    import { selectedDomain } from '$lib/stores/mirror';
    import type { ExtensionRepo } from '$lib/types';
    import ExtensionCard from './ExtensionCard.svelte';

    interface Props {
        category: string;
        repos: ExtensionRepo[];
    }

    let { category, repos }: Props = $props();

    let protocol = $derived(category.toLowerCase() === 'mihon' ? 'tachiyomi' : 'aniyomi');
    let title = $derived(category.charAt(0).toUpperCase() + category.slice(1));
</script>

<div class={category}>
    <h2>{title} Extensions</h2>
    <div class="grid">
        {#each repos as repo}
            <ExtensionCard {repo} {protocol} selectedDomain={$selectedDomain} />
        {/each}
    </div>
</div>
