#!/usr/bin/env bun

import { runTask } from './task';

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.includes('--use-cache')) await runTask(['cache', 'restore']);
    if (args.includes('--restore-cache-only')) return;

    if (args.includes('--update-if-needed') || args.includes('--sync') || args.length === 0) {
        await runTask(['static']);
        return;
    }

    console.error(`Unknown sync arguments: ${args.join(' ')}`);
    console.error(
        'Use `bun run update:static` to populate static/, or `bun run cache:restore` to restore cache.'
    );
    process.exit(1);
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
