import type { S3Client } from 'bun';
import { METADATA_VERSION, writeJsonToS3 } from './utils';
import type { CacheMetadata, FileMetadata } from './utils';

function getMetadataKey(cacheKey: string): string {
    return `${cacheKey}.meta.json`;
}

export async function saveMetadata(
    s3: S3Client,
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
    await writeJsonToS3(s3, metadataKey, metadata);

    console.log(`Metadata saved: ${metadataKey}`);
    return hash;
}

export async function loadMetadata(s3: S3Client, cacheKey: string): Promise<CacheMetadata | null> {
    const metadataKey = getMetadataKey(cacheKey);
    const metadataFile = s3.file(metadataKey);

    try {
        if (!(await metadataFile.exists())) {
            return null;
        }

        const metadata: CacheMetadata = JSON.parse(await metadataFile.text());

        if (metadata.version !== METADATA_VERSION) {
            return null;
        }

        return metadata;
    } catch (e) {
        console.error('Failed to load metadata:', e);
        return null;
    }
}

async function updateMetadataAccessTime(
    s3: S3Client,
    cacheKey: string,
    metadata: CacheMetadata
): Promise<void> {
    metadata.lastAccessed = Date.now();

    const metadataKey = getMetadataKey(cacheKey);
    await writeJsonToS3(s3, metadataKey, metadata);
}

export async function updateBothAccessTimes(
    s3: S3Client,
    cacheKey: string,
    metadata: CacheMetadata
): Promise<void> {
    await updateMetadataAccessTime(s3, cacheKey, metadata);

    // Also update manifest
    const { loadManifest, saveManifest } = await import('./manifest');
    const manifest = await loadManifest(s3);
    const entry = manifest.caches.find((e) => e.key === cacheKey);

    if (entry) {
        entry.lastAccessed = Date.now();
        await saveManifest(s3, manifest);
    }
}

export async function deleteMetadata(s3: S3Client, cacheKey: string): Promise<void> {
    const metadataKey = getMetadataKey(cacheKey);
    const metadataFile = s3.file(metadataKey);

    try {
        if (await metadataFile.exists()) {
            await metadataFile.delete();
        }
    } catch (e) {
        console.error(`Failed to delete metadata: ${e}`);
    }
}
