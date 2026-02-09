import type { S3Client } from '@aws-sdk/client-s3';
import { fileExists, getObject } from './s3';
import type { CacheEntry, CacheManifest } from './utils';
import { writeJsonToS3 } from './utils';

const MANIFEST_KEY = 'manifest.json';
const MANIFEST_VERSION = 1;

export async function loadManifest(s3: S3Client): Promise<CacheManifest> {
    try {
        if (await fileExists(s3, MANIFEST_KEY)) {
            const data = await getObject(s3, MANIFEST_KEY);
            const manifest: CacheManifest = JSON.parse(new TextDecoder().decode(data));

            if (manifest.version === MANIFEST_VERSION) {
                return manifest;
            }
        }
    } catch (e) {
        console.error('Failed to load manifest:', e);
    }

    // Return empty manifest if not found or invalid
    return {
        version: MANIFEST_VERSION,
        caches: []
    };
}

export async function saveManifest(s3: S3Client, manifest: CacheManifest): Promise<void> {
    await writeJsonToS3(s3, MANIFEST_KEY, manifest);
}

export async function addCacheEntry(
    s3: S3Client,
    key: string,
    hash: string,
    timestamp: number
): Promise<void> {
    const manifest = await loadManifest(s3);

    // Remove existing entry with same key if exists
    manifest.caches = manifest.caches.filter((entry) => entry.key !== key);

    // Add new entry
    manifest.caches.push({
        key,
        hash,
        timestamp,
        lastAccessed: timestamp
    });

    await saveManifest(s3, manifest);
}

export async function removeCacheEntry(s3: S3Client, key: string): Promise<void> {
    const manifest = await loadManifest(s3);
    manifest.caches = manifest.caches.filter((entry) => entry.key !== key);
    await saveManifest(s3, manifest);
}

export function findCacheByKey(manifest: CacheManifest, key: string): CacheEntry | null {
    return manifest.caches.find((entry) => entry.key === key) || null;
}

export function findCacheByPrefix(manifest: CacheManifest, prefix: string): CacheEntry | null {
    const matching = manifest.caches.filter((entry) => entry.key.startsWith(prefix));

    if (matching.length === 0) {
        return null;
    }

    // Return most recently created cache
    return matching.sort((a, b) => b.timestamp - a.timestamp)[0];
}
