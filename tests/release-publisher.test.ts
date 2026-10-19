import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import {
    batchArtifacts,
    discoverCandidates,
    parseReleaseManifest,
    publishReleases
} from '../scripts/publish';
import type { ReleaseAssetInfo, ReleaseClient, ReleaseInfo } from '../scripts/publish';
import type { ExtensionConfig } from '../scripts/types';
import type { JsonValue } from '../src/lib/validation';

const commit = '0123456789abcdef0123456789abcdef01234567';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (value: string) => new TextEncoder().encode(value);
const apkUrls = {
    keiyoushi: 'https://downloads.example/kei-v1.apk',
    cursed: 'https://downloads.example/cursed-v1.apk',
    secozzi: 'https://downloads.example/secozzi-v1.apk',
    anime: `https://raw.githubusercontent.com/yuzono/anime-repo/${commit}/apk/anime-v1.apk`
};
const jarUrls = {
    keiyoushi: 'https://downloads.example/kei-v1.jar',
    cursed: 'https://downloads.example/cursed-v1.jar'
};

const data = {
    mihon: {
        keiyoushi: {
            source: 'https://github.com/keiyoushi/extensions@repo',
            name: 'Keiyoushi',
            path: '/keiyoushi/index.pb',
            category: 'mihon',
            commit
        },
        'yuzono/cursed': {
            source: 'https://github.com/yuzono/cursed-manga-repo@repo',
            name: 'Yuzono Cursed',
            path: '/yuzono/cursed/index.pb',
            category: 'mihon',
            commit
        }
    },
    aniyomi: {
        secozzi: {
            source: 'https://github.com/Secozzi/aniyomi-extensions@repo',
            name: 'Secozzi',
            path: '/secozzi/index.min.json',
            category: 'aniyomi',
            commit
        },
        'yuzono/anime': {
            source: 'https://github.com/yuzono/anime-repo@repo',
            name: 'Yuzono Anime',
            path: '/yuzono/anime/index.min.json',
            category: 'aniyomi',
            commit
        }
    }
} satisfies Record<string, Record<string, ExtensionConfig>>;

function sourceData() {
    const contents = new Map<string, Uint8Array>();
    const json = (value: JsonValue) => bytes(JSON.stringify(value));
    const info = (name: string, value: string) => ({ name, sha256: hash(bytes(value)) });
    const indexes = new Map<string, JsonValue>([
        [
            `https://raw.githubusercontent.com/keiyoushi/extensions/${commit}/index.json`,
            {
                extensionList: {
                    extensions: [
                        {
                            packageName: 'org.example.kei',
                            versionName: '1.2.0',
                            versionCode: 12,
                            resources: { apkUrl: apkUrls.keiyoushi, jarUrl: jarUrls.keiyoushi }
                        }
                    ]
                }
            }
        ],
        [
            `https://raw.githubusercontent.com/keiyoushi/extensions/${commit}/release-assets.json`,
            {
                'org.example.kei': {
                    apk: info('kei-v1.apk', 'kei-apk'),
                    jar: info('kei-v1.jar', 'kei-jar')
                }
            }
        ],
        [
            `https://raw.githubusercontent.com/yuzono/cursed-manga-repo/${commit}/index.json`,
            {
                extensionList: {
                    extensions: [
                        {
                            packageName: 'org.example.cursed',
                            versionName: '2.0.0',
                            versionCode: 20,
                            resources: { apkUrl: apkUrls.cursed, jarUrl: jarUrls.cursed }
                        }
                    ]
                }
            }
        ],
        [
            `https://raw.githubusercontent.com/yuzono/cursed-manga-repo/${commit}/release-assets.json`,
            {
                'org.example.cursed': {
                    apk: info('cursed-v1.apk', 'cursed-apk'),
                    jar: info('cursed-v1.jar', 'cursed-jar')
                }
            }
        ],
        [
            `https://raw.githubusercontent.com/Secozzi/aniyomi-extensions/${commit}/index.json`,
            {
                extensionList: {
                    extensions: [
                        {
                            packageName: 'org.example.secozzi',
                            versionName: '3.0.0',
                            resources: { apkUrl: apkUrls.secozzi }
                        }
                    ]
                }
            }
        ],
        [
            `https://raw.githubusercontent.com/Secozzi/aniyomi-extensions/${commit}/release-assets.json`,
            {
                'org.example.secozzi': { apk: info('secozzi-v1.apk', 'secozzi-apk') }
            }
        ],
        [
            `https://raw.githubusercontent.com/yuzono/anime-repo/${commit}/index.min.json`,
            [{ pkg: 'org.example.anime', apk: 'anime-v1.apk', version: '4.0.0', code: 40 }]
        ]
    ]);

    for (const [url, value] of indexes) contents.set(url, json(value));
    for (const [url, value] of Object.entries({
        [apkUrls.keiyoushi]: 'kei-apk',
        [jarUrls.keiyoushi]: 'kei-jar',
        [apkUrls.cursed]: 'cursed-apk',
        [jarUrls.cursed]: 'cursed-jar',
        [apkUrls.secozzi]: 'secozzi-apk',
        [apkUrls.anime]: 'anime-apk'
    })) {
        contents.set(url, bytes(value));
    }

    const fetcher: typeof fetch = async (input) => {
        const value = contents.get(String(input));
        return value
            ? new Response(new TextDecoder().decode(value))
            : new Response('not found', { status: 404 });
    };
    return { contents, fetcher };
}

