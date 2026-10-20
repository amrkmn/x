import { gunzipSync } from 'node:zlib';

import protobuf from 'protobufjs';
import { expect, test } from 'vitest';

import { decodeIndexPb, encodeAniyomiIndexPb, encodeIndexPb } from '../scripts/generate-index';
import { isRecord } from '../scripts/releases/json';
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

// Independent decoder contract transcribed from Aniyomi/Animiru's
// NetworkAnimeExtensionStore models, so this test catches mismatched tags.
const aniyomiConsumerType = protobuf
    .parse(`
        syntax = "proto3";
        package aniyomi.consumer;
        message NetworkAnimeExtensionStore {
            string name = 1;
            string badge_label = 2;
            string signing_key = 3;
            Contact contact = 4;
            ExtensionList extension_list = 101;
            string extension_list_url = 102;
        }
        message Contact {
            string website = 1;
            string discord = 2;
        }
        message ExtensionList {
            repeated Extension extensions = 1;
        }
        message Extension {
            string name = 1;
            string package_name = 2;
            Resources resources = 3;
            string extension_lib = 4;
            int64 version_code = 5;
            string version_name = 6;
            ContentWarning content_warning = 7;
            bool is_torrent = 8;
            repeated Source sources = 9;
        }
        message Resources {
            string apk_url = 1;
            string icon_url = 2;
        }
        message Source {
            int64 id = 1;
            string name = 2;
            string language = 3;
            string home_url = 4;
            repeated string mirror_urls = 5;
            string message = 6;
        }
        enum ContentWarning {
            CONTENT_WARNING_UNSPECIFIED = 0;
            CONTENT_WARNING_SAFE = 1;
            CONTENT_WARNING_MIXED = 2;
            CONTENT_WARNING_NSFW = 3;
        }
    `)
    .root.lookupType('aniyomi.consumer.NetworkAnimeExtensionStore');

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

test('Aniyomi index.pb preserves Aniyomi wire fields and overlays APK URLs', () => {
    const releaseUrl =
        'https://github.com/amrkmn/x/releases/download/abc1234-0/secozzi-stremio.apk';
    const wrapper: JsonObject = {
        name: 'Secozzi',
        badgeLabel: 'SECO',
        signingKey: 'secozzi-signing-key',
        contact: { website: 'https://github.com/Secozzi/aniyomi-extensions' },
        extensionList: {
            extensions: [
                {
                    name: 'Stremio',
                    packageName: 'eu.kanade.tachiyomi.animeextension.all.stremio',
                    resources: {
                        apkUrl: 'https://upstream.example/stremio.apk',
                        iconUrl: 'https://upstream.example/stremio.png'
                    },
                    extensionLib: '17',
                    versionCode: '17002',
                    versionName: '17.2',
                    contentWarning: 'CONTENT_WARNING_MIXED',
                    isTorrent: true,
                    sources: [
                        {
                            id: '8425771932667600381',
                            name: 'Stremio',
                            language: 'all',
                            homeUrl: 'https://example.test/stremio',
                            mirrorUrls: ['https://mirror.example.test/stremio'],
                            message: 'torrent source'
                        }
                    ]
                }
            ]
        }
    };
    const manifest = {
        secozzi: {
            'eu.kanade.tachiyomi.animeextension.all.stremio': {
                apk: {
                    name: 'secozzi-stremio.apk',
                    sha256: 'a'.repeat(64),
                    version: '17.2',
                    source: 'secozzi',
                    kind: 'apk' as const,
                    url: releaseUrl
                }
            }
        }
    };
    const encoded = Buffer.from(encodeAniyomiIndexPb(wrapper, { sourceKey: 'secozzi', manifest }));
    expect(encoded.subarray(0, 2).toString('hex')).toBe('1f8b');
    const decoded = aniyomiConsumerType.toObject(aniyomiConsumerType.decode(gunzipSync(encoded)), {
        longs: String,
        enums: String,
        defaults: false
    });

    expect(decoded.signingKey).toBe('secozzi-signing-key');
    const extension = extensionsOf(decoded)[0];
    expect(extension.isTorrent).toBe(true);
    expect(resourcesOf(extension)).toEqual({
        apkUrl: releaseUrl,
        iconUrl: 'https://upstream.example/stremio.png'
    });
    expect(sourcesOf(extension)[0]).toEqual({
        id: '8425771932667600381',
        name: 'Stremio',
        language: 'all',
        homeUrl: 'https://example.test/stremio',
        mirrorUrls: ['https://mirror.example.test/stremio'],
        message: 'torrent source'
    });
});

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
