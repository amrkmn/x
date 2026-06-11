import { exists, mkdir, readdir, rm } from 'node:fs/promises';
import { join, posix } from 'node:path';

import { logger } from '../log';
import type { CacheMetadata, FileMetadata } from './utils';

export async function calculateFileChecksum(filePath: string): Promise<string> {
    const data = await Bun.file(filePath).arrayBuffer();
    return Bun.hash.rapidhash(data).toString(16);
}

export async function validateCache(metadata: CacheMetadata): Promise<boolean> {
    let valid = 0;
    let invalid = 0;
    let missing = 0;

    const fileEntries = Object.entries(metadata.files);
    const totalFiles = fileEntries.length;
    const progressLogger = logger.validation('[cache] validating cache', totalFiles);

    for (const [index, [filePath, fileInfo]] of fileEntries.entries()) {
        const fullPath = join('.', filePath);

        if (!(await exists(fullPath))) {
            missing++;
            progressLogger.progress(index + 1, totalFiles);
            continue;
        }

        try {
            const actualChecksum = await calculateFileChecksum(fullPath);
            if (actualChecksum === fileInfo.checksum) valid++;
            else invalid++;
        } catch {
            invalid++;
        }

        progressLogger.progress(index + 1, totalFiles);
    }

    const isValid = invalid === 0 && missing === 0;
    progressLogger.complete(totalFiles, valid, invalid, missing);

    return isValid;
}

export async function extractTar(tarPath: string, destPath = '.'): Promise<void> {
    const compressedData = await Bun.file(tarPath).arrayBuffer();
    const decompressed = Bun.zstdDecompressSync(new Uint8Array(compressedData));
    const archive = new Bun.Archive(decompressed);
    await archive.extract(destPath);
}

async function collectFileEntries(
    paths: string[]
): Promise<Array<{ fullPath: string; relativePath: string; size: number }>> {
    const allEntries: Array<{ fullPath: string; relativePath: string; size: number }> = [];

    for (const path of paths) {
        const entries = await readdir(path, { recursive: true, withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) continue;

            const fullPath = join(entry.parentPath, entry.name);
            const relativePath = posix.relative('.', fullPath);
            const size = Bun.file(fullPath).size;
            allEntries.push({ fullPath, relativePath, size });
        }
    }

    return allEntries;
}

export async function compressToTar(
    paths: string[],
    outputPath: string
): Promise<Record<string, FileMetadata>> {
    const checksums: Record<string, FileMetadata> = {};
    const files: Record<string, Uint8Array> = {};

    for (const { fullPath, relativePath, size } of await collectFileEntries(paths)) {
        const fileData = await Bun.file(fullPath).arrayBuffer();
        const checksum = await calculateFileChecksum(fullPath);
        checksums[relativePath] = { checksum, size };
        files[relativePath] = new Uint8Array(fileData);
    }

    const archive = new Bun.Archive(files);
    await Bun.write(outputPath, Bun.zstdCompressSync(await archive.bytes()));

    return checksums;
}

export async function checksumFiles(paths: string[]): Promise<Record<string, FileMetadata>> {
    const result: Record<string, FileMetadata> = {};
    const allEntries = await collectFileEntries(paths);
    const total = allEntries.length;
    const progressLogger = logger.validation('[cache] hashing extracted files', total);

    for (const [index, { fullPath, relativePath, size }] of allEntries.entries()) {
        const checksum = await calculateFileChecksum(fullPath);
        result[relativePath] = { checksum, size };
        progressLogger.progress(index + 1, total);
    }

    progressLogger.complete(total, total, 0, 0);

    return result;
}

export async function ensureDir(dir: string): Promise<void> {
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
    }
}

export async function cleanupDir(dir: string): Promise<void> {
    try {
        await rm(dir, { recursive: true, force: true });
    } catch (e: any) {
        if (e.code !== 'EBUSY' && e.code !== 'ENOTEMPTY') {
            throw e;
        }
    }
}
