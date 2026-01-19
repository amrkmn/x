import { $ } from 'bun';
import { mkdir, readdir, rm, exists } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
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

export async function calculateDirectoryChecksums(
    paths: string[]
): Promise<Record<string, FileMetadata>> {
    const files: Record<string, FileMetadata> = {};

    for (const path of paths) {
        const entries = await readdir(path, {
            recursive: true,
            withFileTypes: true
        });

        await Promise.all(
            entries
                .filter((entry) => entry.isFile())
                .map(async (entry) => {
                    const fullPath = join(entry.parentPath, entry.name);
                    const relativePath = relative('.', fullPath).split(sep).join('/');

                    const size = Bun.file(fullPath).size;
                    const checksum = await calculateFileChecksum(fullPath);

                    files[relativePath] = { checksum, size };
                })
        );
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

export async function extractTar(tarPath: string): Promise<void> {
    const compressedData = await Bun.file(tarPath).arrayBuffer();
    const decompressed = Bun.zstdDecompressSync(new Uint8Array(compressedData));

    // Write decompressed tar to temp file
    const tempTarPath = tarPath + '.tmp';
    await Bun.write(tempTarPath, decompressed);

    await $`tar -xf ${tempTarPath}`.quiet().finally(async () => {
        await rm(tempTarPath).catch(() => {});
    });
}

export async function compressToTar(
    paths: string[],
    outputPath: string
): Promise<Record<string, FileMetadata>> {
    const checksums = await calculateDirectoryChecksums(paths);

    const tempTarPath = outputPath + '.tmp';
    await $`tar -cf ${tempTarPath} ${paths}`.quiet();

    try {
        const tarData = await Bun.file(tempTarPath).arrayBuffer();
        const compressed = Bun.zstdCompressSync(new Uint8Array(tarData));
        await Bun.write(outputPath, compressed);
    } finally {
        await rm(tempTarPath).catch(() => {});
    }

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
