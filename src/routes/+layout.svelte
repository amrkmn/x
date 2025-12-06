<script lang="ts">
    import '../app.css';

    import { selectedDomain } from '$lib/stores/mirror';
    import type { Snippet } from 'svelte';
    import type { LayoutData } from './$types';

    import Footer from '$lib/components/Footer.svelte';

    interface Props {
        children: Snippet;
        data: LayoutData;
    }

    let { children, data }: Props = $props();

    let { source, commitLink, latestCommitHash, domains } = $derived(data);

    $effect(() => {
        if (domains && domains.length > 0) {
            selectedDomain.update((d) => d || domains[0]);
        }
    });
</script>

{@render children()}

<Footer {source} {commitLink} {latestCommitHash} />
