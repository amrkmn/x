import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { config } from './config';
import { env } from './env';
import { GitHubReleaseClient } from './releases/github-client';
import {
    batchArtifacts,
    identity,
    MANIFEST_NAME,
    manifestAsset,
    manifestRecord,
    previousCompleteRelease,
    releaseUrl,
    serializeManifest,
    sha256,
    sourcePrefix,
    verifyReleaseAssets
} from './releases/manifest';
import { discoverCandidates } from './releases/sources';
import type {
    Candidate,
    HashedArtifact,
    PublishOptions,
    ReleaseInfo,
    ReleaseManifest
} from './releases/types';
import type { ExtensionConfig } from './types';
import { parseExtensionsData } from './validation';

export {
    batchArtifacts,
    MAX_BINARIES_PER_RELEASE,
    parseReleaseManifest
} from './releases/manifest';
export { discoverCandidates } from './releases/sources';
export type {
    ArtifactKind,
    Candidate,
    HashedArtifact,
    PublishOptions,
    ReleaseAsset,
    ReleaseAssetInfo,
    ReleaseClient,
    ReleaseInfo,
    ReleaseManifest
} from './releases/types';

const execFileAsync = promisify(execFile);

const gitExec = (args: string[]) =>
    execFileAsync('git', args, { env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });

export async function isExtensionsModified(
    commit: string,
    baseCommit?: string
): Promise<boolean | null> {
    try {
        if (baseCommit) {
            const { stdout } = await gitExec([
                'diff',
                '--name-only',
                baseCommit,
                commit,
                '--',
                'extensions.json'
            ]);
            return stdout.trim().length > 0;
        }
        const { stdout } = await gitExec([
            'diff-tree',
            '--no-commit-id',
            '--name-only',
            '-r',
            commit
        ]);
        const files = stdout
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);
        return files.includes('extensions.json');
    } catch {
        return null;
    }
}

export async function getExtensionsCommitCount(commit: string): Promise<number | null> {
    try {
        const { stdout } = await gitExec(['rev-list', '--count', commit, '--', 'extensions.json']);
        const count = parseInt(stdout.trim(), 10);
        return Number.isFinite(count) ? count : null;
    } catch {
        return null;
    }
}

export async function detectChangedSources(
    currentData: Record<string, Record<string, ExtensionConfig>>,
    baseCommit?: string
): Promise<Set<string> | null> {
    if (!baseCommit) return null;
    try {
        const { stdout } = await gitExec(['show', `${baseCommit}:extensions.json`]);
        const previousData = parseExtensionsData(JSON.parse(stdout));
        const changed = new Set<string>();
        for (const [category, extensions] of Object.entries(currentData)) {
            for (const [key, ext] of Object.entries(extensions)) {
                const prev = previousData[category]?.[key];
                if (!prev || prev.commit !== ext.commit) {
                    changed.add(key);
                }
            }
        }
        return changed;
    } catch {
        return null;
    }
}

async function runConcurrent<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];
    const results: R[] = Array.from({ length: items.length });
    let currentIndex = 0;
    const workerCount = Math.min(limit, items.length);

    const workers = Array.from({ length: workerCount }, async () => {
        while (currentIndex < items.length) {
            const index = currentIndex++;
            results[index] = await fn(items[index], index);
        }
    });

    await Promise.all(workers);
    return results;
}

export function releaseTag(commitCount: number, batchIndex: number): string {
    return `v0.${commitCount}.${batchIndex}`;
}

function recordManifestAsset(
    manifest: ReleaseManifest,
    candidate: Candidate,
    name: string,
    sha256: string,
    url: string
): void {
    ((manifest[candidate.source] ??= {})[candidate.packageName] ??= {})[candidate.kind] =
        manifestRecord(candidate, name, sha256, url);
}

