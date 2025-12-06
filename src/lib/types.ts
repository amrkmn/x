export interface Extension {
    pkg: string;
    name: string;
    version: string;
    lang: string;
    apk: string;
    nsfw: number;
    sourceName?: string;
}

export interface ExtensionRepo {
    source: string;
    name: string;
    path: string;
    commit: string;
}

export interface AppData {
    extensions: {
        [category: string]: ExtensionRepo[];
    };
    domains: string[];
    source: string;
    commitLink: string;
    latestCommitHash: string;
}
