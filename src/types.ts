// Type definitions for config.json
export interface ExtensionConfig {
    dirname: string;
    source: string;
    name: string;
    path: string;
    category: "mihon" | "aniyomi";
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
        templates: string;
        extensions: string;
    };
    filesToCopy: string[];
    extensions: Record<string, ExtensionConfig>;
}

export interface ExtensionSources {
    [category: string]: Array<{
        source: string;
        name: string;
        path: string;
    }>;
}
