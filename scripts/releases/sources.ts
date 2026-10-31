import type { JsonObject, JsonValue } from '../../src/lib/validation';
import type { ExtensionConfig } from '../types';
import { isRecord, isString, optionalUrl, requiredString } from './json';
import type { ArtifactKind, Candidate } from './types';

const SOURCE_KEYS = ['keiyoushi', 'yuzono/cursed', 'secozzi', 'yuzono/anime'] as const;

interface SourceSpec {
    category: 'mihon' | 'aniyomi';
    indexFile: string;
    layout: 'wrapped' | 'flat';
}

interface GitHubRepo {
    owner: string;
    repo: string;
}

interface VersionFields {
    version: string;
    versionCode?: number | string;
}

interface UpstreamAssetInfo {
    name: string;
    sha256: string;
}

const SOURCE_SPECS = new Map<string, SourceSpec>([
    [
        'keiyoushi',
        {
            category: 'mihon',
            indexFile: 'index.json',
            layout: 'wrapped'
        }
    ],
    [
        'yuzono/cursed',
        {
            category: 'mihon',
            indexFile: 'index.json',
            layout: 'wrapped'
        }
    ],
    [
        'secozzi',
        {
            category: 'aniyomi',
            indexFile: 'index.json',
            layout: 'wrapped'
        }
    ],
    [
        'yuzono/anime',
        {
            category: 'aniyomi',
            indexFile: 'index.min.json',
            layout: 'flat'
        }
    ]
]);

function sourceRepo(source: string): GitHubRepo {
    const separator = source.lastIndexOf('@');
    const repositoryUrl = separator > 0 ? source.slice(0, separator) : source;
    const url = new URL(repositoryUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname !== 'github.com' || parts.length !== 2) {
        throw new Error(`Unsupported source repository: ${source}`);
    }
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
}

