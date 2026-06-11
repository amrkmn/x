import type { S3Client } from '@aws-sdk/client-s3';
import { exists } from 'node:fs/promises';
import { join } from 'node:path';
import { calculateFileChecksum } from './files';
import { deleteObject, fileExists, getObject } from './client';
import type { CacheMetadata, FileMetadata } from './utils';
import { METADATA_VERSION, writeJsonToS3 } from './utils';
import { logger } from '../log';

function getMetadataKey(cacheKey: string): string {
    return `${cacheKey}.meta.json`;
}

export async function saveMetadata(
    key: string,
    files: Record<string, FileMetadata>,
    cacheFilePath: string,
    timestamp?: number
): Promise<string> {
    const content = await Bun.file(cacheFilePath).arrayBuffer();
    const hash = Bun.hash(content).toString(16);

    const metadata: CacheMetadata = {
        key,
        hash,
        timestamp: timestamp ?? Date.now(),
        lastAccessed: Date.now(),
        files,
        version: METADATA_VERSION
    };

    const metadataKey = getMetadataKey(key);
    await writeJsonToS3(metadataKey, metadata);

    logger.info('cache', `metadata save complete key=${JSON.stringify(metadataKey)}`);
    return hash;
}

async function migrateMetadata(
    cacheKey: string,
    old: CacheMetadata
): Promise<CacheMetadata | null> {
    // Only migrate if all files are already present locally
    for (const filePath of Object.keys(old.files)) {
        if (!(await exists(join('.', filePath)))) {
            logger.info(
                'cache',
                `metadata migrate skipped reason="missing_file" path=${JSON.stringify(filePath)}`
            );
            return null;
        }
    }

    logger.info('cache', `metadata migrate start from=${old.version} to=${METADATA_VERSION}`);

    const files: Record<string, FileMetadata> = {};
    for (const [filePath, info] of Object.entries(old.files)) {
        const fullPath = join('.', filePath);
        const checksum = await calculateFileChecksum(fullPath);
        files[filePath] = { checksum, size: info.size };
    }

    const migrated: CacheMetadata = {
        ...old,
        files,
        version: METADATA_VERSION,
        lastAccessed: Date.now()
    };

    await writeJsonToS3(getMetadataKey(cacheKey), migrated);
    logger.info('cache', 'metadata migrate complete status="success"');

    return migrated;
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
            logger.info(
                'cache',
                `metadata version mismatch expected=${METADATA_VERSION} got=${metadata.version} action="migrate"`
            );
            return migrateMetadata(cacheKey, metadata);
        }

        return metadata;
    } catch (e) {
        logger.error('cache', 'metadata load failed', e);
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
        logger.error('cache', 'metadata delete failed', e);
    }
}
