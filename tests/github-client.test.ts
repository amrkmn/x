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
    expect(calls).toBe(5);
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
