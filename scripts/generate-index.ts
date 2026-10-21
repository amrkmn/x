import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import protobuf from 'protobufjs';

import type { JsonObject, JsonValue } from '../src/lib/validation';
import { isRecord, isString } from './releases/json';
import { manifestAsset } from './releases/manifest';
import type { ReleaseManifest } from './releases/types';

export interface IndexPbOptions {
    manifest?: ReleaseManifest;
    sourceKey?: string;
}

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

interface IndexTypes {
    store: protobuf.Type;
    extension: protobuf.Type;
    source: protobuf.Type;
}

let cachedTypes: IndexTypes | undefined;
let cachedAniyomiTypes: IndexTypes | undefined;

function indexTypes(): IndexTypes {
    if (!cachedTypes) {
        const protoPath = join(
            dirname(fileURLToPath(import.meta.url)),
            'proto',
            'mihon',
            'extensionstore.proto'
        );
        const parsed = protobuf.parse(readFileSync(protoPath, 'utf8'));
        cachedTypes = {
            store: parsed.root.lookupType('mihon.extensionstore.NetworkExtensionStore'),
            extension: parsed.root.lookupType('mihon.extensionstore.Extension'),
            source: parsed.root.lookupType('mihon.extensionstore.Source')
        };
    }
    return cachedTypes;
}

function aniyomiIndexTypes(): IndexTypes {
    if (!cachedAniyomiTypes) {
        const protoPath = join(
            dirname(fileURLToPath(import.meta.url)),
            'proto',
            'aniyomi',
            'extensionstore.proto'
        );
        const parsed = protobuf.parse(readFileSync(protoPath, 'utf8'));
        cachedAniyomiTypes = {
            store: parsed.root.lookupType('aniyomi.extensionstore.NetworkAnimeExtensionStore'),
            extension: parsed.root.lookupType('aniyomi.extensionstore.Extension'),
            source: parsed.root.lookupType('aniyomi.extensionstore.Source')
        };
    }
    return cachedAniyomiTypes;
}

function asString(value: JsonValue | undefined): string | undefined {
    if (isString(value)) return value;
    if (Number.isFinite(value)) return String(value);
    return undefined;
}

// IDs and versionCodes can exceed 2^53; keep as strings for int64 encoding.
function asInt64(value: JsonValue | undefined): string | undefined {
    const text = asString(value);
    if (text === undefined || !/^-?\d+$/.test(text)) return undefined;
    return text;
}

const CONTENT_WARNINGS = new Set([
    'CONTENT_WARNING_UNSPECIFIED',
    'CONTENT_WARNING_SAFE',
    'CONTENT_WARNING_MIXED',
    'CONTENT_WARNING_NSFW'
]);

interface EncodedExtension {
    message: protobuf.Message;
    packageName: string;
}

function extensionMessage(raw: JsonObject, options: IndexPbOptions): EncodedExtension {
    const resources = isRecord(raw.resources) ? raw.resources : {};
    const packageName = asString(raw.packageName) ?? '';
    let apkUrl = asString(resources.apkUrl) ?? '';
    if (options.manifest && options.sourceKey && packageName) {
        const asset = manifestAsset(options.manifest, options.sourceKey, packageName, 'apk');
        if (asset) apkUrl = asset.url;
    }
    const sources: protobuf.Message[] = [];
    if (Array.isArray(raw.sources)) {
        for (const entry of raw.sources) {
            if (!isRecord(entry)) continue;
            const id = asInt64(entry.id);
            if (id === undefined) continue;
            const homeUrl = asString(entry.homeUrl);
            const mirrors = Array.isArray(entry.mirrorUrls)
                ? entry.mirrorUrls.filter(isString)
                : [];
            const source = {
                id,
                name: asString(entry.name) ?? '',
                language: asString(entry.language) ?? '',
                homeUrl,
                mirrorUrls: mirrors.length > 0 ? mirrors : undefined
            };
            sources.push(indexTypes().source.fromObject(source));
        }
    }
    const warning = asString(raw.contentWarning);
    const message = indexTypes().extension.fromObject({
        name: asString(raw.name) ?? '',
        packageName,
        resources: {
            apkUrl,
            iconUrl: asString(resources.iconUrl) ?? '',
            jarUrl: asString(resources.jarUrl) ?? ''
        },
        extensionLib: asString(raw.extensionLib) ?? '',
        versionCode: asInt64(raw.versionCode) ?? '0',
        versionName: asString(raw.versionName) ?? '',
        contentWarning:
            warning !== undefined && CONTENT_WARNINGS.has(warning)
                ? warning
                : 'CONTENT_WARNING_UNSPECIFIED',
        sources
    });
    return { message, packageName };
}

