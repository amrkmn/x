import type { S3Client } from 'bun';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Constants
// ============================================================================

export const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (matches Restic)
export const LOCK_RETRY_START_MS = 5000; // 5 seconds (initial retry delay)
export const LOCK_RETRY_MAX_MS = 60000; // 60 seconds (max retry delay)
export const LOCK_MAX_RETRIES = 6; // With exponential backoff: 5s, 10s, 20s, 40s, 60s, 60s
export const LOCK_DOUBLE_CHECK_MS = 200; // 200ms delay for double-check pattern (matches Restic)

export const METADATA_VERSION = 1;
export const METADATA_KEY = 'metadata.json';
export const LOCK_KEY = 'cache.lock';

export const MAX_CACHE_FILES = 7;
export const MAX_CACHE_AGE_DAYS = 7;

export const TMP_DIR = 'tmp';
export const STATIC_DIR = 'static';
export const CACHE_FILE_NAME = 'extensions-cache.tzst';

// Cache configuration
export const CACHE_PATHS = ['static'];
export const CACHE_KEY_PREFIX = 'extensions-';
export const CACHE_RESTORE_KEYS = ['extensions-'];
export const EXTENSIONS_CONFIG_FILE = 'extensions.json';

// Helper to generate cache key from extensions.json
export async function generateCacheKey(): Promise<string> {
    const content = await Bun.file(EXTENSIONS_CONFIG_FILE).arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');
    return `${CACHE_KEY_PREFIX}${hash}.tzst`;
}

// Helper to write JSON to S3 file
export async function writeJsonToS3(s3: S3Client, key: string, data: any): Promise<void> {
    await Bun.write(s3.file(key), JSON.stringify(data, null, 2));
}
