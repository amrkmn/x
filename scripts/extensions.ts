import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SearchIndexEntry } from '../src/lib/types';
import { parseAppData, parseExtension } from '../src/lib/validation';
import { formatSourceName } from '../src/lib/search/utils';
import { config } from './config';
import { logger } from './log';
import type { ExtensionConfig } from './types';
import { parseExtensionsData } from './validation';

const ROOT_DIR = process.cwd();
const STATIC_DIR = join(ROOT_DIR, 'static');
const DATA_FILE = join(STATIC_DIR, 'data.json');
const SEARCH_INDEX_FILE = join(STATIC_DIR, 'indexes.json');
const TEMP_DIR = join(ROOT_DIR, 'tmp');
const EXTENSIONS_FILE = join(ROOT_DIR, 'extensions.json');

export type ExtensionsData = Record<string, Record<string, ExtensionConfig>>;

export interface ExtensionUpdate {
    category: string;
    key: string;
    ext: ExtensionConfig;
    hash: string;
}

export interface MaterializeFailure {
    category: string;
    key: string;
    name: string;
    reason: string;
}

export interface MaterializeResult {
    changed: boolean;
    failures: MaterializeFailure[];
}

interface GenerateDataOptions {
    commit?: string;
    dataFile?: string;
    searchIndexFile?: string;
    staticDir?: string;
}

interface FindExtensionUpdatesOptions {
    quick: boolean;
    staticDir?: string;
    getRemoteHead?: (url: string) => Promise<string>;
    loadSyncedCommits?: () => Promise<Map<string, string>>;
}

