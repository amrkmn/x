import { $ } from 'bun';
import { existsSync } from 'fs';
import { appendFile, cp, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { config } from './config';
import type { ExtensionConfig } from './types';

// Load extensions configuration
const extensionsData: Record<string, Record<string, ExtensionConfig>> = await Bun.file(
    'extensions.json'
).json();

const extensionsDir = join(process.cwd(), 'static');
const dataJsonPath = join(extensionsDir, 'data.json');

// Load synced state from data.json if it exists
const syncedCommits = new Map<string, string>();
try {
    const dataJson = await Bun.file(dataJsonPath).json();
    if (dataJson.extensions) {
        Object.values(dataJson.extensions)
            .flat()
            .forEach((ext: any) => {
                if (ext?.path && ext?.commit) syncedCommits.set(ext.path, ext.commit);
            });
    }
} catch (e) {
    // Ignore missing or invalid data.json
}

console.log('Checking for updates...');

let hasUpdates = false;
const extensionsToUpdate: Array<{ category: string; key: string; newHash: string }> = [];

// Check each extension for updates
for (const [category, extensions] of Object.entries(extensionsData)) {
    for (const [key, ext] of Object.entries(extensions)) {
        try {
            const extDestDir = join(extensionsDir, key);
            const isMissing = !existsSync(extDestDir);

            // Get the synced hash from data.json map
            const syncedHash = syncedCommits.get(ext.path);
            const configHash = ext.commit;

            // Check if config and synced are out of sync (failed previous update or manual change)
            const isOutOfSync = syncedHash !== configHash;

            // Fetch remote hash
            const output = await $`git ls-remote ${ext.source} HEAD`.text();
            const remoteHash = output.split('\t')[0];

            // Determine if we need to update
            if (remoteHash !== syncedHash) {
                // Remote has new changes compared to what we have synced
                console.log(
                    `Update detected for ${ext.name}: ${syncedHash?.substring(0, 7) || 'none'} -> ${remoteHash.substring(0, 7)}`
                );
                hasUpdates = true;
                extensionsToUpdate.push({ category, key, newHash: remoteHash });
            } else if (isOutOfSync || isMissing) {
                // Config says we have a hash but files are missing or synced hash differs
                console.log(`Re-sync needed for ${ext.name} (missing files or out of sync)`);
                extensionsToUpdate.push({ category, key, newHash: remoteHash });
            } else {
                console.log(`No update for ${ext.name} (Hash: ${remoteHash.substring(0, 7)})`);
            }
        } catch (e) {
            console.error(`Failed to check updates for ${ext.name}`, e);
            // If check fails and files are missing, try to update anyway
            const extDestDir = join(extensionsDir, key);
            if (!existsSync(extDestDir) && ext.commit) {
                extensionsToUpdate.push({ category, key, newHash: ext.commit });
            }
        }
    }
}

// Determine if we should proceed with download
const isCI = process.env.CI === 'true';
const isManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const shouldDownload = hasUpdates || !isCI || isManual;

if (extensionsToUpdate.length === 0 || !shouldDownload) {
    console.log(
        extensionsToUpdate.length === 0
            ? 'No updates found.'
            : 'No updates found (CI). Skipping download.'
    );
    if (process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, 'updated=false\n');
    }
    process.exit(0);
}

const tempDir = join(process.cwd(), 'tmp');
const tempExtensionsDir = join(tempDir, 'extensions');

// Clean temp dir
if (existsSync(tempDir)) {
    await rm(tempDir, { recursive: true, force: true });
}
await mkdir(tempExtensionsDir, { recursive: true });

// Ensure extensions directory exists
if (!existsSync(extensionsDir)) {
    await mkdir(extensionsDir, { recursive: true });
}

console.log('Starting extension update...');

let successCount = 0;
const successfulUpdates: Array<{ category: string; key: string; newHash: string }> = [];

for (const { category, key, newHash } of extensionsToUpdate) {
    const ext = extensionsData[category][key];
    console.log(`Processing ${ext.name} (${key})...`);

    const extTempDir = join(tempExtensionsDir, key);
    const extDestDir = join(extensionsDir, key);

    try {
        console.log(`  Cloning ${ext.source}...`);
        await $`git clone --depth 1 ${ext.source} ${extTempDir}`.quiet();

        // Clean destination and recreate
        if (existsSync(extDestDir)) {
            await rm(extDestDir, { recursive: true, force: true });
        }
        await mkdir(extDestDir, { recursive: true });

        // Copy each configured file/directory
        for (const file of config.filesToCopy) {
            const srcPath = join(extTempDir, file);
            const destPath = join(extDestDir, file);

            if (existsSync(srcPath)) {
                await cp(srcPath, destPath, { recursive: true });
                console.log(`  Copied ${file}`);
            }
        }

        // Only mark as successful after files are copied
        successCount++;
        successfulUpdates.push({ category, key, newHash });
        console.log(`  Successfully updated ${ext.name}`);
    } catch (error) {
        console.error(`  Failed to update ${ext.name}:`, error);
        // Don't update the hash for failed extensions
    }
}

console.log('Cleaning up...');
await rm(tempDir, { recursive: true, force: true });

// Check if we have actual new updates by comparing against the ORIGINAL extensionsData
// (the root extensions.json that will be committed). If the newHash matches what's
// already in extensionsData, there's no actual change to commit.
const hasActualUpdates = successfulUpdates.some(({ category, key, newHash }) => {
    const originalConfigHash = extensionsData[category]?.[key]?.commit;
    return originalConfigHash !== newHash;
});

// Only update configs if we had successful updates
if (successfulUpdates.length > 0) {
    // Update extensionsData with successful hashes only
    for (const { category, key, newHash } of successfulUpdates) {
        extensionsData[category][key].commit = newHash;
    }

    // Only write root extensions.json if there are actual hash changes
    if (hasActualUpdates) {
        await Bun.write('extensions.json', JSON.stringify(extensionsData, null, 4));
        console.log('Updated extensions.json');
    }

    // Regenerate data.json to reflect new state
    console.log('Regenerating data.json...');
    await $`bun scripts/index.ts`;
}

if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `updated=${hasActualUpdates}\n`);
}

console.log(
    `Update complete! ${successCount}/${extensionsToUpdate.length} extensions updated successfully.`
);
