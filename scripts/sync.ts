#!/usr/bin/env node

import { runTask } from './task';

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.includes('--update-if-needed') || args.includes('--sync') || args.length === 0) {
        await runTask(['static']);
        return;
    }

    console.error(`Unknown sync arguments: ${args.join(' ')}`);
    console.error('Use `pnpm run update:static` to populate static/.');
    process.exit(1);
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
