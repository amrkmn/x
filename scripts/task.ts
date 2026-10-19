#!/usr/bin/env node

import $ from 'dax';

import {
    applyCommitUpdates,
    fetchMissingIcons,
    fetchLatestReleaseManifest,
    findBinaryArtifacts,
    findExtensionUpdates,
    generateDataJson,
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

export type TaskCommand =
    | 'check'
    | 'static'
    | 'full'
    | 'data'
    | 'search'
    | 'prepare-dist'
    | 'cutover';

export function parseTask(args: string[]): TaskCommand {
    if (args.includes('--generate-only')) return 'data';
    if (args.includes('--update-search')) return 'search';
    if (args.includes('--quick')) return 'check';
    if (args.includes('--sync')) return 'static';

    const [command] = args;

    if (
        command === 'check' ||
        command === 'static' ||
        command === 'full' ||
        command === 'data' ||
        command === 'search' ||
        command === 'prepare-dist' ||
        command === 'cutover'
    ) {
        return command;
    }

    return 'full';
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

async function finalizeFullUpdate(
    command: 'static' | 'full',
    data: Awaited<ReturnType<typeof loadExtensionsData>>,
    changed: boolean,
    manifest: Awaited<ReturnType<typeof loadReleaseManifest>>
): Promise<void> {
    if (!changed) {
        await persistQuickUpdates(false);
        return;
    }

    await saveExtensionsData(data);
    logger.info('task', 'extensions_json updated=true');

    if (command === 'full') {
        await generateDataJson(data, { manifest });
        await updateMeilisearch();
    }

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

async function updateExtensions(command: 'check' | 'static' | 'full'): Promise<void> {
    const quick = command === 'check';

    const data = await loadExtensionsData();
    if (!quick) {
        await pruneRemovedRepos(data);
        await pruneBinaryDirs(data);
    }

    const updates = await findExtensionUpdates(data, { quick });

    if (updates.length === 0) {
        await persistQuickUpdates(false);
        // Backfill wrapper icons missing from the mirrored branches without
        // requiring an upstream revision change.
        await fetchMissingIcons(data);
        return;
    }

    if (quick) {
        await handleQuickUpdates(data, updates);
        return;
    }

    // One manifest snapshot for the whole run so index.json, index.pb, and
    // the search index agree; absent without a publisher run (no cutover).
    const manifest = await loadReleaseManifest({});
    const { changed, failures } = await materializeExtensions(data, updates, { manifest });
    // Materialization fetches icons per updated key; cover unchanged keys
    // whose branches never shipped their icons.
    await fetchMissingIcons(data);
    await finalizeFullUpdate(command, data, changed, manifest);
    reportMaterializeFailures(failures);
}

const commandHandlers = {
    data: async () => {
        await generateDataJson();
    },
    search: async () => {
        logger.info('search', 'index update mode="only"');
        await updateMeilisearch();
    },
    'prepare-dist': async () => {
        await updateExtensions('static');
        await overlayReleaseManifest(await loadExtensionsData());
        await $`pnpm run build`;
        const binaries = await findBinaryArtifacts('dist');
        if (binaries.length > 0) {
            throw new Error(
                `dist/ contains ${binaries.length} binary artifact(s): ${binaries.slice(0, 5).join(', ')}`
            );
        }
    },
    cutover: async () => {
        const data = await loadExtensionsData();
        const fetched = process.argv.includes('--fetch')
            ? await fetchLatestReleaseManifest()
            : undefined;
        await overlayReleaseManifest(data, STATIC_DIR, { manifest: fetched });
    },
} satisfies Record<Exclude<TaskCommand, 'check' | 'static' | 'full'>, () => Promise<void>>;

export async function runTask(args = process.argv.slice(2)): Promise<void> {
    const command = parseTask(args);

    if (command === 'check' || command === 'static' || command === 'full') {
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
