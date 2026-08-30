import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import * as tar from 'tar';

import { logger } from '../log';
import type { CacheMetadata, FileMetadata } from './utils';

export async function calculateFileChecksum(filePath: string): Promise<string> {
    const data = await readFile(filePath);
    return createHash('sha256').update(data).digest('hex');
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

        if (!existsSync(fullPath)) {
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

async function collectStream(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

interface TarEntryInfo {
    path: string;
    size: number;
    type: string;
}

async function listTarEntries(data: Uint8Array): Promise<TarEntryInfo[]> {
    const entries: TarEntryInfo[] = [];
    const parser = tar.t({
        onReadEntry(entry) {
            entries.push({ path: entry.path, size: entry.size, type: entry.type });
        }
    });
    await pipeline(Readable.from(data), parser);
    return entries;
}

function isRegularTarEntry(type: string): boolean {
    return type === 'File' || type === 'Directory';
}

export async function extractTar(tarPath: string, destPath = '.'): Promise<void> {
    const compressedData = await readFile(tarPath);
    const decompressed = zstdDecompressSync(compressedData);
    const entries = await listTarEntries(decompressed);
    const files = entries.filter((entry) => entry.type === 'File');
    const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
    const progress = logger.counter(
        'cache',
        'restore extract progress',
        files.length,
        totalBytes,
        'restore extract'
    );

    let extractedFiles = 0;
    let extractedBytes = 0;
    const extractor = tar.x({
        cwd: destPath,
        strict: true,
        filter(_path, entry) {
            return 'type' in entry && isRegularTarEntry(entry.type);
        },
        onReadEntry(entry) {
            if (entry.type !== 'File') return;
            extractedFiles += 1;
            extractedBytes += entry.size;
            progress.progress(extractedFiles, extractedBytes);
        }
    });

    await pipeline(Readable.from(decompressed), extractor);
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
            const size = (await stat(fullPath)).size;
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
        const fileData = await readFile(fullPath);
        const checksum = await calculateFileChecksum(fullPath);
        checksums[relativePath] = { checksum, size };
        files[relativePath] = fileData;
        processedBytes += size;
        progress.progress(index + 1, processedBytes);
    }

    const archive = tar.c({ cwd: '.', portable: true }, Object.keys(files));
    const tarData = await collectStream(archive);
    await writeFile(outputPath, zstdCompressSync(tarData));

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
    if (!existsSync(dir)) {
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
