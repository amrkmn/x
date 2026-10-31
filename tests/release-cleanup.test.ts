import { expect, test } from 'vitest';

import { cleanupReleases, getReferencedUrls } from '../scripts/releases/cleanup';
import { MANIFEST_NAME } from '../scripts/releases/manifest';
import type {
    ReleaseAssetInfo,
    ReleaseClient,
    ReleaseInfo,
    ReleaseManifest
} from '../scripts/releases/types';

class MockReleaseClient implements ReleaseClient {
    releases: ReleaseInfo[] = [];
    deletedAssets: number[] = [];
    deletedReleases: number[] = [];
    deletedTags: string[] = [];
    failDeleteReleaseOnce = false;

    async currentMainSha(): Promise<string> {
        return '0123456789abcdef0123456789abcdef01234567';
    }

    async listReleases(): Promise<ReleaseInfo[]> {
        return [...this.releases];
    }

    async getRelease(tag: string): Promise<ReleaseInfo | null> {
        return this.releases.find((r) => r.tag === tag) ?? null;
    }

    async getTagCommit(): Promise<string | null> {
        return 'commit';
    }

    async downloadAsset(): Promise<Uint8Array> {
        return new Uint8Array();
    }

    async createDraft(): Promise<ReleaseInfo> {
        throw new Error('Not implemented');
    }

    async uploadAsset(): Promise<void> {
        throw new Error('Not implemented');
    }

    async publishDraft(): Promise<void> {
        throw new Error('Not implemented');
    }

    async deleteAsset(assetId: number): Promise<void> {
        this.deletedAssets.push(assetId);
        for (const r of this.releases) {
            r.assets = r.assets.filter((a) => a.id !== assetId);
        }
    }

    async deleteRelease(releaseId: number): Promise<void> {
        if (this.failDeleteReleaseOnce) {
            this.failDeleteReleaseOnce = false;
            throw new Error('502 Server Error / Gateway Timeout');
        }
        this.deletedReleases.push(releaseId);
        this.releases = this.releases.filter((r) => r.id !== releaseId);
    }

    async deleteTagRef(tag: string): Promise<void> {
        this.deletedTags.push(tag);
    }
}

function asset(id: number, name: string): ReleaseAssetInfo {
    return {
        id,
        name,
        url: `https://api.github.com/repos/amrkmn/x/releases/assets/${id}`
    };
}

test('getReferencedUrls extracts all active binary URLs from manifest', () => {
    const manifest: ReleaseManifest = {
        keiyoushi: {
            'org.example.a': {
                apk: {
                    name: 'keiyoushi-a.apk',
                    sha256: 'a'.repeat(64),
                    version: '1.0.0',
                    source: 'keiyoushi',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.1.0/keiyoushi-a.apk'
                },
                jar: {
                    name: 'keiyoushi-a.jar',
                    sha256: 'b'.repeat(64),
                    version: '1.0.0',
                    source: 'keiyoushi',
                    kind: 'jar',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.1.0/keiyoushi-a.jar'
                }
            }
        }
    };

    const urls = getReferencedUrls(manifest);
    expect(urls).toEqual(
        new Set([
            'https://github.com/amrkmn/x/releases/download/v0.1.0/keiyoushi-a.apk',
            'https://github.com/amrkmn/x/releases/download/v0.1.0/keiyoushi-a.jar'
        ])
    );
});

test('aborts cleanup if manifest contains no referenced assets', async () => {
    const client = new MockReleaseClient();
    const emptyManifest: ReleaseManifest = {};

    await expect(
        cleanupReleases({
            client,
            owner: 'amrkmn',
            repo: 'x',
            manifest: emptyManifest
        })
    ).rejects.toThrow('manifest contains no referenced assets');
});

