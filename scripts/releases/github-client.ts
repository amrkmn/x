import { readFile } from 'node:fs/promises';

import type { JsonValue } from '../../src/lib/validation';
import { config } from '../config';
import { isString, requiredArray, requiredNumber, requiredObject, requiredString } from './json';
import type { ReleaseAssetInfo, ReleaseClient, ReleaseInfo } from './types';

const DEFAULT_MAX_ATTEMPTS = 8;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function isRetryable(response: Response): Promise<boolean> {
    const status = response.status;
    if (status === 429 || (status >= 500 && status <= 504)) {
        return true;
    }
    if (status === 403) {
        if (response.headers.get('retry-after') !== null) return true;
        if (response.headers.get('x-ratelimit-remaining') === '0') return true;
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining !== null && Number(remaining) > 0) {
            return false;
        }
        try {
            const body = await response.clone().text();
            const lower = body.toLowerCase();
            if (
                lower.includes('rate limit') ||
                lower.includes('secondary rate limit') ||
                lower.includes('abuse')
            ) {
                return true;
            }
            if (lower.includes('bad credentials') || lower.includes('not accessible')) {
                return false;
            }
        } catch {
            // Ignore clone/read failure
        }
        return true;
    }
    return false;
}

function calculateRetryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
    if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        if (Number.isFinite(reset) && reset > 0) {
            const delay = reset * 1000 - Date.now() + 1000;
            return Math.max(delay, 1000);
        }
    }
    // For 403 secondary/abuse rate limits or 429, allow up to 120s backoff
    const maxBackoff = response.status === 403 || response.status === 429 ? 120_000 : 60_000;
    return Math.min(1000 * 2 ** attempt, maxBackoff);
}

export class GitHubReleaseClient implements ReleaseClient {
    private rateLimitedUntil = 0;

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

    private updateRateLimit(response: Response, delayMs = 0): void {
        if (delayMs > 0) {
            this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + delayMs);
            return;
        }
        if (response.headers.get('x-ratelimit-remaining') === '0') {
            const reset = Number(response.headers.get('x-ratelimit-reset'));
            if (Number.isFinite(reset) && reset > 0) {
                const delay = reset * 1000 - Date.now() + 1000;
                if (delay > 0) {
                    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + delay);
                }
            }
        }
    }

    private async request(url: string, init: RequestInit = {}, label?: string): Promise<Response> {
        const headers = new Headers(init.headers);
        if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json');
        headers.set('Authorization', `Bearer ${this.token}`);
        headers.set('X-GitHub-Api-Version', '2022-11-28');

        const method = init.method ?? 'GET';
        const operation = label ?? `${method} ${url}`;

        for (let attempt = 1; ; attempt += 1) {
            if (this.rateLimitedUntil > Date.now()) {
                const waitMs = this.rateLimitedUntil - Date.now();
                console.warn(
                    `Rate limit active across client. Pausing ${Math.ceil(waitMs / 1000)}s before next request (${operation})...`
                );
                await sleep(waitMs);
            }

            const response = await this.fetcher(url, { ...init, headers });

            const retryable = await isRetryable(response);
            if (!retryable || attempt >= this.maxAttempts) {
                this.updateRateLimit(response);
                return response;
            }

            const delay = calculateRetryDelay(response, attempt);
            this.updateRateLimit(response, delay);

            console.warn(
                `Retrying ${operation} in ${delay}ms (attempt ${attempt}/${this.maxAttempts}, status ${response.status})`
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
