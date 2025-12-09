import { $ } from 'bun';
import { existsSync } from 'fs';
import { appendFile, cp } from 'fs/promises';
import { join } from 'path';
import { restoreCache, saveCache } from './cache';
import { CACHE_PATHS, CACHE_RESTORE_KEYS, generateCacheKey } from './cache/constants';
import { config } from './config';
import type { ExtensionConfig } from './types';

const EXT_DIR = join(process.cwd(), 'static');
const DATA_FILE = join(EXT_DIR, 'data.json');
const TEMP_DIR = join(process.cwd(), 'tmp');

// Load Config
const extensionsData: Record<string, Record<string, ExtensionConfig>> = await Bun.file(
    'extensions.json'
).json();
const { owner, repo } = config.github;

async function generateData() {
    console.log('Generating data.json...');
    try {
        const extensions: Record<string, any[]> = {};
        for (const [cat, exts] of Object.entries(extensionsData)) {
            extensions[cat] = Object.values(exts).map((e) => ({
                source: e.source,
                name: e.name,
                path: e.path,
                commit: e.commit
            }));
        }

        const commit = (await $`git rev-parse HEAD`.text()).trim();
        const source = `https://github.com/${owner}/${repo}`;

        await Bun.write(
            DATA_FILE,
            JSON.stringify({
                extensions,
                domains: config.domains,
                source,
                commitLink: `${source}/commit/${commit}`,
                latestCommitHash: commit.substring(0, 7)
            })
        );
        console.log(`Generated data.json (${commit.substring(0, 7)})`);
    } catch (error) {
        console.error('Failed to generate data.json:', error);
        process.exit(1);
    }
}

if (process.argv.includes('--generate-only')) {
    await generateData();
    process.exit(0);
}

// Try to restore from R2 cache
const cacheKey = await generateCacheKey();

await restoreCache(CACHE_PATHS, cacheKey, CACHE_RESTORE_KEYS);

// 1. Identify updates
console.log('Checking for updates...');
const synced = new Map<string, string>();
try {
    const data = await Bun.file(DATA_FILE).json();
    Object.values(data.extensions || {})
        .flat()
        .forEach((e: any) => {
            if (e?.path && e?.commit) synced.set(e.path, e.commit);
        });
} catch {}

const tasks = Object.entries(extensionsData).flatMap(([category, group]) =>
    Object.entries(group).map(([key, ext]) => ({ category, key, ext }))
);

const updates = (
    await Promise.all(
        tasks.map(async ({ category, key, ext }) => {
            try {
                const dest = join(EXT_DIR, key);
                const syncedHash = synced.get(ext.path);

                // If missing on disk, we must update
                if (!existsSync(dest))
                    return {
                        category,
                        key,
                        ext,
                        hash: ext.commit || 'HEAD'
                    };

                // Fetch remote
                const remoteHash = (
                    await $`git ls-remote ${ext.source} HEAD | cut -f1`.text()
                ).trim();

                // Update if remote differs from synced, or if config differs from synced
                if (remoteHash !== syncedHash || ext.commit !== syncedHash) {
                    console.log(
                        `[${ext.name}] Update: ${syncedHash?.slice(0, 7) ?? 'none'} -> ${remoteHash.slice(0, 7)}`
                    );
                    return { category, key, ext, hash: remoteHash };
                }
            } catch (e) {
                console.error(`Check failed: ${ext.name}`);
            }
            return null;
        })
    )
).filter((u): u is NonNullable<typeof u> => u !== null);

// 2. Check if we should proceed
if (updates.length === 0) {
    console.log('No updates found');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'updated=false\n');
    process.exit(0);
}

// Skip updates in CI unless it's a scheduled run or manual trigger
const isCI = process.env.CI === 'true';
const allowedEvents = ['schedule', 'workflow_dispatch'];
const shouldSkip = isCI && !allowedEvents.includes(process.env.GITHUB_EVENT_NAME || '');

if (shouldSkip) {
    console.log('Skipping updates (CI)');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'updated=false\n');
    process.exit(0);
}

// 3. Perform Updates
console.log(`Updating ${updates.length} extensions...`);
await $`rm -rf ${TEMP_DIR}`;

let changed = false;
for (const { key, ext, hash, category } of updates) {
    console.log(`Processing ${ext.name}...`);
    const temp = join(TEMP_DIR, key);
    const dest = join(EXT_DIR, key);

    try {
        await $`git clone --depth 1 ${ext.source} ${temp}`.quiet();
        await $`rm -rf ${dest} && mkdir -p ${dest}`;

        for (const file of config.filesToCopy) {
            const srcPath = join(temp, file);
            if (existsSync(srcPath)) {
                await cp(srcPath, join(dest, file), { recursive: true });
            }
        }

        extensionsData[category][key].commit = hash;
        changed = true;
        console.log(`  Updated ${ext.name}`);
    } catch (e) {
        console.error(`  Update failed: ${ext.name}`, e);
    }
}

// 4. Cleanup & Save
await $`rm -rf ${TEMP_DIR}`;
if (changed) {
    await Bun.write('extensions.json', JSON.stringify(extensionsData, null, 4));
    console.log('Updated extensions.json');
    await generateData();

    // Save cache with new key based on updated extensions.json
    const newCacheKey = await generateCacheKey();
    await saveCache(CACHE_PATHS, newCacheKey);
}

if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `updated=${changed}\n`);
console.log('Done.');
