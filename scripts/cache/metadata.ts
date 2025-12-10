import type { S3Client } from 'bun';
import { METADATA_VERSION } from './constants';
import type { CacheMetadata, FileMetadata } from './types';

function getMetadataKey(cacheKey: string): string {
    return `${cacheKey}.meta.json`;
}

export async function saveMetadata(
    s3: S3Client,
    key: string,
    files: Record<string, FileMetadata>,
    cacheFilePath: string
): Promise<void> {
    const content = await Bun.file(cacheFilePath).arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');

    const metadata: CacheMetadata = {
        key,
        hash,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        totalAccesses: 0,
        files,
        version: METADATA_VERSION
    };

    const metadataKey = getMetadataKey(key);
    await Bun.write(s3.file(metadataKey), JSON.stringify(metadata, null, 2));

    console.log(`Metadata saved: ${metadataKey}`);
}

export async function loadMetadata(s3: S3Client, cacheKey: string): Promise<CacheMetadata | null> {
    const metadataKey = getMetadataKey(cacheKey);
    const metadataFile = s3.file(metadataKey);

    try {
        if (!(await metadataFile.exists())) {
            return null;
        }

        const metadata: any = JSON.parse(await metadataFile.text());

        if (metadata.version !== METADATA_VERSION) {
            return null;
        }

        // Migrate old metadata format (checksums -> files)
        if (metadata.checksums && !metadata.files) {
            metadata.files = {};
            for (const [path, checksum] of Object.entries(
                metadata.checksums as Record<string, string>
            )) {
                metadata.files[path] = { checksum, size: 0 };
            }
            delete metadata.checksums;
            metadata.lastAccessed = metadata.timestamp || Date.now();
            metadata.totalAccesses = 1;
        }

        // Clean up old per-file access tracking fields
        if (metadata.files) {
            for (const fileInfo of Object.values(metadata.files) as any[]) {
                delete fileInfo.lastAccessed;
                delete fileInfo.lastModified;
                delete fileInfo.accessCount;
            }
        }

        return metadata as CacheMetadata;
    } catch (e) {
        console.error('Failed to load metadata:', e);
        return null;
    }
}

export async function updateAccessTime(
    s3: S3Client,
    cacheKey: string,
    metadata: CacheMetadata
): Promise<void> {
    metadata.lastAccessed = Date.now();
    metadata.totalAccesses++;

    const metadataKey = getMetadataKey(cacheKey);
    await Bun.write(s3.file(metadataKey), JSON.stringify(metadata, null, 2));
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
