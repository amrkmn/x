import { FunctionComponent } from "preact";

interface Extension {
    pkg: string;
    name: string;
    version: string;
    lang: string;
    apk: string;
    nsfw: number;
    sourceName?: string;
}

interface ExtensionRowProps {
    extension: Extension;
    repoUrl: string;
}

export const ExtensionRow: FunctionComponent<ExtensionRowProps> = ({ extension, repoUrl }) => {
    const handleImageError = (e: Event) => {
        const target = e.target as HTMLImageElement;
        target.src =
            "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMyYzNlNTAiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzZjOGI5ZiIgZm9udC1zaXplPSIxMiI+TjwvdGV4dD48L3N2Zz4=";
    };

    return (
        <tr class="extension-row">
            <td class="icon-cell">
                <img
                    src={`${repoUrl}/icon/${extension.pkg}.png`}
                    alt={extension.name}
                    class="extension-icon-small"
                    loading="lazy"
                    onError={handleImageError}
                />
            </td>
            <td class="info-cell">
                <div class="extension-name">
                    {extension.name}
                    {extension.nsfw === 1 && <span class="nsfw-badge">NSFW</span>}
                </div>
                <div class="extension-pkg">{extension.pkg}</div>
                {extension.sourceName && <div class="extension-source">Source: {extension.sourceName}</div>}
            </td>
            <td class="meta-cell">
                <span class="version">v{extension.version}</span>
                <span class="lang">{extension.lang}</span>
            </td>
            <td class="action-cell">
                <a href={`${repoUrl}/apk/${extension.apk}`} class="btn btn-primary btn-sm">
                    Download
                </a>
            </td>
        </tr>
    );
};
