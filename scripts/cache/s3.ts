import type { S3Client } from '@aws-sdk/client-s3';
import { logger } from '../log';
import { deleteMetadata } from './metadata';
import { findCacheByKey, findCachesByPrefix, loadManifest, removeCacheEntry } from './manifest';
import { deleteObject, fileExists } from './client';
import { MAX_CACHE_AGE_DAYS, MAX_CACHE_FILES } from './utils';

export {
    deleteObject,
    ENABLED,
    fileExists,
    getClient,
    getObject,
    s3Config,
    uploadToS3
} from './client';

const cacheExists = async (s3: S3Client, key: string) => await fileExists(s3, key);

const cleanupStaleCache = async (s3: S3Client, key: string): Promise<void> => {
    logger.info('cache', `manifest cleanup stale_cache key=${JSON.stringify(key)}`);
    await deleteMetadata(s3, key);
    await removeCacheEntry(s3, key);
};

export async function resolveCacheKey(
    s3: S3Client,
    key: string,
    restoreKeys?: string[]
): Promise<string | null> {
    const manifest = await loadManifest(s3);

    // Try exact match first
    const exactMatch = findCacheByKey(manifest, key);
    if (exactMatch) {
        if (await cacheExists(s3, exactMatch.key)) {
            return exactMatch.key;
        }
        await cleanupStaleCache(s3, exactMatch.key);
    }

    // Try restore keys in order (prefix matching), preferring most recent
    if (restoreKeys && restoreKeys.length > 0) {
        for (const prefix of restoreKeys) {
            const candidates = findCachesByPrefix(manifest, prefix);
            for (const match of candidates) {
                if (await cacheExists(s3, match.key)) {
                    return match.key;
                }
                await cleanupStaleCache(s3, match.key);
            }
        }
    }

    return null;
}

export async function cleanupOldCaches(s3: S3Client, prefix: string): Promise<void> {
    const manifest = await loadManifest(s3);

    // Filter caches by prefix
    const filesWithMetadata = manifest.caches
        .filter((entry) => entry.key.startsWith(prefix))
        .map((entry) => ({
            key: entry.key,
            lastAccessed: entry.lastAccessed,
            timestamp: entry.timestamp
        }));

    // Sort by lastAccessed (most recently accessed first)
    const files = filesWithMetadata.sort((a, b) => b.lastAccessed - a.lastAccessed);

    const now = Date.now();
    const maxAge = MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000;
    let manifestUpdated = false;

    for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        const age = now - entry.lastAccessed;
        const shouldDelete = i >= MAX_CACHE_FILES || age > maxAge;

        if (shouldDelete) {
            logger.info(
                'cache',
                `cleanup delete key=${JSON.stringify(entry.key)} age_days=${Math.floor(age / (24 * 60 * 60 * 1000))} position=${i + 1}`
            );
            await deleteObject(s3, entry.key);
            await deleteMetadata(s3, entry.key);
            await removeCacheEntry(s3, entry.key);
            manifestUpdated = true;
        }
    }

    if (manifestUpdated) {
        logger.info('cache', 'manifest cleanup complete updated=true');
    }
}
