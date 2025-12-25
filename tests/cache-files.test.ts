import { test, expect, beforeEach, afterEach } from 'bun:test';
import { calculateFileChecksum, ensureDir, cleanupDir } from '../scripts/cache/files';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), 'bun-test-cache');

beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
});

test('calculateFileChecksum returns consistent hash for same content', async () => {
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'Hello, World!');

    const hash1 = await calculateFileChecksum(filePath);
    const hash2 = await calculateFileChecksum(filePath);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 produces 64 hex characters
});

test('calculateFileChecksum returns different hashes for different content', async () => {
    const filePath1 = join(testDir, 'test1.txt');
    const filePath2 = join(testDir, 'test2.txt');

    await writeFile(filePath1, 'Hello, World!');
    await writeFile(filePath2, 'Goodbye, World!');

    const hash1 = await calculateFileChecksum(filePath1);
    const hash2 = await calculateFileChecksum(filePath2);

    expect(hash1).not.toBe(hash2);
});

test('calculateFileChecksum handles empty file', async () => {
    const filePath = join(testDir, 'empty.txt');
    await writeFile(filePath, '');

    const hash = await calculateFileChecksum(filePath);
    expect(hash).toHaveLength(64);
});

test('calculateFileChecksum handles larger file', async () => {
    const filePath = join(testDir, 'large.txt');
    const content = 'x'.repeat(11 * 1024 * 1024); // ~11MB (over 10MB threshold)
    await writeFile(filePath, content);

    const hash = await calculateFileChecksum(filePath);
    expect(hash).toHaveLength(64);
});

test('ensureDir creates directory if it does not exist', async () => {
    const newDir = join(testDir, 'new-directory');

    await ensureDir(newDir);

    // Check if directory exists by trying to create a file in it
    await writeFile(join(newDir, 'test.txt'), 'test');
    expect(true).toBe(true); // If we get here, directory exists
});

test('ensureDir does not error if directory already exists', async () => {
    await ensureDir(testDir);
    await ensureDir(testDir); // Should not throw

    expect(true).toBe(true);
});

test('cleanupDir removes directory and all contents', async () => {
    const subDir = join(testDir, 'subdir');
    await mkdir(subDir);
    await writeFile(join(subDir, 'file.txt'), 'content');
    await writeFile(join(testDir, 'file2.txt'), 'content2');

    await cleanupDir(testDir);

    // Directory should be gone
    let exists = true;
    try {
        await writeFile(join(testDir, 'test.txt'), 'test');
    } catch {
        exists = false;
    }
    expect(exists).toBe(false);
});

test('cleanupDir handles non-existent directory', async () => {
    const nonExistent = join(testDir, 'does-not-exist');

    // Should not throw
    await cleanupDir(nonExistent);

    expect(true).toBe(true);
});
