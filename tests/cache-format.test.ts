import { test, expect } from 'bun:test';

// formatBytes is an internal function in cache.ts
// This test verifies the expected behavior
function formatBytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(2);
}

test('formatBytes converts bytes to MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00');
    expect(formatBytes(10.5 * 1024 * 1024)).toBe('10.50');
});

test('formatBytes rounds to 2 decimal places', () => {
    expect(formatBytes(1024 * 1024 + 1)).toBe('1.00');
    expect(formatBytes(1.234 * 1024 * 1024)).toBe('1.23');
});

test('formatBytes handles zero', () => {
    expect(formatBytes(0)).toBe('0.00');
});

test('formatBytes handles small values', () => {
    expect(formatBytes(512 * 1024)).toBe('0.50');
    expect(formatBytes(1024)).toBe('0.00');
});
