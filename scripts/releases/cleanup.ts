import { config } from '../config';
import { env } from '../env';
import { GitHubReleaseClient } from './github-client';
import { MANIFEST_NAME, previousCompleteManifest, releaseUrl } from './manifest';
import type { CleanupOptions, CleanupResult, ReleaseManifest } from './types';

export function getReferencedUrls(manifest: ReleaseManifest): Set<string> {
    const urls = new Set<string>();
    for (const source of Object.values(manifest)) {
        for (const packageAssets of Object.values(source)) {
            for (const asset of Object.values(packageAssets)) {
                if (asset?.url) {
                    urls.add(asset.url);
                }
            }
        }
    }
    return urls;
}

export async function cleanupReleases(options: CleanupOptions): Promise<CleanupResult> {
    const owner = options.owner ?? config.github.owner;
    const repo = options.repo ?? config.github.repo;

    const releases = await options.client.listReleases();
    const manifest =
        options.manifest ?? (await previousCompleteManifest(releases, options.client, owner, repo));

    const referencedUrls = getReferencedUrls(manifest);
    if (referencedUrls.size === 0) {
        throw new Error('Aborting release cleanup: manifest contains no referenced assets.');
    }

    // Protect the latest published release from complete deletion so that
    // releases/latest/download/release-assets.json remains available.
    const publishedReleases = releases.filter((r) => !r.draft).sort((a, b) => b.id - a.id);
    const latestReleaseId = publishedReleases[0]?.id;

    let deletedAssets = 0;
    let deletedReleases = 0;

    for (const release of releases) {
        // Skip drafts to avoid race conditions with publishers
        if (release.draft) continue;

        const isLatest = release.id === latestReleaseId;

        // Binary extension assets in this release (excluding the manifest metadata itself)
        const binaryAssets = release.assets.filter((asset) => asset.name !== MANIFEST_NAME);

        const isAssetReferenced = (assetName: string): boolean => {
            const expectedUrl = releaseUrl(owner, repo, release.tag, assetName);
            return referencedUrls.has(expectedUrl);
        };

        const referencedBinaries = binaryAssets.filter((asset) => isAssetReferenced(asset.name));
        const unreferencedBinaries = binaryAssets.filter((asset) => !isAssetReferenced(asset.name));

        // If no active binaries remain and it is not the latest release, delete the entire release
        if (!isLatest && referencedBinaries.length === 0) {
            console.info(
                `Deleting obsolete release ${release.tag} (${release.assets.length} unreferenced assets)`
            );
            if (!options.dryRun) {
                if (options.client.deleteRelease) {
                    await options.client.deleteRelease(release.id);
                }
                if (options.client.deleteTagRef) {
                    try {
                        await options.client.deleteTagRef(release.tag);
                    } catch (error) {
                        console.warn(`Could not delete tag ref ${release.tag}: ${error}`);
                    }
                }
            }
            deletedReleases += 1;
            deletedAssets += release.assets.length;
            if (options.delayMs) {
                await new Promise((resolve) => setTimeout(resolve, options.delayMs));
            }
            continue;
        }

        // If the release still contains active binaries, delete only the unreferenced binary assets
        for (const asset of unreferencedBinaries) {
            console.info(`Deleting unreferenced asset ${release.tag}/${asset.name}`);
            if (!options.dryRun && options.client.deleteAsset) {
                await options.client.deleteAsset(asset.id);
            }
            deletedAssets += 1;
            if (options.delayMs) {
                await new Promise((resolve) => setTimeout(resolve, options.delayMs));
            }
        }
    }

    return {
        deletedAssets,
        deletedReleases,
        dryRun: options.dryRun ?? false
    };
}

export async function runCleanup(): Promise<void> {
    const token = env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required for release cleanup');

    const client = new GitHubReleaseClient(token, config.github.owner, config.github.repo);
    const result = await cleanupReleases({
        client,
        delayMs: 100
    });

    console.info(
        `Release cleanup complete: deleted ${result.deletedAssets} unreferenced assets across ${result.deletedReleases} releases (dryRun=${result.dryRun})`
    );
}
