import type { S3Client } from './client';
import { logger } from '../log';
import { uploadToS3 } from './client';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface FileMetadata {
    checksum: string;
    size: number;
}

export interface CacheMetadata {
    key: string;
    hash: string;
    timestamp: number;
    lastAccessed: number;
    files: Record<string, FileMetadata>;
    version: number;
}

export interface CacheLock {
    locked: boolean;
    timestamp: number;
    instance: string;
    ttl: number;
    renewedAt?: number;
    pid: number;
    hostname: string;
}

export interface S3ListObject {
    key: string;
    lastModified?: string;
}

export interface CacheEntry {
    key: string;
    timestamp: number;
    lastAccessed: number;
    hash: string;
}

export interface CacheManifest {
    version: number;
    caches: CacheEntry[];
}

export const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (matches Restic)
export const LOCK_RETRY_START_MS = 5000; // 5 seconds (initial retry delay)
export const LOCK_RETRY_MAX_MS = 60000; // 60 seconds (max retry delay)
export const LOCK_MAX_RETRIES = 6; // With exponential backoff: 5s, 10s, 20s, 40s, 60s, 60s
export const LOCK_DOUBLE_CHECK_MS = 200; // 200ms delay for double-check pattern (matches Restic)

export const METADATA_VERSION = 2;
export const LOCK_KEY = 'cache.lock';

export const MAX_CACHE_FILES = 7;
export const MAX_CACHE_AGE_DAYS = 7;

export const TMP_DIR = 'tmp';
export const CACHE_FILE_NAME = 'extensions-cache.tzst';

// Cache configuration
export const CACHE_PATHS = ['static'];
export const CACHE_KEY_PREFIX = 'extensions-';
export const CACHE_RESTORE_KEYS = ['extensions-'];
const EXTENSIONS_CONFIG_FILE = 'extensions.json';
const TRANSFER_CHUNK_SIZE = 1024 * 1024; // 1 MiB

// Helper to generate cache key from extensions.json
export async function generateCacheKey(): Promise<string> {
    const content = await Bun.file(EXTENSIONS_CONFIG_FILE).arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');
    return `${CACHE_KEY_PREFIX}${hash}.tzst`;
}

// Helper to write JSON to S3 file
export async function writeJsonToS3(key: string, data: any): Promise<void> {
    const jsonData = JSON.stringify(data, null, 2);
    await uploadToS3(key, new TextEncoder().encode(jsonData), {
        contentType: 'application/json'
    });
}

function createFileUploadStream(
    sourcePath: string,
    totalBytes: number,
    onProgress: (bytes: number) => void
): ReadableStream<Uint8Array> {
    let offset = 0;

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (offset >= totalBytes) {
                controller.close();
                return;
            }

            const nextOffset = Math.min(offset + TRANSFER_CHUNK_SIZE, totalBytes);
            const chunk = new Uint8Array(
                await Bun.file(sourcePath).slice(offset, nextOffset).arrayBuffer()
            );

            offset = nextOffset;
            onProgress(offset);
            controller.enqueue(chunk);
        }
    });
}

// Helper to upload file to S3 with progress tracking
export async function uploadFileToS3(key: string, sourcePath: string): Promise<number> {
    const cacheFile = Bun.file(sourcePath);
    const sizeInBytes = cacheFile.size;
    const progressLogger = logger.transfer('[cache] uploading', sizeInBytes);

    await uploadToS3(
        key,
        createFileUploadStream(sourcePath, sizeInBytes, (bytes) => {
            progressLogger.progress(bytes);
        }),
        {
            contentLength: sizeInBytes
        }
    );

    progressLogger.complete(sizeInBytes);
    return sizeInBytes;
}

// Helper to download file from S3 with progress tracking
export async function downloadFileFromS3(
    s3: S3Client,
    key: string,
    targetPath: string
): Promise<number> {
    const url = s3.presign(key, { expiresIn: 3600 });

    await mkdir(dirname(targetPath), { recursive: true });

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `S3 download failed: ${response.status} ${response.statusText} for key: ${key}`
        );
    }

    if (!response.body) {
        throw new Error(`No response body for key: ${key}`);
    }

    const contentLength = Number(response.headers.get('content-length')) || undefined;
    const writer = Bun.file(targetPath).writer();
    const progressLogger = logger.transfer('[cache] received', contentLength);
    let totalBytes = 0;

    try {
        for await (const chunk of response.body as ReadableStream<Uint8Array>) {
            writer.write(chunk);
            totalBytes += chunk.byteLength;
            progressLogger.progress(totalBytes);
        }

        await writer.end();
    } catch (error) {
        try {
            await writer.end();
        } catch {}

        await rm(targetPath, { force: true });
        throw error;
    }

    if (typeof contentLength === 'number' && totalBytes !== contentLength) {
        await rm(targetPath, { force: true });
        throw new Error(
            `S3 download incomplete: expected ${contentLength} bytes, received ${totalBytes} for key: ${key}`
        );
    }

    progressLogger.complete(totalBytes);
    return totalBytes;
}
