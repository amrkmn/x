import { readFile } from 'node:fs/promises';

import type { JsonValue } from '../../src/lib/validation';
import { config } from '../config';
import { isString, requiredArray, requiredNumber, requiredObject, requiredString } from './json';
import type { ReleaseAssetInfo, ReleaseClient, ReleaseInfo } from './types';

const UPLOAD_ATTEMPTS = 5;
const RETRYABLE_UPLOAD_STATUSES = new Set([403, 429, 500, 502, 503, 504]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function uploadRetryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
    if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        if (Number.isFinite(reset) && reset > 0) return Math.max(reset * 1000 - Date.now(), 1000);
    }
    return Math.min(1000 * 2 ** attempt, 60_000);
}

export class GitHubReleaseClient implements ReleaseClient {
    constructor(
        private readonly token: string,
        private readonly owner: string,
        private readonly repo: string,
        private readonly fetcher: typeof fetch = fetch
    ) {}

    private api(path: string): string {
        return `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
    }

    private async request(url: string, init: RequestInit = {}): Promise<Response> {
        const headers = new Headers(init.headers);
        if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json');
        headers.set('Authorization', `Bearer ${this.token}`);
        headers.set('X-GitHub-Api-Version', '2022-11-28');
        return this.fetcher(url, { ...init, headers });
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
        for (let attempt = 1; ; attempt += 1) {
            const response = await this.request(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body
            });
            if (!RETRYABLE_UPLOAD_STATUSES.has(response.status) || attempt >= UPLOAD_ATTEMPTS) {
                await this.json(response);
                return;
            }
            await response.text();
            const delay = uploadRetryDelay(response, attempt);
            console.warn(`Retrying upload of ${name} in ${delay}ms (status ${response.status})`);
            await sleep(delay);
        }
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
