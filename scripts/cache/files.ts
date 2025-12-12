import { create, extract } from 'tar';
import { existsSync, readdirSync, statSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join, relative, sep } from 'path';
import type { CacheMetadata, FileMetadata } from './utils';

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
    console.log('Validating cache...');
    let valid = 0;
    let invalid = 0;
    let missing = 0;

    const totalFiles = Object.keys(metadata.files).length;

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

export async function extractTar(tarPath: string): Promise<void> {
    await extract({
        file: tarPath,
        cwd: '.'
    });
}

export async function compressToTar(
    paths: string[],
    outputPath: string
): Promise<Record<string, FileMetadata>> {
    const checksums = await calculateDirectoryChecksums(paths);

    await create(
        {
            gzip: true,
            file: outputPath,
            cwd: '.'
        },
        paths
    );

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
