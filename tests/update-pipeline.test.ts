import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import { config } from '../scripts/config';
import type { ExtensionsData } from '../scripts/extensions';
import {
    fetchMissingIcons,
    fetchLatestReleaseManifest,
    findBinaryArtifacts,
    findExtensionUpdates,
    generateDataJson,
    generateRedirects,
    loadExtensionsData,
    overlayReleaseManifest,
    pruneBinaryDirs,
    pruneRemovedRepos,
    refreshFlatAnimeIndexPb,
    refreshMirrorIndexPb
} from '../scripts/extensions';
import { decodeAniyomiIndexPb, decodeIndexPb } from '../scripts/generate-index';
import { isRecord } from '../scripts/releases/json';
import type { ReleaseManifest } from '../scripts/releases/types';

let testDir: string;
const savedEnv = { PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL };

beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'x-update-pipeline-'));
    delete process.env.PUBLIC_SITE_URL;
});

afterEach(async () => {
    process.env.PUBLIC_SITE_URL = savedEnv.PUBLIC_SITE_URL;
    await rm(testDir, { recursive: true, force: true });
});

function createExtensionsData(): ExtensionsData {
    return {
        mihon: {
            alpha: {
                name: 'Alpha Source',
                source: 'https://github.com/example/alpha',
                path: '/alpha/index.min.json',
                category: 'mihon',
                commit: 'oldhash1'
            }
        },
        aniyomi: {
            beta: {
                name: 'Beta Source',
                source: 'https://github.com/example/beta',
                path: '/beta/index.min.json',
                category: 'aniyomi',
                commit: 'oldhash2'
            }
        }
    };
}

test('loadExtensionsData loads and validates extension config file', async () => {
    const file = join(testDir, 'extensions.json');
    await writeFile(file, JSON.stringify(createExtensionsData()));

    const data = await loadExtensionsData(file);

    expect(data.mihon.alpha.name).toBe('Alpha Source');
    expect(data.aniyomi.beta.path).toBe('/beta/index.min.json');
});

async function setupTestRepo(dir: string, files: Record<string, string> = {}) {
    await mkdir(join(dir, 'apk'), { recursive: true });
    await mkdir(join(dir, 'icon'), { recursive: true });
    await writeFile(join(dir, 'index.json'), files['index.json'] || '{}');
    await writeFile(join(dir, 'index.min.json'), files['index.min.json'] || '[]');
    await writeFile(join(dir, 'index.pb'), files['index.pb'] || 'pb');
    await writeFile(join(dir, 'repo.json'), files['repo.json'] || '{}');
}

test('findExtensionUpdates uses synced commits for static updates and remote head for quick updates', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const betaDir = join(staticDir, 'beta');

    await setupTestRepo(alphaDir);
    await setupTestRepo(betaDir);

    const remoteHeads = new Map([
        ['https://github.com/example/alpha', 'newhash1'],
        ['https://github.com/example/beta', 'oldhash2']
    ]);

    const staticUpdates = await findExtensionUpdates(data, {
        quick: false,
        staticDir,
        getRemoteHead: async (url) => remoteHeads.get(url) || '',
        loadSyncedCommits: async () =>
            new Map([
                ['/alpha/index.min.json', 'oldhash1'],
                ['/beta/index.min.json', 'oldhash2']
            ])
    });

    expect(staticUpdates).toHaveLength(1);
    expect(staticUpdates[0].key).toBe('alpha');
    expect(staticUpdates[0].hash).toBe('newhash1');

    const quickUpdates = await findExtensionUpdates(data, {
        quick: true,
        staticDir,
        getRemoteHead: async (url) => remoteHeads.get(url) || ''
    });

    expect(quickUpdates).toHaveLength(1);
    expect(quickUpdates[0].key).toBe('alpha');
});

test('findExtensionUpdates marks missing static directories for materialization', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    await mkdir(staticDir, { recursive: true });

    const updates = await findExtensionUpdates(data, {
        quick: false,
        staticDir,
        getRemoteHead: async () => 'unused',
        loadSyncedCommits: async () => new Map()
    });

    expect(updates).toHaveLength(2);
    expect(updates.map((update) => update.hash)).toEqual(['oldhash1', 'oldhash2']);
});

test('findExtensionUpdates marks repos with missing required files for materialization', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const betaDir = join(staticDir, 'beta');

    await mkdir(join(alphaDir, 'apk'), { recursive: true });
    await mkdir(join(alphaDir, 'icon'), { recursive: true });
    // Missing index.json triggers re-materialization.
    await writeFile(join(alphaDir, 'index.min.json'), '[]');
    await writeFile(join(alphaDir, 'index.pb'), 'pb');
    await writeFile(join(alphaDir, 'repo.json'), '{}');

    await setupTestRepo(betaDir);

    const updates = await findExtensionUpdates(data, {
        quick: false,
        staticDir,
        getRemoteHead: async (url) =>
            url === 'https://github.com/example/alpha' ? 'oldhash1' : 'oldhash2',
        loadSyncedCommits: async () =>
            new Map([
                ['/alpha/index.min.json', 'oldhash1'],
                ['/beta/index.min.json', 'oldhash2']
            ])
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].key).toBe('alpha');
});

