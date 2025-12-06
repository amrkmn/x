import { $ } from 'bun';
import { join } from 'path';
import { config } from './config';
import type { ExtensionConfig, ExtensionSources } from './types';

// Read extensions.json
const extensionsData: Record<string, Record<string, ExtensionConfig>> = await Bun.file(
    'extensions.json'
).json();

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
                commit: ext.commit
            });
        }
    }

    return sources;
}

const staticDirectory = join(process.cwd(), 'static');
const { owner: repositoryOwner, repo: repositoryName } = config.github;
const deploymentDomains = config.domains;

try {
    // Get latest commit hash using git
    const longCommitHash = (await $`git rev-parse HEAD`.text()).trim();
    const latestCommitHash = longCommitHash.substring(0, 7);

    const repositorySource = `https://github.com/${repositoryOwner}/${repositoryName}`;
    const commitLink = `${repositorySource}/commit/${longCommitHash}`;

    // Prepare data object
    const data = {
        extensions: getExtensionSources(),
        domains: deploymentDomains,
        source: repositorySource,
        commitLink,
        latestCommitHash
    };

    await Bun.write(join(staticDirectory, 'data.json'), JSON.stringify(data));

    console.log(`Build data.json with commit hash: ${latestCommitHash} (${commitLink})`);
} catch (error) {
    console.error(error);
    process.exit(1);
}
