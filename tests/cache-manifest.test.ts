import { test, expect } from 'bun:test';
import { findCacheByKey, findCacheByPrefix } from '../scripts/cache/manifest';
import type { CacheManifest } from '../scripts/cache/utils';

test('findCacheByKey returns null when cache not found', () => {
    const manifest: CacheManifest = {
        version: 1,
        caches: [
            { key: 'cache1.tzst', hash: 'abc123', timestamp: 1000, lastAccessed: 1000 },
            { key: 'cache2.tzst', hash: 'def456', timestamp: 2000, lastAccessed: 2000 }
        ]
    };

    expect(findCacheByKey(manifest, 'cache3.tzst')).toBeNull();
});

test('findCacheByKey returns matching cache entry', () => {
    const manifest: CacheManifest = {
        version: 1,
        caches: [
            { key: 'cache1.tzst', hash: 'abc123', timestamp: 1000, lastAccessed: 1000 },
            { key: 'cache2.tzst', hash: 'def456', timestamp: 2000, lastAccessed: 2000 }
        ]
    };

    const result = findCacheByKey(manifest, 'cache1.tzst');
    expect(result).not.toBeNull();
    expect(result?.key).toBe('cache1.tzst');
    expect(result?.hash).toBe('abc123');
});

test('findCacheByPrefix returns null when no caches match prefix', () => {
    const manifest: CacheManifest = {
        version: 1,
        caches: [
            { key: 'cache1.tzst', hash: 'abc123', timestamp: 1000, lastAccessed: 1000 },
            { key: 'cache2.tzst', hash: 'def456', timestamp: 2000, lastAccessed: 2000 }
        ]
    };

    expect(findCacheByPrefix(manifest, 'other-')).toBeNull();
});

test('findCacheByPrefix returns most recently created cache', () => {
    const manifest: CacheManifest = {
        version: 1,
        caches: [
            { key: 'extensions-abc123.tzst', hash: 'abc123', timestamp: 1000, lastAccessed: 1000 },
            { key: 'extensions-def456.tzst', hash: 'def456', timestamp: 3000, lastAccessed: 3000 },
            { key: 'extensions-ghi789.tzst', hash: 'ghi789', timestamp: 2000, lastAccessed: 2000 }
        ]
    };

    const result = findCacheByPrefix(manifest, 'extensions-');
    expect(result).not.toBeNull();
    expect(result?.key).toBe('extensions-def456.tzst');
    expect(result?.timestamp).toBe(3000);
});

test('findCacheByPrefix handles empty caches array', () => {
    const manifest: CacheManifest = {
        version: 1,
        caches: []
    };

    expect(findCacheByPrefix(manifest, 'extensions-')).toBeNull();
});

test('findCacheByKey handles empty caches array', () => {
    const manifest: CacheManifest = {
        version: 1,
        caches: []
    };

    expect(findCacheByKey(manifest, 'cache1.tzst')).toBeNull();
});
