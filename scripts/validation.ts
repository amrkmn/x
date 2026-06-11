import type { ExtensionConfig } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Invalid ${path}: expected non-empty string`);
    }
    return value;
}

export function parseExtensionConfig(
    value: unknown,
    path: string,
    category: string
): ExtensionConfig {
    if (category !== 'mihon' && category !== 'aniyomi') {
        throw new Error(`Invalid category ${category}: expected "mihon" or "aniyomi"`);
    }
    if (!isRecord(value)) throw new Error(`Invalid ${path}: expected object`);

    const commit = value.commit;
    if (commit !== undefined && typeof commit !== 'string') {
        throw new Error(`Invalid ${path}.commit: expected string`);
    }

    return {
        source: asString(value.source, `${path}.source`),
        name: asString(value.name, `${path}.name`),
        path: asString(value.path, `${path}.path`),
        category,
        ...(commit ? { commit } : {})
    };
}

export function parseExtensionsData(
    value: unknown
): Record<string, Record<string, ExtensionConfig>> {
    if (!isRecord(value)) throw new Error('Invalid extensions data: expected object');

    const result: Record<string, Record<string, ExtensionConfig>> = {};
    const seenPaths = new Set<string>();

    for (const [category, entries] of Object.entries(value)) {
        if (!isRecord(entries)) {
            throw new Error(`Invalid extensions data.${category}: expected object`);
        }

        result[category] = {};

        for (const [key, entry] of Object.entries(entries)) {
            const parsed = parseExtensionConfig(
                entry,
                `extensions data.${category}.${key}`,
                category
            );
            if (seenPaths.has(parsed.path)) {
                throw new Error(`Duplicate extension path: ${parsed.path}`);
            }
            seenPaths.add(parsed.path);
            result[category][key] = parsed;
        }
    }

    return result;
}