test('findExtensionUpdates rewrites mirrored repo index_v2 without requiring upstream updates', async () => {
    process.env.PUBLIC_SITE_URL = 'https://mirror.example.com/';

    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');

    await setupTestRepo(alphaDir, {
        'index.json': JSON.stringify({
            extensionList: {
                extensions: [
                    {
                        packageName: 'eu.kanade.tachiyomi.extension.alpha',
                        resources: {
                            apkUrl: 'https://raw.githubusercontent.com/example/repo/apk/tachiyomi-alpha.apk',
                            jarUrl: 'https://raw.githubusercontent.com/example/repo/jar/tachiyomi-alpha.jar',
                            iconUrl:
                                'https://raw.githubusercontent.com/example/repo/icon/eu.kanade.tachiyomi.extension.alpha.png'
                        }
                    }
                ]
            }
        }),
        'repo.json': JSON.stringify({
            index_v2: 'https://raw.githubusercontent.com/example/repo/index.pb'
        })
    });
    await writeFile(join(alphaDir, 'icon', 'eu.kanade.tachiyomi.extension.alpha.png'), 'icon');
    await mkdir(join(alphaDir, 'jar'), { recursive: true });
    await writeFile(join(alphaDir, 'jar', 'tachiyomi-alpha.jar'), 'jar');

    const updates = await findExtensionUpdates(data, {
        quick: false,
        staticDir,
        getRemoteHead: async () => 'oldhash1',
        loadSyncedCommits: async () => new Map([['/alpha/index.min.json', 'oldhash1']])
    });

    expect(updates).toHaveLength(1);

    const indexJson = JSON.parse(await readFile(join(alphaDir, 'index.json'), 'utf8'));
    expect(indexJson.extensionList.extensions[0].resources.iconUrl).toBe(
        'https://mirror.example.com/alpha/icon/eu.kanade.tachiyomi.extension.alpha.png'
    );
    expect(indexJson.extensionList.extensions[0].resources.jarUrl).toBe(
        'https://mirror.example.com/alpha/jar/tachiyomi-alpha.jar'
    );

    const repoJson = JSON.parse(await readFile(join(alphaDir, 'repo.json'), 'utf8'));
    expect(repoJson.index_v2).toBe('https://mirror.example.com/alpha/index.pb');
});

test('findExtensionUpdates preserves unchanged mirrored index formatting', async () => {
    process.env.PUBLIC_SITE_URL = 'https://mirror.example.com/';

    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const originalIndex = JSON.stringify({ extensionList: { extensions: [] } }, null, 4);
    const originalRepo = JSON.stringify(
        { index_v2: 'https://mirror.example.com/alpha/index.pb', name: 'Alpha' },
        null,
        4
    );

    await setupTestRepo(alphaDir, { 'index.json': originalIndex, 'repo.json': originalRepo });
    await setupTestRepo(join(staticDir, 'beta'));

    const updates = await findExtensionUpdates(data, {
        quick: false,
        staticDir,
        getRemoteHead: async () => 'oldhash',
        loadSyncedCommits: async () =>
            new Map([
                ['/alpha/index.min.json', 'oldhash'],
                ['/beta/index.min.json', 'oldhash']
            ])
    });

    expect(updates).toHaveLength(0);
    expect(await readFile(join(alphaDir, 'index.json'), 'utf8')).toBe(originalIndex);
    expect(await readFile(join(alphaDir, 'repo.json'), 'utf8')).toBe(originalRepo);
});

test('findExtensionUpdates preserves external Mihon icon URLs without local icons', async () => {
    process.env.PUBLIC_SITE_URL = 'https://mirror.example.com/';

    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const iconUrl = 'https://cdn.example.com/extensions-source/alpha/ic_launcher.png';

    await setupTestRepo(alphaDir, {
        'index.json': JSON.stringify({
            extensionList: {
                extensions: [
                    {
                        packageName: 'eu.kanade.tachiyomi.extension.alpha',
                        resources: { iconUrl }
                    }
                ]
            }
        })
    });

    await findExtensionUpdates(data, {
        quick: false,
        staticDir,
        getRemoteHead: async () => 'oldhash1',
        loadSyncedCommits: async () => new Map([['/alpha/index.min.json', 'oldhash1']])
    });

    const indexJson = JSON.parse(await readFile(join(alphaDir, 'index.json'), 'utf8'));
    expect(indexJson.extensionList.extensions[0].resources.iconUrl).toBe(iconUrl);
});

test('generateDataJson writes data.json and indexes.json from mirrored static files', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const betaDir = join(staticDir, 'beta');
    const dataFile = join(staticDir, 'data.json');
    const searchIndexFile = join(staticDir, 'indexes.json');

    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });

    await writeFile(
        join(alphaDir, 'index.json'),
        JSON.stringify({
            extensionList: {
                extensions: [
                    {
                        name: 'Alpha Extension',
                        packageName: 'alpha.pkg',
                        versionName: '1.0.0',
                        versionCode: 1,
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        resources: { apkUrl: 'https://mirror.example.com/alpha/apk/alpha.apk' },
                        sources: [{ language: 'en' }]
                    }
                ]
            }
        })
    );

    await writeFile(
        join(betaDir, 'index.min.json'),
        JSON.stringify([
            {
                name: 'Beta Extension',
                pkg: 'beta.pkg',
                version: '2.0.0',
                lang: 'ja',
                apk: 'beta.apk',
                nsfw: true
            }
        ])
    );

    await generateDataJson(data, {
        commit: 'abcdef1234567',
        dataFile,
        searchIndexFile,
        staticDir
    });

    const appData = JSON.parse(await readFile(dataFile, 'utf8'));
    const searchIndex = JSON.parse(await readFile(searchIndexFile, 'utf8'));

    expect(appData.latestCommitHash).toBe('abcdef1');
    expect(appData.extensions.mihon[0].name).toBe('Alpha Source');
    expect(searchIndex).toHaveLength(2);
    expect(searchIndex[0].formattedSourceName).toBe('alpha.source');
    expect(searchIndex[0].apk).toBe('alpha.apk');
    expect(searchIndex[1].nsfw).toBe(1);
});

test('generateDataJson skips mihon wrapper entries without an installable apk', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const dataFile = join(staticDir, 'data.json');
    const searchIndexFile = join(staticDir, 'indexes.json');

    await mkdir(alphaDir, { recursive: true });

    await writeFile(
        join(alphaDir, 'index.json'),
        JSON.stringify({
            extensionList: {
                extensions: [
                    {
                        name: 'Please migrate to Keiyoushi',
                        packageName: 'migrate.pkg',
                        versionName: '1.0.0',
                        versionCode: 1,
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        resources: { apkUrl: 'https://mirror.example.com/alpha/apk/' },
                        sources: [{ language: 'all' }]
                    },
                    {
                        name: 'Alpha Extension',
                        packageName: 'alpha.pkg',
                        versionName: '1.0.0',
                        versionCode: 1,
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        resources: { apkUrl: 'https://mirror.example.com/alpha/apk/alpha.apk' },
                        sources: [{ language: 'en' }]
                    }
                ]
            }
        })
    );

    await generateDataJson(data, {
        commit: 'abcdef1234567',
        dataFile,
        searchIndexFile,
        staticDir
    });

    const searchIndex = JSON.parse(await readFile(searchIndexFile, 'utf8'));

    expect(searchIndex).toHaveLength(1);
    expect(searchIndex[0].name).toBe('Alpha Extension');
    expect(searchIndex[0].apk).toBe('alpha.apk');
});

