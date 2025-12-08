import type { S3Client } from 'bun';
import type { CacheMetadata, FileMetadata } from './types';
import { METADATA_KEY, METADATA_VERSION } from './constants';

export async function saveMetadata(
    s3: S3Client,
    key: string,
    files: Record<string, FileMetadata>,
    previousMetadata?: CacheMetadata | null
): Promise<void> {
    const content = await Bun.file('extensions.json').arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');

    const metadata: CacheMetadata = {
        key,
        hash,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        totalAccesses: previousMetadata ? previousMetadata.totalAccesses + 1 : 1,
        files,
        version: METADATA_VERSION
    };

    await Bun.write(s3.file(METADATA_KEY), JSON.stringify(metadata, null, 2));

    console.log('Metadata saved to R2');
    console.log(`  Cache key: ${key}`);
    console.log(`  Total accesses: ${metadata.totalAccesses}`);
    console.log(`  Files tracked: ${Object.keys(metadata.files).length}`);
}

export async function loadMetadata(s3: S3Client): Promise<CacheMetadata | null> {
    const metadataFile = s3.file(METADATA_KEY);

    try {
        if (!(await metadataFile.exists())) {
            return null;
        }

        const metadata: any = JSON.parse(await metadataFile.text());

        if (metadata.version !== METADATA_VERSION) {
            console.log('Metadata version mismatch. Ignoring.');
            return null;
        }

        // Migrate old metadata format (checksums -> files)
        if (metadata.checksums && !metadata.files) {
            console.log('Migrating old metadata format...');
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

export async function updateAccessTime(s3: S3Client, metadata: CacheMetadata): Promise<void> {
    metadata.lastAccessed = Date.now();
    metadata.totalAccesses++;
    await Bun.write(s3.file(METADATA_KEY), JSON.stringify(metadata, null, 2));
    console.log('Updated access time in metadata');
}
