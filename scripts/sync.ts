#!/usr/bin/env bun

import { $ } from 'bun';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { relative, resolve } from 'path';
import { restoreCache } from './cache.js';
import { loadMetadata } from './cache/metadata.js';
import { getClient } from './cache/s3.js';
import { CACHE_PATHS, CACHE_RESTORE_KEYS, generateCacheKey } from './cache/utils.js';
import { SyncLogger } from './logger.js';

const STATIC_DIR = 'static';
const DUFS_URL = process.env.SYNC_DUFS_URL;
const DUFS_AUTH = process.env.SYNC_DUFS_AUTH;
const CONCURRENCY = Math.min(parseInt(process.env.SYNC_CONCURRENCY || '20'), 50);

const USE_CACHE = process.argv.includes('--use-cache');
type AuthHeaders = { Authorization: string };
type RemoteFileMeta = { size: number };
type FileMetadata = { checksum: string; size: number };
type LocalCacheMetadata = { key: string; files: Record<string, FileMetadata> } | null;

async function main() {
    if (!DUFS_URL || !DUFS_AUTH) {
        new SyncLogger('Sync').error('SYNC_DUFS_URL and SYNC_DUFS_AUTH are required');
        process.exit(1);
    }

    const logger = new SyncLogger('Sync');

    let localCacheMeta: LocalCacheMetadata = null;
    if (USE_CACHE) {
        logger.info('Restoring from cache...');
        const key = await generateCacheKey();
        const restoredKey = await restoreCache(CACHE_PATHS, key, CACHE_RESTORE_KEYS);
        if (restoredKey) {
            logger.info(`Cache restored: ${restoredKey}`);
            const s3 = getClient();
            if (s3) {
                try {
                    localCacheMeta = await loadMetadata(s3, restoredKey);
                } catch (e) {
                    logger.error(`Failed to load cache metadata: ${e}`);
                }
            }
        } else {
            logger.info('No cache found, continuing without cache');
        }
    }

    // Update outdated extensions if flag is set
    if (process.argv.includes('--update-if-needed')) {
        logger.info('Updating outdated extensions...');
        await $`bun run update --sync`;
    }

    try {
        const baseUrl = DUFS_URL.replace(/\/$/, '');
        const authHeaders: AuthHeaders = {
            Authorization: `Basic ${Buffer.from(DUFS_AUTH).toString('base64')}`
        };
        const extDir = resolve(STATIC_DIR);

        // 1. Build expected files list
        const expected = await buildFileList(extDir);
        logger.info(`Expected ${expected.size} files`);

        // 2. List remote files and directories
        const remote = await listRemoteFiles(baseUrl, authHeaders);
        logger.info(
            `Remote has ${remote.files.size} files, ${remote.directories.size} directories`
        );

        // 3. Upload new files - parallel
        const toUpload: string[] = [];
        for (const path of expected) {
            if (!remote.files.has(path)) {
                toUpload.push(path);
                continue;
            }

            const remoteMeta = remote.meta.get(path);
            const localCacheMetaFile = localCacheMeta?.files[path];

            if (localCacheMetaFile && remoteMeta) {
                const localChecksum = await calculateFileChecksum(resolve(extDir, path));
                if (localChecksum === localCacheMetaFile.checksum) continue;
            } else if (remoteMeta) {
                const localStat = await Bun.file(resolve(extDir, path)).stat();
                if (localStat.size === remoteMeta.size) continue;
            }

            toUpload.push(path);
        }

        if (toUpload.length > 0) {
            logger.info(`Uploading ${toUpload.length} new files...`);

            const uploaded = await processWithPool(
                toUpload,
                CONCURRENCY,
                (path) => uploadFile(baseUrl, authHeaders, path, extDir),
                (done, total) => logger.progress(done, total, 'Uploading')
            );
            logger.complete(`Uploaded ${uploaded} files`);
        }

        // 4. Delete dangling files - parallel
        const toDelete: string[] = [];
        for (const path of remote.files) {
            if (!expected.has(path)) {
                toDelete.push(path);
            }
        }
        if (toDelete.length > 0) {
            logger.info(`Deleting ${toDelete.length} dangling files...`);

            const deleted = await processWithPool(
                toDelete,
                CONCURRENCY,
                (path) => deleteFile(baseUrl, authHeaders, path),
                (done, total) => logger.progress(done, total, 'Deleting')
            );
            logger.complete(`Deleted ${deleted} dangling files`);
        }

        // 4b. Delete empty dangling directories (deepest to shallowest)
        const expectedDirPrefixes = buildExpectedDirPrefixes(expected);
        const toDeleteDirs: string[] = [];
        for (const dir of remote.directories) {
            if (!expected.has(dir) && !expectedDirPrefixes.has(dir)) {
                toDeleteDirs.push(dir);
            }
        }
        toDeleteDirs.sort((a, b) => b.split('/').length - a.split('/').length);

        if (toDeleteDirs.length > 0) {
            logger.info(`Deleting ${toDeleteDirs.length} empty directories...`);

            for (const dir of toDeleteDirs) {
                await deleteFile(baseUrl, authHeaders, dir);
            }
            logger.complete(`Deleted ${toDeleteDirs.length} empty directories`);
        }

        // 5. Upload data.json if exists
        const dataJsonPath = resolve(extDir, 'data.json');
        if (existsSync(dataJsonPath) && !toUpload.includes('data.json')) {
            await uploadFile(baseUrl, authHeaders, 'data.json', extDir);
        }
        logger.complete('Done!');
    } catch (e) {
        logger.error(e instanceof Error ? e.message : 'Unknown error');
        process.exit(1);
    }
}

