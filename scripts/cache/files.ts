import { exists, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

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
    const totalBytes = Object.values(metadata.files).reduce((sum, f) => sum + f.size, 0);
    const progress = logger.counter(
        'cache',
        'validating cache',
        totalFiles,
        totalBytes,
        'restore validate'
    );

    let processedBytes = 0;
    for (const [index, [filePath, fileInfo]] of fileEntries.entries()) {
        const fullPath = join('.', filePath);

        if (!(await exists(fullPath))) {
            missing++;
        } else {
            try {
                const actualChecksum = await calculateFileChecksum(fullPath);
                if (actualChecksum === fileInfo.checksum) valid++;
                else invalid++;
            } catch {
                invalid++;
            }
        }

        processedBytes += fileInfo.size;
        progress.progress(index + 1, processedBytes);
    }

    progress.complete({ valid, invalid, missing });

    return invalid === 0 && missing === 0;
}

export async function extractTar(tarPath: string, destPath = '.'): Promise<void> {
    const compressedData = await Bun.file(tarPath).arrayBuffer();
    const decompressed = Bun.zstdDecompressSync(new Uint8Array(compressedData));
    const archive = new Bun.Archive(decompressed);
    const files = await archive.files();
    const entries = Array.from(files.entries());

    const totalBytes = entries.reduce((sum, [, file]) => sum + file.size, 0);
    const totalFiles = entries.length;
    const progress = logger.counter(
        'cache',
        'restore extract progress',
        totalFiles,
        totalBytes,
        'restore extract'
    );

    let extractedBytes = 0;
    for (const [index, [relativePath, file]] of entries.entries()) {
        const outputPath = join(destPath, relativePath);
        await mkdir(dirname(outputPath), { recursive: true });
        await Bun.write(outputPath, file);

        extractedBytes += file.size;
        progress.progress(index + 1, extractedBytes);
    }

    progress.complete({ bytes: extractedBytes });
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
    const entries = await collectFileEntries(paths);
    const total = entries.length;
    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    const progress = logger.counter(
        'cache',
        'save compress progress',
        total,
        totalBytes,
        'save compress'
    );

    let processedBytes = 0;
    for (const [index, { fullPath, relativePath, size }] of entries.entries()) {
        const fileData = await Bun.file(fullPath).arrayBuffer();
        const checksum = await calculateFileChecksum(fullPath);
        checksums[relativePath] = { checksum, size };
        files[relativePath] = new Uint8Array(fileData);
        processedBytes += size;
        progress.progress(index + 1, processedBytes);
    }

    const archive = new Bun.Archive(files);
    await Bun.write(outputPath, Bun.zstdCompressSync(await archive.bytes()));

    progress.complete({ bytes: totalBytes });

    return checksums;
}

export async function checksumFiles(paths: string[]): Promise<Record<string, FileMetadata>> {
    const result: Record<string, FileMetadata> = {};
    const allEntries = await collectFileEntries(paths);
    const total = allEntries.length;
    const totalBytes = allEntries.reduce((sum, e) => sum + e.size, 0);
    const progress = logger.counter(
        'cache',
        'hashing extracted files',
        total,
        totalBytes,
        'restore metadata'
    );

    let processedBytes = 0;
    for (const [index, { fullPath, relativePath, size }] of allEntries.entries()) {
        const checksum = await calculateFileChecksum(fullPath);
        result[relativePath] = { checksum, size };
        processedBytes += size;
        progress.progress(index + 1, processedBytes);
    }

    progress.complete({ valid: total, invalid: 0, missing: 0 });

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
