import { readFile } from 'node:fs/promises';

import type { JsonValue } from '../../src/lib/validation';
import { config } from '../config';
import {
    isRecord,
    isString,
    requiredArray,
    requiredNumber,
    requiredObject,
    requiredString
} from './json';
import type { ReleaseAssetInfo, ReleaseClient, ReleaseInfo } from './types';

const DEFAULT_MAX_ATTEMPTS = 8;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface RetryDecision {
    retryable: boolean;
    isPrimaryRateLimit: boolean;
    delayMs: number;
    reason?: string;
}

export class GitHubReleaseClient implements ReleaseClient {
    private rateLimitedUntil = 0;
    private lastKnownResetMs = 0;
    private rateLimitFetchPromise: Promise<number | null> | null = null;

    constructor(
        private readonly token: string,
        private readonly owner: string,
        private readonly repo: string,
        private readonly fetcher: typeof fetch = fetch,
        private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS
    ) {}

    private api(path: string): string {
        return `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
    }

    private inspectHeaders(response: Response): void {
        const resetHeader = response.headers.get('x-ratelimit-reset');
        if (resetHeader !== null) {
            const sec = Number(resetHeader);
            if (Number.isFinite(sec) && sec > 0) {
                this.lastKnownResetMs = sec * 1000;
            }
        }
        const remainingHeader = response.headers.get('x-ratelimit-remaining');
        if (remainingHeader !== null) {
            const remaining = Number(remainingHeader);
            if (Number.isFinite(remaining) && remaining === 0 && this.lastKnownResetMs > 0) {
                const delay = this.lastKnownResetMs - Date.now() + 1000;
                if (delay > 0) {
                    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + delay);
                }
            }
        }
    }

    private async fetchRateLimitReset(): Promise<number | null> {
        if (this.rateLimitFetchPromise) return this.rateLimitFetchPromise;
        this.rateLimitFetchPromise = (async () => {
            try {
                const response = await this.fetcher('https://api.github.com/rate_limit', {
                    headers: {
                        Accept: 'application/vnd.github+json',
                        Authorization: `Bearer ${this.token}`,
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                });
                if (!response.ok) return null;
                const text = await response.text();
                // SAFETY: JSON.parse of a successful GitHub API response yields a parsed JSON tree.
                const body = JSON.parse(text) as JsonValue;
                if (!isRecord(body)) return null;
                let resetValue: JsonValue | undefined;
                if (isRecord(body.resources)) {
                    const resources = body.resources;
                    if (isRecord(resources.core)) {
                        resetValue = resources.core.reset;
                    }
                }
                if (resetValue === undefined && isRecord(body.rate)) {
                    resetValue = body.rate.reset;
                }
                if (Number.isFinite(resetValue)) {
                    const sec = Number(resetValue);
                    if (sec > 0) return sec * 1000;
                }
                return null;
            } catch {
                return null;
            } finally {
                this.rateLimitFetchPromise = null;
            }
        })();
        return this.rateLimitFetchPromise;
    }

    private async evaluateRetry(response: Response, attempt: number): Promise<RetryDecision> {
        const status = response.status;
        if (response.ok) {
            return { retryable: false, isPrimaryRateLimit: false, delayMs: 0 };
        }

        if (status >= 500 && status <= 504) {
            const delayMs = Math.min(1000 * 2 ** attempt, 60_000) + Math.floor(Math.random() * 500);
            return {
                retryable: true,
                isPrimaryRateLimit: false,
                delayMs,
                reason: `HTTP ${status}`
            };
        }

        if (status !== 403 && status !== 429) {
            return { retryable: false, isPrimaryRateLimit: false, delayMs: 0 };
        }

        const retryAfter = response.headers.get('retry-after');
        if (retryAfter !== null) {
            const sec = Number(retryAfter);
            if (Number.isFinite(sec) && sec >= 0) {
                const delayMs = sec * 1000 + (sec > 0 ? 1000 : 0);
                return {
                    retryable: true,
                    isPrimaryRateLimit: false,
                    delayMs,
                    reason: `retry-after ${sec}s`
                };
            }
        }

        let bodyText = '';
        try {
            bodyText = await response.clone().text();
        } catch {
            // Ignore clone failure
        }
        const lower = bodyText.toLowerCase();

        if (
            lower.includes('bad credentials') ||
            lower.includes('not accessible') ||
            lower.includes('must have admin rights')
        ) {
            return { retryable: false, isPrimaryRateLimit: false, delayMs: 0 };
        }

        const remaining = response.headers.get('x-ratelimit-remaining');
        const isPrimary =
            remaining === '0' ||
            lower.includes('api rate limit exceeded') ||
            lower.includes('rate limit exceeded');

        if (isPrimary) {
            let resetMs = 0;
            const resetHeader = response.headers.get('x-ratelimit-reset');
            if (resetHeader !== null) {
                const sec = Number(resetHeader);
                if (Number.isFinite(sec) && sec > 0) {
                    resetMs = sec * 1000;
                }
            }

            if (resetMs <= Date.now()) {
                if (this.lastKnownResetMs > Date.now()) {
                    resetMs = this.lastKnownResetMs;
                } else {
                    const fetched = await this.fetchRateLimitReset();
                    if (fetched && fetched > 0) {
                        resetMs = fetched;
                        this.lastKnownResetMs = fetched;
                    }
                }
            }

            if (resetMs > 0) {
                const waitMs = resetMs - Date.now();
                // Match Keiyoushi's rate limit strategy:
                // sleep for the whole duration until reset plus 10 seconds safety buffer (base delay 60s)
                const bufferMs = waitMs > 5000 ? 10_000 : 1000;
                const baseDelayMs = waitMs > 5000 ? 60_000 : 1000;
                const delayMs = Math.max(waitMs + bufferMs, baseDelayMs);
                return {
                    retryable: true,
                    isPrimaryRateLimit: true,
                    delayMs,
                    reason: `primary rate limit resets in ${Math.ceil(delayMs / 1000)}s`
                };
            }

            const delayMs = Math.max(Math.min(60_000 * 2 ** (attempt - 1), 300_000), 60_000);
            return {
                retryable: true,
                isPrimaryRateLimit: true,
                delayMs,
                reason: 'primary rate limit (backoff)'
            };
        }

        // Secondary / abuse rate limits: match Keiyoushi's base delay of 60s doubling per attempt
        const delayMs = Math.min(60_000 * 2 ** (attempt - 1), 240_000);
        return {
            retryable: true,
            isPrimaryRateLimit: false,
            delayMs,
            reason: status === 429 ? 'HTTP 429' : 'secondary rate limit'
        };
    }

    private async request(url: string, init: RequestInit = {}, label?: string): Promise<Response> {
        const headers = new Headers(init.headers);
        if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json');
        headers.set('Authorization', `Bearer ${this.token}`);
        headers.set('X-GitHub-Api-Version', '2022-11-28');

        const method = init.method ?? 'GET';
        const operation = label ?? `${method} ${url}`;

        let primaryRateLimitWaits = 0;
        const maxPrimaryRateLimitWaits = 5;

        for (let attempt = 1; ; attempt += 1) {
            if (this.rateLimitedUntil > Date.now()) {
                const waitMs = this.rateLimitedUntil - Date.now();
                if (waitMs > 50) {
                    const jitter = Math.floor(Math.random() * 500);
                    const totalWait = waitMs + jitter;
                    console.warn(
                        `Rate limit active across client. Pausing ${Math.ceil(totalWait / 1000)}s before next request (${operation})...`
                    );
                    await sleep(totalWait);
                }
            }

            let response: Response;
            try {
                response = await this.fetcher(url, { ...init, headers });
            } catch (networkError) {
                if (attempt >= this.maxAttempts) {
                    throw networkError;
                }
                const delay = Math.min(1000 * 2 ** attempt, 30_000);
                console.warn(
                    `Network error for ${operation}: ${networkError instanceof Error ? networkError.message : String(networkError)}. Retrying in ${delay}ms (attempt ${attempt}/${this.maxAttempts})...`
                );
                await sleep(delay);
                continue;
            }

            this.inspectHeaders(response);

            const decision = await this.evaluateRetry(response, attempt);
            if (!decision.retryable) {
                return response;
            }

            if (decision.isPrimaryRateLimit) {
                primaryRateLimitWaits += 1;
                if (primaryRateLimitWaits > maxPrimaryRateLimitWaits) {
                    console.error(
                        `Exceeded maximum primary rate limit window waits (${maxPrimaryRateLimitWaits}) for ${operation}`
                    );
                    return response;
                }
                attempt -= 1;
            } else if (attempt >= this.maxAttempts) {
                return response;
            }

            const delay = decision.delayMs;
            this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + delay);

            console.warn(
                `Retrying ${operation} in ${delay}ms (${decision.isPrimaryRateLimit ? `rate-limit wait ${primaryRateLimitWaits}/${maxPrimaryRateLimitWaits}` : `attempt ${attempt}/${this.maxAttempts}`}, status ${response.status}${decision.reason ? `: ${decision.reason}` : ''})`
            );
            await sleep(delay);
        }
    }

    private async json(response: Response): Promise<JsonValue> {
        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`GitHub API failed (${response.status}): ${detail.slice(0, 500)}`);
        }
        try {
            const value: JsonValue = JSON.parse(await response.text());
            return value;
        } catch {
            throw new Error(`Invalid GitHub API JSON response (${response.status})`);
        }
    }

    private release(value: JsonValue): ReleaseInfo {
        const record = requiredObject(value, 'release');
        const assets = requiredArray(record.assets ?? [], 'release assets');
        return {
            id: requiredNumber(record.id, 'release id'),
            tag: requiredString(record.tag_name, 'release tag'),
            targetCommitish: requiredString(record.target_commitish, 'release target commit'),
            draft: record.draft === true,
            uploadUrl: requiredString(record.upload_url, 'release upload URL'),
            assets: assets.map((assetValue) => {
                const assetRecord = requiredObject(assetValue, 'release asset');
                const asset: ReleaseAssetInfo = {
                    id: requiredNumber(assetRecord.id, 'release asset id'),
                    name: requiredString(assetRecord.name, 'release asset name'),
                    url: requiredString(assetRecord.url, 'release asset API URL')
                };
                if (isString(assetRecord.digest)) asset.digest = assetRecord.digest;
                return asset;
            })
        };
    }

    async currentMainSha(): Promise<string> {
        const response = await this.request(
            this.api(`/commits/${encodeURIComponent(config.github.branch)}`)
        );
        const value = requiredObject(await this.json(response), 'commit');
        return requiredString(value.sha, 'commit SHA');
    }

    async listReleases(): Promise<ReleaseInfo[]> {
        const releases: ReleaseInfo[] = [];
        for (let page = 1; ; page += 1) {
            const response = await this.request(this.api(`/releases?per_page=100&page=${page}`));
            const values = requiredArray(await this.json(response), 'releases');
            releases.push(...values.map((value) => this.release(value)));
            if (values.length < 100) return releases;
        }
    }

    async getRelease(tag: string): Promise<ReleaseInfo | null> {
        const response = await this.request(this.api(`/releases/tags/${encodeURIComponent(tag)}`));
        if (response.status === 404) {
            return (await this.listReleases()).find((release) => release.tag === tag) ?? null;
        }
        return this.release(await this.json(response));
    }

    async getTagCommit(tag: string): Promise<string | null> {
        let response = await this.request(this.api(`/git/ref/tags/${encodeURIComponent(tag)}`));
        if (response.status === 404) return null;
        let value = requiredObject(await this.json(response), 'tag reference');
        let object = requiredObject(value.object, 'tag reference target');
        for (let depth = 0; depth < 4; depth += 1) {
            const type = requiredString(object.type, 'tag target type');
            const sha = requiredString(object.sha, 'tag target SHA');
            if (type === 'commit') return sha;
            if (type !== 'tag') throw new Error(`Unexpected tag target type for ${tag}`);
            response = await this.request(this.api(`/git/tags/${sha}`));
            value = requiredObject(await this.json(response), 'annotated tag');
            object = requiredObject(value.object, 'annotated tag target');
        }
        throw new Error(`Tag nesting is too deep: ${tag}`);
    }

    async downloadAsset(asset: ReleaseAssetInfo): Promise<Uint8Array> {
        const response = await this.request(asset.url, {
            headers: { Accept: 'application/octet-stream' }
        });
        if (!response.ok)
            throw new Error(`Release asset download failed (${response.status}): ${asset.name}`);
        return new Uint8Array(await response.arrayBuffer());
    }

    async createDraft(tag: string, targetSha: string): Promise<ReleaseInfo> {
        const response = await this.request(this.api('/releases'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tag_name: tag,
                target_commitish: targetSha,
                name: tag,
                body: `Mirrored extension artifacts for ${targetSha}.`,
                draft: true,
                prerelease: false
            })
        });
        return this.release(await this.json(response));
    }

    async uploadAsset(release: ReleaseInfo, name: string, path: string): Promise<void> {
        const uploadUrl = release.uploadUrl.replace(/\{.*$/, '');
        const url = new URL(uploadUrl);
        url.searchParams.set('name', name);
        const bytes = await readFile(path);
        const body = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(body).set(bytes);
        const response = await this.request(
            url.toString(),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body
            },
            `upload of ${name}`
        );
        if (response.status === 422) {
            try {
                const text = await response.clone().text();
                if (text.includes('already_exists')) {
                    console.warn(
                        `Asset ${name} already exists in ${release.tag}, skipping upload.`
                    );
                    return;
                }
            } catch {
                // Ignore clone/read failure
            }
        }
        await this.json(response);
    }

    async ensureTagRef(tag: string, sha: string): Promise<void> {
        const existing = await this.getTagCommit(tag);
        if (existing) {
            if (existing.toLowerCase() !== sha.toLowerCase()) {
                throw new Error(`Conflicting tag ${tag} points at ${existing}, expected ${sha}`);
            }
            return;
        }
        const response = await this.request(this.api('/git/refs'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ref: `refs/tags/${tag}`,
                sha
            })
        });
        if (response.status !== 201) {
            const detail = await response.text();
            const current = await this.getTagCommit(tag);
            if (!current || current.toLowerCase() !== sha.toLowerCase()) {
                throw new Error(
                    `Failed to create tag ref refs/tags/${tag} (${response.status}): ${detail.slice(0, 500)}`
                );
            }
        }
    }

    async publishDraft(release: ReleaseInfo): Promise<void> {
        await this.ensureTagRef(release.tag, release.targetCommitish);
        const response = await this.request(this.api(`/releases/${release.id}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tag_name: release.tag,
                target_commitish: release.targetCommitish,
                draft: false
            })
        });
        await this.json(response);
    }

    async deleteAsset(assetId: number): Promise<void> {
        const response = await this.request(this.api(`/releases/assets/${assetId}`), {
            method: 'DELETE'
        });
        if (!response.ok && response.status !== 404) {
            const detail = await response.text();
            throw new Error(
                `Failed to delete asset ${assetId} (${response.status}): ${detail.slice(0, 500)}`
            );
        }
    }

    async deleteRelease(releaseId: number): Promise<void> {
        const response = await this.request(this.api(`/releases/${releaseId}`), {
            method: 'DELETE'
        });
        if (!response.ok && response.status !== 404) {
            const detail = await response.text();
            throw new Error(
                `Failed to delete release ${releaseId} (${response.status}): ${detail.slice(0, 500)}`
            );
        }
    }

    async deleteTagRef(tag: string): Promise<void> {
        const response = await this.request(this.api(`/git/refs/tags/${encodeURIComponent(tag)}`), {
            method: 'DELETE'
        });
        if (!response.ok && response.status !== 404) {
            const detail = await response.text();
            throw new Error(
                `Failed to delete tag ref ${tag} (${response.status}): ${detail.slice(0, 500)}`
            );
        }
    }
}