test('pruneRemovedRepos removes mirrored dirs not configured in extensions.json', async () => {
    const staticDir = join(testDir, 'static');
    await mkdir(join(staticDir, 'keiyoushi', 'apk'), { recursive: true });
    await mkdir(join(staticDir, 'keiyoushi', 'icon'), { recursive: true });
    await mkdir(join(staticDir, 'yuzono', 'cursed'), { recursive: true });
    await mkdir(join(staticDir, 'yuzono', 'manga'), { recursive: true });
    await writeFile(join(staticDir, 'data.json'), '{}');
    await writeFile(join(staticDir, 'keiyoushi', 'repo.json'), '{}');

    const data: ExtensionsData = {
        mihon: {
            keiyoushi: {
                source: 'https://github.com/example/keiyoushi',
                name: 'Keiyoushi',
                path: '/keiyoushi/index.pb',
                category: 'mihon',
                commit: 'abc'
            },
            'yuzono/cursed': {
                source: 'https://github.com/example/cursed',
                name: 'Yuzono Cursed',
                path: '/yuzono/cursed/index.pb',
                category: 'mihon',
                commit: 'abc'
            }
        }
    };

    const pruned = await pruneRemovedRepos(data, staticDir);

    expect(pruned).toBe(1);
    expect(existsSync(join(staticDir, 'keiyoushi'))).toBe(true);
    expect(existsSync(join(staticDir, 'keiyoushi', 'apk'))).toBe(true);
    expect(existsSync(join(staticDir, 'keiyoushi', 'icon'))).toBe(true);
    expect(existsSync(join(staticDir, 'yuzono', 'cursed'))).toBe(true);
    expect(existsSync(join(staticDir, 'yuzono', 'manga'))).toBe(false);
    expect(existsSync(join(staticDir, 'data.json'))).toBe(true);
    expect(existsSync(join(staticDir, 'keiyoushi', 'repo.json'))).toBe(true);
});

test('pruneRemovedRepos removes an entire removed top-level group', async () => {
    const staticDir = join(testDir, 'static');
    await mkdir(join(staticDir, 'yuzono', 'manga'), { recursive: true });
    await mkdir(join(staticDir, 'yuzono', 'anime'), { recursive: true });

    const data: ExtensionsData = {
        mihon: {
            keiyoushi: {
                source: 'https://github.com/example/keiyoushi',
                name: 'Keiyoushi',
                path: '/keiyoushi/index.pb',
                category: 'mihon',
                commit: 'abc'
            }
        }
    };

    const pruned = await pruneRemovedRepos(data, staticDir);

    expect(pruned).toBe(1);
    expect(existsSync(join(staticDir, 'yuzono'))).toBe(false);
    expect(existsSync(join(staticDir, 'keiyoushi'))).toBe(false);
});

test('lightweight materialization retains only index, repo, and icon files', () => {
    expect(config.filesToCopy).toEqual([
        'index.json',
        'index.min.json',
        'index.pb',
        'repo.json',
        'icon'
    ]);
});

test('aniyomi wrapper index.json parses without changing category', async () => {
    const data: ExtensionsData = {
        aniyomi: {
            secozzi: {
                name: 'Secozzi',
                source: 'https://github.com/example/secozzi',
                path: '/secozzi/index.json',
                category: 'aniyomi',
                commit: 'abc123'
            }
        }
    };
    const staticDir = join(testDir, 'static');
    const secozziDir = join(staticDir, 'secozzi');
    const dataFile = join(staticDir, 'data.json');
    const searchIndexFile = join(staticDir, 'indexes.json');

    await mkdir(secozziDir, { recursive: true });
    await writeFile(
        join(secozziDir, 'index.json'),
        JSON.stringify({
            extensionList: {
                extensions: [
                    {
                        name: 'Torbox',
                        packageName: 'torbox.pkg',
                        versionName: '1.2.0',
                        versionCode: 5,
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        resources: {
                            apkUrl: 'https://github.com/example/releases/download/abc/torbox.apk'
                        },
                        sources: [{ language: 'en' }]
                    }
                ]
            }
        })
    );

    await generateDataJson(data, {
        commit: 'abcdef1234567',
        dataFile,
        searchIndexFile,
        staticDir
    });

    const searchIndex = JSON.parse(await readFile(searchIndexFile, 'utf8'));
    expect(searchIndex).toHaveLength(1);
    expect(searchIndex[0].pkg).toBe('torbox.pkg');
    expect(searchIndex[0].category).toBe('aniyomi');
    expect(searchIndex[0].apk).toBe('torbox.apk');
    expect(searchIndex[0].apkUrl).toBe(
        'https://github.com/example/releases/download/abc/torbox.apk'
    );

    const updates = await findExtensionUpdates(data, {
        quick: false,
        staticDir,
        getRemoteHead: async () => 'abc123',
        loadSyncedCommits: async () => new Map([['/secozzi/index.json', 'abc123']])
    });
    expect(updates).toHaveLength(0);
});

