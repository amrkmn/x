#!/usr/bin/env node

// Local equivalent of the retired `pnpm run update` (full) command:
// materialize upstream changes into static/, regenerate data.json /
// indexes.json, and push the search index to Meilisearch.
// Unlike `prepare-dist`, this does not build dist/, generate _redirects,
// or fail on missing release manifests. Cross-platform (no shell-outs).

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import $ from 'dax';

const MANIFEST_URL = 'https://github.com/amrkmn/x/releases/latest/download/release-assets.json';

async function fetchManifest(): Promise<string | undefined> {
    try {
        const response = await fetch(MANIFEST_URL);
        if (!response.ok) {
            console.error(
                `warning: manifest HTTP ${response.status}; continuing with upstream URLs`
            );
            return undefined;
        }
        const dir = join(tmpdir(), 'x-manifest');
        await mkdir(dir, { recursive: true });
        const path = join(dir, 'release-assets.json');
        await writeFile(path, Buffer.from(await response.arrayBuffer()));
        return path;
    } catch {
        console.error('warning: manifest fetch failed; continuing with upstream URLs');
        return undefined;
    }
}

async function main(): Promise<void> {
    const manifestPath = await fetchManifest();
    if (manifestPath) process.env.RELEASE_MANIFEST_FILE = manifestPath;

    await $`pnpm run update:static`;
    await $`pnpm run data:generate`;
    await $`pnpm run search:update`;
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
