import type { S3Client } from '@aws-sdk/client-s3';
import { deleteObject, fileExists, getObject } from './s3';
import type { CacheMetadata, FileMetadata } from './utils';
import { METADATA_VERSION, writeJsonToS3 } from './utils';

function getMetadataKey(cacheKey: string): string {
    return `${cacheKey}.meta.json`;
}

export async function saveMetadata(
    key: string,
    files: Record<string, FileMetadata>,
    cacheFilePath: string
): Promise<string> {
    const content = await Bun.file(cacheFilePath).arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');

    const metadata: CacheMetadata = {
        key,
        hash,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        files,
        version: METADATA_VERSION
    };

    const metadataKey = getMetadataKey(key);
    await writeJsonToS3(metadataKey, metadata);

    console.log(`Metadata saved: ${metadataKey}`);
    return hash;
}

export async function loadMetadata(s3: S3Client, cacheKey: string): Promise<CacheMetadata | null> {
    const metadataKey = getMetadataKey(cacheKey);

    try {
        if (!(await fileExists(s3, metadataKey))) {
            return null;
        }

        const data = await getObject(s3, metadataKey);
        const metadata: CacheMetadata = JSON.parse(new TextDecoder().decode(data));

        if (metadata.version !== METADATA_VERSION) {
            return null;
        }

        return metadata;
    } catch (e) {
        console.error('Failed to load metadata:', e);
        return null;
    }
}

async function updateMetadataAccessTime(cacheKey: string, metadata: CacheMetadata): Promise<void> {
    metadata.lastAccessed = Date.now();

    const metadataKey = getMetadataKey(cacheKey);
    await writeJsonToS3(metadataKey, metadata);
}

export async function updateBothAccessTimes(
    s3: S3Client,
    cacheKey: string,
    metadata: CacheMetadata
): Promise<void> {
    await updateMetadataAccessTime(cacheKey, metadata);

    // Also update manifest
    const { loadManifest, saveManifest } = await import('./manifest');
    const manifest = await loadManifest(s3);
    const entry = manifest.caches.find((e) => e.key === cacheKey);

    if (entry) {
        entry.lastAccessed = Date.now();
        await saveManifest(manifest);
    }
}

export async function deleteMetadata(s3: S3Client, cacheKey: string): Promise<void> {
    const metadataKey = getMetadataKey(cacheKey);

    try {
        if (await fileExists(s3, metadataKey)) {
            await deleteObject(s3, metadataKey);
        }
    } catch (e) {
        console.error(`Failed to delete metadata: ${e}`);
    }
}
