import type { S3Client } from 'bun';
import { join } from 'path';
import { cleanupDir, compressToTar, ensureDir, extractTar, validateCache } from './cache/files';
import { acquireLock, generateInstanceId, releaseLock } from './cache/lock';
import { log } from './cache/logger';
import { addCacheEntry } from './cache/manifest';
import { loadMetadata, saveMetadata, updateBothAccessTimes } from './cache/metadata';
import { cleanupOldCaches, ENABLED, getClient, resolveCacheKey } from './cache/s3';
import { CACHE_FILE_NAME, TMP_DIR } from './cache/utils';

const CACHE_FILE_PATH = join(TMP_DIR, CACHE_FILE_NAME);

function formatBytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(2);
}

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

    const s3File = s3.file(key);
    const writer = s3File.writer({
        partSize: 10 * 1024 * 1024, // 10 MB
        queueSize: 4,
        retry: 3
    });

    const timer = log.timer('Uploading cache');
    let uploadedBytes = 0;

    // Start a timer to log progress every second
    const progressInterval = setInterval(() => {
        timer.progress();
    }, 1000);

    try {
        for await (const chunk of stream) {
            writer.write(chunk);
            uploadedBytes += chunk.length;
        }

        await writer.end();
        return uploadedBytes;
    } finally {
        clearInterval(progressInterval);
        timer.complete();
    }
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
            await updateBothAccessTimes(s3, matchedKey, metadata);
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
        const sizeInMB = formatBytes(downloadedBytes);

        console.log(`Cache Size: ~${sizeInMB} MB (${downloadedBytes} B)`);
        console.log(`Cache downloaded in ${(downloadTime / 1000).toFixed(2)}s`);

        console.log('Extracting cache...');
        const extractStartTime = Date.now();
        await extractTar(CACHE_FILE_PATH);
        const extractTime = Date.now() - extractStartTime;
        console.log(`Cache extracted in ${(extractTime / 1000).toFixed(2)}s`);

        await cleanupDir(TMP_DIR);

        // Update access time after successful restore
        const newMetadata = await loadMetadata(s3, matchedKey);
        if (newMetadata) {
            await updateBothAccessTimes(s3, matchedKey, newMetadata);
        }

        console.log(`Cache restored successfully`);
        return matchedKey;
    } catch (e) {
        console.error('Failed to restore cache:', e);
        return undefined;
    }
}

export async function saveCache(paths: string[], key: string): Promise<void> {
    if (!ENABLED) return undefined;

    const s3 = getClient();
    if (!s3) return undefined;

    const instanceId = generateInstanceId();

    try {
        // Acquire lock
        if (!(await acquireLock(s3, instanceId))) {
            console.error('Failed to acquire lock');
            return;
        }

        await ensureDir(TMP_DIR);

        // Compress and calculate checksums
        console.log('Compressing cache...');
        const compressStartTime = Date.now();
        const files = await compressToTar(paths, CACHE_FILE_PATH);
        const compressTime = Date.now() - compressStartTime;
        console.log(`Cache compressed in ${(compressTime / 1000).toFixed(2)}s`);

        const cacheFile = Bun.file(CACHE_FILE_PATH);
        const sizeInBytes = cacheFile.size;
        const sizeInMB = formatBytes(sizeInBytes);

        console.log(`Cache Size: ~${sizeInMB} MB (${sizeInBytes} B)`);
        console.log(`Uploading cache to key: ${key}`);

        const startTime = Date.now();

        await uploadCache(s3, key, CACHE_FILE_PATH);

        const uploadTime = Date.now() - startTime;
        const uploadSpeed = sizeInBytes / (1024 * 1024) / (uploadTime / 1000);
        console.log(
            `Cache uploaded in ${(uploadTime / 1000).toFixed(2)}s (${uploadSpeed.toFixed(2)} MB/s)`
        );

        const timestamp = Date.now();

        // Save metadata and get hash
        const hash = await saveMetadata(s3, key, files, CACHE_FILE_PATH);
        await cleanupDir(TMP_DIR);

        // Add entry to manifest
        await addCacheEntry(s3, key, hash, timestamp);

        console.log(`Cache saved successfully`);

        // Extract prefix for cleanup (e.g., "extensions-abc.tgz" -> "extensions-")
        const prefix = key.split('-')[0] + '-';
        await cleanupOldCaches(s3, prefix);
    } catch (e) {
        console.error('Failed to save cache:', e);
    } finally {
        // Always release lock
        await releaseLock(s3, instanceId);
    }
}