export function encodeIndexPb(wrapper: JsonObject, options: IndexPbOptions = {}): Uint8Array {
    const type = indexTypes().store;
    const list = isRecord(wrapper.extensionList) ? wrapper.extensionList : {};
    const rawExtensions = Array.isArray(list.extensions) ? list.extensions : [];
    const contact = isRecord(wrapper.contact) ? wrapper.contact : {};
    const extensions: protobuf.Message[] = [];
    for (const raw of rawExtensions) {
        if (!isRecord(raw)) continue;
        extensions.push(extensionMessage(raw, options).message);
    }
    const store = type.fromObject({
        name: asString(wrapper.name) ?? '',
        badgeLabel: asString(wrapper.badgeLabel) ?? '',
        signingKey: asString(wrapper.signingKey) ?? '',
        contact: {
            website: asString(contact.website) ?? '',
            discord: asString(contact.discord) ?? ''
        },
        extensionList: { extensions }
    });
    return gzipSync(type.encode(store).finish());
}

// Secozzi uses field 8 for isTorrent and field 9 for sources.
export function encodeAniyomiIndexPb(
    wrapper: JsonObject,
    options: IndexPbOptions = {}
): Uint8Array {
    const types = aniyomiIndexTypes();
    const list = isRecord(wrapper.extensionList) ? wrapper.extensionList : {};
    const rawExtensions = Array.isArray(list.extensions) ? list.extensions : [];
    const contact = isRecord(wrapper.contact) ? wrapper.contact : {};
    const extensions: protobuf.Message[] = [];

    for (const raw of rawExtensions) {
        if (!isRecord(raw)) continue;
        const resources = isRecord(raw.resources) ? raw.resources : {};
        const packageName = asString(raw.packageName) ?? '';
        let apkUrl = asString(resources.apkUrl) ?? '';
        if (options.manifest && options.sourceKey && packageName) {
            const asset = manifestAsset(options.manifest, options.sourceKey, packageName, 'apk');
            if (asset) apkUrl = asset.url;
        }

        const sources: protobuf.Message[] = [];
        if (Array.isArray(raw.sources)) {
            for (const entry of raw.sources) {
                if (!isRecord(entry)) continue;
                const id = asInt64(entry.id);
                if (id === undefined) continue;
                sources.push(
                    types.source.fromObject({
                        id,
                        name: asString(entry.name) ?? '',
                        language: asString(entry.language) ?? '',
                        homeUrl: asString(entry.homeUrl),
                        mirrorUrls: Array.isArray(entry.mirrorUrls)
                            ? entry.mirrorUrls.filter(isString)
                            : [],
                        message: asString(entry.message)
                    })
                );
            }
        }

        const warning = asString(raw.contentWarning);
        extensions.push(
            types.extension.fromObject({
                name: asString(raw.name) ?? '',
                packageName,
                resources: {
                    apkUrl,
                    iconUrl: asString(resources.iconUrl) ?? ''
                },
                extensionLib: asString(raw.extensionLib) ?? '',
                versionCode: asInt64(raw.versionCode) ?? '0',
                versionName: asString(raw.versionName) ?? '',
                contentWarning:
                    warning !== undefined && CONTENT_WARNINGS.has(warning)
                        ? warning
                        : 'CONTENT_WARNING_UNSPECIFIED',
                isTorrent: raw.isTorrent === true,
                sources
            })
        );
    }

    const store = types.store.fromObject({
        name: asString(wrapper.name) ?? '',
        badgeLabel: asString(wrapper.badgeLabel) ?? '',
        signingKey: asString(wrapper.signingKey) ?? '',
        contact: {
            website: asString(contact.website) ?? '',
            discord: asString(contact.discord) ?? ''
        },
        extensionList: { extensions }
    });
    return gzipSync(types.store.encode(store).finish());
}

