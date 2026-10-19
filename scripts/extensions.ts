import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import $ from 'dax';

import { formatSourceName } from '../src/lib/search/utils';
import type { Extension, SearchIndexEntry } from '../src/lib/types';
import type { JsonObject, JsonValue } from '../src/lib/validation';
import { parseAppData, parseExtension, parseSearchIndexEntry } from '../src/lib/validation';
import { config } from './config';
import { encodeIndexPb } from './generate-index';
import { logger } from './log';
import { manifestAsset, parseReleaseManifest } from './releases/manifest';
import { flatUpstreamApkUrl } from './releases/sources';
import type { ReleaseManifest } from './releases/types';
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
    // Latest complete release-assets.json snapshot. Absent while the
    // publisher has not run: entries keep their upstream URLs (no cutover;
    // Phase 4 owns switching website/app links to release URLs).
    manifest?: ReleaseManifest;
    manifestFile?: string;
}

interface FindExtensionUpdatesOptions {
    quick: boolean;
    staticDir?: string;
    getRemoteHead?: (url: string) => Promise<string>;
    loadSyncedCommits?: () => Promise<Map<string, string>>;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
    return (
        value !== undefined &&
        value !== null &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function isStringValue(value: JsonValue | undefined): value is string {
    return value !== undefined && value !== null && String(value) === value;
}

function getMihonExtensions(index: JsonObject): JsonValue[] | undefined {
    const wrapper = index.extensionList;
    if (!isJsonObject(wrapper) || !Array.isArray(wrapper.extensions)) return undefined;
    return wrapper.extensions;
}

// Point resource URLs at the mirror only when the file is actually mirrored;
// otherwise keep the upstream URL (e.g. GitHub releases). Returns true when a
// mirror reference points at a missing file (stale mirror).
async function rewriteMirroredIndexFiles(dest: string, key: string): Promise<boolean> {
    const url = `${(process.env.PUBLIC_SITE_URL || config.domains[0]).replace(/\/+$/, '')}/${key}`;
    let staleMirror = false;
    let indexChanged = false;

    const rewrite = (
        res: JsonObject | undefined,
        resUrl: string,
        subdir: string,
        fileName: string
    ): void => {
        if (!resUrl || !res) return;
        if (fileName && existsSync(join(dest, subdir, fileName))) {
            const mirroredUrl = `${url}/${subdir}/${fileName}`;
            if (res[resUrl] !== mirroredUrl) {
                res[resUrl] = mirroredUrl;
                indexChanged = true;
            }
        } else if (String(res[resUrl] ?? '').startsWith(`${url}/${subdir}/`)) {
            delete res[resUrl];
            indexChanged = true;
            staleMirror = true;
        }
    };

    try {
        const idx: JsonObject = JSON.parse(await readFile(join(dest, 'index.json'), 'utf8'));
        for (const ext of getMihonExtensions(idx) ?? []) {
            const res =
                isJsonObject(ext) && isJsonObject(ext.resources) ? ext.resources : undefined;
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
            if (isJsonObject(ext) && isStringValue(ext.packageName)) {
                rewrite(res, 'iconUrl', 'icon', `${ext.packageName}.png`);
            }
        }
        if (indexChanged) await writeFile(join(dest, 'index.json'), JSON.stringify(idx));
    } catch {}

    try {
        const repo: JsonObject = JSON.parse(await readFile(join(dest, 'repo.json'), 'utf8'));
        const mirroredIndex = `${url}/index.pb`;
        if (repo.index_v2 !== mirroredIndex) {
            repo.index_v2 = mirroredIndex;
            await writeFile(join(dest, 'repo.json'), JSON.stringify(repo, null, 2));
        }
    } catch {}

    return staleMirror;
}

export async function setGithubOutput(key: string, value: string): Promise<void> {
    if (!process.env.GITHUB_OUTPUT) return;
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export async function loadExtensionsData(path = EXTENSIONS_FILE): Promise<ExtensionsData> {
    return parseExtensionsData(JSON.parse(await readFile(path, 'utf8')));
}

export async function saveExtensionsData(
    data: ExtensionsData,
    path = EXTENSIONS_FILE
): Promise<void> {
    await writeFile(path, JSON.stringify(data, null, 4));
}

function toExtensionList(
    data: ExtensionsData
): Record<string, Array<Pick<ExtensionConfig, 'source' | 'name' | 'path' | 'commit'>>> {
    return Object.fromEntries(
        Object.entries(data).map(([category, extensions]) => [
            category,
            Object.values(extensions).map(({ source, name, path, commit }) => {
                const entry: Pick<ExtensionConfig, 'source' | 'name' | 'path' | 'commit'> = {
                    source,
                    name,
                    path
                };
                if (commit) entry.commit = commit;
                return entry;
            })
        ])
    );
}

// mihon uses the index.json wrapper; aniyomi the flat index.min.json array.
function isMihonIndex(category: string): boolean {
    return category === 'mihon';
}

// Secozzi keeps its Aniyomi category but serves a Mihon-style wrapper;
// detect wrapper entries by shape rather than category.
function isMihonEntry(raw: JsonValue): raw is JsonObject {
    return isJsonObject(raw) && (isStringValue(raw.packageName) || isJsonObject(raw.resources));
}

async function loadRepoExtensions(
    category: string,
    repoPath: string,
    staticDir: string
): Promise<JsonValue[]> {
    if (isMihonIndex(category)) {
        // index.pb path maps to the JSON wrapper index.json beside it.
        const repoFile = join(
            staticDir,
            repoPath.replace(/^\//, '').replace(/index\.(min\.json|pb)$/, 'index.json')
        );
        if (!existsSync(repoFile)) return [];
        const wrapper: JsonObject = JSON.parse(await readFile(repoFile, 'utf8'));
        const list = getMihonExtensions(wrapper);
        if (!list) {
            throw new Error(
                `Invalid extension index at ${repoPath}: expected extensionList.extensions`
            );
        }
        return list;
    }

    const repoFile = join(staticDir, repoPath.replace(/^\//, ''));
    if (!existsSync(repoFile)) return [];
    const rawIndex: JsonValue = JSON.parse(await readFile(repoFile, 'utf8'));
    if (Array.isArray(rawIndex)) return rawIndex;
    // Shape-aware: Secozzi's authoritative index.json is a Mihon-style
    // NetworkExtensionStore wrapper despite its Aniyomi category.
    if (isJsonObject(rawIndex)) {
        const list = getMihonExtensions(rawIndex);
        if (list) return list;
    }
    throw new Error(`Invalid extension index at ${repoPath}: expected array`);
}

// Map a mihon wrapper entry to the search shape (packageName/resources/…).
function entryFromMihon(raw: JsonObject): JsonObject {
    const resources = isJsonObject(raw.resources) ? raw.resources : {};
    const sources = raw.sources;
    const source = Array.isArray(sources) && isJsonObject(sources[0]) ? sources[0] : undefined;
    const entry: JsonObject = {
        pkg: String(raw.packageName),
        name: String(raw.name),
        version: String(raw.versionName ?? ''),
        lang: isStringValue(source?.language) ? source.language : '',
        apk:
            String(resources.apkUrl ?? '')
                .split('/')
                .pop() ?? '',
        nsfw:
            raw.contentWarning === 'CONTENT_WARNING_NSFW' ||
            raw.contentWarning === 'CONTENT_WARNING_MIXED'
                ? 1
                : 0
    };
    if (isStringValue(resources.apkUrl)) entry.apkUrl = resources.apkUrl;
    if (isStringValue(resources.jarUrl)) entry.jarUrl = resources.jarUrl;
    if (isStringValue(resources.iconUrl)) entry.iconUrl = resources.iconUrl;
    if (raw.versionCode !== undefined) entry.code = Number(raw.versionCode);
    return entry;
}

// Overlay immutable release URLs onto a search entry when the manifest
// covers its package; upstream URLs are kept otherwise.
function applyManifestUrls(
    entry: SearchIndexEntry,
    manifest: ReleaseManifest | undefined,
    sourceKey: string
): void {
    if (!manifest) return;
    const apk = manifestAsset(manifest, sourceKey, entry.pkg, 'apk');
    if (apk) entry.apkUrl = apk.url;
    const jar = manifestAsset(manifest, sourceKey, entry.pkg, 'jar');
    if (jar) entry.jarUrl = jar.url;
}

export async function loadReleaseManifest(
    options: GenerateDataOptions
): Promise<ReleaseManifest | undefined> {
    if (options.manifest) return options.manifest;
    const file = options.manifestFile ?? process.env.RELEASE_MANIFEST_FILE;
    if (!file) return undefined;
    try {
        return parseReleaseManifest(JSON.parse(await readFile(file, 'utf8')));
    } catch {
        logger.warn(
            'data',
            `release manifest skip reason="unreadable" file=${JSON.stringify(file)}`
        );
        return undefined;
    }
}

async function generateSearchIndexJson(
    data: ExtensionsData,
    staticDir = STATIC_DIR,
    searchIndexFile = SEARCH_INDEX_FILE,
    manifest?: ReleaseManifest
): Promise<void> {
    logger.info('search', 'index generate start file="indexes.json"');

    const entries: SearchIndexEntry[] = [];
    let reposScanned = 0;

    for (const [category, repos] of Object.entries(data)) {
        for (const [key, repo] of Object.entries(repos)) {
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
                    let parsed: JsonObject | Extension;
                    if (isMihonIndex(category) || isMihonEntry(rawExtension)) {
                        if (!isJsonObject(rawExtension)) {
                            throw new Error(`Invalid Mihon entry at ${entryPath}`);
                        }
                        parsed = entryFromMihon(rawExtension);
                    } else {
                        parsed = parseExtension(rawExtension, entryPath);
                    }
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
                // Flat Aniyomi indexes carry no apkUrl; synthesize the pinned
                // upstream download URL so website buttons never point at the
                // removed hosted /apk/ paths. The manifest overlay replaces
                // these with immutable release URLs when it covers them.
                if (!extension.apkUrl && extension.apk && repo.commit) {
                    extension.apkUrl = flatUpstreamApkUrl(repo.source, repo.commit, extension.apk);
                }
                applyManifestUrls(extension, manifest, key);
                entries.push(extension);
            }
        }
    }

    await writeFile(searchIndexFile, JSON.stringify(entries));
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
    const manifest = await loadReleaseManifest(options);
    const { owner, repo } = config.github;
    const source = `https://github.com/${owner}/${repo}`;

    await writeFile(
        dataFile,
        JSON.stringify({
            extensions: toExtensionList(extensionsData),
            domains: config.domains,
            source,
            commitLink: `${source}/commit/${commit}`,
            latestCommitHash: commit.substring(0, 7)
        })
    );

    await generateSearchIndexJson(extensionsData, staticDir, searchIndexFile, manifest);
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
        const data = parseAppData(JSON.parse(await readFile(dataFile, 'utf8')));
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

                // Sentinel is the JSON wrapper for Mihon (index.pb maps to
                // the index.json beside it); Aniyomi follows the configured
                // path basename, since Secozzi serves index.json under an
                // Aniyomi category while others serve index.min.json.
                const sentinel =
                    isMihonIndex(category) || ext.path.endsWith('index.json')
                        ? 'index.json'
                        : (ext.path.split('/').pop() ?? 'index.min.json');
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

// Phase 5: the artifact cache is removed. Older runs may still have left
// APK/JAR files under static/ from before binaries left materialization.
// Remove those subdirs deliberately per configured source so stale
// binaries cannot leak into dist/.
export async function pruneBinaryDirs(
    data: ExtensionsData,
    staticDir = STATIC_DIR
): Promise<number> {
    let pruned = 0;
    for (const group of Object.values(data)) {
        for (const key of Object.keys(group)) {
            for (const subdir of ['apk', 'jar']) {
                const dir = join(staticDir, key, subdir);
                if (existsSync(dir)) {
                    await rm(dir, { recursive: true, force: true });
                    logger.info(
                        'extensions',
                        `prune binaries dir=${JSON.stringify(`${key}/${subdir}`)}`
                    );
                    pruned += 1;
                }
            }
        }
    }
    return pruned;
}

// Phase 3 gate: hosted output must contain no binary artifacts.
export async function findBinaryArtifacts(dir: string): Promise<string[]> {
    const found: string[] = [];
    const scan = async (current: string): Promise<void> => {
        if (!existsSync(current)) return;
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) await scan(full);
            else if (full.endsWith('.apk') || full.endsWith('.jar')) found.push(full);
        }
    };
    await scan(dir);
    return found;
}

// Phase 3 icon backfill: wrapper sources (Keiyoushi, Cursed, Secozzi)
// reference icons from their upstream repos via iconUrl, but the mirrored
// repo branches do not always ship the icon files (Keiyoushi ships ~2 of
// 1439). Download missing icons into the per-source icon/ dir so the
// mirror rewrite can point at them; failures keep the upstream URL.
// Flat-array sources (Anime) carry no iconUrl and are skipped by
// construction; their branch-shipped icons use the frontend fallback.
export const ICON_FETCH_CONCURRENCY = 8;
export const ICON_FETCH_TIMEOUT_MS = 30_000;
export const ICON_MAX_BYTES = 1024 * 1024;

export interface IconFetchResult {
    fetched: number;
    skipped: number;
    failed: number;
}

export async function fetchMissingIcons(
    data: ExtensionsData,
    staticDir = STATIC_DIR,
    fetcher: typeof fetch = fetch,
    onlyKeys?: string[]
): Promise<IconFetchResult> {
    const result: IconFetchResult = { fetched: 0, skipped: 0, failed: 0 };
    const scope = onlyKeys ? new Set(onlyKeys) : undefined;
    const tasks: Array<() => Promise<void>> = [];

    for (const [category, group] of Object.entries(data)) {
        for (const [key, repo] of Object.entries(group)) {
            if (scope && !scope.has(key)) continue;
            let entries: JsonValue[];
            try {
                entries = await loadRepoExtensions(category, repo.path, staticDir);
            } catch {
                continue;
            }
            for (const raw of entries) {
                if (!isMihonEntry(raw)) continue;
                const pkg = isStringValue(raw.packageName) ? raw.packageName : '';
                const resources = isJsonObject(raw.resources) ? raw.resources : undefined;
                const iconUrl =
                    resources && isStringValue(resources.iconUrl) ? resources.iconUrl : '';
                if (!pkg || !iconUrl || !/^https?:\/\//.test(iconUrl)) continue;
                if (pkg.includes('/') || pkg.includes('\\') || pkg.includes('..')) continue;
                const dest = join(staticDir, key, 'icon', `${pkg}.png`);
                if (existsSync(dest)) {
                    result.skipped += 1;
                    continue;
                }
                tasks.push(async () => {
                    try {
                        const controller = new AbortController();
                        const timer = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);
                        let response: Response;
                        try {
                            response = await fetcher(iconUrl, { signal: controller.signal });
                        } finally {
                            clearTimeout(timer);
                        }
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        if (!response.headers.get('content-type')?.startsWith('image/')) {
                            throw new Error('non-image content-type');
                        }
                        const bytes = new Uint8Array(await response.arrayBuffer());
                        if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) {
                            throw new Error(`unexpected size ${bytes.length}`);
                        }
                        await mkdir(join(staticDir, key, 'icon'), { recursive: true });
                        await writeFile(dest, bytes);
                        result.fetched += 1;
                    } catch (error) {
                        result.failed += 1;
                        logger.warn(
                            'extensions',
                            `icon fetch skip pkg=${JSON.stringify(pkg)} error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`
                        );
                    }
                });
            }
        }
    }

    for (let index = 0; index < tasks.length; index += ICON_FETCH_CONCURRENCY) {
        await Promise.all(tasks.slice(index, index + ICON_FETCH_CONCURRENCY).map((run) => run()));
    }

    logger.info(
        'extensions',
        `icons fetch complete fetched=${result.fetched} skipped=${result.skipped} failed=${result.failed}`
    );
    return result;
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

// Remove static dirs no longer configured in extensions.json, so removed
// sources stay removed from disk state. Keeps keys and their nesting prefixes.
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

export interface MaterializeOptions {
    // Latest complete release-assets.json snapshot. Covered index.json
    // apkUrls are rewritten to release URLs before the mirror index.pb is
    // regenerated; without one, upstream URLs are kept (no cutover).
    manifest?: ReleaseManifest;
}

// Phase 4: point covered index.json apkUrls at release URLs and regenerate
// the mirror-owned index.pb from the final index.json (Mihon sources only;
// Aniyomi-side stores use a different wire variant and keep their copy).
// Returns true when index.pb was regenerated.
export async function refreshMirrorIndexPb(
    category: string,
    key: string,
    staticDir = STATIC_DIR,
    manifest?: ReleaseManifest
): Promise<boolean> {
    if (!isMihonIndex(category)) return false;
    const indexFile = join(staticDir, key, 'index.json');
    if (!existsSync(indexFile)) return false;
    const wrapper: JsonObject = JSON.parse(await readFile(indexFile, 'utf8'));
    const list = isJsonObject(wrapper.extensionList) ? wrapper.extensionList : undefined;
    const rawExtensions = list && Array.isArray(list.extensions) ? list.extensions : [];
    let overlaid = 0;
    for (const raw of rawExtensions) {
        if (!isJsonObject(raw)) continue;
        const resources = isJsonObject(raw.resources) ? raw.resources : undefined;
        const packageName = isStringValue(raw.packageName) ? raw.packageName : '';
        if (!resources || !packageName || !manifest) continue;
        const asset = manifestAsset(manifest, key, packageName, 'apk');
        if (asset && resources.apkUrl !== asset.url) {
            resources.apkUrl = asset.url;
            overlaid += 1;
        }
    }
    if (overlaid > 0) await writeFile(indexFile, JSON.stringify(wrapper));
    await writeFile(join(staticDir, key, 'index.pb'), encodeIndexPb(wrapper));
    logger.info(
        'extensions',
        `mirror index.pb regenerate key=${JSON.stringify(key)} overlaid=${overlaid}`
    );
    return true;
}

export async function materializeExtensions(
    data: ExtensionsData,
    updates: ExtensionUpdate[],
    options: MaterializeOptions = {}
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

                // Fetch wrapper icons missing from the branch before the
                // mirror rewrite, so freshly copied indexes can point at
                // local icon files immediately.
                await fetchMissingIcons(data, STATIC_DIR, fetch, [key]);
                await rewriteMirroredIndexFiles(dest, key);
                await refreshMirrorIndexPb(category, key, STATIC_DIR, options.manifest);

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
