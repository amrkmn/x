import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { appendFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config';
import type { ExtensionConfig } from './types';

export const ROOT_DIR = process.cwd();
export const STATIC_DIR = join(ROOT_DIR, 'static');
export const DATA_FILE = join(STATIC_DIR, 'data.json');
export const TEMP_DIR = join(ROOT_DIR, 'tmp');
export const EXTENSIONS_FILE = join(ROOT_DIR, 'extensions.json');

export type ExtensionsData = Record<string, Record<string, ExtensionConfig>>;

export interface ExtensionUpdate {
    category: string;
    key: string;
    ext: ExtensionConfig;
    hash: string;
}

export async function setGithubOutput(key: string, value: string): Promise<void> {
    if (!process.env.GITHUB_OUTPUT) return;
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export async function loadExtensionsData(path = EXTENSIONS_FILE): Promise<ExtensionsData> {
    return Bun.file(path).json();
}

export async function saveExtensionsData(
    data: ExtensionsData,
    path = EXTENSIONS_FILE
): Promise<void> {
    await Bun.write(path, JSON.stringify(data, null, 4));
}

export function toExtensionList(
    data: ExtensionsData
): Record<string, Array<Pick<ExtensionConfig, 'source' | 'name' | 'path' | 'commit'>>> {
    return Object.fromEntries(
        Object.entries(data).map(([category, extensions]) => [
            category,
            Object.values(extensions).map(({ source, name, path, commit }) => ({
                source,
                name,
                path,
                commit
            }))
        ])
    );
}

export async function generateDataJson(data?: ExtensionsData): Promise<void> {
    console.log('Generating data.json...');

    const extensionsData = data ?? (await loadExtensionsData());
    const commit = (await $`git rev-parse HEAD`.text()).trim();
    const { owner, repo } = config.github;
    const source = `https://github.com/${owner}/${repo}`;

    await Bun.write(
        DATA_FILE,
        JSON.stringify({
            extensions: toExtensionList(extensionsData),
            domains: config.domains,
            source,
            commitLink: `${source}/commit/${commit}`,
            latestCommitHash: commit.substring(0, 7)
        })
    );

    console.log(`Generated data.json (${commit.substring(0, 7)})`);
}

async function getRemoteHead(url: string): Promise<string> {
    const output = (await $`git ls-remote ${url} HEAD`.text()).trim();
    return output.split(/\s+/)[0] ?? '';
}

async function loadSyncedCommits(): Promise<Map<string, string>> {
    const synced = new Map<string, string>();

    try {
        const data = await Bun.file(DATA_FILE).json();
        Object.values(data.extensions || {})
            .flat()
            .forEach((entry: any) => {
                if (entry?.path && entry?.commit) synced.set(entry.path, entry.commit);
            });
    } catch {
        // data.json may not exist before the first full materialization.
    }

    return synced;
}

export async function findExtensionUpdates(
    data: ExtensionsData,
    options: { quick: boolean }
): Promise<ExtensionUpdate[]> {
    console.log('Checking for updates...');

    const synced = options.quick ? new Map<string, string>() : await loadSyncedCommits();
    const checks = Object.entries(data).flatMap(([category, group]) =>
        Object.entries(group).map(async ([key, ext]) => {
            try {
                const dest = join(STATIC_DIR, key);
                const syncedHash = synced.get(ext.path);

                if (!options.quick && !existsSync(dest)) {
                    return { category, key, ext, hash: ext.commit || 'HEAD' };
                }

                const remoteHash = await getRemoteHead(ext.source);

                if (options.quick && remoteHash !== ext.commit) {
                    console.log(
                        `[${ext.name}] Update available: ${ext.commit?.slice(0, 7) ?? 'none'} -> ${remoteHash.slice(0, 7)}`
                    );
                    return { category, key, ext, hash: remoteHash };
                }

                const compareHash = syncedHash ?? ext.commit;
                if (!options.quick && remoteHash !== compareHash) {
                    console.log(
                        `[${ext.name}] Update: ${compareHash?.slice(0, 7) ?? 'none'} -> ${remoteHash.slice(0, 7)}`
                    );
                    return { category, key, ext, hash: remoteHash };
                }
            } catch {
                console.error(`Check failed: ${ext.name}`);
            }

            return null;
        })
    );

    const updates = await Promise.all(checks);
    return updates.filter((update): update is ExtensionUpdate => update !== null);
}

export function applyCommitUpdates(data: ExtensionsData, updates: ExtensionUpdate[]): void {
    for (const { category, key, hash } of updates) {
        data[category][key].commit = hash;
    }
}

export async function materializeExtensions(
    data: ExtensionsData,
    updates: ExtensionUpdate[]
): Promise<boolean> {
    if (updates.length === 0) return false;

    console.log(`Updating ${updates.length} extensions...`);
    await $`rm -rf ${TEMP_DIR}`;

    let changed = false;

    try {
        for (const { key, ext, hash, category } of updates) {
            console.log(`Processing ${ext.name}...`);
            const temp = join(TEMP_DIR, key);
            const dest = join(STATIC_DIR, key);

            try {
                await $`git clone --depth 1 ${ext.source} ${temp}`.quiet();
                await $`rm -rf ${dest} && mkdir -p ${dest}`;

                for (const file of config.filesToCopy) {
                    const srcPath = join(temp, file);
                    if (existsSync(srcPath))
                        await cp(srcPath, join(dest, file), { recursive: true });
                }

                data[category][key].commit = hash;
                changed = true;
                console.log(`  Updated ${ext.name}`);
            } catch (error) {
                console.error(`  Update failed: ${ext.name}`, error);
            }
        }
    } finally {
        await $`rm -rf ${TEMP_DIR}`;
    }

    return changed;
}