export async function setGithubOutput(key: string, value: string): Promise<void> {
    if (!process.env.GITHUB_OUTPUT) return;
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export async function loadExtensionsData(path = EXTENSIONS_FILE): Promise<ExtensionsData> {
    return parseExtensionsData(await Bun.file(path).json());
}

export async function saveExtensionsData(
    data: ExtensionsData,
    path = EXTENSIONS_FILE
): Promise<void> {
    await Bun.write(path, JSON.stringify(data, null, 4));
}

function toExtensionList(
    data: ExtensionsData
): Record<string, Array<Pick<ExtensionConfig, 'source' | 'name' | 'path' | 'commit'>>> {
    return Object.fromEntries(
        Object.entries(data).map(([category, extensions]) => [
            category,
            Object.values(extensions).map(({ source, name, path, commit }) => ({
                source,
                name,
                path,
                ...(commit ? { commit } : {})
            }))
        ])
    );
}

async function generateSearchIndexJson(
    data: ExtensionsData,
    staticDir = STATIC_DIR,
    searchIndexFile = SEARCH_INDEX_FILE
): Promise<void> {
    logger.info('search', 'index generate start file="indexes.json"');

    const entries: SearchIndexEntry[] = [];
    let reposScanned = 0;

    for (const [category, repos] of Object.entries(data)) {
        for (const [, repo] of Object.entries(repos)) {
            const normalizedPath = repo.path.replace(/^\//, '');
            const repoFile = join(staticDir, normalizedPath);

            if (!existsSync(repoFile)) {
                logger.warn(
                    'search',
                    `index source skip reason="missing_file" path=${JSON.stringify(repo.path)}`
                );
                continue;
            }

            reposScanned += 1;
            const rawIndex = await Bun.file(repoFile).json();
            if (!Array.isArray(rawIndex)) {
                throw new Error(`Invalid extension index at ${repo.path}: expected array`);
            }

            const repoUrl = repo.path.substring(0, repo.path.lastIndexOf('/'));
            const sourceName = repo.name;
            const formattedSourceName = formatSourceName(sourceName);

            for (const [index, rawExtension] of rawIndex.entries()) {
                const extension = parseExtension(rawExtension, `${repo.path}[${index}]`);
                entries.push({
                    ...extension,
                    repoUrl,
                    sourceName,
                    formattedSourceName,
                    category
                });
            }
        }
    }

    await Bun.write(searchIndexFile, JSON.stringify(entries));
    logger.info(
        'search',
        `index generate complete records=${entries.length} repos=${reposScanned} output=${JSON.stringify(searchIndexFile)}`
    );
}

export async function generateDataJson(
    data?: ExtensionsData,
    options: GenerateDataOptions = {}
): Promise<void> {
    logger.info('data', 'data generate start file="data.json"');

    const extensionsData = data ?? (await loadExtensionsData());
    const commit = options.commit ?? (await $`git rev-parse HEAD`.text()).trim();
    const dataFile = options.dataFile ?? DATA_FILE;
    const searchIndexFile = options.searchIndexFile ?? SEARCH_INDEX_FILE;
    const staticDir = options.staticDir ?? STATIC_DIR;
    const { owner, repo } = config.github;
    const source = `https://github.com/${owner}/${repo}`;

    await Bun.write(
        dataFile,
        JSON.stringify({
            extensions: toExtensionList(extensionsData),
            domains: config.domains,
            source,
            commitLink: `${source}/commit/${commit}`,
            latestCommitHash: commit.substring(0, 7)
        })
    );

    await generateSearchIndexJson(extensionsData, staticDir, searchIndexFile);
    logger.info('data', `data generate complete commit=${commit.substring(0, 7)}`);
}

async function getRemoteHead(url: string): Promise<string> {
    const output = (await $`git ls-remote ${url} HEAD`.text()).trim();
    return output.split(/\s+/)[0] ?? '';
}

async function loadSyncedCommits(dataFile = DATA_FILE): Promise<Map<string, string>> {
    const synced = new Map<string, string>();

    try {
        const data = parseAppData(await Bun.file(dataFile).json());
        Object.values(data.extensions)
            .flat()
            .forEach((entry) => {
                if (entry.path && entry.commit) synced.set(entry.path, entry.commit);
            });
    } catch {
        // data.json may not exist before the first full materialization.
    }

    return synced;
}

export async function findExtensionUpdates(
    data: ExtensionsData,
    options: FindExtensionUpdatesOptions
): Promise<ExtensionUpdate[]> {
    logger.info('extensions', 'update check start');

    const staticDir = options.staticDir ?? STATIC_DIR;
    const remoteHead = options.getRemoteHead ?? getRemoteHead;
    const synced = options.quick
        ? new Map<string, string>()
        : await (options.loadSyncedCommits ?? (() => loadSyncedCommits()))();

    const checks = Object.entries(data).flatMap(([category, group]) =>
        Object.entries(group).map(async ([key, ext]) => {
            try {
                const dest = join(staticDir, key);
                const syncedHash = synced.get(ext.path);

                if (!options.quick && !existsSync(dest)) {
                    return { category, key, ext, hash: ext.commit || 'HEAD' };
                }

                const remoteHash = await remoteHead(ext.source);

                if (options.quick && remoteHash !== ext.commit) {
                    logger.info(
                        'extensions',
                        `update available name=${JSON.stringify(ext.name)} from=${ext.commit?.slice(0, 7) ?? 'none'} to=${remoteHash.slice(0, 7)}`
                    );
                    return { category, key, ext, hash: remoteHash };
                }

                const compareHash = syncedHash ?? ext.commit;
                if (!options.quick && remoteHash !== compareHash) {
                    logger.info(
                        'extensions',
                        `update detected name=${JSON.stringify(ext.name)} from=${compareHash?.slice(0, 7) ?? 'none'} to=${remoteHash.slice(0, 7)}`
                    );
                    return { category, key, ext, hash: remoteHash };
                }
            } catch {
                logger.error('extensions', `update check failed name=${JSON.stringify(ext.name)}`);
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

async function cloneRepository(source: string, temp: string): Promise<'sparse' | 'full'> {
    try {
        await $`git clone --depth 1 --filter=blob:none --sparse ${source} ${temp}`.quiet();
        await $`git -C ${temp} sparse-checkout set --no-cone ${config.filesToCopy}`.quiet();
        return 'sparse';
    } catch {
        await rm(temp, { recursive: true, force: true });
        await $`git clone --depth 1 ${source} ${temp}`.quiet();
        return 'full';
    }
}

export function shouldFailOnMaterializeErrors(): boolean {
    return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

export async function materializeExtensions(
    data: ExtensionsData,
    updates: ExtensionUpdate[]
): Promise<MaterializeResult> {
    if (updates.length === 0) return { changed: false, failures: [] };

    logger.info('extensions', `materialize start count=${updates.length}`);
    await $`rm -rf ${TEMP_DIR}`;

    let changed = false;
    const failures: MaterializeFailure[] = [];
    let sparseClones = 0;
    let fullClones = 0;

    try {
        for (const { key, ext, hash, category } of updates) {
            logger.info('extensions', `materialize item start name=${JSON.stringify(ext.name)}`);
            const temp = join(TEMP_DIR, key);
            const dest = join(STATIC_DIR, key);

            try {
                await mkdir(join(temp, '..'), { recursive: true });
                const cloneMode = await cloneRepository(ext.source, temp);
                if (cloneMode === 'sparse') sparseClones += 1;
                else fullClones += 1;

                await $`rm -rf ${dest} && mkdir -p ${dest}`;

                for (const file of config.filesToCopy) {
                    const srcPath = join(temp, file);
                    if (existsSync(srcPath)) {
                        await cp(srcPath, join(dest, file), { recursive: true });
                    }
                }

                data[category][key].commit = hash;
                changed = true;
                logger.info(
                    'extensions',
                    `materialize item complete name=${JSON.stringify(ext.name)}`
                );
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                failures.push({ category, key, name: ext.name, reason });
                logger.error(
                    'extensions',
                    `materialize item failed name=${JSON.stringify(ext.name)}`,
                    error
                );
            } finally {
                await rm(temp, { recursive: true, force: true });
            }
        }
    } finally {
        await $`rm -rf ${TEMP_DIR}`;
    }

    logger.info(
        'extensions',
        `materialize complete updates=${updates.length} changed=${changed} failures=${failures.length} sparse_clones=${sparseClones} full_clones=${fullClones}`
    );

    return { changed, failures };
}
