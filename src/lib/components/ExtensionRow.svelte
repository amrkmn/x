<script lang="ts">
    import type { SearchIndexEntry } from '$lib/types';

    interface Props {
        extension: SearchIndexEntry;
        repoUrl: string;
    }

    let { extension, repoUrl }: Props = $props();

    const fallbackIcon =
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMyYzNlNTAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzZjOGI5ZiIgZm9udC1zaXplPSIxMiI+TjwvdGV4dD48L3N2Zz4=';

    function handleImageError(e: Event) {
        // SAFETY: The handler is attached to an img element's error event.
        const target = e.target as HTMLImageElement;
        target.src =
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMyYzNlNTAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzZjOGI5ZiIgZm9udC1zaXplPSIxMiI+TjwvdGV4dD48L3N2Zz4=';
    }
</script>

<tr class="extension-row">
    <td class="icon-cell" data-label="Icon">
        <img
            src={extension.iconUrl ||
                (extension.category === 'mihon'
                    ? fallbackIcon
                    : `${repoUrl}/icon/${extension.pkg}.png`)}
            alt={extension.name}
            class="extension-icon-small"
            loading="lazy"
            width="32"
            height="32"
            onerror={handleImageError}
        />
    </td>
    <td class="info-cell" data-label="Extension">
        <div class="extension-name">
            {#if extension.website}
                <a
                    href={extension.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="extension-name-link"
                    title={`Open ${extension.name} website`}
                >
                    {extension.name}
                </a>
            {:else}
                {extension.name}
            {/if}
            {#if extension.nsfw === 1}
                <span class="nsfw-badge">NSFW</span>
            {/if}
        </div>
        <div class="extension-pkg">{extension.pkg}</div>
        {#if extension.sourceName}
            <div class="extension-source">Source: {extension.sourceName}</div>
        {/if}
    </td>
    <td class="meta-cell" data-label="Version / Lang">
        <span class="version">v{extension.version}</span>
        <span class="lang">{extension.lang}</span>
    </td>
    <td class="action-cell" data-label="Action">
        <div class="action-buttons">
            {#if extension.jarUrl}
                <a
                    href={extension.jarUrl}
                    class="btn btn-secondary btn-sm"
                    aria-label={`Download ${extension.name} version ${extension.version} Jar`}
                    title={`Download ${extension.name} v${extension.version} Jar`}>Jar</a
                >
            {/if}
            <a
                href={extension.apkUrl}
                class="btn btn-primary btn-sm"
                aria-label={`Download ${extension.name} version ${extension.version} APK`}
                title={`Download ${extension.name} v${extension.version} APK`}>APK</a
            >
        </div>
    </td>
</tr>