class MemoryReleaseClient implements ReleaseClient {
    mainSha = commit;
    releases: ReleaseInfo[] = [];
    tags = new Map<string, string>();
    assetBytes = new Map<number, Uint8Array>();
    nextId = 1;
    uploadCount = 0;
    failAfterUpload?: number;

    async currentMainSha() {
        return this.mainSha;
    }

    async listReleases() {
        return [...this.releases].reverse();
    }

    async getRelease(tag: string) {
        return this.releases.find((release) => release.tag === tag) ?? null;
    }

    async getTagCommit(tag: string) {
        return this.tags.get(tag) ?? null;
    }

    async downloadAsset(asset: ReleaseAssetInfo) {
        const content = this.assetBytes.get(asset.id);
        if (!content) throw new Error(`Missing fake asset ${asset.name}`);
        return content;
    }

    async createDraft(tag: string, targetSha: string) {
        const release: ReleaseInfo = {
            id: this.nextId++,
            tag,
            targetCommitish: targetSha,
            draft: true,
            uploadUrl: 'https://uploads.example/releases/assets',
            assets: []
        };
        this.releases.push(release);
        return release;
    }

    async uploadAsset(release: ReleaseInfo, name: string, path: string) {
        if (release.assets.some((asset) => asset.name === name))
            throw new Error(`Refusing to overwrite ${name}`);
        const content = new Uint8Array(await readFile(path));
        const id = this.nextId++;
        const digest = `sha256:${hash(content)}`;
        const asset: ReleaseAssetInfo = {
            id,
            name,
            url: `https://api.example/assets/${id}`,
            digest
        };
        release.assets.push(asset);
        this.assetBytes.set(id, content);
        this.uploadCount += 1;
        if (this.failAfterUpload === this.uploadCount) {
            this.failAfterUpload = undefined;
            throw new Error('Simulated lost upload response');
        }
    }

    async publishDraft(release: ReleaseInfo) {
        release.draft = false;
        this.tags.set(release.tag, release.targetCommitish);
    }
}

test('discovers APKs and available JARs across all four source layouts', async () => {
    const { fetcher } = sourceData();
    const candidates = await discoverCandidates(data, fetcher);

    expect(
        candidates.map(({ source, packageName, kind }) => `${source}/${packageName}/${kind}`)
    ).toEqual([
        'keiyoushi/org.example.kei/apk',
        'keiyoushi/org.example.kei/jar',
        'yuzono/cursed/org.example.cursed/apk',
        'yuzono/cursed/org.example.cursed/jar',
        'secozzi/org.example.secozzi/apk',
        'yuzono/anime/org.example.anime/apk'
    ]);
    expect(candidates.find(({ source }) => source === 'yuzono/anime')?.downloadUrl).toBe(
        apkUrls.anime
    );
    expect(candidates.find(({ source }) => source === 'secozzi')?.kind).toBe('apk');
});

