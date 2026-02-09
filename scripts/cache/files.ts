import { exists, mkdir, readdir, rm } from 'node:fs/promises';
import { join, posix } from 'node:path';

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
    console.log('Validating cache...');
    let valid = 0;
    let invalid = 0;
    let missing = 0;

    const totalFiles = Object.keys(metadata.files).length;

    for (const [filePath, fileInfo] of Object.entries(metadata.files)) {
        const fullPath = join('.', filePath);

        if (!(await exists(fullPath))) {
            missing++;
            continue;
        }

        try {
            const actualChecksum = await calculateFileChecksum(fullPath);
            if (actualChecksum === fileInfo.checksum) valid++;
            else invalid++;
        } catch (e) {
            invalid++;
        }
    }

    const isValid = invalid === 0 && missing === 0;

    if (isValid) {
        console.log(`Cache is valid: ${valid} files matched`);
    } else {
        console.log(
            `Cache validation failed: ${valid} valid, ${invalid} invalid, ${missing} missing (total: ${totalFiles})`
        );
    }

    return isValid;
}

export async function extractTar(
    tarPath: string,
    destPath = '.',
    onProgress?: (phase: 'decompress' | 'extract', percent: number) => void
): Promise<void> {
    onProgress?.('decompress', 0);
    const compressedData = await Bun.file(tarPath).arrayBuffer();
    const decompressed = Bun.zstdDecompressSync(new Uint8Array(compressedData));
    onProgress?.('decompress', 100);

    onProgress?.('extract', 0);
    const archive = new Bun.Archive(decompressed);
    await archive.extract(destPath);
    onProgress?.('extract', 100);
}

export async function compressToTar(
    paths: string[],
    outputPath: string,
    onProgress?: (phase: 'read' | 'archive' | 'compress', percent: number) => void
): Promise<Record<string, FileMetadata>> {
    const checksums: Record<string, FileMetadata> = {};
    const files: Record<string, Uint8Array> = {};

    onProgress?.('read', 0);
    const allEntries: Array<{ path: string; entry: any }> = [];
    for (const path of paths) {
        const entries = await readdir(path, {
            recursive: true,
            withFileTypes: true
        });
        for (const entry of entries) {
            if (entry.isFile()) {
                allEntries.push({ path, entry });
            }
        }
    }

    const totalFiles = allEntries.length;
    let processedFiles = 0;

    for (const { entry } of allEntries) {
        const fullPath = join(entry.parentPath, entry.name);
        const relativePath = posix.relative('.', fullPath);

        const fileBlob = Bun.file(fullPath);
        const size = fileBlob.size;
        const fileData = await fileBlob.arrayBuffer();

        const checksum = await calculateFileChecksum(fullPath);
        checksums[relativePath] = { checksum, size };
        files[relativePath] = new Uint8Array(fileData);

        processedFiles++;
        onProgress?.('read', Math.floor((processedFiles / totalFiles) * 100));
    }

    onProgress?.('archive', 0);
    const archive = new Bun.Archive(files);
    const tarData = await archive.bytes();
    onProgress?.('archive', 100);

    onProgress?.('compress', 0);
    await Bun.write(outputPath, Bun.zstdCompressSync(tarData));
    onProgress?.('compress', 100);

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
