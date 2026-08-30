import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';

import { logger } from '../log';
import type { S3Client } from './client';
import { uploadToS3 } from './client';

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
    const content = await readFile(EXTENSIONS_CONFIG_FILE);
    const hash = createHash('sha256').update(content).digest('hex');
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
    onProgress: (bytes: number) => void
): ReadableStream<Uint8Array> {
    let uploaded = 0;
    // SAFETY: Node's Readable.toWeb returns a byte stream for this file stream.
    const source = Readable.toWeb(
        createReadStream(sourcePath, { highWaterMark: TRANSFER_CHUNK_SIZE })
    ) as ReadableStream<Uint8Array>;

    return source.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                uploaded += chunk.byteLength;
                onProgress(uploaded);
                controller.enqueue(chunk);
            }
        })
    );
}

// Helper to upload file to S3 with progress tracking
export async function uploadFileToS3(key: string, sourcePath: string): Promise<number> {
    const sizeInBytes = (await stat(sourcePath)).size;
    const progressLogger = logger.transfer('[cache] uploading', sizeInBytes);

    await uploadToS3(
        key,
        createFileUploadStream(sourcePath, (bytes) => {
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
    await mkdir(dirname(targetPath), { recursive: true });

    const response = await s3.getObject(key);
    if (!response.ok) {
        throw new Error(
            `S3 download failed: ${response.status} ${response.statusText} for key: ${key}`
        );
    }

    if (!response.body) {
        throw new Error(`No response body for key: ${key}`);
    }

    const contentLength = Number(response.headers.get('content-length')) || undefined;
    const progressLogger = logger.transfer('[cache] received', contentLength);
    let totalBytes = 0;

    try {
        const file = await open(targetPath, 'w');
        try {
            // SAFETY: Response.body is checked immediately above and Node ReadableStreams are async iterable.
            for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
                await file.write(chunk);
                totalBytes += chunk.byteLength;
                progressLogger.progress(totalBytes);
            }
        } finally {
            await file.close();
        }
    } catch (error) {
        await rm(targetPath, { force: true });
        throw error;
    }

    if (contentLength !== undefined && totalBytes !== contentLength) {
        await rm(targetPath, { force: true });
        throw new Error(
            `S3 download incomplete: expected ${contentLength} bytes, received ${totalBytes} for key: ${key}`
        );
    }

    progressLogger.complete(totalBytes);
    return totalBytes;
}
