#!/usr/bin/env bun

import { runTask } from './task';

try {
    await runTask(process.argv.slice(2));
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