test('pruneBinaryDirs removes stale apk/jar dirs for configured sources only', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');

    await mkdir(join(staticDir, 'alpha', 'apk'), { recursive: true });
    await writeFile(join(staticDir, 'alpha', 'apk', 'x.apk'), 'bin');
    await mkdir(join(staticDir, 'alpha', 'icon'), { recursive: true });
    await writeFile(join(staticDir, 'alpha', 'icon', 'a.png'), 'icon');
    await mkdir(join(staticDir, 'beta', 'jar'), { recursive: true });
    await writeFile(join(staticDir, 'beta', 'jar', 'y.jar'), 'bin');
    await mkdir(join(staticDir, 'other', 'apk'), { recursive: true });
    await writeFile(join(staticDir, 'other', 'apk', 'z.apk'), 'bin');

    expect(await findBinaryArtifacts(staticDir)).toHaveLength(3);
    expect(await pruneBinaryDirs(data, staticDir)).toBe(2);
    expect(existsSync(join(staticDir, 'alpha', 'apk'))).toBe(false);
    expect(existsSync(join(staticDir, 'alpha', 'icon'))).toBe(true);
    expect(existsSync(join(staticDir, 'beta', 'jar'))).toBe(false);
    expect(existsSync(join(staticDir, 'other', 'apk', 'z.apk'))).toBe(true);
});

test('generateDataJson overlays release manifest URLs and keeps upstream URLs without one', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const betaDir = join(staticDir, 'beta');
    const dataFile = join(staticDir, 'data.json');
    const searchIndexFile = join(staticDir, 'indexes.json');
    const upstreamApk = 'https://raw.githubusercontent.com/example/repo/apk/alpha.apk';

    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });
    await writeFile(
        join(alphaDir, 'index.json'),
        JSON.stringify({
            extensionList: {
                extensions: [
                    {
                        name: 'Alpha Extension',
                        packageName: 'alpha.pkg',
                        versionName: '1.0.0',
                        versionCode: 1,
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        resources: { apkUrl: upstreamApk },
                        sources: [{ language: 'en' }]
                    }
                ]
            }
        })
    );
    await writeFile(
        join(betaDir, 'index.min.json'),
        JSON.stringify([
            {
                name: 'Beta Extension',
                pkg: 'beta.pkg',
                version: '2.0.0',
                lang: 'ja',
                apk: 'beta.apk'
            }
        ])
    );

    const releaseUrl = 'https://github.com/amrkmn/x/releases/download/abc1234-1/alpha-alpha.apk';
    await generateDataJson(data, {
        commit: 'abcdef1234567',
        dataFile,
        searchIndexFile,
        staticDir,
        manifest: {
            alpha: {
                'alpha.pkg': {
                    apk: {
                        name: 'alpha-alpha.apk',
                        sha256: 'a'.repeat(64),
                        version: '1.0.0',
                        source: 'alpha',
                        kind: 'apk' as const,
                        url: releaseUrl
                    }
                }
            }
        }
    });

    let searchIndex = JSON.parse(await readFile(searchIndexFile, 'utf8'));
    expect(searchIndex[0].apkUrl).toBe(releaseUrl);

    await generateDataJson(data, {
        commit: 'abcdef1234567',
        dataFile,
        searchIndexFile,
        staticDir
    });

    searchIndex = JSON.parse(await readFile(searchIndexFile, 'utf8'));
    expect(searchIndex[0].apkUrl).toBe(upstreamApk);
});

