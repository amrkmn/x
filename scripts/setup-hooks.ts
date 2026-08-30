import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PRE_COMMIT_HOOK = `#!/bin/sh
pnpm run format:check
if [ $? -ne 0 ]; then
    echo ""
    echo "Formatting check failed. Run 'pnpm run format' to fix formatting issues."
    exit 1
fi

pnpm run lint
if [ $? -ne 0 ]; then
    echo ""
    echo "Lint check failed."
    exit 1
fi
`;

function getGitDir(): string | null {
    const result = spawnSync('git', ['rev-parse', '--git-dir'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    });

    if (result.status !== 0) return null;

    const gitDir = result.stdout.trim();
    return gitDir || null;
}

async function setupHooks() {
    const gitDir = getGitDir();
    if (!gitDir) {
        console.log('Git repository not found. Skipping hook setup.');
        return;
    }

    const hooksDir = join(gitDir, 'hooks');
    if (!existsSync(hooksDir)) {
        await mkdir(hooksDir, { recursive: true });
    }

    const hookPath = join(hooksDir, 'pre-commit');
    await writeFile(hookPath, PRE_COMMIT_HOOK, { mode: 0o755 });
    await chmod(hookPath, 0o755);

    console.log(`Git pre-commit hook installed at ${hookPath}`);
    console.log('  Runs "pnpm run format:check" and "pnpm run lint" before each commit');
    console.log('  If formatting issues are found, run "pnpm run format" to fix them');
}

await setupHooks();
