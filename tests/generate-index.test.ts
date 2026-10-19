import { gunzipSync } from 'node:zlib';

import { expect, test } from 'vitest';

import { decodeIndexPb, encodeIndexPb } from '../scripts/generate-index';
import { isRecord } from '../scripts/release-publisher/json';
import type { JsonObject } from '../src/lib/validation';

function extensionsOf(decoded: JsonObject): JsonObject[] {
    const list = decoded.extensionList;
    if (!isRecord(list) || !Array.isArray(list.extensions)) throw new Error('bad shape');
    return list.extensions.filter(isRecord);
}

function resourcesOf(extension: JsonObject): JsonObject {
    const resources = extension.resources;
    if (!isRecord(resources)) throw new Error('bad shape');
    return resources;
}

function sourcesOf(extension: JsonObject): JsonObject[] {
    if (!Array.isArray(extension.sources)) throw new Error('bad shape');
    return extension.sources.filter(isRecord);
}

function fullWrapper(): JsonObject {
    return {
        name: 'TestStore',
        badgeLabel: 'TEST',
        signingKey: '9add655a78e96c4ec7a53ef89dccb557cb5d7674',
        contact: { website: 'https://example.test', discord: 'https://discord.gg/test' },
        extensionList: {
            extensions: [
                {
                    name: 'Full Extension',
                    packageName: 'eu.kanade.tachiyomi.extension.en.full',
                    resources: {
                        apkUrl: 'https://upstream.example/full-v1.apk',
                        iconUrl: 'https://upstream.example/full.png',
                        jarUrl: 'https://upstream.example/full-v1.jar'
                    },
                    extensionLib: '1.6',
                    // Exceeds 2^53: must survive the string→int64 trip exactly.
                    versionCode: '6289731484943315811',
                    versionName: '1.0.0',
                    contentWarning: 'CONTENT_WARNING_NSFW',
                    sources: [
                        {
                            id: '6289731484943315811',
                            name: 'Full',
                            language: 'en',
                            homeUrl: 'https://example.test/full',
                            mirrorUrls: ['https://mirror-a.test', 'https://mirror-b.test']
                        }
                    ]
                },
                {
                    name: 'Minimal Extension',
                    packageName: 'eu.kanade.tachiyomi.extension.all.minimal',
                    resources: { apkUrl: 'https://upstream.example/minimal-v2.apk' },
                    extensionLib: '17',
                    versionCode: '17002',
                    versionName: '17.2',
                    contentWarning: 'CONTENT_WARNING_SAFE',
                    sources: [{ id: '8925551562887732093', name: 'Minimal', language: 'all' }]
                }
            ]
        }
    };
}

test('index.pb round-trips wrapper JSON exactly', () => {
    const wrapper = fullWrapper();
    const decoded = decodeIndexPb(encodeIndexPb(wrapper));
    expect(decoded.name).toBe('TestStore');
    expect(decoded.badgeLabel).toBe('TEST');
    expect(decoded.signingKey).toBe(wrapper.signingKey);
    expect(decoded.contact).toEqual(wrapper.contact);

    const extensions = extensionsOf(decoded);
    expect(extensions).toHaveLength(2);

    const full = extensions[0];
    expect(full.versionCode).toBe('6289731484943315811');
    expect(full.contentWarning).toBe('CONTENT_WARNING_NSFW');
    expect(resourcesOf(full)).toEqual({
        apkUrl: 'https://upstream.example/full-v1.apk',
        iconUrl: 'https://upstream.example/full.png',
        jarUrl: 'https://upstream.example/full-v1.jar'
    });
    const sources = sourcesOf(full);
    expect(sources[0].id).toBe('6289731484943315811');
    expect(sources[0].mirrorUrls).toEqual(['https://mirror-a.test', 'https://mirror-b.test']);

    // Absent optionals stay absent (proto defaults), not empty strings.
    const minimal = extensions[1];
    expect(resourcesOf(minimal)).toEqual({ apkUrl: 'https://upstream.example/minimal-v2.apk' });
    expect(sourcesOf(minimal)[0]).toEqual({
        id: '8925551562887732093',
        name: 'Minimal',
        language: 'all'
    });
});

test('index.pb swaps only manifest-covered apkUrls', () => {
    const wrapper = fullWrapper();
    const releaseUrl = 'https://github.com/amrkmn/x/releases/download/abc1234-1/keiyoushi-full.apk';
    const decoded = decodeIndexPb(
        encodeIndexPb(wrapper, {
            sourceKey: 'keiyoushi',
            manifest: {
                keiyoushi: {
                    'eu.kanade.tachiyomi.extension.en.full': {
                        apk: {
                            name: 'keiyoushi-full.apk',
                            sha256: 'a'.repeat(64),
                            version: '1.0.0',
                            source: 'keiyoushi',
                            kind: 'apk',
                            url: releaseUrl
                        }
                    }
                }
            }
        })
    );

    const extensions = extensionsOf(decoded);
    expect(resourcesOf(extensions[0]).apkUrl).toBe(releaseUrl);
    // jarUrl/iconUrl preserved; uncovered entry keeps its upstream apkUrl.
    expect(resourcesOf(extensions[0]).jarUrl).toBe('https://upstream.example/full-v1.jar');
    expect(resourcesOf(extensions[1]).apkUrl).toBe('https://upstream.example/minimal-v2.apk');
    expect(decoded.signingKey).toBe(wrapper.signingKey);
});

test('index.pb output is gzipped protobuf the decoder accepts raw too', () => {
    const encoded = Buffer.from(encodeIndexPb(fullWrapper()));
    expect(encoded.subarray(0, 2).toString('hex')).toBe('1f8b');
    const raw = gunzipSync(encoded);
    // Field 501 tag (jarUrl) present in the raw protobuf bytes.
    expect(raw.includes(Buffer.from([0xaa, 0x1f]))).toBe(true);
    expect(extensionsOf(decodeIndexPb(raw))[0].name).toBe('Full Extension');
});

test('index.pb decode rejects truncated protobuf', () => {
    expect(() => decodeIndexPb(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow();
});
