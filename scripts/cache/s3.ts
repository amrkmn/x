import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { findCacheByKey, findCacheByPrefix, loadManifest, removeCacheEntry } from './manifest';
import { deleteMetadata } from './metadata';
import { MAX_CACHE_AGE_DAYS, MAX_CACHE_FILES } from './utils';

const s3Config = {
    ENDPOINT: process.env.S3_ENDPOINT,
    ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    BUCKET_NAME: process.env.S3_BUCKET_NAME,
    REGION: process.env.S3_REGION,
    FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE === 'true'
};

export { s3Config };

export const ENABLED =
    !!s3Config.ENDPOINT &&
    !!s3Config.ACCESS_KEY_ID &&
    !!s3Config.SECRET_ACCESS_KEY &&
    !!s3Config.BUCKET_NAME;

let client: S3Client | null = null;

export function getClient(): S3Client | null {
    if (!ENABLED || client) return client;

    client = new S3Client({
        endpoint: s3Config.ENDPOINT,
        credentials: {
            accessKeyId: s3Config.ACCESS_KEY_ID!,
            secretAccessKey: s3Config.SECRET_ACCESS_KEY!
        },
        region: s3Config.REGION || 'auto',
        forcePathStyle: s3Config.FORCE_PATH_STYLE
    });
    return client;
}

export async function fileExists(client: S3Client, key: string): Promise<boolean> {
    try {
        await client.send(
            new HeadObjectCommand({
                Bucket: s3Config.BUCKET_NAME!,
                Key: key
            })
        );
        return true;
    } catch {
        return false;
    }
}

export async function getObject(client: S3Client, key: string): Promise<Uint8Array> {
    const response = await client.send(
        new GetObjectCommand({
            Bucket: s3Config.BUCKET_NAME!,
            Key: key
        })
    );
    return new Uint8Array(await response.Body!.transformToByteArray());
}

export async function deleteObject(client: S3Client, key: string): Promise<void> {
    await client.send(
        new DeleteObjectCommand({
            Bucket: s3Config.BUCKET_NAME!,
            Key: key
        })
    );
}

export async function uploadToS3(
    key: string,
    data: Uint8Array | ArrayBuffer,
    onProgress?: (bytes: number) => void
): Promise<void> {
    const client = getClient();
    if (!client) throw new Error('S3 client not initialized');

    const body = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (!onProgress) {
        await client.send(
            new PutObjectCommand({
                Bucket: s3Config.BUCKET_NAME!,
                Key: key,
                Body: body
            })
        );
        return;
    }

    const upload = new Upload({
        client,
        params: {
            Bucket: s3Config.BUCKET_NAME!,
            Key: key,
            Body: body
        }
    });

    upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded) {
            onProgress(progress.loaded);
        }
    });

    await upload.done();
}

const cacheExists = async (s3: S3Client, key: string) => await fileExists(s3, key);

const cleanupStaleCache = async (s3: S3Client, key: string): Promise<void> => {
    console.log(`Cleaning stale cache from manifest (cache missing): ${key}`);
    await deleteMetadata(s3, key);
    await removeCacheEntry(s3, key);
};

export async function resolveCacheKey(
    s3: S3Client,
    key: string,
    restoreKeys?: string[]
): Promise<string | null> {
    const manifest = await loadManifest(s3);

    // Try exact match first
    const exactMatch = findCacheByKey(manifest, key);
    if (exactMatch) {
        if (await cacheExists(s3, exactMatch.key)) {
            return exactMatch.key;
        }
        await cleanupStaleCache(s3, exactMatch.key);
    }

    // Try restore keys in order (prefix matching), preferring most recent
    if (restoreKeys && restoreKeys.length > 0) {
        for (const prefix of restoreKeys) {
            const match = findCacheByPrefix(manifest, prefix);
            if (match) {
                if (await cacheExists(s3, match.key)) {
                    return match.key;
                }
                await cleanupStaleCache(s3, match.key);
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
            await deleteObject(s3, entry.key);
            await deleteMetadata(s3, entry.key);
            await removeCacheEntry(s3, entry.key);
            manifestUpdated = true;
        }
    }

    if (manifestUpdated) {
        console.log('Manifest updated after cleanup');
    }
}
