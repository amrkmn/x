import type { JsonValue } from '../src/lib/validation';
import { isRecord, isString } from './releases/json';
import type { ExtensionConfig } from './types';

function asString(value: JsonValue | undefined, path: string): string {
    if (!isString(value) || value.length === 0) {
        throw new Error(`Invalid ${path}: expected non-empty string`);
    }
    return value;
}

export function parseExtensionConfig(
    value: JsonValue | undefined,
    path: string,
    category: string
): ExtensionConfig {
    if (category !== 'mihon' && category !== 'aniyomi') {
        throw new Error(`Invalid category ${category}: expected "mihon" or "aniyomi"`);
    }
    if (!isRecord(value)) throw new Error(`Invalid ${path}: expected object`);

    const commit = value.commit;
    if (commit !== undefined && !isString(commit)) {
        throw new Error(`Invalid ${path}.commit: expected string`);
    }

    const result: ExtensionConfig = {
        source: asString(value.source, `${path}.source`),
        name: asString(value.name, `${path}.name`),
        path: asString(value.path, `${path}.path`),
        category
    };
    if (commit) result.commit = commit;
    return result;
}

export function parseExtensionsData(value: JsonValue | undefined) {
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
