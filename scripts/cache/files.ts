import { exists, mkdir, readdir, rm } from 'node:fs/promises';
import { join, posix } from 'node:path';

import { log } from './logger';
import type { CacheMetadata, FileMetadata } from './utils';

export async function calculateFileChecksum(filePath: string): Promise<string> {
    const fileBlob = Bun.file(filePath);
    const size = fileBlob.size;

    const hasher = new Bun.CryptoHasher('sha256');
    if (size <= 10 * 1024 * 1024 /** 10MB */)
        return hasher.update(await fileBlob.arrayBuffer()).digest('hex');

    const reader = fileBlob.stream().getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) hasher.update(value);
    }

    return hasher.digest('hex');
}

export async function validateCache(metadata: CacheMetadata): Promise<boolean> {
    let valid = 0;
    let invalid = 0;
    let missing = 0;

    const fileEntries = Object.entries(metadata.files);
    const totalFiles = fileEntries.length;
    const logger = log.validation('Validating cache', totalFiles);

    for (const [index, [filePath, fileInfo]] of fileEntries.entries()) {
        const fullPath = join('.', filePath);

        if (!(await exists(fullPath))) {
            missing++;
            logger.progress(index + 1, totalFiles);
            continue;
        }

        try {
            const actualChecksum = await calculateFileChecksum(fullPath);
            if (actualChecksum === fileInfo.checksum) valid++;
            else invalid++;
        } catch {
            invalid++;
        }

        logger.progress(index + 1, totalFiles);
    }

    const isValid = invalid === 0 && missing === 0;
    logger.complete(totalFiles, valid, invalid, missing);

    return isValid;
}

export async function extractTar(tarPath: string, destPath = '.'): Promise<void> {
    const compressedData = await Bun.file(tarPath).arrayBuffer();
    const decompressed = Bun.zstdDecompressSync(new Uint8Array(compressedData));
    const archive = new Bun.Archive(decompressed);
    await archive.extract(destPath);
}

export async function compressToTar(
    paths: string[],
    outputPath: string
): Promise<Record<string, FileMetadata>> {
    const checksums: Record<string, FileMetadata> = {};
    const files: Record<string, Uint8Array> = {};

    for (const path of paths) {
        const entries = await readdir(path, {
            recursive: true,
            withFileTypes: true
        });

        for (const entry of entries) {
            if (entry.isFile()) {
                const fullPath = join(entry.parentPath, entry.name);
                const relativePath = posix.relative('.', fullPath);

                const fileBlob = Bun.file(fullPath);
                const size = fileBlob.size;
                const fileData = await fileBlob.arrayBuffer();

                const checksum = await calculateFileChecksum(fullPath);
                checksums[relativePath] = { checksum, size };
                files[relativePath] = new Uint8Array(fileData);
            }
        }
    }

    const archive = new Bun.Archive(files);
    await Bun.write(outputPath, Bun.zstdCompressSync(await archive.bytes()));

    return checksums;
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
