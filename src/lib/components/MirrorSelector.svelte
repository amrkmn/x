<script lang="ts">
    import { selectedDomain } from '$lib/stores/mirror';

    interface Props {
        domains: string[];
        initialDomain?: string;
    }

    let { domains, initialDomain = '' }: Props = $props();

    $effect(() => {
        if (domains && domains.length > 0) {
            if ($selectedDomain && domains.includes($selectedDomain)) return;
            let fallback =
                initialDomain && domains.includes(initialDomain) ? initialDomain : domains[0];
            if (typeof window !== 'undefined') {
                const own = window.location.origin;
                if (domains.includes(own)) fallback = own;
            }
            $selectedDomain = fallback;
        }
    });

    function getHostname(url: string) {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
</script>

<div class="controls">
    <label for="mirror-select">Select Mirror:&nbsp;</label>
    <select id="mirror-select" bind:value={$selectedDomain}>
        {#each domains as domain}
            <option value={domain}>{getHostname(domain)}</option>
        {/each}
    </select>
</div>