test('deletes unreferenced assets and deletes completely obsolete releases', async () => {
    const client = new MockReleaseClient();

    // Release 1 (older, id=10, tag=v0.1.0):
    // Contains extA-v1 (superseded) and extB-v1 (superseded)
    const release1: ReleaseInfo = {
        id: 10,
        tag: 'v0.1.0',
        targetCommitish: 'sha1',
        draft: false,
        uploadUrl: 'https://uploads.example/10',
        assets: [asset(1, MANIFEST_NAME), asset(2, 'extA-v1.apk'), asset(3, 'extB-v1.apk')]
    };

    // Release 2 (older, id=20, tag=v0.2.0):
    // Contains extC-v1 (still active!) and extD-v1 (superseded)
    const release2: ReleaseInfo = {
        id: 20,
        tag: 'v0.2.0',
        targetCommitish: 'sha2',
        draft: false,
        uploadUrl: 'https://uploads.example/20',
        assets: [asset(4, MANIFEST_NAME), asset(5, 'extC-v1.apk'), asset(6, 'extD-v1.apk')]
    };

    // Release 3 (latest, id=30, tag=v0.3.0):
    // Contains extA-v2, extB-v2, extD-v2 (all active!)
    const release3: ReleaseInfo = {
        id: 30,
        tag: 'v0.3.0',
        targetCommitish: 'sha3',
        draft: false,
        uploadUrl: 'https://uploads.example/30',
        assets: [
            asset(7, MANIFEST_NAME),
            asset(8, 'extA-v2.apk'),
            asset(9, 'extB-v2.apk'),
            asset(10, 'extD-v2.apk')
        ]
    };

    client.releases = [release1, release2, release3];

    // Manifest references extC-v1 from v0.2.0, and extA-v2, extB-v2, extD-v2 from v0.3.0
    const manifest: ReleaseManifest = {
        source1: {
            extA: {
                apk: {
                    name: 'extA-v2.apk',
                    sha256: 'a'.repeat(64),
                    version: '2.0.0',
                    source: 'source1',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.3.0/extA-v2.apk'
                }
            },
            extB: {
                apk: {
                    name: 'extB-v2.apk',
                    sha256: 'b'.repeat(64),
                    version: '2.0.0',
                    source: 'source1',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.3.0/extB-v2.apk'
                }
            },
            extC: {
                apk: {
                    name: 'extC-v1.apk',
                    sha256: 'c'.repeat(64),
                    version: '1.0.0',
                    source: 'source1',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.2.0/extC-v1.apk'
                }
            },
            extD: {
                apk: {
                    name: 'extD-v2.apk',
                    sha256: 'd'.repeat(64),
                    version: '2.0.0',
                    source: 'source1',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.3.0/extD-v2.apk'
                }
            }
        }
    };

    const result = await cleanupReleases({
        client,
        owner: 'amrkmn',
        repo: 'x',
        manifest
    });

    // Release 1: all binaries unreferenced -> entire release deleted (3 assets total in release 1)
    expect(client.deletedReleases).toEqual([10]);
    expect(client.deletedTags).toEqual(['v0.1.0']);

    // Release 2: extC-v1 kept, extD-v1 (asset 6) deleted
    expect(client.deletedAssets).toEqual([6]);

    // Releases 2 and 3 remain active
    expect(client.releases.map((r) => r.id)).toEqual([20, 30]);

    // Summary count:
    // release 1 (3 assets) + release 2 extD-v1 (1 asset) = 4 assets deleted
    // 1 release deleted
    expect(result).toEqual({
        deletedAssets: 4,
        deletedReleases: 1,
        dryRun: false
    });
});

