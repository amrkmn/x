import fs from "fs/promises";
import ejs from "ejs";
import { join } from "path";
import { PathLike } from "fs";
import { config } from "./config.js";

const outputDirectory = join(process.cwd(), config.directories.output);
const templateDirectory = join(process.cwd(), config.directories.templates);
const extensionsDirectory = join(process.cwd(), config.directories.extensions);
const extensionNames = config.extensions;
const filesToCopy = config.filesToCopy;

const { owner: repositoryOwner, repo: repositoryName, branch: gitBranch } = config.github;
const githubCommitsApiUrl = `https://api.github.com/repos/${repositoryOwner}/${repositoryName}/commits/${gitBranch}`;

const deploymentDomains = config.domains;
const extensionSources = config.extensionSources;

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
        if (err.code !== "ENOENT") {
            console.error(`Error copying ${src} to ${dest}:`, err);
        }
    }
}

async function copyExtensions() {
    try {
        await ensureDir(outputDirectory);

        for (const extensionName of extensionNames) {
            const sourceExtensionPath = join(extensionsDirectory, extensionName);
            const destinationExtensionPath = join(outputDirectory, extensionName);

            await ensureDir(destinationExtensionPath);

            for (const fileItem of filesToCopy) {
                const sourceItemPath = join(sourceExtensionPath, fileItem);
                const destinationItemPath = join(destinationExtensionPath, fileItem);

                await copyRecursive(sourceItemPath, destinationItemPath);
                console.log(`Copied ${fileItem} from ${extensionName} to dist/${extensionName}`);
            }
        }
        console.log("Submodules copied successfully to dist!");
    } catch (error) {}
}

try {
    await copyExtensions();
    const apiResponse = await fetch(githubCommitsApiUrl);
    const commitsData = await apiResponse.json();
    const latestCommitHash = `${commitsData.sha}`.substring(0, 7);
    const commitLink = commitsData.html_url;
    const repositorySource = `https://github.com/${repositoryOwner}/${repositoryName}`;

    const templateContent = await fs.readFile(`${templateDirectory}/index.ejs`, "utf-8");
    const renderedOutput = ejs.render(
        templateContent,
        {
            extensions: extensionSources,
            source: repositorySource,
            commitLink,
            latestCommitHash,
            domains: deploymentDomains,
        },
        { views: [join(__dirname, "templates")] }
    );

    await fs.writeFile(`${outputDirectory}/index.html`, renderedOutput);
    console.log(`Build index.html with commit hash: ${latestCommitHash} (${commitLink})`);
} catch (error) {
    console.error(error);
    process.exit(1);
}
