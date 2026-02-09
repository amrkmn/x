import type { S3Client } from '@aws-sdk/client-s3';
import { join } from 'node:path';
import { cleanupDir, compressToTar, ensureDir, extractTar, validateCache } from './cache/files';
import { withLock } from './cache/lock';
import { addCacheEntry } from './cache/manifest';
import { loadMetadata, saveMetadata, updateBothAccessTimes } from './cache/metadata';
import { cleanupOldCaches, ENABLED, fileExists, getClient, resolveCacheKey } from './cache/s3';
import { CACHE_FILE_NAME, downloadFileFromS3, TMP_DIR, uploadFileToS3 } from './cache/utils';

const CACHE_FILE_PATH = join(TMP_DIR, CACHE_FILE_NAME);

function formatBytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(2);
}

async function downloadCache(s3: S3Client, key: string, targetPath: string): Promise<number> {
    return downloadFileFromS3(s3, key, targetPath);
}

async function uploadCache(s3: S3Client, key: string, sourcePath: string): Promise<number> {
    return uploadFileToS3(s3, key, sourcePath);
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
        let lastExtractPhase = '';
        await extractTar(CACHE_FILE_PATH, '.', (phase, percent) => {
            if (phase !== lastExtractPhase) {
                if (lastExtractPhase) process.stdout.write('\n');
                lastExtractPhase = phase;
            }
            const phaseLabel = phase === 'decompress' ? 'Decompressing' : 'Extracting';
            process.stdout.write(`\r${phaseLabel}: ${percent}%`);
        });
        process.stdout.write('\n');
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
    if (!ENABLED) return;

    const s3 = getClient();
    if (!s3) return;

    // Use withLock for automatic lock management with renewal
    const result = await withLock(s3, async () => {
        // Check if cache already exists before compressing
        if (await fileExists(s3, key)) {
            console.log(`Cache already exists: ${key}, skipping upload`);
            return;
        }

        await ensureDir(TMP_DIR);

        // Compress and calculate checksums
        console.log('Compressing cache...');
        const compressStartTime = Date.now();
        let lastPhase = '';
        const files = await compressToTar(paths, CACHE_FILE_PATH, (phase, percent) => {
            if (phase !== lastPhase) {
                if (lastPhase) process.stdout.write('\n');
                lastPhase = phase;
            }
            const phaseLabel =
                phase === 'read'
                    ? 'Reading files'
                    : phase === 'archive'
                      ? 'Creating archive'
                      : 'Compressing';
            process.stdout.write(`\r${phaseLabel}: ${percent}%`);
        });
        process.stdout.write('\n');
        const compressTime = Date.now() - compressStartTime;
        console.log(`Cache compressed in ${(compressTime / 1000).toFixed(2)}s`);

        const cache = Bun.file(CACHE_FILE_PATH);
        const sizeInBytes = cache.size;
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

        return;
    });

    if (result === null) {
        console.error('Failed to acquire lock for cache save');
    }
}
