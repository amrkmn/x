// Load local `.env` if present. Real environment values always win.
try {
    process.loadEnvFile();
} catch {}

// Live getters so tests can assign `process.env.X` after import.
export const env = {
    get PUBLIC_SITE_URL(): string | undefined {
        return process.env.PUBLIC_SITE_URL;
    },
    get GITHUB_OUTPUT(): string | undefined {
        return process.env.GITHUB_OUTPUT;
    },
    get GITHUB_TOKEN(): string | undefined {
        return process.env.GITHUB_TOKEN;
    },
    get GITHUB_SHA(): string | undefined {
        return process.env.GITHUB_SHA;
    },
    get GITHUB_REF(): string | undefined {
        return process.env.GITHUB_REF;
    },
    get RELEASE_MANIFEST_FILE(): string | undefined {
        return process.env.RELEASE_MANIFEST_FILE;
    },
    get MEILISEARCH_HOST(): string | undefined {
        return process.env.MEILISEARCH_HOST;
    },
    get MEILISEARCH_MASTER_KEY(): string | undefined {
        return process.env.MEILISEARCH_MASTER_KEY;
    },
    get NO_COLOR(): string | undefined {
        return process.env.NO_COLOR;
    },
    get TERM(): string | undefined {
        return process.env.TERM;
    },
    get CI(): string | undefined {
        return process.env.CI;
    },
    get GITHUB_ACTIONS(): string | undefined {
        return process.env.GITHUB_ACTIONS;
    },
    get GITHUB_EVENT_NAME(): string | undefined {
        return process.env.GITHUB_EVENT_NAME;
    }
};

export function isCI(): boolean {
    return env.CI === 'true' || env.CI === '1' || env.GITHUB_ACTIONS === 'true';
}
