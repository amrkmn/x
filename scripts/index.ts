import { $ } from "bun";
import { PathLike } from "fs";
import fs from "fs/promises";
import { join } from "path";
import { config } from "./config";
import type { ExtensionConfig, ExtensionSources } from "./types";

// Read extensions.json
const extensionsPath = join(process.cwd(), "extensions.json");
const extensionsFile = await fs.readFile(extensionsPath, "utf-8");
const extensions: Record<string, ExtensionConfig> = JSON.parse(extensionsFile);

// Helper functions to process config data
function getExtensionNames(): string[] {
    return Object.values(extensions).map((ext) => ext.dirname);
}

function getExtensionSources(): ExtensionSources {
    const sources: ExtensionSources = {};

    for (const ext of Object.values(extensions)) {
        if (!sources[ext.category]) {
            sources[ext.category] = [];
        }
        sources[ext.category].push({
            source: ext.source,
            name: ext.name,
            path: ext.path,
            commit: ext.commit,
        });
    }

    return sources;
}

const outputDirectory = join(process.cwd(), config.directories.output);
const extensionsDirectory = join(process.cwd(), config.directories.extensions);
const extensionNames = getExtensionNames();
const filesToCopy = config.filesToCopy;

const { owner: repositoryOwner, repo: repositoryName } = config.github;

const deploymentDomains = config.domains;
const extensionSources = getExtensionSources();

async function ensureDir(path: PathLike) {
    try {
        await fs.mkdir(path, { recursive: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            console.error(`Error creating directory ${path}:`, error);
        }
    }
}
async function copyRecursive(src: string, dest: string) {
    try {
        const stat = await fs.stat(src);
        if (stat.isDirectory()) {
            await ensureDir(dest);
            const files = await fs.readdir(src);
            await Promise.all(files.map((file) => copyRecursive(join(src, file), join(dest, file))));
        } else {
            await fs.cp(src, dest);
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error(`Error copying ${src} to ${dest}:`, err);
        }
    }
}

async function copyExtensions() {
    try {
        // Extensions are now copied to existing dist created by Vite
        // Ensure dist directory exists (it should already exist from Vite build)

        for (const extensionName of extensionNames) {
            const sourceExtensionPath = join(extensionsDirectory, extensionName);
            const destinationExtensionPath = join(outputDirectory, extensionName);

            await ensureDir(destinationExtensionPath);

            console.log(`Copying ${extensionName}...`);

            for (const fileItem of filesToCopy) {
                const sourceItemPath = join(sourceExtensionPath, fileItem);
                const destinationItemPath = join(destinationExtensionPath, fileItem);

                await copyRecursive(sourceItemPath, destinationItemPath);
            }
        }
        console.log("Extensions copied successfully to dist");
    } catch (error) {}
}

try {
    await copyExtensions();

    // Get latest commit hash using git
    const longCommitHash = (await $`git rev-parse HEAD`.text()).trim();
    const latestCommitHash = longCommitHash.substring(0, 7);

    const repositorySource = `https://github.com/${repositoryOwner}/${repositoryName}`;
    const commitLink = `${repositorySource}/commit/${longCommitHash}`;

    // Prepare data object
    const data = {
        extensions: extensionSources,
        domains: deploymentDomains,
        source: repositorySource,
        commitLink,
        latestCommitHash,
    };

    await fs.writeFile(join(outputDirectory, "data.json"), JSON.stringify(data));

    console.log(`Build data.json with commit hash: ${latestCommitHash} (${commitLink})`);
} catch (error) {
    console.error(error);
    process.exit(1);
}
