import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import { compressToTar, extractTar } from '../scripts/cache/files';

test('create and extract roundtrip', async () => {
    const testDir = 'tests/test-archive-input';
    const extractDir = 'tests/test-archive-output';
    const outputPath = 'tests/test-archive.tzst';

    await mkdir(testDir, { recursive: true });
    await mkdir(`${testDir}/nested`, { recursive: true });
    await mkdir(extractDir, { recursive: true });

    await writeFile(`${testDir}/file1.txt`, 'Hello World');
    await writeFile(`${testDir}/file2.json`, JSON.stringify({ key: 'value' }));
    await writeFile(`${testDir}/nested/deep.txt`, 'Deep content');

    const checksums = await compressToTar([testDir], outputPath);

    expect(checksums).toBeDefined();
    expect(Object.keys(checksums).length).toBeGreaterThan(0);

    await extractTar(outputPath, extractDir);

    const extractFile = `${extractDir}/${testDir}/file1.txt`;

    const filesContent = await readFile(extractFile, 'utf8');
    expect(filesContent).toBe('Hello World');

    await rm(testDir, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
    await rm(outputPath, { force: true });
}, 30000);
