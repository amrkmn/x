import type { S3Client } from 'bun';
import type { CacheLock } from './types';
import {
    LOCK_KEY,
    LOCK_MAX_RETRIES,
    LOCK_RETRY_MS,
    LOCK_TIMEOUT_MS,
    LOCK_VERIFY_DELAY_MS
} from './constants';

export function generateInstanceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function acquireLock(s3: S3Client, instanceId: string): Promise<boolean> {
    const lockFile = s3.file(LOCK_KEY);

    for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
        try {
            if (await lockFile.exists()) {
                const existingLock: CacheLock = JSON.parse(await lockFile.text());
                const lockAge = Date.now() - existingLock.timestamp;

                if (lockAge < existingLock.ttl) {
                    console.log(
                        `Cache locked by ${existingLock.instance}. Waiting ${LOCK_RETRY_MS / 1000}s... (Attempt ${attempt + 1}/${LOCK_MAX_RETRIES})`
                    );
                    await Bun.sleep(LOCK_RETRY_MS);
                    continue;
                }

                console.log(`Stale lock detected (age: ${Math.round(lockAge / 1000)}s). Taking over...`);
            }

            // Acquire lock
            const newLock: CacheLock = {
                locked: true,
                timestamp: Date.now(),
                instance: instanceId,
                ttl: LOCK_TIMEOUT_MS
            };

            await Bun.write(lockFile, JSON.stringify(newLock, null, 2));

            // Verify we got the lock (handle race condition)
            await Bun.sleep(LOCK_VERIFY_DELAY_MS);
            const verifyLock: CacheLock = JSON.parse(await lockFile.text());

            if (verifyLock.instance !== instanceId) {
                console.log(`Lost race condition to ${verifyLock.instance}. Retrying...`);
                await Bun.sleep(LOCK_RETRY_MS);
                continue;
            }

            console.log(`Lock acquired: ${instanceId}`);
            return true;
        } catch (e) {
            console.error(`Failed to acquire lock (attempt ${attempt + 1}):`, e);
        }
    }

    console.error('Failed to acquire lock after maximum retries');
    return false;
}

export async function releaseLock(s3: S3Client, instanceId: string): Promise<void> {
    const lockFile = s3.file(LOCK_KEY);

    try {
        if (await lockFile.exists()) {
            const lock: CacheLock = JSON.parse(await lockFile.text());

            if (lock.instance === instanceId) {
                await lockFile.delete();
                console.log(`Lock released: ${instanceId}`);
            } else {
                console.warn(`Lock owned by different instance (${lock.instance}). Not releasing.`);
            }
        }
    } catch (e) {
        console.error('Failed to release lock:', e);
    }
}
