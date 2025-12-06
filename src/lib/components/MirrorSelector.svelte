<script lang="ts">
    import { selectedDomain } from '$lib/stores/mirror';

    interface Props {
        domains: string[];
    }

    let { domains }: Props = $props();

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
