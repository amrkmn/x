#!/usr/bin/env bun

import { $ } from 'bun';
import { restoreCache, saveCache } from './cache';
import { CACHE_PATHS, CACHE_RESTORE_KEYS, generateCacheKey } from './cache/utils';
import {
    applyCommitUpdates,
    findExtensionUpdates,
    generateDataJson,
    loadExtensionsData,
    materializeExtensions,
    saveExtensionsData,
    setGithubOutput
} from './extensions';
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

    if (restoredKey) console.log(`Cache restored: ${restoredKey}`);
    else console.log('No cache restored');
}

async function saveStaticCache(): Promise<void> {
    await saveCache(CACHE_PATHS, await generateCacheKey());
}

async function updateExtensions(
    command: 'check' | 'static' | 'full',
    args: string[]
): Promise<void> {
    const quick = command === 'check';
    const useCache = command === 'full' && !args.includes('--no-cache');

    if (useCache) await restoreStaticCache();
    else console.log(quick ? 'Cache disabled for quick mode' : 'Cache disabled for this command');

    const data = await loadExtensionsData();
    const updates = await findExtensionUpdates(data, { quick });

    if (updates.length === 0) {
        console.log('No updates found');
        await setGithubOutput('updated', 'false');
        return;
    }

    if (quick) {
        console.log(`Found ${updates.length} updates. Updating extensions.json...`);
        applyCommitUpdates(data, updates);
        await saveExtensionsData(data);
        await setGithubOutput('updated', 'true');
        return;
    }

    const changed = await materializeExtensions(data, updates);
    if (changed) {
        await saveExtensionsData(data);
        console.log('Updated extensions.json');

        if (command === 'full') {
            await generateDataJson(data);
            await updateMeilisearch();
            if (useCache) await saveStaticCache();
        }
    }

    await setGithubOutput('updated', String(changed));
}

export async function runTask(args = process.argv.slice(2)): Promise<void> {
    const command = parseTask(args);

    if (command === 'data') {
        await generateDataJson();
        return;
    }

    if (command === 'search') {
        console.log('Updating search index only...');
        await updateMeilisearch();
        return;
    }

    if (command === 'cache:restore') {
        await restoreStaticCache();
        return;
    }

    if (command === 'cache:save') {
        await saveStaticCache();
        return;
    }

    if (command === 'prepare-dist') {
        await restoreStaticCache();
        await updateExtensions('static', args);
        await $`bun run build`;
        return;
    }

    await updateExtensions(command, args);
}

if (import.meta.main) {
    try {
        await runTask();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
