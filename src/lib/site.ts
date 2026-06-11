const DEFAULT_SITE_URL = 'https://x.noz.one';

function normalizeBaseUrl(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

const siteUrl = normalizeBaseUrl(import.meta.env.PUBLIC_SITE_URL || DEFAULT_SITE_URL);

export const analyticsDomain = import.meta.env.PUBLIC_ANALYTICS_DOMAIN || new URL(siteUrl).hostname;

export function withSiteUrl(path = '/'): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${siteUrl}${normalizedPath}`;
}
