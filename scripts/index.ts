import { $ } from "bun";
import { PathLike } from "fs";
import { cp, mkdir, readdir, stat } from "fs/promises";
import { join } from "path";
import { config } from "./config";
import type { ExtensionConfig, ExtensionSources } from "./types";

// Read extensions.json
const extensionsData: Record<string, Record<string, ExtensionConfig>> = await Bun.file("extensions.json").json();

// Helper functions to process config data
function getExtensionNames(): string[] {
    const names: string[] = [];
    for (const extensions of Object.values(extensionsData)) {
        names.push(...Object.keys(extensions));
    }
    return names;
}

function getExtensionSources(): ExtensionSources {
    const sources: ExtensionSources = {};

    for (const [category, extensions] of Object.entries(extensionsData)) {
        if (!sources[category]) {
            sources[category] = [];
        }
        for (const ext of Object.values(extensions)) {
            sources[category].push({
                source: ext.source,
                name: ext.name,
                path: ext.path,
                commit: ext.commit,
            });
        }
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
        await mkdir(path, { recursive: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            console.error(`Error creating directory ${path}:`, error);
        }
    }
}
async function copyRecursive(src: string, dest: string) {
    try {
        const file = await stat(src);
        if (file.isDirectory()) {
            await ensureDir(dest);
            const files = await readdir(src);
            await Promise.all(files.map((file) => copyRecursive(join(src, file), join(dest, file))));
        } else {
            await cp(src, dest);
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

    await Bun.write(join(outputDirectory, "data.json"), JSON.stringify(data));

    console.log(`Build data.json with commit hash: ${latestCommitHash} (${commitLink})`);
} catch (error) {
    console.error(error);
    process.exit(1);
}
