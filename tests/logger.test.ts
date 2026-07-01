import { expect, test } from 'bun:test';
import { formatTransferStats, Logger } from '../scripts/log';

test('formatTransferStats formats bytes without totalBytes', () => {
    // 10 MB over 1 second, no total
    const result = formatTransferStats(10 * 1024 * 1024, 1);
    expect(result).toBe('10.00MiB(0.00%) 10.00MiB/s');
});

test('formatTransferStats formats bytes with totalBytes', () => {
    // 5 MB of 10 MB over 2 seconds
    const result = formatTransferStats(5 * 1024 * 1024, 2, 10 * 1024 * 1024);
    expect(result).toBe('5.00/10.00MiB(50.00%) 2.50MiB/s');
});

test('formatTransferStats handles small values', () => {
    // 1 KB (0.00 MB)
    const result = formatTransferStats(1024, 1);
    expect(result).toContain('0.00MiB');
    expect(result).toContain('0.00MiB/s');
});

test('formatTransferStats handles zero elapsed time', () => {
    const bytes = 1024 * 1024; // 1 MB
    const result = formatTransferStats(bytes, 0);
    expect(result).toContain('1.00MiB');
    expect(result).toContain('0.00MiB/s');
});

test('formatTransferStats caps percentage at 100%', () => {
    // More bytes than total (edge case)
    const result = formatTransferStats(15 * 1024 * 1024, 1, 10 * 1024 * 1024);
    expect(result).toContain('100.00%');
});

test('Logger clears progress line before writing log output', () => {
    const logger = new Logger();
    const outputs: string[] = [];

    // Capture console output
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        outputs.push(args.join(' '));
    };

    try {
        // Create a transfer logger (uses progress)
        const transfer = logger.transfer('[test] uploading', 1000);

        // Simulate progress updates
        transfer.progress(500);

        // Write a log while progress might be active
        logger.info('test', 'log message during progress');

        // Complete the transfer
        transfer.complete(1000);

        // Verify log message was written
        expect(outputs.some((o) => o.includes('log message during progress'))).toBe(true);
    } finally {
        console.log = originalLog;
    }
});
