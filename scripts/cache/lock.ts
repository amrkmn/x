import type { S3Client } from '@aws-sdk/client-s3';
import { hostname } from 'node:os';
import { deleteObject, fileExists, getObject } from './s3';
import type { CacheLock } from './utils';
import {
    LOCK_DOUBLE_CHECK_MS,
    LOCK_KEY,
    LOCK_MAX_RETRIES,
    LOCK_RETRY_MAX_MS,
    LOCK_RETRY_START_MS,
    LOCK_TIMEOUT_MS,
    writeJsonToS3
} from './utils';

export function generateInstanceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Checks if a process is still running (only works on same machine).
 * Uses Node.js process.kill(pid, 0) which doesn't actually kill but checks existence.
 */
function isProcessRunning(pid: number): boolean {
    try {
        // Signal 0 doesn't kill, just checks if process exists
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Checks if a lock is stale based on Restic's algorithm:
 * 1. If timestamp is older than LOCK_TIMEOUT_MS (30 min), it's stale
 * 2. If on same machine and process doesn't exist, it's stale
 */
function isLockStale(lock: CacheLock): boolean {
    const lockAge = Date.now() - lock.timestamp;
    const timeSinceRenewal = lock.renewedAt ? Date.now() - lock.renewedAt : lockAge;

    // Check 1: Timestamp-based staleness (30 minutes)
    if (timeSinceRenewal > LOCK_TIMEOUT_MS) {
        return true;
    }

    // Check 2: Process-based staleness (only on same machine)
    if (lock.hostname === hostname()) {
        if (!isProcessRunning(lock.pid)) {
            return true;
        }
    }

    return false;
}

/**
 * Acquires a distributed lock using Restic's double-check pattern.
 * This is simpler and more reliable than the lease-based approach.
 *
 * Algorithm (inspired by Restic):
 * 1. Check for existing locks
 * 2. If lock exists and is NOT stale, retry with exponential backoff
 * 3. If no lock or stale lock found, create our lock
 * 4. Wait 200ms (LOCK_DOUBLE_CHECK_MS)
 * 5. Re-check: verify we still own the lock
 * 6. If verification fails, we lost the race - retry
 */
export async function acquireLock(s3: S3Client, instanceId: string): Promise<string | null> {
    let retryDelay = LOCK_RETRY_START_MS;

    for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
        try {
            // Step 1: Check for existing lock
            if (await fileExists(s3, LOCK_KEY)) {
                const lockData = await getObject(s3, LOCK_KEY);
                const existingLock: CacheLock = JSON.parse(new TextDecoder().decode(lockData));

                // Check if lock is stale
                if (isLockStale(existingLock)) {
                    console.log('Stale lock detected, removing...');
                    await deleteObject(s3, LOCK_KEY).catch(() => {});
                } else {
                    // Lock is valid, need to retry
                    console.log(
                        `Lock busy, retrying in ${retryDelay / 1000}s (${attempt + 1}/${LOCK_MAX_RETRIES})...`
                    );
                    await Bun.sleep(retryDelay);

                    // Exponential backoff: double delay each time, up to max
                    retryDelay = Math.min(retryDelay * 2, LOCK_RETRY_MAX_MS);
                    continue;
                }
            }

            // Step 2: Create new lock
            const newLock: CacheLock = {
                locked: true,
                timestamp: Date.now(),
                instance: instanceId,
                ttl: LOCK_TIMEOUT_MS,
                renewedAt: Date.now(),
                pid: process.pid,
                hostname: hostname()
            };

            await writeJsonToS3(s3, LOCK_KEY, newLock);

            // Step 3: Wait for double-check delay (Restic's waitBeforeLockCheck pattern)
            // This allows any racing processes to also write their locks
            await Bun.sleep(LOCK_DOUBLE_CHECK_MS);

            // Step 4: Verify we still own the lock (detect race conditions)
            if (await fileExists(s3, LOCK_KEY)) {
                const verifyData = await getObject(s3, LOCK_KEY);
                const verifyLock: CacheLock = JSON.parse(new TextDecoder().decode(verifyData));

                if (verifyLock.instance === instanceId) {
                    // Successfully acquired lock
                    console.log('Lock acquired');
                    return instanceId;
                }
            }

            // Lost the race - another process overwrote our lock
            // Retry with exponential backoff
            console.log(`Lost lock race, retrying in ${retryDelay / 1000}s...`);
            await Bun.sleep(retryDelay);
            retryDelay = Math.min(retryDelay * 2, LOCK_RETRY_MAX_MS);
        } catch (e) {
            console.error(`Lock error: ${e}`);
            await Bun.sleep(retryDelay);
            retryDelay = Math.min(retryDelay * 2, LOCK_RETRY_MAX_MS);
        }
    }

    console.error('Failed to acquire lock');
    return null;
}

/**
 * Renews the lock to extend its TTL. Should be called periodically during long operations.
 */
export async function renewLock(s3: S3Client, instanceId: string): Promise<boolean> {
    try {
        if (!(await fileExists(s3, LOCK_KEY))) {
            return false;
        }

        const lockData = await getObject(s3, LOCK_KEY);
        const lock: CacheLock = JSON.parse(new TextDecoder().decode(lockData));

        if (lock.instance !== instanceId) {
            return false;
        }

        // Update renewal time
        lock.renewedAt = Date.now();
        await writeJsonToS3(s3, LOCK_KEY, lock);

        console.log('Lock renewed');
        return true;
    } catch (e) {
        console.error('Failed to renew lock:', e);
        return false;
    }
}

/**
 * Releases the lock if owned by this instance.
 */
export async function releaseLock(s3: S3Client, instanceId: string): Promise<void> {
    try {
        if (!(await fileExists(s3, LOCK_KEY))) {
            return;
        }

        const lockData = await getObject(s3, LOCK_KEY);
        const lock: CacheLock = JSON.parse(new TextDecoder().decode(lockData));

        if (lock.instance === instanceId) {
            await deleteObject(s3, LOCK_KEY);
            console.log('Lock released');
        }
    } catch (e) {
        console.error('Failed to release lock:', e);
    }
}

/**
 * Executes a callback while holding the lock, with automatic renewal.
 */
export async function withLock<T>(
    s3: S3Client,
    callback: (instanceId: string) => Promise<T>
): Promise<T | null> {
    const instanceId = generateInstanceId();
    const lockToken = await acquireLock(s3, instanceId);

    if (!lockToken) {
        return null;
    }

    // Setup automatic lock renewal every 2 minutes
    const renewalInterval = setInterval(
        async () => {
            await renewLock(s3, instanceId);
        },
        2 * 60 * 1000
    );

    try {
        return await callback(instanceId);
    } finally {
        clearInterval(renewalInterval);
        await releaseLock(s3, instanceId);
    }
}
