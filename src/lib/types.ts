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
    commit?: string;
}

export interface AppData {
    extensions: Record<string, ExtensionRepo[]>;
    domains: string[];
    source: string;
    commitLink: string;
    latestCommitHash: string;
}

export interface SearchIndexEntry extends Extension {
    code?: number;
    repoUrl: string;
    sourceName: string;
    formattedSourceName: string;
    category: string;
}