function rawUrl(source: string, commit: string, path: string): string {
    const { owner, repo } = sourceRepo(source);
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${encodedPath}`;
}

// Pinned upstream URL for a flat-index APK.
export function flatUpstreamApkUrl(source: string, commit: string, fileName: string): string {
    return rawUrl(source, commit, `apk/${fileName}`);
}

async function fetchJson(fetcher: typeof fetch, url: string): Promise<JsonValue> {
    let response;
    try {
        response = await fetcher(url);
    } catch (error) {
        throw new Error(`Fetch failed: ${url} (${error instanceof Error ? error.message : error})`);
    }
    if (!response.ok) throw new Error(`Fetch failed (${response.status}): ${url}`);
    try {
        const value: JsonValue = JSON.parse(await response.text());
        return value;
    } catch {
        throw new Error(`Invalid JSON response: ${url}`);
    }
}

function versionFields(entry: JsonObject): VersionFields {
    const versionValue = entry.versionName ?? entry.version;
    const version = isString(versionValue)
        ? versionValue
        : versionValue !== undefined && Number.isFinite(versionValue)
          ? String(versionValue)
          : '';
    const code = entry.versionCode ?? entry.code;
    const result: VersionFields = { version };
    if (isString(code)) result.versionCode = code;
    else if (code !== undefined && Number.isFinite(code)) result.versionCode = Number(code);
    return result;
}

function basenameFromUrl(value: string, label: string): string {
    const pathname = new URL(value).pathname;
    const segment = pathname.slice(pathname.lastIndexOf('/') + 1);
    let name: string;
    try {
        name = decodeURIComponent(segment);
    } catch {
        throw new Error(`Invalid ${label} filename in URL: ${value}`);
    }
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error(`Invalid ${label} filename in URL: ${value}`);
    }
    return name;
}

function sourceAssetRecord(
    manifest: JsonObject,
    packageName: string,
    kind: ArtifactKind,
    _source: string
): UpstreamAssetInfo | undefined {
    const packageRecord = manifest[packageName];
    if (!isRecord(packageRecord) || !isRecord(packageRecord[kind])) {
        return undefined;
    }
    const record = packageRecord[kind];
    if (!isString(record.name) || !isString(record.sha256)) {
        return undefined;
    }
    const sha256 = record.sha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
        return undefined;
    }
    return { name: record.name, sha256 };
}

function addWrappedCandidates(
    source: string,
    index: JsonValue,
    sourceManifest: JsonObject | undefined,
    candidates: Candidate[]
): void {
    if (
        !isRecord(index) ||
        !isRecord(index.extensionList) ||
        !Array.isArray(index.extensionList.extensions)
    ) {
        throw new Error(`Invalid Mihon index for ${source}: expected extensionList.extensions`);
    }

    for (const [indexEntry, value] of index.extensionList.extensions.entries()) {
        if (!isRecord(value)) throw new Error(`Invalid extension entry ${source}[${indexEntry}]`);
        const packageName = requiredString(
            value.packageName,
            `${source}[${indexEntry}].packageName`
        );
        const resources = isRecord(value.resources) ? value.resources : {};
        const apkUrl = optionalUrl(resources.apkUrl, `${source}/${packageName} apkUrl`);
        if (!apkUrl) continue;

        const metadata = versionFields(value);
        const add = (kind: ArtifactKind, downloadUrl: string): void => {
            const upstream = sourceManifest
                ? sourceAssetRecord(sourceManifest, packageName, kind, source)
                : undefined;
            const urlName = basenameFromUrl(downloadUrl, `${source}/${packageName} ${kind}`);
            if (upstream && upstream.name !== urlName) {
                throw new Error(
                    `Upstream ${kind} filename mismatch for ${source}/${packageName}: ${urlName} != ${upstream.name}`
                );
            }
            candidates.push({
                source,
                packageName,
                kind,
                ...metadata,
                upstreamName: urlName,
                downloadUrl,
                upstreamSha256: upstream?.sha256
            });
        };

        add('apk', apkUrl);
        const jarUrl = optionalUrl(resources.jarUrl, `${source}/${packageName} jarUrl`);
        if (jarUrl) add('jar', jarUrl);
    }
}

function addFlatCandidates(
    source: string,
    sourceConfig: ExtensionConfig,
    index: JsonValue,
    candidates: Candidate[]
): void {
    if (!Array.isArray(index))
        throw new Error(`Invalid Aniyomi index for ${source}: expected array`);
    const commit = requiredString(sourceConfig.commit, `${source} pinned commit`);

    for (const [indexEntry, value] of index.entries()) {
        if (!isRecord(value)) throw new Error(`Invalid extension entry ${source}[${indexEntry}]`);
        const packageName = requiredString(value.pkg, `${source}[${indexEntry}].pkg`);
        const apkValue = value.apk;
        if (apkValue === undefined || apkValue === null || apkValue === '') continue;
        const upstreamName = requiredString(apkValue, `${source}/${packageName} apk`);
        if (
            upstreamName.includes('/') ||
            upstreamName.includes('\\') ||
            upstreamName === '.' ||
            upstreamName === '..'
        ) {
            throw new Error(
                `Invalid Aniyomi APK filename: ${source}/${packageName}/${upstreamName}`
            );
        }
        const metadata = versionFields(value);
        candidates.push({
            source,
            packageName,
            kind: 'apk',
            ...metadata,
            upstreamName,
            downloadUrl: flatUpstreamApkUrl(sourceConfig.source, commit, upstreamName)
        });
    }
}

export async function discoverCandidates(
    data: Record<string, Record<string, ExtensionConfig>>,
    fetcher: typeof fetch = fetch,
    sourcesToDiscover?: Iterable<string>
): Promise<Candidate[]> {
    const configured = new Map<string, ExtensionConfig>();
    for (const [category, entries] of Object.entries(data)) {
        for (const [key, extension] of Object.entries(entries)) {
            if (configured.has(key)) throw new Error(`Duplicate source key: ${key}`);
            const spec = SOURCE_SPECS.get(key);
            if (!spec) throw new Error(`Unsupported extension source: ${key}`);
            if (category !== spec.category || extension.category !== spec.category) {
                throw new Error(
                    `Unexpected category for ${key}: ${category}/${extension.category}`
                );
            }
            configured.set(key, extension);
        }
    }

    for (const key of SOURCE_KEYS) {
        if (!configured.has(key)) throw new Error(`Missing configured source: ${key}`);
    }
    if (configured.size !== SOURCE_KEYS.length) throw new Error('Unexpected source count');

    const sourcesToScan = sourcesToDiscover
        ? SOURCE_KEYS.filter((s) => new Set(sourcesToDiscover).has(s))
        : SOURCE_KEYS;

    const candidates: Candidate[] = [];
    for (const source of sourcesToScan) {
        const sourceConfig = configured.get(source)!;
        const spec = SOURCE_SPECS.get(source)!;
        const commit = requiredString(sourceConfig.commit, `${source} pinned commit`);
        if (!/^[a-f0-9]{7,40}$/i.test(commit))
            throw new Error(`Invalid pinned commit for ${source}`);
        const index = await fetchJson(fetcher, rawUrl(sourceConfig.source, commit, spec.indexFile));

        if (spec.layout === 'wrapped') {
            let sourceManifestValue: JsonObject | undefined;
            try {
                const fetched = await fetchJson(
                    fetcher,
                    rawUrl(sourceConfig.source, commit, 'release-assets.json')
                );
                if (isRecord(fetched)) sourceManifestValue = fetched;
            } catch {
                // Upstream release-assets.json is an optional build artifact
            }
            addWrappedCandidates(source, index, sourceManifestValue, candidates);
        } else {
            addFlatCandidates(source, sourceConfig, index, candidates);
        }
    }

    const identities = new Set<string>();
    for (const candidate of candidates) {
        const artifactIdentity = JSON.stringify([
            candidate.source,
            candidate.packageName,
            candidate.kind
        ]);
        if (identities.has(artifactIdentity)) {
            throw new Error(`Duplicate artifact identity: ${artifactIdentity}`);
        }
        identities.add(artifactIdentity);
    }
    return candidates;
}
