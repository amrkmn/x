import { gunzipSync } from 'node:zlib';

import protobuf from 'protobufjs';
import { expect, test } from 'vitest';

import {
    decodeAniyomiIndexPb,
    decodeIndexPb,
    encodeAniyomiIndexPb,
    encodeIndexPb,
    flatAnimeExtensionLib,
    flatAnimeToWrapper
} from '../scripts/generate-index';
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

// Independent decoder contract to catch mismatched tags.
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

test('flatAnimeExtensionLib follows the legacy substringBeforeLast rule', () => {
    expect(flatAnimeExtensionLib('14.10')).toBe('14');
    expect(flatAnimeExtensionLib('16.15')).toBe('16');
    expect(flatAnimeExtensionLib('14')).toBe('14');
    expect(flatAnimeExtensionLib('')).toBe('');
});

test('flat anime records convert to Aniyomi PB with legacy behavior', () => {
    const releaseUrl =
        'https://github.com/amrkmn/x/releases/download/abc1234-0/yuzono-anime-animeonsen.apk';
    const wrapper = flatAnimeToWrapper(
        [
            {
                name: 'Aniyomi: AnimeOnsen',
                pkg: 'eu.kanade.tachiyomi.animeextension.all.animeonsen',
                apk: 'aniyomi-all.animeonsen-v14.10.apk',
                lang: 'all',
                code: 10,
                version: '14.10',
                nsfw: 0,
                sources: [
                    {
                        name: 'AnimeOnsen',
                        lang: 'all',
                        id: '8542735178285060053',
                        baseUrl: 'https://www.animeonsen.xyz',
                        versionId: 1
                    }
                ]
            },
            {
                name: 'Aniyomi: NoSources',
                pkg: 'eu.kanade.tachiyomi.animeextension.all.nosources',
                apk: 'aniyomi-all.nosources-v14.1.apk',
                lang: 'en',
                code: '41',
                version: '14.1',
                nsfw: 1,
                sources: []
            },
            // Uninstallable entries never reach clients.
            {
                name: 'Aniyomi: Broken',
                pkg: '',
                apk: '',
                lang: 'all',
                code: 0,
                version: '0',
                nsfw: 0,
                sources: []
            }
        ],
        {
            name: 'Yūzōnō',
            badgeLabel: 'Yūzōnō',
            signingKey: 'cbec121aa82ebb02aaa73806992e0368a97d47b5451ed6524816d03084c45905',
            website: 'https://github.com/yuzono/anime-extensions'
        },
        (_pkg, file) => `https://upstream.example/apk/${file}`,
        'https://x.noz.one/yuzono/anime'
    );
    const manifest = {
        'yuzono/anime': {
            'eu.kanade.tachiyomi.animeextension.all.animeonsen': {
                apk: {
                    name: 'yuzono-anime-animeonsen.apk',
                    sha256: 'c'.repeat(64),
                    version: '14.10',
                    source: 'yuzono/anime',
                    kind: 'apk' as const,
                    url: releaseUrl
                }
            }
        }
    };
    const encoded = Buffer.from(
        encodeAniyomiIndexPb(wrapper, { sourceKey: 'yuzono/anime', manifest })
    );
    expect(encoded.subarray(0, 2).toString('hex')).toBe('1f8b');
    const decoded = aniyomiConsumerType.toObject(aniyomiConsumerType.decode(gunzipSync(encoded)), {
        longs: String,
        enums: String,
        defaults: false
    });

    expect(decoded.name).toBe('Yūzōnō');
    expect(decoded.badgeLabel).toBe('Yūzōnō');
    expect(decoded.signingKey).toBe(
        'cbec121aa82ebb02aaa73806992e0368a97d47b5451ed6524816d03084c45905'
    );
    const extensions = extensionsOf(decoded);
    expect(extensions).toHaveLength(2);

    const onsen = extensions[0];
    expect(onsen.name).toBe('AnimeOnsen');
    expect(onsen.packageName).toBe('eu.kanade.tachiyomi.animeextension.all.animeonsen');
    expect(resourcesOf(onsen)).toEqual({
        apkUrl: releaseUrl,
        iconUrl:
            'https://x.noz.one/yuzono/anime/icon/eu.kanade.tachiyomi.animeextension.all.animeonsen.png'
    });
    expect(onsen.extensionLib).toBe('14');
    expect(onsen.versionCode).toBe('10');
    expect(onsen.versionName).toBe('14.10');
    expect(onsen.contentWarning).toBe('CONTENT_WARNING_SAFE');
    // Proto3 omits false booleans on decode; absent means not a torrent source.
    expect(onsen.isTorrent ?? false).toBe(false);
    expect(sourcesOf(onsen)).toEqual([
        {
            id: '8542735178285060053',
            name: 'AnimeOnsen',
            language: 'all',
            homeUrl: 'https://www.animeonsen.xyz'
        }
    ]);

    // Empty source lists synthesize the legacy default source; nsfw maps to
    // CONTENT_WARNING_NSFW; uncovered packages keep the upstream APK URL.
    const bare = extensions[1];
    expect(bare.name).toBe('NoSources');
    expect(bare.contentWarning).toBe('CONTENT_WARNING_NSFW');
    expect(bare.extensionLib).toBe('14');
    expect(bare.versionCode).toBe('41');
    expect(resourcesOf(bare).apkUrl).toBe(
        'https://upstream.example/apk/aniyomi-all.nosources-v14.1.apk'
    );
    // Proto3 omits the default int64 0 on decode; absent id means 0.
    expect(sourcesOf(bare)).toEqual([{ name: 'Aniyomi: NoSources', language: 'en' }]);
    expect(sourcesOf(bare)[0].id ?? '0').toBe('0');
});

test('flat anime wrapper round-trips through the Aniyomi decoder', () => {
    const wrapper = flatAnimeToWrapper(
        [
            {
                name: 'Plain Name',
                pkg: 'plain.pkg',
                apk: 'plain.apk',
                lang: 'all',
                code: 7,
                version: '7',
                nsfw: 0,
                sources: [{ id: '42', name: 'Plain', lang: 'all', baseUrl: '' }]
            }
        ],
        { name: 'S', badgeLabel: 'S', signingKey: 'key', website: 'https://example.test' },
        (_pkg, file) => `https://upstream.example/${file}`,
        'https://example.test/s'
    );
    const decoded = decodeAniyomiIndexPb(encodeAniyomiIndexPb(wrapper));
    expect(decoded.signingKey).toBe('key');
    const extensions = extensionsOf(decoded);
    expect(extensions).toHaveLength(1);
    // Names without the legacy prefix pass through untouched.
    expect(extensions[0].name).toBe('Plain Name');
    expect(extensions[0].extensionLib).toBe('7');
    expect(sourcesOf(extensions[0])[0].id).toBe('42');
});
