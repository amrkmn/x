#!/usr/bin/env node

import $ from 'dax';

import { refreshMetadata, restoreCache, saveCache } from './cache';
import { CACHE_PATHS, CACHE_RESTORE_KEYS, generateCacheKey } from './cache/utils';
import {
    applyCommitUpdates,
    findExtensionUpdates,
    generateDataJson,
    loadExtensionsData,
    materializeExtensions,
    pruneRemovedRepos,
    saveExtensionsData,
    setGithubOutput,
    shouldFailOnMaterializeErrors
} from './extensions';
import { logger } from './log';
import { updateMeilisearch } from './meilisearch';

export type TaskCommand =
    | 'check'
    | 'static'
    | 'full'
    | 'data'
    | 'search'
    | 'cache:restore'
    | 'cache:save'
    | 'prepare-dist';

export function parseTask(args: string[]): TaskCommand {
    if (args.includes('--generate-only')) return 'data';
    if (args.includes('--update-search')) return 'search';
    if (args.includes('--quick')) return 'check';
    if (args.includes('--sync')) return 'static';

    const [command, subcommand] = args;
    if (command === 'cache' && subcommand === 'restore') return 'cache:restore';
    if (command === 'cache' && subcommand === 'save') return 'cache:save';

    if (
        command === 'check' ||
        command === 'static' ||
        command === 'full' ||
        command === 'data' ||
        command === 'search' ||
        command === 'prepare-dist'
    ) {
        return command;
    }

    return 'full';
}

async function restoreStaticCache(): Promise<void> {
    const key = await generateCacheKey();
    const restoredKey = await restoreCache(CACHE_PATHS, key, CACHE_RESTORE_KEYS);

    if (restoredKey) logger.info('cache', `restore complete key=${JSON.stringify(restoredKey)}`);
    else logger.info('cache', 'restore skipped reason="not_found"');
}

async function saveStaticCache(): Promise<void> {
    await saveCache(CACHE_PATHS, await generateCacheKey());
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
    useCache: boolean,
    data: Awaited<ReturnType<typeof loadExtensionsData>>,
    changed: boolean
): Promise<void> {
    if (!changed) {
        await persistQuickUpdates(false);
        return;
    }

    await saveExtensionsData(data);
    logger.info('task', 'extensions_json updated=true');

    if (command === 'full') {
        await generateDataJson(data);
        if (useCache) await refreshMetadata(await generateCacheKey(), CACHE_PATHS);
        await updateMeilisearch();
        if (useCache) await saveStaticCache();
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

async function updateExtensions(
    command: 'check' | 'static' | 'full',
    args: string[]
): Promise<void> {
    const quick = command === 'check';
    const useCache = command === 'full' && !args.includes('--no-cache');

    if (useCache) {
        await restoreStaticCache();
    } else {
        logger.info(
            'cache',
            quick ? 'cache disabled mode="quick"' : 'cache disabled mode="command"'
        );
    }

    const data = await loadExtensionsData();
    const pruned = !quick ? await pruneRemovedRepos(data) : 0;

    const updates = await findExtensionUpdates(data, { quick });

    if (updates.length === 0) {
        await persistQuickUpdates(false);
        // Persist removed sources in the cache even without repo updates, so
        // the next restore doesn't resurrect files for deleted extensions.json
        // entries (e.g. a deprecated repo removed after a cache was saved).
        if (pruned > 0 && useCache) await saveStaticCache();
        return;
    }

    if (quick) {
        await handleQuickUpdates(data, updates);
        return;
    }

    const { changed, failures } = await materializeExtensions(data, updates);
    await finalizeFullUpdate(command, useCache, data, changed);
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
    'cache:restore': async () => {
        await restoreStaticCache();
    },
    'cache:save': async () => {
        await saveStaticCache();
    },
    'prepare-dist': async (args) => {
        await restoreStaticCache();
        await updateExtensions('static', args);
        await $`nub run build`;
    }
} satisfies Record<
    Exclude<TaskCommand, 'check' | 'static' | 'full'>,
    (args: string[]) => Promise<void>
>;

export async function runTask(args = process.argv.slice(2)): Promise<void> {
    const command = parseTask(args);

    if (command === 'check' || command === 'static' || command === 'full') {
        await updateExtensions(command, args);
        return;
    }

    await commandHandlers[command](args);
}

if (import.meta.main) {
    try {
        await runTask();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
