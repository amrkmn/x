#!/usr/bin/env bun

import { resolve } from 'path';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { SyncLogger } from './logger.js';
import { restoreCache } from './cache.js';
import { CACHE_PATHS, CACHE_RESTORE_KEYS, generateCacheKey } from './cache/utils.js';

const STATIC_DIR = 'static';
const DUFS_URL = process.env.SYNC_DUFS_URL;
const DUFS_AUTH = process.env.SYNC_DUFS_AUTH;
const CONCURRENCY = Math.min(parseInt(process.env.SYNC_CONCURRENCY || '3'), 10);

const USE_CACHE = Bun.argv.includes('--use-cache');

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

        const base64Auth = Buffer.from(DUFS_AUTH).toString('base64');
        const extDir = resolve(STATIC_DIR);

        // 1. Build expected files list
        const expected = await buildFileList(extDir);
        logger.info(`Expected ${expected.size} files`);

        // 2. List remote files and directories
        const remote = await listRemoteFiles(DUFS_URL, base64Auth);
        logger.info(
            `Remote has ${remote.files.size} files, ${remote.directories.size} directories`
        );

        // 3. Upload new files - parallel
        const toUpload = [...expected].filter((path) => !remote.files.has(path));

        if (toUpload.length > 0) {
            logger.info(`Uploading ${toUpload.length} new files...`);

            const uploadQueue = [...toUpload];
            let uploaded = 0;
            while (uploadQueue.length > 0) {
                const batch = uploadQueue.splice(0, CONCURRENCY);
                await Promise.all(
                    batch.map(async (path) => {
                        await uploadFile(DUFS_URL, base64Auth, path, extDir);
                        uploaded++;
                    })
                );
                logger.progress(uploaded, toUpload.length, 'Uploading');
            }
            logger.complete(`Uploaded ${uploaded} files`);
        }

        // 4. Delete dangling files - parallel
        const toDelete = [...remote.files].filter((path) => !expected.has(path));
        if (toDelete.length > 0) {
            logger.info(`Deleting ${toDelete.length} dangling files...`);

            const deleteQueue = [...toDelete];
            let deleted = 0;
            while (deleteQueue.length > 0) {
                const batch = deleteQueue.splice(0, CONCURRENCY);
                await Promise.all(
                    batch.map(async (path) => {
                        await deleteFile(DUFS_URL, base64Auth, path);
                        deleted++;
                    })
                );
                logger.progress(deleted, toDelete.length, 'Deleting');
            }
            logger.complete(`Deleted ${deleted} dangling files`);
        }

        // 4b. Delete empty dangling directories (deepest to shallowest)
        const toDeleteDirs = [...remote.directories].filter((dir) => {
            if (expected.has(dir)) return false;
            const dirSlash = dir + '/';
            return ![...expected].some((f) => f.startsWith(dirSlash));
        });
        toDeleteDirs.sort((a, b) => b.split('/').length - a.split('/').length);

        if (toDeleteDirs.length > 0) {
            logger.info(`Deleting ${toDeleteDirs.length} empty directories...`);

            for (const dir of toDeleteDirs) {
                await deleteFile(DUFS_URL, base64Auth, dir);
            }
            logger.complete(`Deleted ${toDeleteDirs.length} empty directories`);
        }

        // 5. Upload data.json if exists
        const dataJsonPath = resolve(extDir, 'data.json');
        if (existsSync(dataJsonPath)) {
            await uploadFile(DUFS_URL, base64Auth, 'data.json', extDir);
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
    dufsUrl: string,
    auth: string
): Promise<{ files: Set<string>; directories: Set<string> }> {
    const files = new Set<string>();
    const directories = new Set<string>();
    const dirsToScan: string[] = [''];

    try {
        const baseUrl = dufsUrl.replace(/\/$/, '');

        while (dirsToScan.length > 0) {
            const dir = dirsToScan.shift()!;
            const listUrl = dir === '' ? `${baseUrl}/?json` : `${baseUrl}/${dir}?json`;

            let res = await fetch(listUrl, {
                headers: { Authorization: `Basic ${auth}` }
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
    const cleanUrl = baseUrl.replace(/\/$/, '');
    return `${cleanUrl}/${path}`;
}

async function uploadFile(
    dufsUrl: string,
    auth: string,
    path: string,
    baseDir: string
): Promise<void> {
    const filePath = resolve(baseDir, path);
    const content = await readFile(filePath);

    const res = await fetch(getUploadUrl(dufsUrl, path), {
        method: 'PUT',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/octet-stream'
        },
        body: content
    });

    if (!res.ok) {
        throw new Error(`Failed to upload ${path}: ${res.status} ${res.statusText}`);
    }
}

async function deleteFile(dufsUrl: string, auth: string, path: string): Promise<void> {
    const res = await fetch(getUploadUrl(dufsUrl, path), {
        method: 'DELETE',
        headers: { Authorization: `Basic ${auth}` }
    });

    if (!res.ok) {
        throw new Error(`Failed to delete ${path}: ${res.status} ${res.statusText}`);
    }
}

main();
