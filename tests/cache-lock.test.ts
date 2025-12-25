import { test, expect } from 'bun:test';
import { generateInstanceId } from '../scripts/cache/lock';
import type { CacheLock } from '../scripts/cache/utils';

test('generateInstanceId returns non-empty string', () => {
    const id = generateInstanceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
});

test('generateInstanceId includes timestamp', () => {
    const before = Date.now();
    const id = generateInstanceId();
    const after = Date.now();

    const timestampPart = id.split('-')[0];
    const timestamp = parseInt(timestampPart, 10);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
});

test('generateInstanceId includes random component', () => {
    const id1 = generateInstanceId();
    const id2 = generateInstanceId();

    expect(id1).not.toBe(id2);
});

test('generateInstanceId format is timestamp-randomstring', () => {
    const id = generateInstanceId();
    const parts = id.split('-');
    expect(parts.length).toBe(2);

    const [timestamp, random] = parts;
    expect(timestamp).toMatch(/^\d+$/);
    expect(random).toMatch(/^[a-z0-9]+$/);
    expect(random.length).toBeGreaterThan(0);
    expect(random.length).toBeLessThan(10);
});

// Helper function to test isLockStale logic (since it's private)
function isLockStale(lock: CacheLock, currentHostname: string): boolean {
    const lockAge = Date.now() - lock.timestamp;
    const timeSinceRenewal = lock.renewedAt ? Date.now() - lock.renewedAt : lockAge;

    // Check 1: Timestamp-based staleness (30 minutes)
    if (timeSinceRenewal > 30 * 60 * 1000) {
        return true;
    }

    // Check 2: Process-based staleness (only on same machine)
    if (lock.hostname === currentHostname) {
        // For testing, assume process doesn't exist if pid is -1
        if (lock.pid === -1) {
            return true;
        }
    }

    return false;
}

test('isLockStale returns true for old lock (over 30 minutes)', () => {
    const lock: CacheLock = {
        locked: true,
        timestamp: Date.now() - 31 * 60 * 1000, // 31 minutes ago
        instance: 'test-instance',
        ttl: 30 * 60 * 1000,
        pid: 12345,
        hostname: 'test-host'
    };

    expect(isLockStale(lock, 'test-host')).toBe(true);
});

test('isLockStale returns false for recent lock (under 30 minutes)', () => {
    const lock: CacheLock = {
        locked: true,
        timestamp: Date.now() - 29 * 60 * 1000, // 29 minutes ago
        instance: 'test-instance',
        ttl: 30 * 60 * 1000,
        pid: 12345,
        hostname: 'test-host'
    };

    expect(isLockStale(lock, 'test-host')).toBe(false);
});

test('isLockStale respects renewedAt timestamp', () => {
    const now = Date.now();
    const lock: CacheLock = {
        locked: true,
        timestamp: now - 40 * 60 * 1000, // 40 minutes ago
        instance: 'test-instance',
        ttl: 30 * 60 * 1000,
        renewedAt: now - 10 * 60 * 1000, // Renewed 10 minutes ago
        pid: 12345,
        hostname: 'test-host'
    };

    expect(isLockStale(lock, 'test-host')).toBe(false);
});

test('isLockStale returns true when lock on same host but process dead', () => {
    const lock: CacheLock = {
        locked: true,
        timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
        instance: 'test-instance',
        ttl: 30 * 60 * 1000,
        pid: -1, // Simulate dead process
        hostname: 'test-host'
    };

    expect(isLockStale(lock, 'test-host')).toBe(true);
});

test('isLockStale returns false when lock on different host (even if old process)', () => {
    const lock: CacheLock = {
        locked: true,
        timestamp: Date.now() - 10 * 60 * 1000,
        instance: 'test-instance',
        ttl: 30 * 60 * 1000,
        pid: -1,
        hostname: 'different-host'
    };

    expect(isLockStale(lock, 'test-host')).toBe(false);
});

test('isLockStale handles missing renewedAt', () => {
    const lock: CacheLock = {
        locked: true,
        timestamp: Date.now() - 35 * 60 * 1000, // 35 minutes ago
        instance: 'test-instance',
        ttl: 30 * 60 * 1000,
        pid: 12345,
        hostname: 'test-host'
    };

    expect(isLockStale(lock, 'test-host')).toBe(true);
});
