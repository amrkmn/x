import type { S3Client } from 'bun';
import type { CacheEntry, CacheManifest } from './types';

const MANIFEST_KEY = 'manifest.json';
const MANIFEST_VERSION = 1;

export async function loadManifest(s3: S3Client): Promise<CacheManifest> {
    const manifestFile = s3.file(MANIFEST_KEY);

    try {
        if (await manifestFile.exists()) {
            const data = await manifestFile.text();
            const manifest: CacheManifest = JSON.parse(data);

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
    const manifestFile = s3.file(MANIFEST_KEY);
    await Bun.write(manifestFile, JSON.stringify(manifest, null, 2));
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

export async function updateCacheAccess(s3: S3Client, key: string): Promise<void> {
    const manifest = await loadManifest(s3);
    const entry = manifest.caches.find((e) => e.key === key);

    if (entry) {
        entry.lastAccessed = Date.now();
        await saveManifest(s3, manifest);
    }
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