test('fetchMissingIcons mirrors wrapper iconUrls and keeps upstream URLs on failure', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const server = createServer((req, res) => {
        if (req.url === '/good.png') {
            res.writeHead(200, { 'content-type': 'image/png' });
            res.end(png);
        } else if (req.url === '/text.png') {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('not an image');
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    // SAFETY: server is bound to a TCP port above, so address() is AddressInfo.
    const port = (server.address() as AddressInfo).port;

    try {
        const data: ExtensionsData = {
            mihon: {
                alpha: {
                    name: 'Alpha Source',
                    source: 'https://github.com/example/alpha',
                    path: '/alpha/index.pb',
                    category: 'mihon',
                    commit: 'abc'
                }
            },
            aniyomi: {
                beta: {
                    name: 'Beta Source',
                    source: 'https://github.com/example/beta',
                    path: '/beta/index.min.json',
                    category: 'aniyomi',
                    commit: 'abc'
                }
            }
        };
        const staticDir = join(testDir, 'static');
        const alphaDir = join(staticDir, 'alpha');
        const betaDir = join(staticDir, 'beta');

        await mkdir(alphaDir, { recursive: true });
        await mkdir(betaDir, { recursive: true });
        await writeFile(
            join(alphaDir, 'index.json'),
            JSON.stringify({
                extensionList: {
                    extensions: [
                        {
                            packageName: 'good.pkg',
                            resources: { iconUrl: `http://127.0.0.1:${port}/good.png` }
                        },
                        {
                            packageName: 'gone.pkg',
                            resources: { iconUrl: `http://127.0.0.1:${port}/gone.png` }
                        },
                        {
                            packageName: 'text.pkg',
                            resources: { iconUrl: `http://127.0.0.1:${port}/text.png` }
                        }
                    ]
                }
            })
        );
        await writeFile(
            join(betaDir, 'index.min.json'),
            JSON.stringify([{ name: 'Beta', pkg: 'beta.pkg', apk: 'beta.apk' }])
        );

        const result = await fetchMissingIcons(data, staticDir);

        expect(result).toEqual({ fetched: 1, skipped: 0, failed: 2 });
        expect(existsSync(join(alphaDir, 'icon', 'good.pkg.png'))).toBe(true);
        expect(existsSync(join(alphaDir, 'icon', 'gone.pkg.png'))).toBe(false);
        expect(existsSync(join(alphaDir, 'icon', 'text.pkg.png'))).toBe(false);
        expect(existsSync(join(betaDir, 'icon'))).toBe(false);

        const again = await fetchMissingIcons(data, staticDir);
        expect(again.fetched).toBe(0);
        expect(again.skipped).toBe(1);
        expect(again.failed).toBe(2);
    } finally {
        server.close();
    }
});

test('generateDataJson synthesizes pinned upstream apkUrls for flat entries', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    const betaDir = join(staticDir, 'beta');
    const dataFile = join(staticDir, 'data.json');
    const searchIndexFile = join(staticDir, 'indexes.json');
    const upstreamApk = 'https://raw.githubusercontent.com/example/beta/oldhash2/apk/beta.apk';

    await mkdir(betaDir, { recursive: true });
    await writeFile(
        join(betaDir, 'index.min.json'),
        JSON.stringify([
            {
                name: 'Beta Extension',
                pkg: 'beta.pkg',
                version: '2.0.0',
                lang: 'ja',
                apk: 'beta.apk',
                nsfw: 0
            }
        ])
    );

    await generateDataJson(data, {
        commit: 'abcdef1234567',
        dataFile,
        searchIndexFile,
        staticDir
    });
    let searchIndex = JSON.parse(await readFile(searchIndexFile, 'utf8'));
    expect(searchIndex).toHaveLength(1);
    expect(searchIndex[0].apkUrl).toBe(upstreamApk);

    const releaseUrl = 'https://github.com/amrkmn/x/releases/download/abc1234-1/beta-beta.apk';
    await generateDataJson(data, {
        commit: 'abcdef1234567',
        dataFile,
        searchIndexFile,
        staticDir,
        manifest: {
            beta: {
                'beta.pkg': {
                    apk: {
                        name: 'beta-beta.apk',
                        sha256: 'a'.repeat(64),
                        version: '2.0.0',
                        source: 'beta',
                        kind: 'apk',
                        url: releaseUrl
                    }
                }
            }
        }
    });
    searchIndex = JSON.parse(await readFile(searchIndexFile, 'utf8'));
    expect(searchIndex[0].apkUrl).toBe(releaseUrl);
});

test('refreshMirrorIndexPb overlays manifest apkUrls and regenerates index.pb for Mihon', async () => {
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const betaDir = join(staticDir, 'beta');
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });

    const upstreamApk = 'https://upstream.example/alpha.apk';
    await writeFile(
        join(alphaDir, 'index.json'),
        JSON.stringify({
            name: 'Alpha',
            badgeLabel: 'A',
            signingKey: 'deadbeef',
            contact: { website: 'https://example.test' },
            extensionList: {
                extensions: [
                    {
                        name: 'Covered',
                        packageName: 'covered.pkg',
                        resources: {
                            apkUrl: upstreamApk,
                            jarUrl: 'https://upstream.example/alpha.jar'
                        },
                        extensionLib: '1.6',
                        versionCode: '106004',
                        versionName: '1.0.0',
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        sources: [{ id: '1', name: 'Covered', language: 'en' }]
                    },
                    {
                        name: 'Uncovered',
                        packageName: 'uncovered.pkg',
                        resources: { apkUrl: 'https://upstream.example/other.apk' },
                        extensionLib: '1.6',
                        versionCode: '106005',
                        versionName: '1.0.0',
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        sources: [{ id: '2', name: 'Uncovered', language: 'en' }]
                    }
                ]
            }
        })
    );

    const releaseUrl = 'https://github.com/amrkmn/x/releases/download/abc1234-1/alpha-covered.apk';
    const releaseJarUrl =
        'https://github.com/amrkmn/x/releases/download/abc1234-1/alpha-covered.jar';
    const regenerated = await refreshMirrorIndexPb('mihon', 'alpha', staticDir, {
        alpha: {
            'covered.pkg': {
                apk: {
                    name: 'alpha-covered.apk',
                    sha256: 'a'.repeat(64),
                    version: '1.0.0',
                    source: 'alpha',
                    kind: 'apk',
                    url: releaseUrl
                },
                jar: {
                    name: 'alpha-covered.jar',
                    sha256: 'b'.repeat(64),
                    version: '1.0.0',
                    source: 'alpha',
                    kind: 'jar',
                    url: releaseJarUrl
                }
            }
        }
    });

    expect(regenerated).toBe(true);
    const index = JSON.parse(await readFile(join(alphaDir, 'index.json'), 'utf8'));
    const entries = index.extensionList.extensions;
    expect(entries[0].resources.apkUrl).toBe(releaseUrl);
    expect(entries[0].resources.jarUrl).toBe(releaseJarUrl);
    expect(entries[1].resources.apkUrl).toBe('https://upstream.example/other.apk');

    const decoded = decodeIndexPb(await readFile(join(alphaDir, 'index.pb')));
    expect(decoded.signingKey).toBe('deadbeef');
    const decodedList = decoded.extensionList;
    if (!isRecord(decodedList) || !Array.isArray(decodedList.extensions)) {
        throw new Error('bad shape');
    }
    const decodedEntries = decodedList.extensions.filter(isRecord);
    expect(decodedEntries).toHaveLength(2);
    const decodedResources = decodedEntries.map((entry) => {
        if (!isRecord(entry.resources)) throw new Error('bad shape');
        return entry.resources;
    });
    expect(decodedResources[0].apkUrl).toBe(releaseUrl);
    expect(decodedResources[1].apkUrl).toBe('https://upstream.example/other.apk');

    await writeFile(join(betaDir, 'index.min.json'), JSON.stringify([]));
    expect(await refreshMirrorIndexPb('aniyomi', 'beta', staticDir)).toBe(false);
    expect(existsSync(join(betaDir, 'index.pb'))).toBe(false);

    await writeFile(
        join(alphaDir, 'index.json'),
        JSON.stringify({
            name: 'Alpha',
            extensionList: { extensions: [] }
        })
    );
    expect(await refreshMirrorIndexPb('mihon', 'alpha', staticDir)).toBe(true);
    expect(decodeIndexPb(await readFile(join(alphaDir, 'index.pb'))).name).toBe('Alpha');
});

