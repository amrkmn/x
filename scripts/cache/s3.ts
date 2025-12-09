import { S3Client } from 'bun';
import type { S3ListObject } from './types';
import { MAX_CACHE_AGE_DAYS, MAX_CACHE_FILES } from './constants';
import { deleteMetadata } from './metadata';

const ENV = {
    ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    ACCESS_KEY_ID: process.env.CLOUDFLARE_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
    BUCKET_NAME: process.env.CLOUDFLARE_BUCKET_NAME
};

export const ENABLED = Object.values(ENV).every((v) => !!v);

let client: S3Client | null = null;

export function getClient(): S3Client | null {
    if (!ENABLED || client) return client;

    client = new S3Client({
        endpoint: `https://${ENV.ACCOUNT_ID}.r2.cloudflarestorage.com`,
        accessKeyId: ENV.ACCESS_KEY_ID,
        secretAccessKey: ENV.SECRET_ACCESS_KEY,
        bucket: ENV.BUCKET_NAME
    });
    return client;
}

export async function getCacheKey(): Promise<string> {
    const content = await Bun.file('extensions.json').arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');
    return `extensions-${hash}.zip`;
}

export async function findLatestCache(s3: S3Client): Promise<string | null> {
    const response = await s3.list({ prefix: 'extensions-' });
    if (!response.contents) return null;

    let latest = null as S3ListObject | null;

    for (const entry of response.contents || []) {
        if (!entry.key?.endsWith('.zip') || !entry.lastModified) continue;

        const entryTime = new Date(entry.lastModified).getTime();
        const latestTime = latest ? new Date(latest.lastModified!).getTime() : 0;

        if (!latest || entryTime > latestTime) {
            latest = entry;
        }
    }

    return latest?.key || null;
}

export async function cleanupOldCaches(s3: S3Client): Promise<void> {
    const response = await s3.list({ prefix: 'extensions-' });
    if (!response.contents) return;

    const files = response.contents
        .filter((entry) => entry.key?.endsWith('.zip') && entry.lastModified)
        .sort((a, b) => {
            const timeA = new Date(a.lastModified!).getTime();
            const timeB = new Date(b.lastModified!).getTime();
            return timeB - timeA;
        });

    const now = Date.now();
    const maxAge = MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000;

    for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        const age = now - new Date(entry.lastModified!).getTime();
        const shouldDelete = i >= MAX_CACHE_FILES || age > maxAge;

        if (shouldDelete && entry.key) {
            await s3.file(entry.key).delete();
            await deleteMetadata(s3, entry.key);
        }
    }
}
