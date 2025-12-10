import { S3Client } from 'bun';
import { MAX_CACHE_AGE_DAYS, MAX_CACHE_FILES } from './constants';
import { findCacheByKey, findCacheByPrefix, loadManifest, removeCacheEntry } from './manifest';
import { deleteMetadata } from './metadata';

const ENV = {
    ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    ACCESS_KEY_ID: process.env.CLOUDFLARE_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
    BUCKET_NAME: process.env.CLOUDFLARE_BUCKET_NAME
};

export const ENABLED = Object.values(ENV).every((v) => !!v);

let client: S3Client | null = null;

export function getClient(): S3Client | null {
    if (!ENABLED || client) return client;

    client = new S3Client({
        endpoint: `https://${ENV.ACCOUNT_ID}.r2.cloudflarestorage.com`,
        accessKeyId: ENV.ACCESS_KEY_ID,
        secretAccessKey: ENV.SECRET_ACCESS_KEY,
        bucket: ENV.BUCKET_NAME
    });
    return client;
}

export async function resolveCacheKey(
    s3: S3Client,
    key: string,
    restoreKeys?: string[]
): Promise<string | null> {
    const manifest = await loadManifest(s3);

    // Try exact match first
    const exactMatch = findCacheByKey(manifest, key);
    if (exactMatch) {
        return exactMatch.key;
    }

    // Try restore keys in order (prefix matching)
    if (restoreKeys && restoreKeys.length > 0) {
        for (const prefix of restoreKeys) {
            const match = findCacheByPrefix(manifest, prefix);
            if (match) {
                return match.key;
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
            console.log(
                `Deleting cache: ${entry.key} (age: ${Math.floor(age / (24 * 60 * 60 * 1000))} days, position: ${i + 1})`
            );
            await s3.file(entry.key).delete();
            await deleteMetadata(s3, entry.key);
            await removeCacheEntry(s3, entry.key);
            manifestUpdated = true;
        }
    }

    if (manifestUpdated) {
        console.log('Manifest updated after cleanup');
    }
}
