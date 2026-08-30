import type { AppData, Extension, ExtensionRepo, SearchIndexEntry } from './types';

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
    [key: string]: JsonValue;
}

function isRecord(value: JsonValue): value is JsonObject {
    return value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isString(value: JsonValue): value is string {
    return value !== null && value !== undefined && String(value) === value;
}

function asString(value: JsonValue, path: string): string {
    if (!isString(value) || value.length === 0) {
        throw new Error(`Invalid ${path}: expected non-empty string`);
    }
    return value;
}

function asOptionalNumber(value: JsonValue | undefined, path: string): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid ${path}: expected number`);
    }
    return Number(value);
}

function asOptionalString(value: JsonValue | undefined, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (!isString(value)) {
        throw new Error(`Invalid ${path}: expected string`);
    }
    return value;
}

function asArray(value: JsonValue, path: string): JsonValue[] {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid ${path}: expected array`);
    }
    return value;
}

function asRecord(value: JsonValue, path: string): JsonObject {
    if (!isRecord(value)) {
        throw new Error(`Invalid ${path}: expected object`);
    }
    return value;
}

function asNsfw(value: JsonValue, path: string): number {
    if (Number.isFinite(value)) return Number(value);
    if (value === true || value === false) return value ? 1 : 0;
    throw new Error(`Invalid ${path}: expected boolean or number`);
}

export function parseExtension(value: JsonValue, path: string): Extension {
    const record = asRecord(value, path);
    const iconUrl = asOptionalString(record.iconUrl, `${path}.iconUrl`);
    const sourceName = asOptionalString(record.sourceName, `${path}.sourceName`);
    const extension: Extension = {
        pkg: asString(record.pkg, `${path}.pkg`),
        name: asString(record.name, `${path}.name`),
        version: asString(record.version, `${path}.version`),
        lang: asString(record.lang, `${path}.lang`),
        apk: asString(record.apk, `${path}.apk`),
        nsfw: asNsfw(record.nsfw, `${path}.nsfw`)
    };
    if (iconUrl) extension.iconUrl = iconUrl;
    if (sourceName) extension.sourceName = sourceName;
    return extension;
}

function parseExtensionRepo(value: JsonValue, path: string): ExtensionRepo {
    const record = asRecord(value, path);
    const commit = asOptionalString(record.commit, `${path}.commit`);
    const repo: ExtensionRepo = {
        source: asString(record.source, `${path}.source`),
        name: asString(record.name, `${path}.name`),
        path: asString(record.path, `${path}.path`)
    };
    if (commit) repo.commit = commit;
    return repo;
}

function parseExtensionsByCategory(value: JsonValue): AppData['extensions'] {
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

export function parseAppData(value: JsonValue): AppData {
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

export function parseSearchIndexEntry(value: JsonValue, path: string): SearchIndexEntry {
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

export function parseSearchIndex(value: JsonValue): SearchIndexEntry[] {
    return asArray(value, 'search index').map((entry, index) =>
        parseSearchIndexEntry(entry, `search index[${index}]`)
    );
}
