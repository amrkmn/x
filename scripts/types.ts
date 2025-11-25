// Type definitions for config.json
export interface ExtensionConfig {
    source: string;
    name: string;
    path: string;
    category: "mihon" | "aniyomi";
    commit?: string;
}

export interface Config {
    github: {
        owner: string;
        repo: string;
        branch: string;
    };
    domains: string[];
    directories: {
        output: string;
        extensions: string;
    };
    filesToCopy: string[];
}

export interface ExtensionSources {
    [category: string]: Array<{
        source: string;
        name: string;
        path: string;
        commit?: string;
    }>;
}
