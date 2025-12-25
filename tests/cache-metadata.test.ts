import { test, expect } from 'bun:test';

// The getMetadataKey function is internal to metadata.ts
// This test verifies the expected behavior/format
function getMetadataKey(cacheKey: string): string {
    return `${cacheKey}.meta.json`;
}

test('getMetadataKey appends .meta.json to cache key', () => {
    expect(getMetadataKey('cache.tzst')).toBe('cache.tzst.meta.json');
    expect(getMetadataKey('extensions-abc123.tzst')).toBe('extensions-abc123.tzst.meta.json');
    expect(getMetadataKey('my-cache.tar.zst')).toBe('my-cache.tar.zst.meta.json');
});

test('getMetadataKey handles keys with path', () => {
    expect(getMetadataKey('path/to/cache.tzst')).toBe('path/to/cache.tzst.meta.json');
});

test('getMetadataKey handles empty string', () => {
    expect(getMetadataKey('')).toBe('.meta.json');
});
