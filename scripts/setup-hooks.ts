import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PRE_COMMIT_HOOK = `#!/bin/sh
bun run lint
if [ $? -ne 0 ]; then
    echo ""
    echo "Formatting check failed. Run 'bun run format' to fix formatting issues."
    exit 1
fi
`;

function getGitDir(): string | null {
    const result = Bun.spawnSync(['git', 'rev-parse', '--git-dir'], {
        stdout: 'pipe',
        stderr: 'ignore'
    });

    if (result.exitCode !== 0) return null;

    const gitDir = new TextDecoder().decode(result.stdout).trim();
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
    console.log('  Runs "bun run lint" before each commit');
    console.log('  If formatting issues are found, run "bun run format" to fix them');
}

await setupHooks();