async function buildFileList(baseDir: string): Promise<Set<string>> {
    const files = new Set<string>();

    async function scan(dir: string) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                await scan(fullPath);
            } else {
                const relativePath = relative(baseDir, fullPath).replace(/\\/g, '/');
                files.add(relativePath);
            }
        }
    }

    await scan(baseDir);
    return files;
}

async function listRemoteFiles(
    baseUrl: string,
    authHeaders: AuthHeaders
): Promise<{ files: Set<string>; directories: Set<string>; meta: Map<string, RemoteFileMeta> }> {
    const files = new Set<string>();
    const directories = new Set<string>();
    const meta = new Map<string, RemoteFileMeta>();

    async function scanDir(dir: string): Promise<void> {
        const listUrl = dir === '' ? `${baseUrl}/?json` : `${baseUrl}/${dir}?json`;

        let res = await fetch(listUrl, { headers: authHeaders });
        if (!res.ok) res = await fetch(listUrl);
        if (!res.ok) return;

        const data = (await res.json()) as {
            paths?: Array<{ path_type: string; name: string; size?: number }>;
        };

        const subDirs: string[] = [];
        for (const item of data.paths ?? []) {
            const fullPath = dir === '' ? item.name : `${dir}/${item.name}`;
            if (item.path_type === 'File') {
                files.add(fullPath);
                meta.set(fullPath, {
                    size: item.size ?? -1
                });
            } else if (item.path_type === 'Dir') {
                directories.add(fullPath);
                subDirs.push(fullPath);
            }
        }

        await Promise.all(subDirs.map(scanDir));
    }

    try {
        await scanDir('');
    } catch (e) {
        console.error('Failed to list remote files:', e);
    }

    return { files, directories, meta };
}

function getUploadUrl(baseUrl: string, path: string): string {
    return `${baseUrl}/${path}`;
}

async function calculateFileChecksum(filePath: string): Promise<string> {
    const data = await Bun.file(filePath).arrayBuffer();
    return Bun.hash(data).toString(16);
}

function buildExpectedDirPrefixes(expected: Set<string>): Set<string> {
    const directories = new Set<string>();
    for (const filePath of expected) {
        let index = filePath.indexOf('/');
        while (index !== -1) {
            directories.add(filePath.slice(0, index));
            index = filePath.indexOf('/', index + 1);
        }
    }
    return directories;
}

async function processWithPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
    onProgress: (done: number, total: number) => void
): Promise<number> {
    let index = 0;
    let completed = 0;

    async function runWorker() {
        while (index < items.length) {
            const item = items[index++]!;
            await worker(item);
            onProgress(++completed, items.length);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, runWorker));
    return completed;
}

async function uploadFile(
    baseUrl: string,
    authHeaders: AuthHeaders,
    path: string,
    baseDir: string
): Promise<void> {
    const filePath = resolve(baseDir, path);
    const content = Bun.file(filePath);

    const res = await fetch(getUploadUrl(baseUrl, path), {
        method: 'PUT',
        headers: {
            ...authHeaders,
            'Content-Type': 'application/octet-stream'
        },
        body: content
    });

    if (!res.ok) {
        throw new Error(`Failed to upload ${path}: ${res.status} ${res.statusText}`);
    }
}

async function deleteFile(baseUrl: string, authHeaders: AuthHeaders, path: string): Promise<void> {
    const res = await fetch(getUploadUrl(baseUrl, path), {
        method: 'DELETE',
        headers: authHeaders
    });

    if (!res.ok) {
        throw new Error(`Failed to delete ${path}: ${res.status} ${res.statusText}`);
    }
}

main();
