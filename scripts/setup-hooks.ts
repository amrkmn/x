import { existsSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HOOKS_DIR = '.git/hooks';
const PRE_COMMIT_HOOK = `#!/bin/sh
bun run lint
if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Formatting check failed. Run 'bun run format' to fix formatting issues."
    exit 1
fi
`;

async function setupHooks() {
    if (!existsSync(HOOKS_DIR)) {
        console.log('Git hooks directory not found. Skipping hook setup.');
        return;
    }

    const hookPath = join(HOOKS_DIR, 'pre-commit');

    await writeFile(hookPath, PRE_COMMIT_HOOK, { mode: 0o755 });
    await chmod(hookPath, 0o755);

    console.log('✓ Git pre-commit hook installed');
    console.log('  Runs "bun run lint" before each commit');
    console.log('  If formatting issues are found, run "bun run format" to fix them');
}

await setupHooks();
