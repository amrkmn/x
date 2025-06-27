// Extension configuration types
interface ExtensionConfig {
    directoryName: string;
    source: string;
    name: string;
    path: string;
    category: "mihon" | "aniyomi";
}

interface ExtensionSources {
    [category: string]: Array<{
        source: string;
        name: string;
        path: string;
    }>;
}

// Combined extension configurations
const extensionConfigs: Record<string, ExtensionConfig> = {
    keiyoushi: {
        directoryName: "keiyoushi",
        source: "https://github.com/keiyoushi/extensions",
        name: "Keiyoushi",
        path: "/keiyoushi/index.min.json",
        category: "mihon",
    },
    "kohi-den": {
        directoryName: "kohi-den",
        source: "https://kohiden.xyz/Kohi-den/extensions",
        name: "Kohi-den",
        path: "/kohi-den/index.min.json",
        category: "aniyomi",
    },
};

// Helper functions to derive configurations
function getExtensions(): string[] {
    return Object.values(extensionConfigs).map((config) => config.directoryName);
}

function getExtensionSources(): ExtensionSources {
    const sources: ExtensionSources = {};

    for (const config of Object.values(extensionConfigs)) {
        if (!sources[config.category]) {
            sources[config.category] = [];
        }
        sources[config.category].push({
            source: config.source,
            name: config.name,
            path: config.path,
        });
    }

    return sources;
}

export const config = {
    directories: {
        output: "dist",
        templates: "src/templates",
        extensions: "extensions",
    },
    filesToCopy: [
        "index.json", //
        "index.min.json",
        "repo.json",
        "apk",
        "icon",
    ],
    github: {
        owner: "amrkmn",
        repo: "x",
        branch: "main",
    },
    domains: [
        "https://x.noz.one", //
        "https://x.ujol.dev",
        "https://amrkmn.github.io/x",
    ],
    extensionConfigs,
    get extensions() {
        return getExtensions();
    },
    get extensionSources() {
        return getExtensionSources();
    },
};