test('rejects retired Kohi-den and requires exactly the four retained sources', async () => {
    const { fetcher } = sourceData();
    const retired = {
        ...data,
        aniyomi: {
            ...data.aniyomi,
            'kohi-den': {
                source: 'https://example.invalid/kohi-den/extensions@repo',
                name: 'Kohi-den',
                path: '/kohi-den/index.min.json',
                category: 'aniyomi' as const,
                commit
            }
        }
    };
    await expect(discoverCandidates(retired, fetcher)).rejects.toThrow(
        'Unsupported extension source: kohi-den'
    );

    const client = new MemoryReleaseClient();
    await expect(
        publishReleases({
            data: retired,
            commit,
            client,
            fetcher,
            owner: 'amrkmn',
            repo: 'x'
        })
    ).rejects.toThrow('Unsupported extension source: kohi-den');
    expect(client.releases).toHaveLength(0);

    const missing = {
        mihon: data.mihon,
        aniyomi: { 'yuzono/anime': data.aniyomi['yuzono/anime'] }
    };
    await expect(discoverCandidates(missing, fetcher)).rejects.toThrow(
        'Missing configured source: secozzi'
    );
});

test('batches no more than 999 binaries per release', () => {
    const batches = batchArtifacts(Array.from({ length: 3144 }, (_, index) => index));
    expect(batches.map((batch) => batch.length)).toEqual([999, 999, 999, 147]);
    expect(() => batchArtifacts([1], 0)).toThrow('Invalid batch size');
});

test('publishes a full manifest and reruns unchanged bytes without creating releases', async () => {
    const source = sourceData();
    const client = new MemoryReleaseClient();
    const options = { data, commit, client, fetcher: source.fetcher, owner: 'amrkmn', repo: 'x' };

    const first = await publishReleases(options);
    expect(first).toEqual({ binaries: 6, releases: 1 });
    expect(client.releases).toHaveLength(1);
    expect(client.releases[0].draft).toBe(false);
    expect(client.releases[0].assets).toHaveLength(7);
    expect(client.releases[0].assets.map(({ name }) => name)).toContain(
        'yuzono-cursed-cursed-v1.apk'
    );

    const manifestAsset = client.releases[0].assets.find(
        ({ name }) => name === 'release-assets.json'
    )!;
    const manifest = parseReleaseManifest(
        JSON.parse(new TextDecoder().decode(await client.downloadAsset(manifestAsset)))
    );
    expect(manifest.keiyoushi['org.example.kei'].apk?.url).toContain('/0123456-0/');
    expect(manifest.keiyoushi['org.example.kei'].jar?.sha256).toBe(hash(bytes('kei-jar')));
    expect(manifest.secozzi['org.example.secozzi'].jar).toBeUndefined();
    expect(manifest['yuzono/anime']['org.example.anime'].apk?.source).toBe('yuzono/anime');

    const second = await publishReleases(options);
    expect(second).toEqual({ binaries: 0, releases: 0 });
    expect(client.releases).toHaveLength(1);
    expect(client.uploadCount).toBe(7);
});

test('skips downloads when upstream checksums match the previous manifest', async () => {
    const source = sourceData();
    const client = new MemoryReleaseClient();
    let artifactDownloads = 0;
    const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        if (!url.endsWith('.json')) artifactDownloads += 1;
        return source.fetcher(input);
    };
    const options = { data, commit, client, fetcher, owner: 'amrkmn', repo: 'x' };

    expect(await publishReleases(options)).toEqual({ binaries: 6, releases: 1 });
    expect(artifactDownloads).toBe(6);

    artifactDownloads = 0;
    expect(await publishReleases(options)).toEqual({ binaries: 0, releases: 0 });
    expect(artifactDownloads).toBe(1);
});

