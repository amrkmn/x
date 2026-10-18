import type { ExtensionConfig } from '../types';

export type ArtifactKind = 'apk' | 'jar';

export interface ReleaseAsset {
    name: string;
    sha256: string;
    version: string;
    versionCode?: number | string;
    source: string;
    kind: ArtifactKind;
    url: string;
}

export type ReleaseManifest = Record<
    string,
    Record<string, Partial<Record<ArtifactKind, ReleaseAsset>>>
>;

export interface Candidate {
    source: string;
    packageName: string;
    kind: ArtifactKind;
    version: string;
    versionCode?: number | string;
    upstreamName: string;
    downloadUrl: string;
    upstreamSha256?: string;
}

export interface HashedArtifact extends Candidate {
    name: string;
    sha256: string;
    filePath: string;
}

export interface ReleaseAssetInfo {
    id: number;
    name: string;
    url: string;
    digest?: string;
}

export interface ReleaseInfo {
    id: number;
    tag: string;
    targetCommitish: string;
    draft: boolean;
    uploadUrl: string;
    assets: ReleaseAssetInfo[];
}

export interface ReleaseClient {
    currentMainSha(): Promise<string>;
    listReleases(): Promise<ReleaseInfo[]>;
    getRelease(tag: string): Promise<ReleaseInfo | null>;
    getTagCommit(tag: string): Promise<string | null>;
    downloadAsset(asset: ReleaseAssetInfo): Promise<Uint8Array>;
    createDraft(tag: string, targetSha: string): Promise<ReleaseInfo>;
    uploadAsset(release: ReleaseInfo, name: string, path: string): Promise<void>;
    publishDraft(release: ReleaseInfo): Promise<void>;
}

export interface PublishOptions {
    data: Record<string, Record<string, ExtensionConfig>>;
    commit: string;
    client: ReleaseClient;
    fetcher?: typeof fetch;
    tempRoot?: string;
    owner?: string;
    repo?: string;
}
