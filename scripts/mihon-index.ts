import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import protobuf from 'protobufjs';

import type { JsonObject, JsonValue } from '../src/lib/validation';
import { isRecord, isString } from './release-publisher/json';
import { manifestAsset } from './release-publisher/manifest';
import type { ReleaseManifest } from './release-publisher/types';

export interface IndexPbOptions {
    // Latest complete release-assets.json snapshot. Covered packages get
    // resources.apkUrl rewritten to the immutable release URL; everything
    // else (including jarUrl) is preserved byte-for-byte semantically.
    manifest?: ReleaseManifest;
    // extensions.json source key (manifest top-level key).
    sourceKey?: string;
}

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

interface IndexTypes {
    store: protobuf.Type;
    extension: protobuf.Type;
    source: protobuf.Type;
}

let cachedTypes: IndexTypes | undefined;

function indexTypes(): IndexTypes {
    if (!cachedTypes) {
        const protoPath = join(dirname(fileURLToPath(import.meta.url)), 'mihon-index.proto');
        const parsed = protobuf.parse(readFileSync(protoPath, 'utf8'));
        cachedTypes = {
            store: parsed.root.lookupType('mihon.extensionstore.NetworkExtensionStore'),
            extension: parsed.root.lookupType('mihon.extensionstore.Extension'),
            source: parsed.root.lookupType('mihon.extensionstore.Source')
        };
    }
    return cachedTypes;
}

function asString(value: JsonValue | undefined): string | undefined {
    if (isString(value)) return value;
    if (Number.isFinite(value)) return String(value);
    return undefined;
}

// JSON ids and versionCodes are strings (often exceeding 2^53); the proto
// uses int64. Pass through as strings so protobufjs encodes via Long exactly.
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

// Encode a Mihon wrapper index.json object to gzipped index.pb bytes.
// Only resources.apkUrl changes (via manifest); signingKey, metadata,
// iconUrl/jarUrl, and APK bytes (referenced, never embedded) are preserved.
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

// Decode index.pb bytes (gzipped as served, or raw) back to the wrapper
// JSON shape: int64s as strings, enums as CONTENT_WARNING_* names, unset
// fields omitted — directly comparable to index.json.
export function decodeIndexPb(bytes: Uint8Array): JsonObject {
    const type = indexTypes().store;
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