test('metadata-only changes create no release', async () => {
    const source = sourceData();
    const client = new MemoryReleaseClient();
    const options = { data, commit, client, fetcher: source.fetcher, owner: 'amrkmn', repo: 'x' };
    await publishReleases(options);

    const indexUrl = `https://raw.githubusercontent.com/keiyoushi/extensions/${commit}/index.json`;
    const index = JSON.parse(new TextDecoder().decode(source.contents.get(indexUrl)!));
    index.extensionList.extensions[0].versionName = '1.2.1';
    source.contents.set(indexUrl, bytes(JSON.stringify(index)));

    expect(await publishReleases(options)).toEqual({ binaries: 0, releases: 0 });
    expect(client.releases).toHaveLength(1);
});

test('rejects empty artifacts before creating a release', async () => {
    const source = sourceData();
    source.contents.set(apkUrls.keiyoushi, bytes(''));
    const client = new MemoryReleaseClient();

    await expect(
        publishReleases({
            data,
            commit,
            client,
            fetcher: source.fetcher,
            owner: 'amrkmn',
            repo: 'x'
        })
    ).rejects.toThrow('Empty artifact');
    expect(client.releases).toHaveLength(0);
});

test('resumes a matching draft without replacing assets after an interrupted upload', async () => {
    const source = sourceData();
    const client = new MemoryReleaseClient();
    client.failAfterUpload = 1;
    const options = { data, commit, client, fetcher: source.fetcher, owner: 'amrkmn', repo: 'x' };

    await expect(publishReleases(options)).rejects.toThrow('Simulated lost upload response');
    expect(client.releases[0].draft).toBe(true);
    expect(client.releases[0].assets).toHaveLength(1);

    const retry = await publishReleases(options);
    expect(retry).toEqual({ binaries: 6, releases: 1 });
    expect(client.releases).toHaveLength(1);
    expect(client.releases[0].draft).toBe(false);
    expect(client.releases[0].assets).toHaveLength(7);
});

test('fails on a conflicting published asset and does not overwrite it', async () => {
    const source = sourceData();
    const client = new MemoryReleaseClient();
    const options = { data, commit, client, fetcher: source.fetcher, owner: 'amrkmn', repo: 'x' };
    await publishReleases(options);

    const changedBytes = bytes('different upstream bytes');
    source.contents.set(apkUrls.keiyoushi, changedBytes);
    const sourceManifestUrl = `https://raw.githubusercontent.com/keiyoushi/extensions/${commit}/release-assets.json`;
    const sourceManifest = JSON.parse(
        new TextDecoder().decode(source.contents.get(sourceManifestUrl)!)
    );
    sourceManifest['org.example.kei'].apk.sha256 = hash(changedBytes);
    source.contents.set(sourceManifestUrl, bytes(JSON.stringify(sourceManifest)));

    await expect(publishReleases(options)).rejects.toThrow(/Unexpected asset|Conflicting checksum/);
    expect(client.uploadCount).toBe(7);
    expect(client.releases).toHaveLength(1);
});

test('rejects failed source discovery before creating any release', async () => {
    const source = sourceData();
    const client = new MemoryReleaseClient();
    const fetcher: typeof fetch = async (input) => {
        if (String(input).includes('/Secozzi/aniyomi-extensions/')) {
            return new Response('unavailable', { status: 503 });
        }
        return source.fetcher(input);
    };

    await expect(
        publishReleases({ data, commit, client, fetcher, owner: 'amrkmn', repo: 'x' })
    ).rejects.toThrow('Fetch failed (503)');
    expect(client.releases).toHaveLength(0);
});

test('rejects a stale publisher commit before reading or creating releases', async () => {
    const source = sourceData();
    const client = new MemoryReleaseClient();
    client.mainSha = 'f'.repeat(40);

    await expect(
        publishReleases({
            data,
            commit,
            client,
            fetcher: source.fetcher,
            owner: 'amrkmn',
            repo: 'x'
        })
    ).rejects.toThrow('Stale publisher event');
    expect(client.releases).toHaveLength(0);
});
