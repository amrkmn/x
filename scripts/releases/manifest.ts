import { createHash } from 'node:crypto';

import type { JsonValue } from '../../src/lib/validation';
import { isRecord, isString, optionalUrl, requiredString } from './json';
import type {
    ArtifactKind,
    Candidate,
    ReleaseAsset,
    ReleaseAssetInfo,
    ReleaseClient,
    ReleaseInfo,
    ReleaseManifest
} from './types';

export const MANIFEST_NAME = 'release-assets.json';
export const MAX_BINARIES_PER_RELEASE = 999;

interface ReleaseDownloadPath {
    tag: string;
    name: string;
}

export function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export function batchArtifacts<T>(items: T[], limit = MAX_BINARIES_PER_RELEASE): T[][] {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid batch size: ${limit}`);
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += limit) {
        batches.push(items.slice(index, index + limit));
    }
    return batches;
}

export function sourcePrefix(source: string): string {
    return source.replaceAll('/', '-');
}

export function identity(candidate: Pick<Candidate, 'source' | 'packageName' | 'kind'>): string {
    return JSON.stringify([candidate.source, candidate.packageName, candidate.kind]);
}

export function manifestRecord(
    candidate: Candidate,
    name: string,
    hash: string,
    url: string
): ReleaseAsset {
    const record: ReleaseAsset = {
        name,
        sha256: hash,
        version: candidate.version,
        source: candidate.source,
        kind: candidate.kind,
        url
    };
    if (candidate.versionCode !== undefined) record.versionCode = candidate.versionCode;
    return record;
}

function canonicalManifest(manifest: ReleaseManifest) {
    const result: ReleaseManifest = {};
    for (const source of Object.keys(manifest).sort()) {
        const packages: ReleaseManifest[string] = {};
        for (const packageName of Object.keys(manifest[source]).sort()) {
            const kinds = manifest[source][packageName];
            const sortedKinds: Partial<Record<ArtifactKind, ReleaseAsset>> = {};
            for (const kind of ['apk', 'jar'] as const) {
                if (kinds[kind]) sortedKinds[kind] = kinds[kind];
            }
            packages[packageName] = sortedKinds;
        }
        result[source] = packages;
    }
    return result;
}

export function parseReleaseManifest(value: JsonValue): ReleaseManifest {
    if (!isRecord(value)) throw new Error('Invalid release-assets.json: expected object');
    const manifest: ReleaseManifest = {};
    for (const [source, sourceValue] of Object.entries(value)) {
        if (!isRecord(sourceValue)) throw new Error(`Invalid manifest source: ${source}`);
        manifest[source] = {};
        for (const [packageName, packageValue] of Object.entries(sourceValue)) {
            if (!isRecord(packageValue))
                throw new Error(`Invalid manifest package: ${source}/${packageName}`);
            const kinds: Partial<Record<ArtifactKind, ReleaseAsset>> = {};
            for (const kind of ['apk', 'jar'] as const) {
                const assetValue = packageValue[kind];
                if (assetValue === undefined) continue;
                if (!isRecord(assetValue))
                    throw new Error(`Invalid manifest asset: ${source}/${packageName}/${kind}`);
                const name = requiredString(assetValue.name, 'manifest asset name');
                const hash = requiredString(
                    assetValue.sha256,
                    'manifest asset SHA-256'
                ).toLowerCase();
                if (!/^[a-f0-9]{64}$/.test(hash))
                    throw new Error(`Invalid manifest SHA-256: ${source}/${packageName}/${kind}`);
                const url = requiredString(assetValue.url, 'manifest asset URL');
                optionalUrl(url, 'manifest asset URL');
                const versionValue = assetValue.version;
                const version = isString(versionValue)
                    ? versionValue
                    : versionValue !== undefined && Number.isFinite(versionValue)
                      ? String(versionValue)
                      : '';
                const versionCodeValue = assetValue.versionCode;
                let versionCode: number | string | undefined;
                if (isString(versionCodeValue)) versionCode = versionCodeValue;
                else if (versionCodeValue !== undefined && Number.isFinite(versionCodeValue)) {
                    versionCode = Number(versionCodeValue);
                }
                const declaredSource = requiredString(assetValue.source, 'manifest asset source');
                if (declaredSource !== source)
                    throw new Error(`Manifest source mismatch: ${source}/${packageName}/${kind}`);
                const declaredKind = requiredString(assetValue.kind, 'manifest asset kind');
                if (declaredKind !== kind)
                    throw new Error(`Manifest kind mismatch: ${source}/${packageName}/${kind}`);
                const asset: ReleaseAsset = {
                    name,
                    sha256: hash,
                    version,
                    source: declaredSource,
                    kind,
                    url
                };
                if (versionCode !== undefined) asset.versionCode = versionCode;
                kinds[kind] = asset;
            }
            if (Object.keys(kinds).length === 0)
                throw new Error(`Empty manifest package: ${source}/${packageName}`);
            manifest[source][packageName] = kinds;
        }
    }
    return canonicalManifest(manifest);
}

export function manifestAsset(
    manifest: ReleaseManifest,
    source: string,
    packageName: string,
    kind: ArtifactKind
) {
    return manifest[source]?.[packageName]?.[kind];
}

function parseReleaseAssetUrl(urlValue: string, owner: string, repo: string): ReleaseDownloadPath {
    const url = new URL(urlValue);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (
        url.origin !== 'https://github.com' ||
        parts.length !== 6 ||
        parts[0] !== owner ||
        parts[1] !== repo ||
        parts[2] !== 'releases' ||
        parts[3] !== 'download'
    ) {
        throw new Error(`Invalid release asset URL: ${urlValue}`);
    }
    return { tag: parts[4], name: parts[5] };
}

function isPublisherTag(tag: string): boolean {
    return /^v0\.\d+\.\d+$/i.test(tag) || /^[a-f0-9]{7}(-\d+)?$/i.test(tag);
}

export async function previousCompleteManifest(
    releases: ReleaseInfo[],
    client: ReleaseClient,
    owner: string,
    repo: string
): Promise<ReleaseManifest> {
    // The /releases listing is not guaranteed chronological; newest first.
    const ordered = [...releases].sort((left, right) => right.id - left.id);
    const byTag = new Map(ordered.map((release) => [release.tag, release]));
    for (const release of ordered) {
        if (!isPublisherTag(release.tag) || release.draft) continue;
        const asset = release.assets.find(({ name }) => name === MANIFEST_NAME);
        if (!asset) continue;
        const bytes = await client.downloadAsset(asset);
        if (asset.digest && asset.digest.toLowerCase() !== `sha256:${sha256(bytes)}`) {
            throw new Error(`Manifest checksum conflicts with release asset: ${release.tag}`);
        }
        let parsed: JsonValue;
        try {
            parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            throw new Error(`Invalid ${MANIFEST_NAME} in release ${release.tag}`);
        }
        const manifest = parseReleaseManifest(parsed);
        let complete = true;
        for (const source of Object.values(manifest)) {
            for (const packageAssets of Object.values(source)) {
                for (const record of Object.values(packageAssets)) {
                    if (!record) continue;
                    const { tag, name } = parseReleaseAssetUrl(record.url, owner, repo);
                    if (record.name !== name) {
                        throw new Error(
                            `Manifest filename conflicts with release URL: ${record.url}`
                        );
                    }
                    const referenced = byTag.get(tag);
                    if (!referenced || referenced.draft) {
                        complete = false;
                        break;
                    }
                    const referencedAsset = referenced.assets.find((item) => item.name === name);
                    if (!referencedAsset)
                        throw new Error(`Manifest references missing asset: ${record.url}`);
                    if (
                        referencedAsset.digest &&
                        referencedAsset.digest.toLowerCase() !== `sha256:${record.sha256}`
                    ) {
                        throw new Error(
                            `Manifest checksum conflicts with release asset: ${record.url}`
                        );
                    }
                }
                if (!complete) break;
            }
            if (!complete) break;
        }
        if (complete) return manifest;
    }
    return {};
}

export function releaseUrl(owner: string, repo: string, tag: string, name: string): string {
    return `https://github.com/${owner}/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

export function serializeManifest(manifest: ReleaseManifest): string {
    return `${JSON.stringify(canonicalManifest(manifest), null, 2)}\n`;
}

export async function verifyReleaseAssets(
    client: ReleaseClient,
    release: ReleaseInfo,
    expected: Map<string, { sha256: string; path: string }>,
    allowMissing: boolean
): Promise<string[]> {
    const actual = new Map<string, ReleaseAssetInfo>();
    for (const asset of release.assets) {
        if (actual.has(asset.name))
            throw new Error(`Duplicate release asset ${asset.name} in ${release.tag}`);
        if (!expected.has(asset.name))
            throw new Error(`Unexpected asset ${asset.name} in release ${release.tag}`);
        actual.set(asset.name, asset);
    }

    const missing: string[] = [];
    for (const [name, expectedAsset] of expected) {
        const asset = actual.get(name);
        if (!asset) {
            if (!allowMissing) throw new Error(`Missing asset ${name} in release ${release.tag}`);
            missing.push(name);
            continue;
        }
        const digest = asset.digest?.toLowerCase();
        if (digest) {
            if (digest !== `sha256:${expectedAsset.sha256}`) {
                throw new Error(`Conflicting checksum for ${name} in release ${release.tag}`);
            }
        } else if (sha256(await client.downloadAsset(asset)) !== expectedAsset.sha256) {
            throw new Error(`Conflicting checksum for ${name} in release ${release.tag}`);
        }
    }
    return missing;
}