// Flat indexes carry {name, pkg, apk, lang, code, version, nsfw, sources[]} with no wrapper.
export const ANIYOMI_NAME_PREFIX = 'Aniyomi: ';

export interface FlatAnimeStoreMeta {
    name: string;
    badgeLabel: string;
    signingKey: string;
    website: string;
}

export function flatAnimeExtensionLib(version: string): string {
    const dot = version.lastIndexOf('.');
    return dot > 0 ? version.slice(0, dot) : version;
}

function flatAnimeContentWarning(nsfw: JsonValue | undefined): string {
    return nsfw === 1 || nsfw === true ? 'CONTENT_WARNING_NSFW' : 'CONTENT_WARNING_SAFE';
}

// Convert flat records to a wrapper for encodeAniyomiIndexPb.
export function flatAnimeToWrapper(
    entries: JsonValue[],
    meta: FlatAnimeStoreMeta,
    resolveApkUrl: (packageName: string, fileName: string) => string,
    iconBaseUrl: string
): JsonObject {
    const extensions: JsonObject[] = [];
    for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const packageName = asString(entry.pkg);
        const fileName = asString(entry.apk);
        if (
            packageName === undefined ||
            fileName === undefined ||
            fileName === '' ||
            fileName.includes('/') ||
            fileName.includes('\\')
        ) {
            continue;
        }
        const rawName = asString(entry.name) ?? packageName;
        const name = rawName.startsWith(ANIYOMI_NAME_PREFIX)
            ? rawName.slice(ANIYOMI_NAME_PREFIX.length)
            : rawName;
        const version = asString(entry.version) ?? '';
        const lang = asString(entry.lang) ?? '';
        const rawSources = Array.isArray(entry.sources) ? entry.sources : [];
        const sources: JsonObject[] = [];
        for (const source of rawSources) {
            if (!isRecord(source)) continue;
            const id = asInt64(source.id);
            if (id === undefined) continue;
            const record: JsonObject = {
                id,
                name: asString(source.name) ?? '',
                language: asString(source.lang) ?? ''
            };
            const homeUrl = asString(source.baseUrl);
            if (homeUrl !== undefined) record.homeUrl = homeUrl;
            sources.push(record);
        }
        if (sources.length === 0 && rawSources.length === 0) {
            sources.push({ id: '0', name: rawName, language: lang });
        }
        extensions.push({
            name,
            packageName,
            resources: {
                apkUrl: resolveApkUrl(packageName, fileName),
                iconUrl: `${iconBaseUrl}/icon/${packageName}.png`
            },
            extensionLib: flatAnimeExtensionLib(version),
            versionCode: asInt64(entry.code) ?? '0',
            versionName: version,
            contentWarning: flatAnimeContentWarning(entry.nsfw),
            isTorrent: false,
            sources
        });
    }
    return {
        name: meta.name,
        badgeLabel: meta.badgeLabel,
        signingKey: meta.signingKey,
        contact: { website: meta.website },
        extensionList: { extensions }
    };
}

// Decode index.pb bytes to the JSON shape; int64s as strings.
function decodeStoreBytes(type: protobuf.Type, bytes: Uint8Array): JsonObject {
    const raw = Buffer.from(bytes);
    const payload =
        raw.length >= 2 && raw.subarray(0, 2).equals(GZIP_MAGIC) ? gunzipSync(raw) : raw;
    // SAFETY: toObject with these conversion options emits only JSON scalar
    // values, arrays, and plain objects, which structurally match JsonObject.
    const decoded = type.toObject(type.decode(payload), {
        longs: String,
        enums: String,
        defaults: false
    }) as JsonObject;
    return decoded;
}

export function decodeIndexPb(bytes: Uint8Array): JsonObject {
    return decodeStoreBytes(indexTypes().store, bytes);
}

export function decodeAniyomiIndexPb(bytes: Uint8Array): JsonObject {
    return decodeStoreBytes(aniyomiIndexTypes().store, bytes);
}