test('refreshMirrorIndexPb uses the Aniyomi codec for Secozzi wrappers', async () => {
    const staticDir = join(testDir, 'static');
    const secozziDir = join(staticDir, 'secozzi');
    await mkdir(secozziDir, { recursive: true });
    await writeFile(
        join(secozziDir, 'index.json'),
        JSON.stringify({
            name: 'Secozzi',
            signingKey: 'secozzi-signing-key',
            extensionList: {
                extensions: [
                    {
                        name: 'Stremio',
                        packageName: 'stremio.pkg',
                        resources: { apkUrl: 'https://upstream.example/stremio.apk' },
                        isTorrent: true,
                        sources: [{ id: '8425771932667600381', message: 'torrent source' }]
                    }
                ]
            }
        })
    );

    const releaseUrl = 'https://github.com/amrkmn/x/releases/download/abc-0/secozzi-stremio.apk';
    const manifest = {
        secozzi: {
            'stremio.pkg': {
                apk: {
                    name: 'secozzi-stremio.apk',
                    sha256: 'b'.repeat(64),
                    version: '1.0.0',
                    source: 'secozzi',
                    kind: 'apk' as const,
                    url: releaseUrl
                }
            }
        }
    };
    expect(await refreshMirrorIndexPb('aniyomi', 'secozzi', staticDir, manifest)).toBe(true);
    const index = JSON.parse(await readFile(join(secozziDir, 'index.json'), 'utf8'));
    expect(index.extensionList.extensions[0].resources.apkUrl).toBe(releaseUrl);
    const generated = await readFile(join(secozziDir, 'index.pb'));
    const decoded = decodeAniyomiIndexPb(generated);
    expect(decoded.signingKey).toBe(index.signingKey);
    const list = decoded.extensionList;
    if (!isRecord(list) || !Array.isArray(list.extensions)) throw new Error('bad shape');
    const extensions = list.extensions.filter(isRecord);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].name).toBe('Stremio');
    if (!isRecord(extensions[0].resources)) throw new Error('bad shape');
    expect(extensions[0].resources.apkUrl).toBe(releaseUrl);
});

const flatAnimeRepo = {
    name: 'Yuzono Anime',
    source: 'https://github.com/yuzono/anime-repo@repo',
    path: '/yuzono/anime/index.pb',
    category: 'aniyomi' as const,
    commit: 'd4fac05022c1bd92ac5af66b890b8d57fd7684dc'
};

function flatAnimeFiles() {
    return {
        'index.min.json': JSON.stringify([
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
                        baseUrl: 'https://www.animeonsen.xyz'
                    }
                ]
            },
            {
                name: 'Aniyomi: Bare',
                pkg: 'eu.kanade.tachiyomi.animeextension.all.bare',
                apk: 'aniyomi-all.bare-v14.1.apk',
                lang: 'en',
                code: 1,
                version: '14.1',
                nsfw: 1,
                sources: []
            }
        ]),
        'repo.json': JSON.stringify({
            meta: {
                name: 'Yūzōnō',
                shortName: 'Yūzōnō',
                website: 'https://github.com/yuzono/anime-extensions',
                signingKeyFingerprint:
                    'cbec121aa82ebb02aaa73806992e0368a97d47b5451ed6524816d03084c45905'
            },
            index_v2: 'https://x.noz.one/yuzono/anime/index.pb'
        })
    };
}

function flatAnimeManifest(): ReleaseManifest {
    const entry = (file: string, url: string) => ({
        apk: {
            name: file,
            sha256: 'c'.repeat(64),
            version: '14.10',
            source: 'yuzono/anime',
            kind: 'apk' as const,
            url
        }
    });
    return {
        'yuzono/anime': {
            'eu.kanade.tachiyomi.animeextension.all.animeonsen': entry(
                'yuzono-anime-animeonsen.apk',
                'https://github.com/amrkmn/x/releases/download/abc-0/yuzono-anime-animeonsen.apk'
            ),
            'eu.kanade.tachiyomi.animeextension.all.bare': entry(
                'yuzono-anime-bare.apk',
                'https://github.com/amrkmn/x/releases/download/abc-0/yuzono-anime-bare.apk'
            )
        }
    };
}

function flatAnimeData(): ExtensionsData {
    return { mihon: {}, aniyomi: { 'yuzono/anime': flatAnimeRepo } };
}

test('refreshMirrorIndexPb converts flat anime indexes to Aniyomi PB', async () => {
    const staticDir = join(testDir, 'static');
    const animeDir = join(staticDir, 'yuzono', 'anime');
    await mkdir(animeDir, { recursive: true });
    const files = flatAnimeFiles();
    await writeFile(join(animeDir, 'index.min.json'), files['index.min.json']);
    await writeFile(join(animeDir, 'repo.json'), files['repo.json']);

    const manifest = flatAnimeManifest();
    expect(
        await refreshMirrorIndexPb('aniyomi', 'yuzono/anime', staticDir, manifest, flatAnimeRepo)
    ).toBe(true);

    expect(await readFile(join(animeDir, 'index.min.json'), 'utf8')).toBe(files['index.min.json']);
    const decoded = decodeAniyomiIndexPb(await readFile(join(animeDir, 'index.pb')));
    expect(decoded.signingKey).toBe(
        'cbec121aa82ebb02aaa73806992e0368a97d47b5451ed6524816d03084c45905'
    );
    const list = decoded.extensionList;
    if (!isRecord(list) || !Array.isArray(list.extensions)) throw new Error('bad shape');
    const extensions = list.extensions.filter(isRecord);
    expect(extensions).toHaveLength(2);
    const onsen = extensions[0];
    expect(onsen.name).toBe('AnimeOnsen');
    if (!isRecord(onsen.resources)) throw new Error('bad shape');
    expect(onsen.resources.apkUrl).toBe(
        'https://github.com/amrkmn/x/releases/download/abc-0/yuzono-anime-animeonsen.apk'
    );
    expect(onsen.resources.iconUrl).toBe(
        'https://x.noz.one/yuzono/anime/icon/eu.kanade.tachiyomi.animeextension.all.animeonsen.png'
    );
    expect(onsen.isTorrent ?? false).toBe(false);
    if (!Array.isArray(onsen.sources)) throw new Error('bad shape');
    expect(onsen.sources).toHaveLength(1);
    if (!Array.isArray(extensions[1].sources)) throw new Error('bad shape');
    expect(extensions[1].sources).toHaveLength(1);
});

