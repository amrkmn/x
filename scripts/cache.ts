import { join } from 'path';
import { CACHE_FILE_NAME, STATIC_DIR, TMP_DIR } from './cache/constants';
import { cleanupDir, compressToZip, ensureDir, extractZip, validateCache } from './cache/files';
import { acquireLock, generateInstanceId, releaseLock } from './cache/lock';
import { loadMetadata, saveMetadata, updateAccessTime } from './cache/metadata';
import { cleanupOldCaches, ENABLED, findLatestCache, getCacheKey, getClient } from './cache/s3';

const CACHE_FILE_PATH = join(TMP_DIR, CACHE_FILE_NAME);

export async function restoreCache(): Promise<boolean> {
    if (!ENABLED) {
        console.log('R2 Cache disabled: Missing environment variables');
        return false;
    }

    const s3 = getClient();
    if (!s3) return false;

    try {
        // Load metadata to check if cache is still valid
        const metadata = await loadMetadata(s3);
        if (metadata) {
            console.log(
                `Found metadata: ${metadata.key} (${new Date(metadata.timestamp).toISOString()})`
            );

            // Validate local cache
            if (await validateCache(metadata)) {
                console.log('Local cache is valid. Skipping download.');
                await updateAccessTime(s3, metadata);
                return true;
            }

            console.log('Local cache validation failed. Downloading fresh cache...');
        }

        const exactKey = await getCacheKey();
        console.log('Checking R2 cache...');

        let downloadKey = exactKey;
        const exactFile = s3.file(exactKey);

        if (await exactFile.exists()) {
            console.log(`Cache hit (Exact): ${exactKey}`);
        } else {
            console.log(`Cache miss (Exact): ${exactKey}`);
            console.log('Searching for fallback cache...');

            const fallbackKey = await findLatestCache(s3);
            if (!fallbackKey) {
                console.log('No cache found.');
                return false;
            }

            console.log(`Fallback found: ${fallbackKey}`);
            downloadKey = fallbackKey;
        }

        await ensureDir(TMP_DIR);
        await ensureDir(STATIC_DIR);

        console.log(`Downloading ${downloadKey}...`);
        const s3File = s3.file(downloadKey);
        const arrayBuffer = await s3File.arrayBuffer();
        await Bun.write(CACHE_FILE_PATH, new Uint8Array(arrayBuffer));

        console.log('Extracting cache...');
        await extractZip(CACHE_FILE_PATH);

        console.log('Cleaning up tmp directory...');
        await cleanupDir(TMP_DIR);

        console.log('Cache restored successfully.');
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
            console.error('Failed to acquire lock. Another instance may be updating the cache.');
            return;
        }

        // Load previous metadata to preserve access history
        const previousMetadata = await loadMetadata(s3);

        const key = await getCacheKey();
        console.log(`Saving R2 cache: ${key}`);

        await ensureDir(TMP_DIR);

        // Compress and calculate checksums
        const files = await compressToZip(STATIC_DIR, CACHE_FILE_PATH);

        console.log('Uploading to R2...');
        await Bun.write(s3.file(key), Bun.file(CACHE_FILE_PATH));

        console.log('Saving metadata...');
        await saveMetadata(s3, key, files, previousMetadata);

        console.log('Cleaning up tmp directory...');
        await cleanupDir(TMP_DIR);
        console.log('Cache saved successfully.');

        await cleanupOldCaches(s3);
    } catch (e) {
        console.error('Failed to save cache:', e);
    } finally {
        // Always release lock
        await releaseLock(s3, instanceId);
    }
}
