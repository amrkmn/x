import { expect, test } from 'vitest';

import { CACHE_KEY_PREFIX, generateCacheKey } from '../scripts/cache/utils';

test('generateCacheKey returns key with correct prefix', async () => {
    const key = await generateCacheKey();

    expect(key.startsWith(CACHE_KEY_PREFIX)).toBe(true);
    expect(key.endsWith('.tzst')).toBe(true);
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