test('refreshFlatAnimeIndexPb keeps upstream URLs without a manifest', async () => {
    const staticDir = join(testDir, 'static');
    const animeDir = join(staticDir, 'yuzono', 'anime');
    await mkdir(animeDir, { recursive: true });
    const files = flatAnimeFiles();
    await writeFile(join(animeDir, 'index.min.json'), files['index.min.json']);
    await writeFile(join(animeDir, 'repo.json'), files['repo.json']);

    expect(await refreshFlatAnimeIndexPb('yuzono/anime', staticDir, flatAnimeRepo)).toBe(true);
    const decoded = decodeAniyomiIndexPb(await readFile(join(animeDir, 'index.pb')));
    const list = decoded.extensionList;
    if (!isRecord(list) || !Array.isArray(list.extensions)) throw new Error('bad shape');
    const resources = list.extensions.filter(isRecord).map((entry) => {
        if (!isRecord(entry.resources)) throw new Error('bad shape');
        return entry.resources;
    });
    expect(resources[0].apkUrl).toBe(
        'https://raw.githubusercontent.com/yuzono/anime-repo/d4fac05022c1bd92ac5af66b890b8d57fd7684dc/apk/aniyomi-all.animeonsen-v14.10.apk'
    );
});

test('generateRedirects maps every legacy APK path to its release asset', async () => {
    const staticDir = join(testDir, 'static');
    const animeDir = join(staticDir, 'yuzono', 'anime');
    await mkdir(animeDir, { recursive: true });
    const files = flatAnimeFiles();
    await writeFile(join(animeDir, 'index.min.json'), files['index.min.json']);

    const manifest = flatAnimeManifest();
    expect(await generateRedirects(flatAnimeData(), staticDir, { manifest })).toBe(2);
    expect(await readFile(join(staticDir, '_redirects'), 'utf8')).toBe(
        '/yuzono/anime/apk/aniyomi-all.animeonsen-v14.10.apk https://github.com/amrkmn/x/releases/download/abc-0/yuzono-anime-animeonsen.apk 302\n' +
            '/yuzono/anime/apk/aniyomi-all.bare-v14.1.apk https://github.com/amrkmn/x/releases/download/abc-0/yuzono-anime-bare.apk 302\n'
    );
});

test('generateRedirects fails closed on incomplete manifests', async () => {
    const staticDir = join(testDir, 'static');
    const animeDir = join(staticDir, 'yuzono', 'anime');
    await mkdir(animeDir, { recursive: true });
    const files = flatAnimeFiles();
    await writeFile(join(animeDir, 'index.min.json'), files['index.min.json']);

    const manifest = flatAnimeManifest();
    delete manifest['yuzono/anime']['eu.kanade.tachiyomi.animeextension.all.bare'];
    await expect(generateRedirects(flatAnimeData(), staticDir, { manifest })).rejects.toThrow(
        'no release URL for yuzono/anime'
    );
    expect(existsSync(join(staticDir, '_redirects'))).toBe(false);
});

test('generateRedirects skips index.pb repos without published artifacts', async () => {
    const staticDir = join(testDir, 'static');
    const secozziDir = join(staticDir, 'secozzi');
    await mkdir(secozziDir, { recursive: true });
    await writeFile(
        join(secozziDir, 'index.min.json'),
        JSON.stringify([
            {
                name: 'Outdated App, switch to Animiru 0.20+',
                pkg: 'eu.kanade.tachiyomi.extension.all.animiru',
                apk: 'tachiyomi-all.animiru-v17.1.apk'
            }
        ])
    );
    const data: ExtensionsData = {
        mihon: {},
        aniyomi: {
            secozzi: {
                name: 'Secozzi',
                source: 'https://example.test/secozzi',
                path: '/secozzi/index.pb',
                category: 'aniyomi',
                commit: 'c1'
            }
        }
    };
    expect(await generateRedirects(data, staticDir, { manifest: flatAnimeManifest() })).toBe(0);
});

test('generateRedirects is a no-op without a manifest and clears stale rules', async () => {
    const staticDir = join(testDir, 'static');
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, '_redirects'), '/stale /stale 302\n');
    delete process.env.RELEASE_MANIFEST_FILE;
    expect(await generateRedirects(flatAnimeData(), staticDir)).toBe(0);
    expect(existsSync(join(staticDir, '_redirects'))).toBe(false);
});

test('overlayReleaseManifest cuts over every mirrored wrapper and skips flat indexes', async () => {
    const staticDir = join(testDir, 'static');
    const alphaDir = join(staticDir, 'alpha');
    const betaDir = join(staticDir, 'beta');
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });
    const wrapper = (apkUrl: string) =>
        JSON.stringify({
            name: 'S',
            extensionList: {
                extensions: [{ name: 'E', packageName: 'covered.pkg', resources: { apkUrl } }]
            }
        });
    await writeFile(join(alphaDir, 'index.json'), wrapper('https://upstream.example/a.apk'));
    await writeFile(join(betaDir, 'index.json'), wrapper('https://upstream.example/b.apk'));
    await writeFile(join(betaDir, 'index.min.json'), JSON.stringify([]));

    const releaseUrl = 'https://github.com/amrkmn/x/releases/download/abc-0/s-covered.apk';
    const manifestPath = join(testDir, 'release-assets.json');
    await writeFile(
        manifestPath,
        JSON.stringify({
            alpha: {
                'covered.pkg': {
                    apk: {
                        name: 's-covered.apk',
                        sha256: 'c'.repeat(64),
                        version: '1.0.0',
                        source: 'alpha',
                        kind: 'apk',
                        url: releaseUrl
                    }
                }
            }
        })
    );
    process.env.RELEASE_MANIFEST_FILE = manifestPath;
    try {
        const data: ExtensionsData = {
            mihon: {
                alpha: {
                    name: 'A',
                    source: 'https://example.test/a',
                    path: '/alpha/index.pb',
                    category: 'mihon',
                    commit: 'c1'
                }
            },
            aniyomi: {
                beta: {
                    name: 'B',
                    source: 'https://example.test/b',
                    path: '/beta/index.json',
                    category: 'aniyomi',
                    commit: 'c2'
                }
            }
        };
        expect(await overlayReleaseManifest(data, staticDir)).toBe(2);
        const alpha = JSON.parse(await readFile(join(alphaDir, 'index.json'), 'utf8'));
        expect(alpha.extensionList.extensions[0].resources.apkUrl).toBe(releaseUrl);
        const beta = JSON.parse(await readFile(join(betaDir, 'index.json'), 'utf8'));
        expect(beta.extensionList.extensions[0].resources.apkUrl).toBe(
            'https://upstream.example/b.apk'
        );
    } finally {
        delete process.env.RELEASE_MANIFEST_FILE;
    }
});

