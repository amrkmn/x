import type { S3Client } from './cache/client';
import { join } from 'node:path';
import {
    checksumFiles,
    cleanupDir,
    compressToTar,
    ensureDir,
    extractTar,
    validateCache
} from './cache/files';
import { withLock } from './cache/lock';
import { addCacheEntry } from './cache/manifest';
import { loadMetadata, saveMetadata, updateBothAccessTimes } from './cache/metadata';
import { cleanupOldCaches, ENABLED, fileExists, getClient, resolveCacheKey } from './cache/s3';
import { CACHE_FILE_NAME, downloadFileFromS3, TMP_DIR, uploadFileToS3 } from './cache/utils';
import { logger } from './log';

const CACHE_FILE_PATH = join(TMP_DIR, CACHE_FILE_NAME);

function formatBytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(2);
}

async function downloadCache(s3: S3Client, key: string, targetPath: string): Promise<number> {
    return downloadFileFromS3(s3, key, targetPath);
}

async function uploadCache(key: string, sourcePath: string): Promise<number> {
    return uploadFileToS3(key, sourcePath);
}

export async function restoreCache(
    paths: string[],
    key: string,
    restoreKeys?: string[]
): Promise<string | undefined> {
    if (!ENABLED) {
        logger.info('cache', 'cache disabled backend="r2"');
        return undefined;
    }

    const s3 = getClient();
    if (!s3) return undefined;

    try {
        // Find matching cache (exact or prefix match)
        const matchedKey = await resolveCacheKey(s3, key, restoreKeys);
        if (!matchedKey) {
            logger.info('cache', `restore miss key=${JSON.stringify(key)}`);
            return undefined;
        }

        // Check if local cache is still valid
        const metadata = await loadMetadata(s3, matchedKey);
        if (metadata && (await validateCache(metadata))) {
            await updateBothAccessTimes(s3, matchedKey, metadata);
            logger.info(
                'cache',
                `restore hit_local requested_key=${JSON.stringify(key)} restored_key=${JSON.stringify(matchedKey)}`
            );
            return matchedKey;
        }

        await ensureDir(TMP_DIR);

        // Ensure all target paths exist
        for (const path of paths) {
            await ensureDir(path);
        }

        logger.info('cache', `restore download start key=${JSON.stringify(matchedKey)}`);
        const startTime = Date.now();

        const downloadedBytes = await downloadCache(s3, matchedKey, CACHE_FILE_PATH);

        const downloadTime = Date.now() - startTime;
        const sizeInMB = formatBytes(downloadedBytes);

        logger.info('cache', `restore download size_mib=${sizeInMB} bytes=${downloadedBytes}`);
        logger.info(
            'cache',
            `restore download complete seconds=${(downloadTime / 1000).toFixed(2)}`
        );

        logger.info('cache', 'restore extract start');
        const extractStartTime = Date.now();
        await extractTar(CACHE_FILE_PATH, '.');
        const extractTime = Date.now() - extractStartTime;

        // Recompute checksums from extracted files and update S3 metadata so
        // the next run can validate locally without re-downloading.
        // Must happen before cleanupDir so the archive is still present for hashing.
        // Preserve the original timestamp so age-based eviction is not affected.
        logger.info('cache', 'restore metadata update start');
        const files = await checksumFiles(paths);
        await saveMetadata(matchedKey, files, CACHE_FILE_PATH, metadata?.timestamp);

        await cleanupDir(TMP_DIR);

        const refreshedMetadata = await loadMetadata(s3, matchedKey);
        if (refreshedMetadata) {
            await updateBothAccessTimes(s3, matchedKey, refreshedMetadata);
        }

        logger.info('cache', 'restore complete status="success"');
        logger.info(
            'cache',
            `restore hit_remote requested_key=${JSON.stringify(key)} restored_key=${JSON.stringify(matchedKey)} bytes=${downloadedBytes} download_ms=${downloadTime} extract_ms=${extractTime}`
        );
        return matchedKey;
    } catch (e) {
        logger.error('cache', `restore failed key=${JSON.stringify(key)}`, e);
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
            logger.info('cache', `save skipped reason="already_exists" key=${JSON.stringify(key)}`);
            return;
        }

        await ensureDir(TMP_DIR);

        // Compress and calculate checksums
        logger.info('cache', 'save compress start');
        const compressStartTime = Date.now();
        const files = await compressToTar(paths, CACHE_FILE_PATH);
        const compressTime = Date.now() - compressStartTime;
        logger.info('cache', `save compress complete seconds=${(compressTime / 1000).toFixed(2)}`);

        const cache = Bun.file(CACHE_FILE_PATH);
        const sizeInBytes = cache.size;
        const sizeInMB = formatBytes(sizeInBytes);

        logger.info('cache', `save archive size_mib=${sizeInMB} bytes=${sizeInBytes}`);
        logger.info('cache', `save upload start key=${JSON.stringify(key)}`);

        const startTime = Date.now();

        await uploadCache(key, CACHE_FILE_PATH);

        const uploadTime = Date.now() - startTime;
        const uploadSpeed = sizeInBytes / (1024 * 1024) / (uploadTime / 1000);
        logger.info(
            'cache',
            `save upload complete seconds=${(uploadTime / 1000).toFixed(2)} speed_mib_per_s=${uploadSpeed.toFixed(2)}`
        );

        const timestamp = Date.now();

        // Save metadata and get hash
        const hash = await saveMetadata(key, files, CACHE_FILE_PATH);
        await cleanupDir(TMP_DIR);

        // Add entry to manifest
        await addCacheEntry(s3, key, hash, timestamp);

        logger.info('cache', 'save complete status="success"');
        logger.info(
            'cache',
            `save summary status="saved" key=${JSON.stringify(key)} bytes=${sizeInBytes} compress_ms=${compressTime} upload_ms=${uploadTime}`
        );

        // Extract prefix for cleanup (e.g., "extensions-abc.tgz" -> "extensions-")
        const prefix = key.split('-')[0] + '-';
        await cleanupOldCaches(s3, prefix);

        return;
    });

    if (result === null) {
        logger.error('cache', `save failed reason="lock_acquire" key=${JSON.stringify(key)}`);
    }
}
