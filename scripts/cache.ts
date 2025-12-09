import { join } from 'path';
import { CACHE_FILE_NAME, TMP_DIR } from './cache/constants';
import { cleanupDir, compressToZip, ensureDir, extractZip, validateCache } from './cache/files';
import { acquireLock, generateInstanceId, releaseLock } from './cache/lock';
import { loadMetadata, saveMetadata, updateAccessTime } from './cache/metadata';
import { cleanupOldCaches, ENABLED, findMatchingCache, getClient } from './cache/s3';

const CACHE_FILE_PATH = join(TMP_DIR, CACHE_FILE_NAME);

let cacheIdCounter = Date.now();

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
        const matchedKey = await findMatchingCache(s3, key, restoreKeys);
        if (!matchedKey) {
            console.log('No cache found');
            return undefined;
        }

        // Check if local cache is still valid
        const metadata = await loadMetadata(s3, matchedKey);
        if (metadata && (await validateCache(metadata))) {
            console.log('Local cache valid');
            await updateAccessTime(s3, matchedKey, metadata);
            return matchedKey;
        }

        await ensureDir(TMP_DIR);

        // Ensure all target paths exist
        for (const path of paths) {
            await ensureDir(path);
        }

        console.log(`Downloading cache...`);
        const s3File = s3.file(matchedKey);
        const arrayBuffer = await s3File.arrayBuffer();
        await Bun.write(CACHE_FILE_PATH, new Uint8Array(arrayBuffer));

        await extractZip(CACHE_FILE_PATH);
        await cleanupDir(TMP_DIR);

        // Update access time after successful restore
        const newMetadata = await loadMetadata(s3, matchedKey);
        if (newMetadata) {
            await updateAccessTime(s3, matchedKey, newMetadata);
        }

        console.log('Cache restored');
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

        console.log(`Saving cache: ${key}`);

        await ensureDir(TMP_DIR);

        // Compress and calculate checksums
        const files = await compressToZip(paths, CACHE_FILE_PATH);

        await Bun.write(s3.file(key), Bun.file(CACHE_FILE_PATH));
        await saveMetadata(s3, key, files);
        await cleanupDir(TMP_DIR);

        console.log('Cache saved');

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