test('overlayReleaseManifest is a no-op without a manifest', async () => {
    delete process.env.RELEASE_MANIFEST_FILE;
    expect(await overlayReleaseManifest(createExtensionsData(), testDir)).toBe(0);
});

test('generateDataJson reads wrapper JSON beside a served index.pb path', async () => {
    const staticDir = join(testDir, 'static');
    const secozziDir = join(staticDir, 'secozzi');
    await mkdir(secozziDir, { recursive: true });
    await writeFile(
        join(secozziDir, 'index.json'),
        JSON.stringify({
            name: 'Secozzi',
            extensionList: {
                extensions: [
                    {
                        name: 'Covered',
                        packageName: 'covered.pkg',
                        versionName: '1.0.0',
                        versionCode: 10,
                        contentWarning: 'CONTENT_WARNING_SAFE',
                        resources: { apkUrl: 'https://upstream.example/s.apk' },
                        sources: [{ id: '1', name: 'Covered', language: 'en' }]
                    }
                ]
            }
        })
    );
    const data: ExtensionsData = {
        aniyomi: {
            secozzi: {
                name: 'Secozzi',
                source: 'https://example.test/secozzi',
                path: '/secozzi/index.pb',
                category: 'aniyomi',
                commit: 'c1'
            }
        }
    };
    delete process.env.RELEASE_MANIFEST_FILE;
    await generateDataJson(data, {
        commit: 'c1',
        dataFile: join(staticDir, 'data.json'),
        searchIndexFile: join(staticDir, 'indexes.json'),
        staticDir
    });
    const search = JSON.parse(await readFile(join(staticDir, 'indexes.json'), 'utf8'));
    expect(search).toHaveLength(1);
    expect(search[0].pkg).toBe('covered.pkg');
});

test('fetchLatestReleaseManifest downloads the newest published snapshot', async () => {
    const snapshot = {
        keiyoushi: {
            'org.example.kei': {
                apk: {
                    name: 'keiyoushi-kei.apk',
                    sha256: 'd'.repeat(64),
                    version: '1.0.0',
                    source: 'keiyoushi',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/abc-0/keiyoushi-kei.apk'
                }
            }
        }
    };
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/releases?per_page=30')) {
            return new Response(
                JSON.stringify([
                    {
                        draft: true,
                        created_at: '2026-10-20T00:00:00Z',
                        assets: [
                            {
                                name: 'release-assets.json',
                                browser_download_url: 'https://example.test/draft.json'
                            }
                        ]
                    },
                    {
                        draft: false,
                        created_at: '2026-10-18T00:00:00Z',
                        assets: [
                            {
                                name: 'release-assets.json',
                                browser_download_url: 'https://example.test/old.json'
                            }
                        ]
                    },
                    {
                        draft: false,
                        created_at: '2026-10-19T00:00:00Z',
                        assets: [
                            {
                                name: 'release-assets.json',
                                browser_download_url: 'https://example.test/new.json'
                            }
                        ]
                    }
                ])
            );
        }
        if (url === 'https://example.test/new.json') return new Response(JSON.stringify(snapshot));
        return new Response('not found', { status: 404 });
    };
    expect(await fetchLatestReleaseManifest(fetcher)).toEqual(snapshot);
    expect(calls).toEqual([
        expect.stringContaining('/releases?per_page=30'),
        'https://example.test/new.json'
    ]);
});

test('fetchLatestReleaseManifest returns undefined without a usable snapshot', async () => {
    const empty: typeof fetch = async () => new Response(JSON.stringify([]));
    expect(await fetchLatestReleaseManifest(empty, [])).toBeUndefined();
    const failing: typeof fetch = async () => new Response('down', { status: 500 });
    expect(await fetchLatestReleaseManifest(failing, [])).toBeUndefined();
});

test('fetchLatestReleaseManifest authenticates when GITHUB_TOKEN is set', async () => {
    let seen: string | null = null;
    const authed: typeof fetch = async (_input, init) => {
        seen = new Headers(init?.headers).get('authorization');
        return new Response(JSON.stringify([]));
    };
    process.env.GITHUB_TOKEN = 'test-token';
    try {
        expect(await fetchLatestReleaseManifest(authed, [0])).toBeUndefined();
    } finally {
        delete process.env.GITHUB_TOKEN;
    }
    expect(seen).toBe('Bearer test-token');
});

test('fetchLatestReleaseManifest retries throttled list requests', async () => {
    let calls = 0;
    const flaky: typeof fetch = async (input) => {
        calls += 1;
        if (String(input).endsWith('/releases?per_page=30') && calls < 3) {
            return new Response('limited', { status: 403 });
        }
        if (String(input).endsWith('/releases?per_page=30')) {
            return new Response(
                JSON.stringify([
                    {
                        draft: false,
                        created_at: '2026-10-19T00:00:00Z',
                        assets: [
                            {
                                name: 'release-assets.json',
                                browser_download_url: 'https://example.test/new.json'
                            }
                        ]
                    }
                ])
            );
        }
        return new Response(
            JSON.stringify({
                keiyoushi: {
                    'org.example.kei': {
                        apk: {
                            name: 'k.apk',
                            sha256: 'e'.repeat(64),
                            version: '1.0.0',
                            source: 'keiyoushi',
                            kind: 'apk',
                            url: 'https://example.test/k.apk'
                        }
                    }
                }
            })
        );
    };
    const manifest = await fetchLatestReleaseManifest(flaky, [0, 0, 0]);
    expect(manifest?.keiyoushi['org.example.kei'].apk?.url).toBe('https://example.test/k.apk');
    expect(calls).toBe(4);
});
