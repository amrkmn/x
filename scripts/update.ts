import { $ } from "bun";
import { existsSync } from "fs";
import fs from "fs/promises";
import { join } from "path";
import { config } from "./config";
import type { ExtensionConfig } from "./types";

// Load extensions configuration
const extensionsPath = join(process.cwd(), "extensions.json");
let extensions: Record<string, ExtensionConfig> = {};
if (existsSync(extensionsPath)) {
    const content = await fs.readFile(extensionsPath, "utf-8");
    extensions = JSON.parse(content);
}

let hasUpdates = false;
const extensionsToUpdate: string[] = [];

console.log("Checking for updates...");

const extensionsDir = join(process.cwd(), config.directories.extensions);

for (const [key, ext] of Object.entries(extensions)) {
    try {
        const output = await $`git ls-remote ${ext.source} HEAD`.text();
        const hash = output.split("\t")[0];

        const previousHash = ext.commit;
        const extDestDir = join(extensionsDir, key);
        const isMissing = !existsSync(extDestDir);

        if (previousHash !== hash) {
            console.log(`Update detected for ${ext.name}: ${previousHash} -> ${hash}`);
            hasUpdates = true;
            extensions[key].commit = hash;
        } else {
            console.log(`No update for ${ext.name} (Hash: ${hash})`);
        }

        // If we have updates (globally) OR this specific extension is missing, we need to process it.
        // But we can't know "globally" inside the loop easily without two passes or a deferred check.
        // However, if we just track what needs doing:
        if (previousHash !== hash || isMissing) {
            extensionsToUpdate.push(key);
        }
    } catch (e) {
        console.error(`Failed to check updates for ${ext.name}`, e);
        // If check fails, assume we might need to update if it's missing
        extensionsToUpdate.push(key);
    }
}

// Determine if we should proceed with download
// We download if:
// 1. There are actual updates (hash changes)
// 2. We are NOT in CI (local development, restore missing files)
// 3. We are in CI but it's a manual trigger (workflow_dispatch)
const isCI = process.env.CI === "true";
const isManual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
const shouldDownload = hasUpdates || !isCI || isManual;

if (extensionsToUpdate.length === 0 || !shouldDownload) {
    console.log(extensionsToUpdate.length === 0 ? "No updates found." : "No updates found (CI). Skipping download.");
    if (process.env.GITHUB_OUTPUT) {
        await fs.appendFile(process.env.GITHUB_OUTPUT, "updated=false\n");
    }
    process.exit(0);
}

if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `updated=${hasUpdates}\n`);
}

// Save updated extensions config with new commit hashes
if (hasUpdates) {
    await fs.writeFile(extensionsPath, JSON.stringify(extensions, null, 4));
}

const tempDir = join(process.cwd(), "tmp");
const tempExtensionsDir = join(tempDir, "extensions");

// Clean temp dir
if (existsSync(tempDir)) {
    await fs.rm(tempDir, { recursive: true, force: true });
}
await fs.mkdir(tempExtensionsDir, { recursive: true });

// Ensure extensions directory exists
if (!existsSync(extensionsDir)) {
    await fs.mkdir(extensionsDir, { recursive: true });
}

console.log("Starting extension update...");

for (const key of extensionsToUpdate) {
    const ext = extensions[key];
    console.log(`Processing ${ext.name} (${key})...`);

    const extTempDir = join(tempExtensionsDir, key);
    const extDestDir = join(extensionsDir, key);

    try {
        console.log(`  Cloning ${ext.source}...`);
        await $`git clone --depth 1 ${ext.source} ${extTempDir}`.quiet();

        // Clean destination for this extension
        if (existsSync(extDestDir)) {
            await fs.rm(extDestDir, { recursive: true, force: true });
        }
        await fs.mkdir(extDestDir, { recursive: true });

        for (const file of config.filesToCopy) {
            const srcPath = join(extTempDir, file);
            const destPath = join(extDestDir, file);

            if (existsSync(srcPath)) {
                await fs.cp(srcPath, destPath, { recursive: true });
                console.log(`  Copied ${file}`);
            }
        }
    } catch (error) {
        console.error(`  Failed to update ${ext.name}:`, error);
    }
}

console.log("Cleaning up...");
await fs.rm(tempDir, { recursive: true, force: true });
console.log("Update complete!");
