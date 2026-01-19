import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { appendFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { restoreCache, saveCache } from './cache';
import { CACHE_PATHS, CACHE_RESTORE_KEYS, generateCacheKey } from './cache/utils';
import { config } from './config';
import { updateMeilisearch } from './meilisearch';
import type { ExtensionConfig } from './types';

const EXT_DIR = join(process.cwd(), 'static');
const DATA_FILE = join(EXT_DIR, 'data.json');
const TEMP_DIR = join(process.cwd(), 'tmp');

const extensionsData: Record<string, Record<string, ExtensionConfig>> = await Bun.file(
    'extensions.json'
).json();

const setOutput = async (key: string, value: string) =>
    process.env.GITHUB_OUTPUT && (await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`));

async function generateData() {
    console.log('Generating data.json...');
    try {
        const extensions = Object.fromEntries(
            Object.entries(extensionsData).map(([category, exts]) => [
                category,
                Object.values(exts).map(({ source, name, path, commit }) => ({
                    source,
                    name,
                    path,
                    commit
                }))
            ])
        );

        const commit = (await $`git rev-parse HEAD`.text()).trim();
        const { owner, repo } = config.github;
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

if (process.argv.includes('--update-search')) {
    console.log('Updating search index only...');
    await updateMeilisearch();
    process.exit(0);
}

const quickMode = process.argv.includes('--quick');
const useCache = !process.argv.includes('--no-cache') && !quickMode;

if (useCache) await restoreCache(CACHE_PATHS, await generateCacheKey(), CACHE_RESTORE_KEYS);
else
    console.log(quickMode ? 'Cache disabled for quick mode' : 'Cache disabled via --no-cache flag');

console.log('Checking for updates...');
const synced = new Map<string, string>();
if (!quickMode) {
    try {
        Object.values((await Bun.file(DATA_FILE).json()).extensions || {})
            .flat()
            .forEach((e: any) => e?.path && e?.commit && synced.set(e.path, e.commit));
    } catch {}
}

const updates = (
    await Promise.all(
        Object.entries(extensionsData).flatMap(([category, group]) =>
            Object.entries(group).map(async ([key, ext]) => {
                try {
                    const dest = join(EXT_DIR, key);
                    const syncedHash = synced.get(ext.path);

                    if (!quickMode && !existsSync(dest))
                        return { category, key, ext, hash: ext.commit || 'HEAD' };

                    const remoteHash = (
                        await $`git ls-remote ${ext.source} HEAD | cut -f1`.text()
                    ).trim();

                    if (quickMode && remoteHash !== ext.commit) {
                        console.log(
                            `[${ext.name}] Update available: ${ext.commit?.slice(0, 7) ?? 'none'} -> ${remoteHash.slice(0, 7)}`
                        );
                        return { category, key, ext, hash: remoteHash };
                    }

                    if (!quickMode && (remoteHash !== syncedHash || ext.commit !== syncedHash)) {
                        console.log(
                            `[${ext.name}] Update: ${syncedHash?.slice(0, 7) ?? 'none'} -> ${remoteHash.slice(0, 7)}`
                        );
                        return { category, key, ext, hash: remoteHash };
                    }
                } catch {
                    console.error(`Check failed: ${ext.name}`);
                }
                return null;
            })
        )
    )
).filter((u): u is NonNullable<typeof u> => u !== null);

if (updates.length === 0) {
    console.log('No updates found');
    await setOutput('updated', 'false');
    process.exit(0);
}

if (quickMode) {
    console.log(`Found ${updates.length} updates. Updating extensions.json...`);
    updates.forEach(({ category, key, hash }) => (extensionsData[category][key].commit = hash));
    await Bun.write('extensions.json', JSON.stringify(extensionsData, null, 4));
    await setOutput('updated', 'true');
    process.exit(0);
}

const { CI, GITHUB_EVENT_NAME } = process.env;
if (
    CI === 'true' &&
    GITHUB_EVENT_NAME &&
    !['schedule', 'workflow_dispatch'].includes(GITHUB_EVENT_NAME)
) {
    console.log('Skipping updates (CI)');
    await setOutput('updated', 'false');
    process.exit(0);
}

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
            if (existsSync(srcPath)) await cp(srcPath, join(dest, file), { recursive: true });
        }

        extensionsData[category][key].commit = hash;
        changed = true;
        console.log(`  Updated ${ext.name}`);
    } catch (e) {
        console.error(`  Update failed: ${ext.name}`, e);
    }
}

await $`rm -rf ${TEMP_DIR}`;
if (changed) {
    await Bun.write('extensions.json', JSON.stringify(extensionsData, null, 4));
    console.log('Updated extensions.json');
    await generateData();
    await updateMeilisearch();
    if (useCache) await saveCache(CACHE_PATHS, await generateCacheKey());
}

await setOutput('updated', String(changed));
