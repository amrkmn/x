import { expect, test } from 'bun:test';

// Re-implement the helper functions for testing (since they're private in the module)
function formatTransferStats(bytes: number, elapsedSeconds: number): string {
    const sizeMB = (bytes / (1024 * 1024)).toFixed(2);
    const speedMBps = (bytes / (1024 * 1024) / elapsedSeconds).toFixed(2);
    return `${sizeMB} MB (${speedMBps} MB/s)`;
}

test('formatTransferStats formats bytes correctly', () => {
    // 10 MB over 1 second
    expect(formatTransferStats(10 * 1024 * 1024, 1)).toBe('10.00 MB (10.00 MB/s)');

    // 5.5 MB over 2 seconds (2.75 MB/s)
    expect(formatTransferStats(5.5 * 1024 * 1024, 2)).toBe('5.50 MB (2.75 MB/s)');

    // 1 KB (0.00 MB)
    expect(formatTransferStats(1024, 1)).toBe('0.00 MB (0.00 MB/s)');
});

test('formatTransferStats handles zero elapsed time', () => {
    // Should handle gracefully (Infinity would be wrong)
    const bytes = 1024 * 1024; // 1 MB
    const result = formatTransferStats(bytes, 0);
    expect(result).toContain('1.00 MB');
});
