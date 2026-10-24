#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import './env';

import $ from 'dax';

import {
    applyCommitUpdates,
    fetchMissingIcons,
    findBinaryArtifacts,
    findExtensionUpdates,
    generateDataJson,
    generateRedirects,
    loadExtensionsData,
    loadReleaseManifest,
    materializeExtensions,
    overlayReleaseManifest,
    pruneBinaryDirs,
    pruneRemovedRepos,
    saveExtensionsData,
    setGithubOutput,
    shouldFailOnMaterializeErrors,
    STATIC_DIR
} from './extensions';
import { logger } from './log';
import { updateMeilisearch } from './meilisearch';
import { runPublisher } from './publish';

export type TaskCommand =
    | 'check'
    | 'static'
    | 'data'
    | 'search'
    | 'prepare-dist'
    | 'local'
    | 'publish';

export function parseTask(args: string[]): TaskCommand {
    if (args.includes('--generate-only')) return 'data';
    if (args.includes('--update-search')) return 'search';
    if (args.includes('--quick')) return 'check';
    if (args.includes('--sync')) return 'static';

    const [command] = args;

    if (
        command === 'check' ||
        command === 'static' ||
        command === 'data' ||
        command === 'search' ||
        command === 'prepare-dist' ||
        command === 'local' ||
        command === 'publish'
    ) {
        return command;
    }

    return 'check';
}

async function persistQuickUpdates(updated: boolean): Promise<void> {
    await setGithubOutput('updated', String(updated));
}

async function handleQuickUpdates(
    data: Awaited<ReturnType<typeof loadExtensionsData>>,
    updates: Awaited<ReturnType<typeof findExtensionUpdates>>
): Promise<void> {
    logger.info(
        'task',
        `update check result="updates_found" count=${updates.length} action="update_extensions_json"`
    );
    applyCommitUpdates(data, updates);
    await saveExtensionsData(data);
    await persistQuickUpdates(true);
}

async function finalizeStaticUpdate(
    data: Awaited<ReturnType<typeof loadExtensionsData>>,
    changed: boolean
): Promise<void> {
    if (!changed) {
        await persistQuickUpdates(false);
        return;
    }

    await saveExtensionsData(data);
    logger.info('task', 'extensions_json updated=true');

    await persistQuickUpdates(true);
}

function reportMaterializeFailures(
    failures: Awaited<ReturnType<typeof materializeExtensions>>['failures']
): void {
    if (failures.length === 0) return;

    logger.error('extensions', `materialize result="failed" failures=${failures.length}`);
    for (const failure of failures) {
        logger.error(
            'extensions',
            `failure category=${failure.category} key=${failure.key} name=${JSON.stringify(failure.name)} reason=${JSON.stringify(failure.reason)}`
        );
    }

    if (shouldFailOnMaterializeErrors()) {
        throw new Error('One or more upstream repositories failed to materialize');
    }
}

async function updateExtensions(command: 'check' | 'static'): Promise<void> {
    const quick = command === 'check';

    const data = await loadExtensionsData();
    if (!quick) {
        await pruneRemovedRepos(data);
        await pruneBinaryDirs(data);
    }

    const updates = await findExtensionUpdates(data, { quick });

    if (updates.length === 0) {
        await persistQuickUpdates(false);
        await fetchMissingIcons(data);
        return;
    }

    if (quick) {
        await handleQuickUpdates(data, updates);
        return;
    }

    // One snapshot for the run so outputs agree.
    const manifest = await loadReleaseManifest({});
    const { changed, failures } = await materializeExtensions(data, updates, {
        manifest
    });
    await fetchMissingIcons(data);
    await finalizeStaticUpdate(data, changed);
    reportMaterializeFailures(failures);
}

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

const commandHandlers = {
    data: async () => {
        await generateDataJson();
    },
    search: async () => {
        logger.info('search', 'index update mode="only"');
        // Rebuild the index with release URLs when a manifest is available so a
        // manifest-less local build can never silently push upstream URLs live.
        const manifest = await loadReleaseManifest({});
        if (manifest) {
            await generateDataJson(undefined, { manifest });
        } else {
            logger.warn('search', 'index update without manifest reason="no_manifest"');
        }
        await updateMeilisearch();
    },
    'prepare-dist': async () => {
        await updateExtensions('static');
        const data = await loadExtensionsData();
        const manifest = await loadReleaseManifest({});
        await overlayReleaseManifest(data, STATIC_DIR, { manifest });
        await generateRedirects(data, STATIC_DIR, { manifest });
        await $`pnpm run build`;
        const binaries = await findBinaryArtifacts('dist');
        if (binaries.length > 0) {
            throw new Error(
                `dist/ contains ${binaries.length} binary artifact(s): ${binaries.slice(0, 5).join(', ')}`
            );
        }
    },
    local: async () => {
        const manifestPath = await fetchManifest();
        if (manifestPath) process.env.RELEASE_MANIFEST_FILE = manifestPath;

        await updateExtensions('static');
        await generateDataJson();
        logger.info('search', 'index update mode="only"');
        await updateMeilisearch();
    },
    publish: async () => {
        await runPublisher();
    }
} satisfies Record<Exclude<TaskCommand, 'check' | 'static'>, () => Promise<void>>;

export async function runTask(args = process.argv.slice(2)): Promise<void> {
    const command = parseTask(args);

    if (command === 'check' || command === 'static') {
        await updateExtensions(command);
        return;
    }

    await commandHandlers[command]();
}

if (import.meta.main) {
    try {
        await runTask();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
