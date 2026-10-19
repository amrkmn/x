import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { config } from './config';
import { GitHubReleaseClient } from './releases/github-client';
import {
    MANIFEST_NAME,
    batchArtifacts,
    identity,
    manifestAsset,
    manifestRecord,
    previousCompleteManifest,
    releaseUrl,
    serializeManifest,
    sha256,
    sourcePrefix,
    verifyReleaseAssets
} from './releases/manifest';
import { discoverCandidates } from './releases/sources';
import type {
    HashedArtifact,
    PublishOptions,
    ReleaseInfo,
    ReleaseManifest
} from './releases/types';
import { parseExtensionsData } from './validation';

export {
    MAX_BINARIES_PER_RELEASE,
    batchArtifacts,
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
    const previous = await previousCompleteManifest(releases, options.client, owner, repo);
    const candidates = await discoverCandidates(options.data, options.fetcher);
    console.info(`Discovered ${candidates.length} candidates`);
    const tempDir = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'x-releases-'));

    try {
        const current: ReleaseManifest = {};
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

        for (const [index, candidate] of candidates.entries()) {
            const position = `${index + 1}/${candidates.length}`;
            const old = manifestAsset(
                previous,
                candidate.source,
                candidate.packageName,
                candidate.kind
            );
            if (candidate.upstreamSha256 && old?.sha256 === candidate.upstreamSha256) {
                current[candidate.source] ??= {};
                current[candidate.source][candidate.packageName] ??= {};
                current[candidate.source][candidate.packageName][candidate.kind] = manifestRecord(
                    candidate,
                    old.name,
                    old.sha256,
                    old.url
                );
                verified += 1;
                progress(index);
                continue;
            }
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
            if (bytes.byteLength === 0) throw new Error(`Empty artifact: ${candidate.downloadUrl}`);
            const hash = sha256(bytes);
            if (candidate.upstreamSha256 && candidate.upstreamSha256 !== hash) {
                throw new Error(
                    `Upstream checksum mismatch: ${candidate.source}/${candidate.packageName}/${candidate.kind}`
                );
            }

            if (old?.sha256 === hash) {
                current[candidate.source] ??= {};
                current[candidate.source][candidate.packageName] ??= {};
                current[candidate.source][candidate.packageName][candidate.kind] = manifestRecord(
                    candidate,
                    old.name,
                    hash,
                    old.url
                );
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
        const shortSha = commit.slice(0, 7);
        const batches = batchArtifacts(changed);

        for (const [batchIndex, batch] of batches.entries()) {
            const tag = `${shortSha}-${batchIndex}`;
            for (const artifact of batch) {
                const record = manifestRecord(
                    artifact,
                    artifact.name,
                    artifact.sha256,
                    releaseUrl(owner, repo, tag, artifact.name)
                );
                current[artifact.source] ??= {};
                current[artifact.source][artifact.packageName] ??= {};
                current[artifact.source][artifact.packageName][artifact.kind] = record;
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
            const tag = `${shortSha}-${batchIndex}`;
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
    const token = process.env.GITHUB_TOKEN;
    const commit = process.env.GITHUB_SHA;
    const ref = process.env.GITHUB_REF;
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

if (import.meta.main) {
    try {
        await runPublisher();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
