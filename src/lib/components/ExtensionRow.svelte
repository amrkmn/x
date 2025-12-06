<script lang="ts">
    import type { Extension } from '$lib/types';

    interface Props {
        extension: Extension;
        repoUrl: string;
    }

    let { extension, repoUrl }: Props = $props();

    function handleImageError(e: Event) {
        const target = e.target as HTMLImageElement;
        target.src =
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMyYzNlNTAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzZjOGI5ZiIgZm9udC1zaXplPSIxMiI+TjwvdGV4dD48L3N2Zz4=';
    }
</script>

<tr class="extension-row">
    <td class="icon-cell">
        <img
            src={`${repoUrl}/icon/${extension.pkg}.png`}
            alt={extension.name}
            class="extension-icon-small"
            loading="lazy"
            onerror={handleImageError}
        />
    </td>
    <td class="info-cell">
        <div class="extension-name">
            {extension.name}
            {#if extension.nsfw === 1}
                <span class="nsfw-badge">NSFW</span>
            {/if}
        </div>
        <div class="extension-pkg">{extension.pkg}</div>
        {#if extension.sourceName}
            <div class="extension-source">Source: {extension.sourceName}</div>
        {/if}
    </td>
    <td class="meta-cell">
        <span class="version">v{extension.version}</span>
        <span class="lang">{extension.lang}</span>
    </td>
    <td class="action-cell">
        <a href={`${repoUrl}/apk/${extension.apk}`} class="btn btn-primary btn-sm"> Download </a>
    </td>
</tr>

<style>
    .info-cell {
        max-width: 200px;
    }

    .extension-name,
    .extension-pkg,
    .extension-source {
        word-wrap: break-word;
        overflow-wrap: break-word;
    }
</style>
