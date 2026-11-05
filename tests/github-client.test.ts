import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { GitHubReleaseClient } from '../scripts/releases/github-client';
import type { ReleaseInfo } from '../scripts/releases/types';

const release: ReleaseInfo = {
    id: 1,
    tag: 'v0.1.0',
    targetCommitish: 'a'.repeat(40),
    draft: true,
    uploadUrl: 'https://uploads.example/repos/owner/repo/releases/1/assets{?name,label}',
    assets: []
};

const directories: string[] = [];

async function assetPath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'github-client-'));
    directories.push(directory);
    const path = join(directory, 'org.example.apk');
    await writeFile(path, 'apk bytes');
    return path;
}

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
});

test('retries a rate-limited asset upload until it succeeds', async () => {
    const path = await assetPath();
    const statuses = [403, 201];
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
        calls.push(String(input));
        const status = statuses.shift() ?? 201;
        if (status === 201) return Response.json({ id: 1, name: 'org.example.apk' }, { status });
        return new Response('secondary rate limit', {
            status,
            headers: { 'retry-after': '0' }
        });
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await client.uploadAsset(release, 'org.example.apk', path);

    const expectedUrl =
        'https://uploads.example/repos/owner/repo/releases/1/assets?name=org.example.apk';
    expect(calls).toEqual([expectedUrl, expectedUrl]);
});

test('gives up after bounded retries while rate limited', async () => {
    const path = await assetPath();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
        calls += 1;
        return new Response('secondary rate limit', {
            status: 429,
            headers: { 'retry-after': '0' }
        });
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await expect(client.uploadAsset(release, 'org.example.apk', path)).rejects.toThrow(
        'GitHub API failed (429)'
    );
    expect(calls).toBe(8);
});

test('fails immediately on a non-retryable upload error', async () => {
    const path = await assetPath();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
        calls += 1;
        return new Response('unprocessable', { status: 422 });
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await expect(client.uploadAsset(release, 'org.example.apk', path)).rejects.toThrow(
        'GitHub API failed (422)'
    );
    expect(calls).toBe(1);
});

test('retries rate-limited deleteAsset until it succeeds', async () => {
    const statuses = [403, 204];
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
        calls.push(String(input));
        const status = statuses.shift() ?? 204;
        if (status === 204) return new Response(null, { status });
        return new Response('API rate limit exceeded', {
            status,
            headers: { 'retry-after': '0' }
        });
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await client.deleteAsset(12345);

    const expectedUrl = 'https://api.github.com/repos/owner/repo/releases/assets/12345';
    expect(calls).toEqual([expectedUrl, expectedUrl]);
});

test('retries rate-limited deleteRelease until it succeeds', async () => {
    const statuses = [429, 204];
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
        calls.push(String(input));
        const status = statuses.shift() ?? 204;
        if (status === 204) return new Response(null, { status });
        return new Response('Too many requests', {
            status,
            headers: { 'retry-after': '0' }
        });
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await client.deleteRelease(999);

    const expectedUrl = 'https://api.github.com/repos/owner/repo/releases/999';
    expect(calls).toEqual([expectedUrl, expectedUrl]);
});

test('pauses subsequent requests when rate limited across client', async () => {
    const resetTimeSec = Math.floor(Date.now() / 1000) + 1;
    let callCount = 0;
    const timestamps: number[] = [];
    const fetcher: typeof fetch = async () => {
        callCount += 1;
        timestamps.push(Date.now());
        if (callCount === 1) {
            return new Response('rate limit', {
                status: 403,
                headers: {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': String(resetTimeSec)
                }
            });
        }
        return new Response(null, { status: 204 });
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await client.deleteAsset(1);
    expect(callCount).toBe(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(900);
});

test('queries /rate_limit when uploads.github.com returns 403 without reset headers', async () => {
    const path = await assetPath();
    const resetTimeSec = Math.floor(Date.now() / 1000) + 1;
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url === 'https://api.github.com/rate_limit') {
            return new Response(
                JSON.stringify({
                    resources: {
                        core: {
                            limit: 5000,
                            used: 5000,
                            remaining: 0,
                            reset: resetTimeSec
                        }
                    }
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
        if (calls.filter((c) => c.includes('uploads.example')).length === 1) {
            // uploads.github.com returns 403 without x-ratelimit headers
            return new Response(
                JSON.stringify({
                    message:
                        'API rate limit exceeded for user ID 85985879. If you reach out to GitHub Support for help, please include the request ID...',
                    documentation_url: 'https://docs.github.com/en/rest'
                }),
                {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
        return Response.json({ id: 1, name: 'org.example.apk' }, { status: 201 });
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await client.uploadAsset(release, 'org.example.apk', path);

    const uploadUrl =
        'https://uploads.example/repos/owner/repo/releases/1/assets?name=org.example.apk';
    expect(calls).toEqual([uploadUrl, 'https://api.github.com/rate_limit', uploadUrl]);
});

test('skips upload gracefully if asset already exists on retry (422 already_exists)', async () => {
    const path = await assetPath();
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
        calls.push(String(input));
        return new Response(
            JSON.stringify({
                message: 'Validation Failed',
                errors: [{ resource: 'ReleaseAsset', code: 'already_exists', field: 'name' }]
            }),
            {
                status: 422,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    };
    const client = new GitHubReleaseClient('token', 'owner', 'repo', fetcher);

    await client.uploadAsset(release, 'org.example.apk', path);

    expect(calls.length).toBe(1);
});
