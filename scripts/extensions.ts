import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SearchIndexEntry } from '../src/lib/types';
import {
    parseAppData,
    parseExtension,
    parseSearchIndex,
    parseSearchIndexEntry
} from '../src/lib/validation';
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

// Point resource URLs at the mirror only when the file is actually mirrored;
// otherwise keep the upstream URL (e.g. GitHub releases). Returns true when a
// mirror reference points at a missing file (stale mirror).
async function rewriteMirroredIndexFiles(dest: string, key: string): Promise<boolean> {
    const url = `${(process.env.PUBLIC_SITE_URL || config.domains[0]).replace(/\/+$/, '')}/${key}`;
    let staleMirror = false;

    const rewrite = (
        res: Record<string, unknown> | undefined,
        resUrl: string | undefined,
        subdir: string,
        fileName: string
    ): void => {
        if (!resUrl || !res) return;
        if (fileName && existsSync(join(dest, subdir, fileName))) {
            res[resUrl] = `${url}/${subdir}/${fileName}`;
        } else if (String(res[resUrl]).startsWith(`${url}/${subdir}/`)) {
            delete res[resUrl];
            staleMirror = true;
        }
    };

    try {
        const idx = await Bun.file(join(dest, 'index.json')).json();
        for (const ext of idx?.extensionList?.extensions || []) {
            const res = ext?.resources;
            if (!res) continue;
            rewrite(
                res,
                'apkUrl',
                'apk',
                String(res.apkUrl ?? '')
                    .split('/')
                    .pop() ?? ''
            );
            rewrite(
                res,
                'jarUrl',
                'jar',
                String(res.jarUrl ?? '')
                    .split('/')
                    .pop() ?? ''
            );
            if (typeof ext.packageName === 'string' && ext.packageName) {
                rewrite(res, 'iconUrl', 'icon', `${ext.packageName}.png`);
            }
        }
        await Bun.write(join(dest, 'index.json'), JSON.stringify(idx));
    } catch {}

    try {
        const repo = await Bun.file(join(dest, 'repo.json')).json();
        repo.index_v2 = `${url}/index.pb`;
        await Bun.write(join(dest, 'repo.json'), JSON.stringify(repo, null, 2));
    } catch {}

    return staleMirror;
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

// mihon uses the index.json wrapper; aniyomi the flat index.min.json array.
function isMihonIndex(category: string): boolean {
    return category === 'mihon';
}

async function loadRepoExtensions(
    category: string,
    repoPath: string,
    staticDir: string
): Promise<unknown[]> {
    if (isMihonIndex(category)) {
        // index.pb path maps to the JSON wrapper index.json beside it.
        const repoFile = join(
            staticDir,
            repoPath.replace(/^\//, '').replace(/index\.(min\.json|pb)$/, 'index.json')
        );
        if (!existsSync(repoFile)) return [];
        const wrapper = await Bun.file(repoFile).json();
        const list = (wrapper as { extensionList?: { extensions?: unknown[] } })?.extensionList
            ?.extensions;
        if (!Array.isArray(list)) {
            throw new Error(
                `Invalid extension index at ${repoPath}: expected extensionList.extensions`
            );
        }
        return list;
    }

    const repoFile = join(staticDir, repoPath.replace(/^\//, ''));
    if (!existsSync(repoFile)) return [];
    const rawIndex = await Bun.file(repoFile).json();
    if (!Array.isArray(rawIndex)) {
        throw new Error(`Invalid extension index at ${repoPath}: expected array`);
    }
    return rawIndex;
}

// Map a mihon wrapper entry to the search shape (packageName/resources/…).
function entryFromMihon(raw: Record<string, unknown>): SearchIndexEntry {
    const resources = (raw.resources ?? {}) as { apkUrl?: string; iconUrl?: string };
    const apkUrl = resources.apkUrl ?? '';
    const source = (raw.sources as Array<{ language?: string }> | undefined)?.[0];
    const warning = (raw.contentWarning ?? '') as string;

    return {
        pkg: String(raw.packageName),
        name: String(raw.name),
        version: String(raw.versionName ?? ''),
        lang: source?.language ?? '',
        apk: apkUrl.split('/').pop() ?? '',
        ...(resources.iconUrl ? { iconUrl: resources.iconUrl } : {}),
        nsfw: warning === 'CONTENT_WARNING_NSFW' || warning === 'CONTENT_WARNING_MIXED' ? 1 : 0,
        code: raw.versionCode !== undefined ? Number(raw.versionCode) : undefined
    } as unknown as SearchIndexEntry;
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
            const rawIndex = await loadRepoExtensions(category, repo.path, staticDir);
            if (rawIndex.length === 0) {
                logger.warn(
                    'search',
                    `index source skip reason="missing_file" path=${JSON.stringify(repo.path)}`
                );
                continue;
            }

            reposScanned += 1;

            const repoUrl = repo.path.substring(0, repo.path.lastIndexOf('/'));
            const sourceName = repo.name;
            const formattedSourceName = formatSourceName(sourceName);

            for (const [index, rawExtension] of rawIndex.entries()) {
                // Skip uninstallable entries (e.g. deprecation stubs) individually.
                const entryPath = `${repo.path}[${index}]`;
                let extension: SearchIndexEntry;
                try {
                    const parsed = isMihonIndex(category)
                        ? entryFromMihon(rawExtension as Record<string, unknown>)
                        : parseExtension(rawExtension, entryPath);
                    extension = parseSearchIndexEntry(
                        {
                            ...parsed,
                            repoUrl,
                            sourceName,
                            formattedSourceName,
                            category
                        },
                        entryPath
                    );
                } catch (error) {
                    logger.warn(
                        'search',
                        `index entry skip reason="invalid_entry" path=${JSON.stringify(entryPath)} error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`
                    );
                    continue;
                }
                entries.push(extension);
            }
        }
    }

    // Reject a poisoned index outright instead of breaking every consumer at runtime.
    parseSearchIndex(entries);
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

interface ParsedSource {
    url: string;
    branch?: string;
}

function parseSourceUrl(source: string): ParsedSource {
    const idx = source.lastIndexOf('@');
    if (idx === -1) return { url: source };
    const url = source.slice(0, idx);
    const branch = source.slice(idx + 1);
    if (!branch) return { url };
    return { url, branch };
}

async function getRemoteHead(source: string): Promise<string> {
    const { url, branch } = parseSourceUrl(source);
    const ref = branch ? `refs/heads/${branch}` : 'HEAD';
    const output = (await $`git ls-remote ${url} ${ref}`.text()).trim();
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

                if (!options.quick && existsSync(dest)) {
                    const staleMirror = await rewriteMirroredIndexFiles(dest, key);
                    if (staleMirror) {
                        // Binaries moved to GitHub releases; rebuild the mirror fresh.
                        logger.info(
                            'extensions',
                            `stale mirror detected key=${JSON.stringify(key)}`
                        );
                        await rm(dest, { recursive: true, force: true });
                        return { category, key, ext, hash: ext.commit || 'HEAD' };
                    }
                }

                if (!options.quick && !existsSync(dest)) {
                    return { category, key, ext, hash: ext.commit || 'HEAD' };
                }

                const sentinel = isMihonIndex(category) ? 'index.json' : 'index.min.json';
                if (!options.quick && !existsSync(join(dest, sentinel))) {
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
    const { url, branch } = parseSourceUrl(source);
    const branchArgs = branch ? ['--branch', branch] : [];
    try {
        await $`git clone --depth 1 --filter=blob:none --sparse ${branchArgs} ${url} ${temp}`.quiet();
        await $`git -C ${temp} sparse-checkout set --no-cone ${config.filesToCopy}`.quiet();
        return 'sparse';
    } catch {
        await rm(temp, { recursive: true, force: true });
        await $`git clone --depth 1 ${branchArgs} ${url} ${temp}`.quiet();
        return 'full';
    }
}

export function shouldFailOnMaterializeErrors(): boolean {
    return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

// Remove static dirs no longer configured in extensions.json, so removed sources
// aren't resurrected by cache restore. Keeps keys and their nesting prefixes.
export async function pruneRemovedRepos(
    data: ExtensionsData,
    staticDir = STATIC_DIR
): Promise<number> {
    if (!existsSync(staticDir)) return 0;

    const keys = Object.values(data).flatMap((group) => Object.keys(group));
    const isRepoDir = (relative: string) => keys.includes(relative);
    const isPrefix = (relative: string) => keys.some((key) => key.startsWith(`${relative}/`));
    let pruned = 0;

    const pruneEntry = async (current: string): Promise<void> => {
        const full = join(staticDir, current);
        const entries = await readdir(full, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const relative = current ? `${current}/${entry.name}` : entry.name;
            if (isRepoDir(relative) || isPrefix(relative)) {
                if (isPrefix(relative)) await pruneEntry(relative);
                continue;
            }

            await rm(join(full, entry.name), { recursive: true, force: true });
            logger.info('extensions', `prune dir=${JSON.stringify(relative)}`);
            pruned += 1;
        }
    };

    await pruneEntry('');
    return pruned;
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

                await rewriteMirroredIndexFiles(dest, key);

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
