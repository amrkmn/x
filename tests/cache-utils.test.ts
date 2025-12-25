import { test, expect } from 'bun:test';
import { generateCacheKey, CACHE_KEY_PREFIX } from '../scripts/cache/utils';

test('generateCacheKey returns key with correct prefix', async () => {
    const key = await generateCacheKey();

    expect(key).toStartWith(CACHE_KEY_PREFIX);
    expect(key).toEndWith('.tzst');
});

test('generateCacheKey produces consistent hash for same content', async () => {
    const key1 = await generateCacheKey();
    const key2 = await generateCacheKey();

    expect(key1).toBe(key2);
});

test('generateCacheKey produces 64-character hash', async () => {
    const key = await generateCacheKey();
    const hashPart = key.replace(CACHE_KEY_PREFIX, '').replace('.tzst', '');

    expect(hashPart).toHaveLength(64);
});
