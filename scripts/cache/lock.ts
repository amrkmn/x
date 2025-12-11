import type { S3Client } from 'bun';
import { LOCK_KEY, LOCK_MAX_RETRIES, LOCK_RETRY_MS, LOCK_TIMEOUT_MS, writeJsonToS3 } from './utils';
import type { CacheLock } from './utils';

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
                    await Bun.sleep(LOCK_RETRY_MS);
                    continue;
                }
            }

            // Acquire lock
            const newLock: CacheLock = {
                locked: true,
                timestamp: Date.now(),
                instance: instanceId,
                ttl: LOCK_TIMEOUT_MS
            };

            await writeJsonToS3(s3, LOCK_KEY, newLock);
            return true;
        } catch (e) {
            console.error(`Lock error: ${e}`);
        }
    }

    console.error('Failed to acquire lock');
    return false;
}

export async function releaseLock(s3: S3Client, instanceId: string): Promise<void> {
    const lockFile = s3.file(LOCK_KEY);

    try {
        if (await lockFile.exists()) {
            const lock: CacheLock = JSON.parse(await lockFile.text());

            if (lock.instance === instanceId) {
                await lockFile.delete();
            }
        }
    } catch (e) {
        console.error('Failed to release lock:', e);
    }
}
