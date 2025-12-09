import { unzipSync, zipSync } from 'fflate';
import { existsSync, readdirSync, statSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join, relative, sep } from 'path';
import type { CacheMetadata, FileMetadata } from './types';

export async function calculateFileChecksum(filePath: string): Promise<string> {
    const content = await Bun.file(filePath).arrayBuffer();
    return new Bun.CryptoHasher('sha256').update(content).digest('hex');
}

export async function calculateDirectoryChecksums(
    paths: string[]
): Promise<Record<string, FileMetadata>> {
    const files: Record<string, FileMetadata> = {};

    async function walk(currentDir: string) {
        for (const entry of readdirSync(currentDir)) {
            const fullPath = join(currentDir, entry);
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
                await walk(fullPath);
            } else if (stat.isFile()) {
                const relativePath = relative('.', fullPath).split(sep).join('/');
                const checksum = await calculateFileChecksum(fullPath);
                files[relativePath] = { checksum, size: stat.size };
            }
        }
    }

    for (const path of paths) {
        if (existsSync(path)) {
            const stat = statSync(path);
            if (stat.isDirectory()) {
                await walk(path);
            } else if (stat.isFile()) {
                const relativePath = relative('.', path).split(sep).join('/');
                const checksum = await calculateFileChecksum(path);
                files[relativePath] = { checksum, size: stat.size };
            }
        }
    }

    return files;
}

export async function validateCache(metadata: CacheMetadata): Promise<boolean> {
    let valid = 0;
    let invalid = 0;
    let missing = 0;

    for (const [filePath, fileInfo] of Object.entries(metadata.files)) {
        const fullPath = join('.', filePath);

        if (!existsSync(fullPath)) {
            missing++;
            continue;
        }

        try {
            const actualChecksum = await calculateFileChecksum(fullPath);
            if (actualChecksum === fileInfo.checksum) {
                valid++;
            } else {
                invalid++;
            }
        } catch (e) {
            invalid++;
        }
    }

    return invalid === 0 && missing === 0;
}

export async function extractZip(zipPath: string): Promise<void> {
    const zipData = await readFile(zipPath);
    const unzipped = unzipSync(new Uint8Array(zipData));

    for (const [filePath, content] of Object.entries(unzipped)) {
        const fullPath = join('.', filePath);
        const dir = join(fullPath, '..');

        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
        await writeFile(fullPath, content);
    }
}

export async function collectFiles(paths: string[]): Promise<Record<string, Uint8Array>> {
    const files: Record<string, Uint8Array> = {};

    async function walk(currentDir: string) {
        for (const entry of readdirSync(currentDir)) {
            const fullPath = join(currentDir, entry);
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
                await walk(fullPath);
            } else if (stat.isFile()) {
                const relativePath = relative('.', fullPath).split(sep).join('/');
                const content = new Uint8Array(await Bun.file(fullPath).arrayBuffer());
                files[relativePath] = content;
            }
        }
    }

    for (const path of paths) {
        if (existsSync(path)) {
            const stat = statSync(path);
            if (stat.isDirectory()) {
                await walk(path);
            } else if (stat.isFile()) {
                const relativePath = relative('.', path).split(sep).join('/');
                const content = new Uint8Array(await Bun.file(path).arrayBuffer());
                files[relativePath] = content;
            }
        }
    }

    return files;
}

export async function compressToZip(
    paths: string[],
    outputPath: string
): Promise<Record<string, FileMetadata>> {
    const checksums = await calculateDirectoryChecksums(paths);
    const files = await collectFiles(paths);
    const zipped = zipSync(files, { level: 6 });
    await writeFile(outputPath, zipped);

    return checksums;
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
        // Ignore EBUSY errors on Windows - directory will be cleaned up eventually
        if (e.code !== 'EBUSY' && e.code !== 'ENOTEMPTY') {
            throw e;
        }
    }
}
