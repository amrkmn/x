import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    findExtensionUpdates,
    generateDataJson,
    loadExtensionsData,
    type ExtensionsData
} from '../scripts/extensions';

let testDir: string;

beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'x-update-pipeline-'));
});

afterEach(async () => {
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

test('findExtensionUpdates uses synced commits for static updates and remote head for quick updates', async () => {
    const data = createExtensionsData();
    const staticDir = join(testDir, 'static');
    await mkdir(join(staticDir, 'alpha'), { recursive: true });
    await mkdir(join(staticDir, 'beta'), { recursive: true });

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
        join(alphaDir, 'index.min.json'),
        JSON.stringify([
            {
                name: 'Alpha Extension',
                pkg: 'alpha.pkg',
                version: '1.0.0',
                lang: 'en',
                apk: 'alpha.apk',
                nsfw: 0
            }
        ])
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
    expect(searchIndex[1].nsfw).toBe(1);
});
