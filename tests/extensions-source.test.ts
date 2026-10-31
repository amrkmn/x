import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import $ from 'dax';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { cloneRepository, findExtensionUpdates, parseSourceUrl } from '../scripts/extensions';

let testDir: string;
let remoteDir: string;

beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'x-ext-source-'));
    remoteDir = join(testDir, 'remote');

    await $`git init --initial-branch=master ${remoteDir}`.quiet();
    await $`git -C ${remoteDir} config user.email "test@test"`.quiet();
    await $`git -C ${remoteDir} config user.name "test"`.quiet();
    await mkdir(join(remoteDir, 'files'), { recursive: true });
    await writeFile(join(remoteDir, 'files', 'index.min.json'), '[]');
    await $`git -C ${remoteDir} add .`.quiet();
    await $`git -C ${remoteDir} commit -m "init master"`.quiet();

    await $`git -C ${remoteDir} checkout -b repo`.quiet();
    await writeFile(join(remoteDir, 'files', 'index.min.json'), '[{"repo":true}]');
    await $`git -C ${remoteDir} add .`.quiet();
    await $`git -C ${remoteDir} commit -m "init repo branch"`.quiet();

    await $`git -C ${remoteDir} checkout master`.quiet();
});

afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
});

test('cloneRepository clones default branch when no @branch', async () => {
    const masterSha = (await $`git -C ${remoteDir} rev-parse master`.text()).trim();
    const cloneDir = join(testDir, 'clone-default');

    const mode = await cloneRepository(remoteDir, cloneDir);

    expect(['sparse', 'full']).toContain(mode);
    const headSha = (await $`git -C ${cloneDir} rev-parse HEAD`.text()).trim();
    expect(headSha).toBe(masterSha);
});

test('cloneRepository with @branch clones the specified branch', async () => {
    const repoBranchSha = (await $`git -C ${remoteDir} rev-parse repo`.text()).trim();
    const cloneDir = join(testDir, 'clone-repo');

    const mode = await cloneRepository(`${remoteDir}@repo`, cloneDir);

    expect(['sparse', 'full']).toContain(mode);
    const headSha = (await $`git -C ${cloneDir} rev-parse HEAD`.text()).trim();
    expect(headSha).toBe(repoBranchSha);
});

test('parseSourceUrl extracts branch from @branch syntax', async () => {
    const staticDir = join(testDir, 'static');
    await mkdir(staticDir, { recursive: true });

    const updates = await findExtensionUpdates(
        {
            aniyomi: {
                secozzi: {
                    name: 'Secozzi',
                    source: `${remoteDir}@repo`,
                    path: '/secozzi/index.min.json',
                    category: 'aniyomi',
                    commit: 'old'
                }
            }
        },
        {
            quick: true,
            staticDir
        }
    );

    const repoHead = (await $`git -C ${remoteDir} rev-parse repo`.text()).trim();
    expect(updates).toHaveLength(1);
    expect(updates[0].hash).toBe(repoHead);
});

test('parseSourceUrl handles various URL patterns', () => {
    const r1 = parseSourceUrl('https://github.com/user/repo');
    expect(r1).toEqual({ url: 'https://github.com/user/repo' });

    const r2 = parseSourceUrl('https://github.com/user/repo@main');
    expect(r2).toEqual({ url: 'https://github.com/user/repo', branch: 'main' });

    const r3 = parseSourceUrl('https://github.com/Secozzi/aniyomi-extensions@repo');
    expect(r3).toEqual({ url: 'https://github.com/Secozzi/aniyomi-extensions', branch: 'repo' });

    const r4 = parseSourceUrl('https://github.com/user/repo@');
    expect(r4).toEqual({ url: 'https://github.com/user/repo' });

    const r5 = parseSourceUrl('https://github.com/org@user/repo@dev');
    expect(r5).toEqual({ url: 'https://github.com/org@user/repo', branch: 'dev' });
});