test('prunes assets before deleting obsolete releases with > 100 assets to prevent GitHub 502 timeout', async () => {
    const client = new MockReleaseClient();

    // Large release with 120 unreferenced assets
    const largeAssets: ReleaseAssetInfo[] = [];
    for (let i = 1; i <= 120; i++) {
        largeAssets.push(asset(i, `old-${i}.apk`));
    }

    const largeRelease: ReleaseInfo = {
        id: 100,
        tag: 'large-batch',
        targetCommitish: 'sha1',
        draft: false,
        uploadUrl: 'https://uploads.example/100',
        assets: largeAssets
    };

    const latestRelease: ReleaseInfo = {
        id: 200,
        tag: 'v0.1.0',
        targetCommitish: 'sha2',
        draft: false,
        uploadUrl: 'https://uploads.example/200',
        assets: [asset(999, 'active.apk')]
    };

    client.releases = [largeRelease, latestRelease];

    const manifest: ReleaseManifest = {
        s: {
            p: {
                apk: {
                    name: 'active.apk',
                    sha256: 'a'.repeat(64),
                    version: '1',
                    source: 's',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.1.0/active.apk'
                }
            }
        }
    };

    const result = await cleanupReleases({
        client,
        owner: 'amrkmn',
        repo: 'x',
        manifest,
        delayMs: 0
    });

    // All 120 assets must have been deleted via deleteAsset
    expect(client.deletedAssets).toHaveLength(120);
    // Release must have been deleted via deleteRelease
    expect(client.deletedReleases).toEqual([100]);
    expect(result.deletedAssets).toBe(120);
    expect(result.deletedReleases).toBe(1);
});

test('falls back to asset pruning if deleteRelease fails initially', async () => {
    const client = new MockReleaseClient();
    client.failDeleteReleaseOnce = true;

    const obsoleteRelease: ReleaseInfo = {
        id: 10,
        tag: 'failing-release',
        targetCommitish: 'sha1',
        draft: false,
        uploadUrl: 'https://uploads.example/10',
        assets: [asset(1, 'old1.apk'), asset(2, 'old2.apk')]
    };

    const latestRelease: ReleaseInfo = {
        id: 20,
        tag: 'v0.1.0',
        targetCommitish: 'sha2',
        draft: false,
        uploadUrl: 'https://uploads.example/20',
        assets: [asset(3, 'active.apk')]
    };

    client.releases = [obsoleteRelease, latestRelease];

    const manifest: ReleaseManifest = {
        s: {
            p: {
                apk: {
                    name: 'active.apk',
                    sha256: 'a'.repeat(64),
                    version: '1',
                    source: 's',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.1.0/active.apk'
                }
            }
        }
    };

    const result = await cleanupReleases({
        client,
        owner: 'amrkmn',
        repo: 'x',
        manifest,
        delayMs: 0
    });

    // Assets were pruned in fallback
    expect(client.deletedAssets).toContain(1);
    expect(client.deletedAssets).toContain(2);
    // Release was successfully retried and deleted
    expect(client.deletedReleases).toEqual([10]);
    expect(result.deletedReleases).toBe(1);
});

test('dry run reports deletions without modifying client state', async () => {
    const client = new MockReleaseClient();

    const release: ReleaseInfo = {
        id: 1,
        tag: 'v0.0.1',
        targetCommitish: 'sha1',
        draft: false,
        uploadUrl: 'https://uploads.example/1',
        assets: [asset(1, 'old.apk')]
    };
    const latest: ReleaseInfo = {
        id: 2,
        tag: 'v0.0.2',
        targetCommitish: 'sha2',
        draft: false,
        uploadUrl: 'https://uploads.example/2',
        assets: [asset(2, 'new.apk')]
    };
    client.releases = [release, latest];

    const manifest: ReleaseManifest = {
        s: {
            p: {
                apk: {
                    name: 'new.apk',
                    sha256: 'a'.repeat(64),
                    version: '1',
                    source: 's',
                    kind: 'apk',
                    url: 'https://github.com/amrkmn/x/releases/download/v0.0.2/new.apk'
                }
            }
        }
    };

    const result = await cleanupReleases({
        client,
        owner: 'amrkmn',
        repo: 'x',
        manifest,
        dryRun: true
    });

    expect(result).toEqual({
        deletedAssets: 1,
        deletedReleases: 1,
        dryRun: true
    });
    expect(client.deletedAssets).toHaveLength(0);
    expect(client.deletedReleases).toHaveLength(0);
    expect(client.releases).toHaveLength(2);
});
