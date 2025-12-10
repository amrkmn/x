import type { S3Client } from 'bun';
import { join } from 'path';
import { CACHE_FILE_NAME, TMP_DIR } from './cache/constants';
import { cleanupDir, compressToZip, ensureDir, extractZip, validateCache } from './cache/files';
import { acquireLock, generateInstanceId, releaseLock } from './cache/lock';
import { addCacheEntry, updateCacheAccess } from './cache/manifest';
import { loadMetadata, saveMetadata, updateAccessTime } from './cache/metadata';
import { cleanupOldCaches, ENABLED, getClient, resolveCacheKey } from './cache/s3';
import { log } from './cache/logger';

const CACHE_FILE_PATH = join(TMP_DIR, CACHE_FILE_NAME);

let cacheIdCounter = Date.now();

async function downloadCache(s3: S3Client, key: string, targetPath: string): Promise<number> {
    const s3File = s3.file(key);
    const stream = s3File.stream();
    const writer = Bun.file(targetPath).writer();

    const transfer = log.transfer('Received');
    let downloadedBytes = 0;

    for await (const chunk of stream) {
        writer.write(chunk);
        downloadedBytes += chunk.length;
        transfer.progress(downloadedBytes);
    }
    await writer.end();

    transfer.complete(downloadedBytes);

    return downloadedBytes;
}

async function uploadCache(s3: S3Client, key: string, sourcePath: string): Promise<number> {
    const cacheFile = Bun.file(sourcePath);
    const stream = cacheFile.stream();

    const transfer = log.transfer('Uploaded');
    let uploadedBytes = 0;
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
        uploadedBytes += chunk.length;
        transfer.progress(uploadedBytes);
    }

    transfer.complete(uploadedBytes);

    // Combine chunks and upload
    const totalSize = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    const s3FileWriter = s3.file(key);
    await Bun.write(s3FileWriter, combined);

    return uploadedBytes;
}

export async function restoreCache(
    paths: string[],
    key: string,
    restoreKeys?: string[]
): Promise<string | undefined> {
    if (!ENABLED) {
        console.log('R2 Cache disabled');
        return undefined;
    }

    const s3 = getClient();
    if (!s3) return undefined;

    try {
        // Find matching cache (exact or prefix match)
        const matchedKey = await resolveCacheKey(s3, key, restoreKeys);
        if (!matchedKey) {
            console.log('Cache not found');
            return undefined;
        }

        // Check if local cache is still valid
        const metadata = await loadMetadata(s3, matchedKey);
        if (metadata && (await validateCache(metadata))) {
            await updateAccessTime(s3, matchedKey, metadata);
            await updateCacheAccess(s3, matchedKey);
            return matchedKey;
        }

        await ensureDir(TMP_DIR);

        // Ensure all target paths exist
        for (const path of paths) {
            await ensureDir(path);
        }

        console.log(`Downloading cache from key: ${matchedKey}`);
        const startTime = Date.now();

        const downloadedBytes = await downloadCache(s3, matchedKey, CACHE_FILE_PATH);

        const downloadTime = Date.now() - startTime;
        const sizeInMB = (downloadedBytes / (1024 * 1024)).toFixed(2);

        console.log(`Cache Size: ~${sizeInMB} MB (${downloadedBytes} B)`);
        console.log(`Cache downloaded in ${(downloadTime / 1000).toFixed(2)}s`);

        await extractZip(CACHE_FILE_PATH);
        await cleanupDir(TMP_DIR);

        // Update access time after successful restore
        const newMetadata = await loadMetadata(s3, matchedKey);
        if (newMetadata) {
            await updateAccessTime(s3, matchedKey, newMetadata);
        }
        await updateCacheAccess(s3, matchedKey);

        console.log(`Cache restored successfully`);
        return matchedKey;
    } catch (e) {
        console.error('Failed to restore cache:', e);
        return undefined;
    }
}

export async function saveCache(paths: string[], key: string): Promise<number | undefined> {
    if (!ENABLED) return undefined;

    const s3 = getClient();
    if (!s3) return undefined;

    const instanceId = generateInstanceId();

    try {
        // Acquire lock
        if (!(await acquireLock(s3, instanceId))) {
            console.error('Failed to acquire lock');
            return undefined;
        }

        await ensureDir(TMP_DIR);

        // Compress and calculate checksums
        const files = await compressToZip(paths, CACHE_FILE_PATH);

        const cacheFile = Bun.file(CACHE_FILE_PATH);
        const sizeInBytes = cacheFile.size;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

        console.log(`Cache Size: ~${sizeInMB} MB (${sizeInBytes} B)`);
        console.log(`Uploading cache to key: ${key}`);

        const startTime = Date.now();

        await uploadCache(s3, key, CACHE_FILE_PATH);

        const uploadTime = Date.now() - startTime;
        console.log(`Cache uploaded in ${(uploadTime / 1000).toFixed(2)}s`);

        const timestamp = Date.now();

        // Save metadata
        await saveMetadata(s3, key, files, CACHE_FILE_PATH);
        await cleanupDir(TMP_DIR);

        // Add entry to manifest
        const metadata = await loadMetadata(s3, key);
        if (metadata) {
            await addCacheEntry(s3, key, metadata.hash, timestamp);
        }

        console.log(`Cache saved successfully`);

        // Extract prefix for cleanup (e.g., "extensions-abc.zip" -> "extensions-")
        const prefix = key.split('-')[0] + '-';
        await cleanupOldCaches(s3, prefix);

        return ++cacheIdCounter;
    } catch (e) {
        console.error('Failed to save cache:', e);
        return undefined;
    } finally {
        // Always release lock
        await releaseLock(s3, instanceId);
    }
}
