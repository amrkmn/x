export interface BuildTarget {
    name: 'cloudflare' | 'netlify' | 'grebedoc';
    siteUrl: string;
    analyticsDomain: string;
    outDir: string;
}

export const BUILD_TARGETS: readonly BuildTarget[] = [
    {
        name: 'cloudflare',
        siteUrl: 'https://x.noz.one',
        analyticsDomain: 'x.noz.one',
        outDir: 'dist/cloudflare'
    },
    {
        name: 'netlify',
        siteUrl: 'https://x.ujol.dev',
        analyticsDomain: 'x.ujol.dev',
        outDir: 'dist/netlify'
    },
    {
        name: 'grebedoc',
        siteUrl: 'https://x.amar.kim',
        analyticsDomain: 'x.amar.kim',
        outDir: 'dist/grebedoc'
    }
] as const;
