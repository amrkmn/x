import { join } from 'path';
import { CACHE_FILE_NAME, STATIC_DIR, TMP_DIR } from './cache/constants';
import { cleanupDir, compressToZip, ensureDir, extractZip, validateCache } from './cache/files';
import { acquireLock, generateInstanceId, releaseLock } from './cache/lock';
import { loadMetadata, saveMetadata, updateAccessTime } from './cache/metadata';
import { cleanupOldCaches, ENABLED, findLatestCache, getCacheKey, getClient } from './cache/s3';

const CACHE_FILE_PATH = join(TMP_DIR, CACHE_FILE_NAME);

export async function restoreCache(): Promise<boolean> {
    if (!ENABLED) {
        console.log('R2 Cache disabled');
        return false;
    }

    const s3 = getClient();
    if (!s3) return false;

    try {
        const exactKey = await getCacheKey();

        let downloadKey = exactKey;
        const exactFile = s3.file(exactKey);

        if (await exactFile.exists()) {
            // Load metadata to check if local cache is still valid
            const metadata = await loadMetadata(s3, exactKey);
            if (metadata && (await validateCache(metadata))) {
                console.log('Local cache valid');
                await updateAccessTime(s3, exactKey, metadata);
                return true;
            }
        } else {
            const fallbackKey = await findLatestCache(s3);
            if (!fallbackKey) {
                console.log('No cache found');
                return false;
            }

            console.log(`Using fallback: ${fallbackKey}`);
            downloadKey = fallbackKey;
        }

        await ensureDir(TMP_DIR);
        await ensureDir(STATIC_DIR);

        console.log(`Downloading cache...`);
        const s3File = s3.file(downloadKey);
        const arrayBuffer = await s3File.arrayBuffer();
        await Bun.write(CACHE_FILE_PATH, new Uint8Array(arrayBuffer));

        await extractZip(CACHE_FILE_PATH);
        await cleanupDir(TMP_DIR);

        // Update access time after successful restore
        const metadata = await loadMetadata(s3, downloadKey);
        if (metadata) {
            await updateAccessTime(s3, downloadKey, metadata);
        }

        console.log('Cache restored');
        return true;
    } catch (e) {
        console.error('Failed to restore cache:', e);
        return false;
    }
}

export async function saveCache(): Promise<void> {
    if (!ENABLED) return;

    const s3 = getClient();
    if (!s3) return;

    const instanceId = generateInstanceId();

    try {
        // Acquire lock
        if (!(await acquireLock(s3, instanceId))) {
            console.error('Failed to acquire lock');
            return;
        }

        const key = await getCacheKey();
        console.log(`Saving cache: ${key}`);

        await ensureDir(TMP_DIR);

        // Compress and calculate checksums
        const files = await compressToZip(STATIC_DIR, CACHE_FILE_PATH);

        await Bun.write(s3.file(key), Bun.file(CACHE_FILE_PATH));
        await saveMetadata(s3, key, files);
        await cleanupDir(TMP_DIR);

        console.log('Cache saved');

        await cleanupOldCaches(s3);
    } catch (e) {
        console.error('Failed to save cache:', e);
    } finally {
        // Always release lock
        await releaseLock(s3, instanceId);
    }
}
