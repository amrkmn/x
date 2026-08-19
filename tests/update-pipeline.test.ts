import { afterEach, beforeEach, expect, test } from 'bun:test';
import { exists, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionsData } from '../scripts/extensions';
import {
    findExtensionUpdates,
    generateDataJson,
    loadExtensionsData,
    pruneRemovedRepos
} from '../scripts/extensions';

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
    // index.json omitted (mihon sentinel) — triggers re-materialization
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

    const indexJson = await Bun.file(join(alphaDir, 'index.json')).json();
    expect(indexJson.extensionList.extensions[0].resources.iconUrl).toBe(
        'https://mirror.example.com/alpha/icon/eu.kanade.tachiyomi.extension.alpha.png'
    );
    expect(indexJson.extensionList.extensions[0].resources.jarUrl).toBe(
        'https://mirror.example.com/alpha/jar/tachiyomi-alpha.jar'
    );

    const repoJson = await Bun.file(join(alphaDir, 'repo.json')).json();
    expect(repoJson.index_v2).toBe('https://mirror.example.com/alpha/index.pb');
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

    const indexJson = await Bun.file(join(alphaDir, 'index.json')).json();
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

    const appData = await Bun.file(dataFile).json();
    const searchIndex = await Bun.file(searchIndexFile).json();

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

    const searchIndex = await Bun.file(searchIndexFile).json();

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
    expect(await exists(join(staticDir, 'keiyoushi'))).toBe(true);
    expect(await exists(join(staticDir, 'keiyoushi', 'apk'))).toBe(true);
    expect(await exists(join(staticDir, 'keiyoushi', 'icon'))).toBe(true);
    expect(await exists(join(staticDir, 'yuzono', 'cursed'))).toBe(true);
    expect(await exists(join(staticDir, 'yuzono', 'manga'))).toBe(false);
    expect(await exists(join(staticDir, 'data.json'))).toBe(true);
    expect(await exists(join(staticDir, 'keiyoushi', 'repo.json'))).toBe(true);
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
    expect(await exists(join(staticDir, 'yuzono'))).toBe(false);
    expect(await exists(join(staticDir, 'keiyoushi'))).toBe(false);
});
