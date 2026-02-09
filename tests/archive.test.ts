import { expect, test } from 'bun:test';
import { compressToTar, extractTar } from '../scripts/cache/files';
import { mkdir, rm } from 'node:fs/promises';

test('create and extract roundtrip', async () => {
    const testDir = 'tests/test-archive-input';
    const extractDir = 'tests/test-archive-output';
    const outputPath = 'tests/test-archive.tzst';

    await mkdir(testDir, { recursive: true });
    await mkdir(`${testDir}/nested`, { recursive: true });
    await mkdir(extractDir, { recursive: true });

    await Bun.write(`${testDir}/file1.txt`, 'Hello World');
    await Bun.write(`${testDir}/file2.json`, JSON.stringify({ key: 'value' }));
    await Bun.write(`${testDir}/nested/deep.txt`, 'Deep content');

    const checksums = await compressToTar([testDir], outputPath);

    expect(checksums).toBeDefined();
    expect(Object.keys(checksums).length).toBeGreaterThan(0);

    const archive = new Bun.Archive(
        Bun.zstdDecompressSync(await Bun.file(outputPath).arrayBuffer())
    );
    const files = await archive.files();

    const file1Content = await files.get('tests/test-archive-input/file1.txt')?.text();
    expect(file1Content).toBe('Hello World');

    await extractTar(outputPath, extractDir);

    const extractFile = `${extractDir}/${testDir}/file1.txt`;

    const file = Bun.file(extractFile);

    const filesContent = await file.text();
    expect(filesContent).toBe('Hello World');

    await rm(testDir, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
    await rm(outputPath, { force: true });
}, 30000);
