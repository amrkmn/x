import type { AppData, Extension, ExtensionRepo, SearchIndexEntry } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid ${path}: expected non-empty string`);
    }
    return value;
}

function asOptionalNumber(value: unknown, path: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`Invalid ${path}: expected number`);
    }
    return value;
}

function asOptionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new Error(`Invalid ${path}: expected string`);
    }
    return value;
}

function asArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid ${path}: expected array`);
    }
    return value;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`Invalid ${path}: expected object`);
    }
    return value;
}

function asNsfw(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    throw new Error(`Invalid ${path}: expected boolean or number`);
}

function withOptionalStringProperty<K extends string>(
    key: K,
    value: string | undefined
): Partial<Record<K, string>> {
    if (!value) return {};
    return { [key]: value } as Partial<Record<K, string>>;
}

export function parseExtension(value: unknown, path: string): Extension {
    const record = asRecord(value, path);
    const sourceName = asOptionalString(record.sourceName, `${path}.sourceName`);

    return {
        pkg: asString(record.pkg, `${path}.pkg`),
        name: asString(record.name, `${path}.name`),
        version: asString(record.version, `${path}.version`),
        lang: asString(record.lang, `${path}.lang`),
        apk: asString(record.apk, `${path}.apk`),
        nsfw: asNsfw(record.nsfw, `${path}.nsfw`),
        ...withOptionalStringProperty('sourceName', sourceName)
    };
}

function parseExtensionRepo(value: unknown, path: string): ExtensionRepo {
    const record = asRecord(value, path);
    const commit = asOptionalString(record.commit, `${path}.commit`);

    return {
        source: asString(record.source, `${path}.source`),
        name: asString(record.name, `${path}.name`),
        path: asString(record.path, `${path}.path`),
        ...withOptionalStringProperty('commit', commit)
    };
}

function parseExtensionsByCategory(value: unknown): AppData['extensions'] {
    const extensionsRecord = asRecord(value, 'app data.extensions');

    return Object.fromEntries(
        Object.entries(extensionsRecord).map(([category, repos], categoryIndex) => [
            category,
            asArray(repos, `app data.extensions.${category}`).map((repo, repoIndex) =>
                parseExtensionRepo(repo, `app data.extensions[${categoryIndex}][${repoIndex}]`)
            )
        ])
    );
}

export function parseAppData(value: unknown): AppData {
    const record = asRecord(value, 'app data');

    return {
        extensions: parseExtensionsByCategory(record.extensions),
        domains: asArray(record.domains, 'app data.domains').map((domain, index) =>
            asString(domain, `app data.domains[${index}]`)
        ),
        source: asString(record.source, 'app data.source'),
        commitLink: asString(record.commitLink, 'app data.commitLink'),
        latestCommitHash: asString(record.latestCommitHash, 'app data.latestCommitHash')
    };
}

function parseSearchIndexEntry(value: unknown, path: string): SearchIndexEntry {
    const record = asRecord(value, path);
    const extension = parseExtension(record, path);

    return {
        ...extension,
        code: asOptionalNumber(record.code, `${path}.code`),
        repoUrl: asString(record.repoUrl, `${path}.repoUrl`),
        sourceName: asString(record.sourceName, `${path}.sourceName`),
        formattedSourceName: asString(record.formattedSourceName, `${path}.formattedSourceName`),
        category: asString(record.category, `${path}.category`)
    };
}

export function parseSearchIndex(value: unknown): SearchIndexEntry[] {
    return asArray(value, 'search index').map((entry, index) =>
        parseSearchIndexEntry(entry, `search index[${index}]`)
    );
}
