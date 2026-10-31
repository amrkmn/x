import { expect, test } from 'vitest';

import { formatTransferStats, Logger } from '../scripts/log';

test('formatTransferStats formats bytes without totalBytes', () => {
    const result = formatTransferStats(10 * 1024 * 1024, 1);
    expect(result).toBe('10.00MiB(0.00%) 10.00MiB/s');
});

test('formatTransferStats formats bytes with totalBytes', () => {
    const result = formatTransferStats(5 * 1024 * 1024, 2, 10 * 1024 * 1024);
    expect(result).toBe('5.00/10.00MiB(50.00%) 2.50MiB/s');
});

test('formatTransferStats handles small values', () => {
    const result = formatTransferStats(1024, 1);
    expect(result).toBe('0.00MiB(0.00%) 0.00MiB/s');
});

test('formatTransferStats handles zero elapsed time', () => {
    const bytes = 1024 * 1024;
    const result = formatTransferStats(bytes, 0);
    expect(result).toBe('1.00MiB(0.00%) 0.00MiB/s');
});

test('formatTransferStats caps percentage at 100%', () => {
    const result = formatTransferStats(15 * 1024 * 1024, 1, 10 * 1024 * 1024);
    expect(result).toBe('15.00/10.00MiB(100.00%) 15.00MiB/s');
});

test('Logger clears progress line before writing log output', () => {
    const logger = new Logger();
    const outputs: string[] = [];

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        outputs.push(args.join(' '));
    };

    try {
        const transfer = logger.transfer('[test] uploading', 1000);

        transfer.progress(500);

        logger.info('test', 'log message during progress');

        transfer.complete(1000);

        expect(outputs.some((o) => o.includes('log message during progress'))).toBe(true);
    } finally {
        console.log = originalLog;
    }
});
