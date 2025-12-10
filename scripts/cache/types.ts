export interface FileMetadata {
    checksum: string;
    size: number;
}

export interface CacheMetadata {
    key: string;
    hash: string;
    timestamp: number;
    lastAccessed: number;
    totalAccesses: number;
    files: Record<string, FileMetadata>;
    version: number;
}

export interface CacheLock {
    locked: boolean;
    timestamp: number;
    instance: string;
    ttl: number;
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
