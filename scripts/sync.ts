#!/usr/bin/env bun

import { resolve } from 'path';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { SyncLogger } from './logger.js';
import { restoreCache } from './cache.js';
import { CACHE_PATHS, CACHE_RESTORE_KEYS, generateCacheKey } from './cache/utils.js';

const STATIC_DIR = 'static';
const DUFS_URL = process.env.SYNC_DUFS_URL;
const DUFS_AUTH = process.env.SYNC_DUFS_AUTH;
const CONCURRENCY = Math.min(parseInt(process.env.SYNC_CONCURRENCY || '3'), 10);

const USE_CACHE = Bun.argv.includes('--use-cache');
type AuthHeaders = { Authorization: string };

async function main() {
    if (!DUFS_URL || !DUFS_AUTH) {
        new SyncLogger('Sync').error('SYNC_DUFS_URL and SYNC_DUFS_AUTH are required');
        process.exit(1);
    }

    const logger = new SyncLogger('Sync');

    try {
        if (USE_CACHE) {
            logger.info('Restoring from cache...');
            const key = await generateCacheKey();
            const restoredKey = await restoreCache(CACHE_PATHS, key, CACHE_RESTORE_KEYS);
            if (restoredKey) {
                logger.info(`Cache restored: ${restoredKey}`);
            } else {
                logger.info('No cache found, continuing without cache');
            }
        }

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
            }
        }

        if (toUpload.length > 0) {
            logger.info(`Uploading ${toUpload.length} new files...`);

            const uploaded = await processInBatches(
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

            const deleted = await processInBatches(
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
                const relativePath = fullPath.replace(baseDir + '/', '');
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
): Promise<{ files: Set<string>; directories: Set<string> }> {
    const files = new Set<string>();
    const directories = new Set<string>();
    const dirsToScan: string[] = [''];

    try {
        for (let i = 0; i < dirsToScan.length; i++) {
            const dir = dirsToScan[i]!;
            const listUrl = dir === '' ? `${baseUrl}/?json` : `${baseUrl}/${dir}?json`;

            let res = await fetch(listUrl, {
                headers: authHeaders
            });

            if (!res.ok) {
                res = await fetch(listUrl);
            }

            if (!res.ok) continue;

            const data = (await res.json()) as {
                paths?: Array<{ path_type: string; name: string }>;
            };

            if (data.paths) {
                for (const item of data.paths) {
                    const fullPath = dir === '' ? item.name : `${dir}/${item.name}`;
                    if (item.path_type === 'File') {
                        files.add(fullPath);
                    } else if (item.path_type === 'Dir') {
                        directories.add(fullPath);
                        dirsToScan.push(fullPath);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Failed to list remote files:', e);
    }

    return { files, directories };
}

function getUploadUrl(baseUrl: string, path: string): string {
    return `${baseUrl}/${path}`;
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

async function processInBatches<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
    onBatchComplete: (done: number, total: number) => void
): Promise<number> {
    let completed = 0;
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        await Promise.all(
            batch.map(async (item) => {
                await worker(item);
                completed++;
            })
        );
        onBatchComplete(completed, items.length);
    }
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