async function stageBatch(
    client: PublishOptions['client'],
    tag: string,
    commit: string,
    expected: Map<string, { sha256: string; path: string }>
): Promise<{ release: ReleaseInfo; draft: boolean }> {
    let release = await client.getRelease(tag);
    const tagCommit = await client.getTagCommit(tag);
    if (tagCommit && tagCommit.toLowerCase() !== commit.toLowerCase()) {
        throw new Error(`Conflicting tag ${tag} points at ${tagCommit}, expected ${commit}`);
    }
    if (
        release &&
        !tagCommit &&
        (!release.draft || release.targetCommitish.toLowerCase() !== commit.toLowerCase())
    ) {
        throw new Error(`Release ${tag} exists without a matching tag target`);
    }

    if (!release) release = await client.createDraft(tag, commit);
    const missing = await verifyReleaseAssets(client, release, expected, release.draft);
    if (release.draft) {
        console.info(`Uploading ${missing.length} assets to ${tag}`);
        for (const name of missing) {
            await client.uploadAsset(release, name, expected.get(name)!.path);
        }
        release = (await client.getRelease(tag)) ?? release;
        await verifyReleaseAssets(client, release, expected, false);
    }
    return { release, draft: release.draft };
}

export async function publishReleases(
    options: PublishOptions
): Promise<{ binaries: number; releases: number }> {
    const owner = options.owner ?? config.github.owner;
    const repo = options.repo ?? config.github.repo;
    const commit = options.commit.toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(commit))
        throw new Error(`Invalid publishing commit: ${options.commit}`);

    const assertCurrentMain = async (): Promise<void> => {
        const currentMainSha = (await options.client.currentMainSha()).toLowerCase();
        if (currentMainSha !== commit) {
            throw new Error(
                `Stale publisher event: ${commit} is not current main (${currentMainSha})`
            );
        }
    };
    await assertCurrentMain();

    const releases = await options.client.listReleases();
    const previousInfo = await previousCompleteRelease(releases, options.client, owner, repo);
    const previous = previousInfo?.manifest ?? {};
    const previousCommit = previousInfo?.release.targetCommitish;

    const isManualDispatch = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
    const extensionsModified =
        options.commitCount !== undefined || isManualDispatch
            ? true
            : await isExtensionsModified(commit, previousCommit);
    if (extensionsModified === false) {
        console.info(
            `Skipping release publishing: extensions.json was not modified between ${previousCommit ?? 'initial'} and ${commit}`
        );
        return { binaries: 0, releases: 0 };
    }

    const commitCount = options.commitCount ?? (await getExtensionsCommitCount(commit)) ?? 1;

    const detectedChanged =
        options.changedSources !== undefined
            ? new Set(options.changedSources)
            : await detectChangedSources(options.data, previousCommit);

    const current: ReleaseManifest = {};

    // For any source whose commit didn't change, carry over previous manifest entries directly
    if (detectedChanged) {
        for (const extensions of Object.values(options.data)) {
            for (const key of Object.keys(extensions)) {
                if (!detectedChanged.has(key) && previous[key]) {
                    current[key] = JSON.parse(JSON.stringify(previous[key]));
                }
            }
        }
    }

    const candidates = await discoverCandidates(
        options.data,
        options.fetcher,
        detectedChanged ?? undefined
    );
    console.info(`Discovered ${candidates.length} candidates`);
    const tempDir = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'x-releases-'));

    try {
        const changed: HashedArtifact[] = [];
        const names = new Set<string>();
        let verified = 0;
        const progress = (index: number): void => {
            if ((index + 1) % 100 === 0 || index + 1 === candidates.length) {
                console.info(
                    `Checked ${index + 1}/${candidates.length} artifacts (${changed.length} new, ${verified} checksum-verified)`
                );
            }
        };

        const toDownload: Array<{
            candidate: Candidate;
            index: number;
        }> = [];

        for (const [index, candidate] of candidates.entries()) {
            const old = manifestAsset(
                previous,
                candidate.source,
                candidate.packageName,
                candidate.kind
            );

            const recordUnchanged = (sha: string) => {
                recordManifestAsset(current, candidate, old!.name, sha, old!.url);
                verified += 1;
                progress(index);
            };

            if (candidate.upstreamSha256 && old?.sha256 === candidate.upstreamSha256) {
                recordUnchanged(old.sha256);
                continue;
            }

            toDownload.push({ candidate, index });
        }

        const concurrency = options.concurrency ?? 20;
        const downloaded = await runConcurrent(
            toDownload,
            concurrency,
            async ({ candidate, index }) => {
                const position = `${index + 1}/${candidates.length}`;
                let response;
                try {
                    response = await (options.fetcher ?? fetch)(candidate.downloadUrl);
                } catch (error) {
                    throw new Error(
                        `Artifact download failed [${position}]: ${candidate.downloadUrl} (${error instanceof Error ? error.message : error})`
                    );
                }
                if (!response.ok)
                    throw new Error(
                        `Artifact download failed (${response.status}) [${position}]: ${candidate.downloadUrl}`
                    );
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.byteLength === 0)
                    throw new Error(`Empty artifact: ${candidate.downloadUrl}`);
                const hash = sha256(bytes);
                if (candidate.upstreamSha256 && candidate.upstreamSha256 !== hash) {
                    throw new Error(
                        `Upstream checksum mismatch: ${candidate.source}/${candidate.packageName}/${candidate.kind}`
                    );
                }

                return { candidate, index, bytes, hash };
            }
        );

        for (const { candidate, index, bytes, hash } of downloaded) {
            const old = manifestAsset(
                previous,
                candidate.source,
                candidate.packageName,
                candidate.kind
            );

            if (old?.sha256 === hash) {
                recordManifestAsset(current, candidate, old.name, hash, old.url);
                verified += 1;
                progress(index);
                continue;
            }

            const name = `${sourcePrefix(candidate.source)}-${candidate.upstreamName}`;
            if (names.has(name)) throw new Error(`Ambiguous release asset name: ${name}`);
            names.add(name);
            const filePath = join(tempDir, `${index}.asset`);
            await writeFile(filePath, bytes);
            changed.push({ ...candidate, name, sha256: hash, filePath });
            progress(index);
        }

        changed.sort((left, right) => identity(left).localeCompare(identity(right)));
        const batches = batchArtifacts(changed);

        for (const [batchIndex, batch] of batches.entries()) {
            const tag = releaseTag(commitCount, batchIndex);
            for (const artifact of batch) {
                recordManifestAsset(
                    current,
                    artifact,
                    artifact.name,
                    artifact.sha256,
                    releaseUrl(owner, repo, tag, artifact.name)
                );
            }
        }

        if (changed.length === 0) {
            await assertCurrentMain();
            return { binaries: 0, releases: 0 };
        }

        await assertCurrentMain();
        const manifestPath = join(tempDir, MANIFEST_NAME);
        await writeFile(manifestPath, serializeManifest(current));
        const manifestHash = sha256(new Uint8Array(await readFile(manifestPath)));
        const staged: Array<{ release: ReleaseInfo; draft: boolean }> = [];

        for (const [batchIndex, batch] of batches.entries()) {
            const tag = releaseTag(commitCount, batchIndex);
            console.info(
                `Staging release ${tag} (batch ${batchIndex + 1}/${batches.length}, ${batch.length} binaries)`
            );
            const expected = new Map<string, { sha256: string; path: string }>();
            for (const artifact of batch) {
                expected.set(artifact.name, {
                    sha256: artifact.sha256,
                    path: artifact.filePath
                });
            }
            expected.set(MANIFEST_NAME, {
                sha256: manifestHash,
                path: manifestPath
            });
            staged.push(await stageBatch(options.client, tag, commit, expected));
        }

        await assertCurrentMain();
        for (const stagedRelease of staged) {
            if (stagedRelease.draft) {
                await options.client.publishDraft(stagedRelease.release);
                console.info(`Published ${stagedRelease.release.tag}`);
            }
        }
        return { binaries: changed.length, releases: batches.length };
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

export async function runPublisher(): Promise<void> {
    const token = env.GITHUB_TOKEN;
    const commit = env.GITHUB_SHA;
    const ref = env.GITHUB_REF;
    if (!token) throw new Error('GITHUB_TOKEN is required');
    if (!commit) throw new Error('GITHUB_SHA is required');
    if (ref !== `refs/heads/${config.github.branch}`) {
        throw new Error(`Publisher only runs on ${config.github.branch}`);
    }

    const data = parseExtensionsData(JSON.parse(await readFile('extensions.json', 'utf8')));
    const client = new GitHubReleaseClient(token, config.github.owner, config.github.repo);
    const result = await publishReleases({ data, commit, client });
    console.info(
        `Release publisher complete: ${result.binaries} binaries, ${result.releases} releases`
    );
}
