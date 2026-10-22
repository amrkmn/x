import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AppData } from './types';
import { parseAppData, parseSearchIndex } from './validation';

export function loadAppData(): AppData {
    const dataPath = resolve('static/data.json');
    const data = parseAppData(JSON.parse(readFileSync(dataPath, 'utf-8')));
    attachExtensionCounts(data);
    return data;
}

function repoUrlFromPath(path: string): string {
    return path.replace(/\/index(\..*)?$/, '') || '/';
}

function attachExtensionCounts(data: AppData): void {
    let counts: Map<string, number>;
    try {
        const entries = parseSearchIndex(
            JSON.parse(readFileSync(resolve('static/indexes.json'), 'utf-8'))
        );
        counts = new Map<string, number>();
        for (const entry of entries) {
            counts.set(entry.repoUrl, (counts.get(entry.repoUrl) ?? 0) + 1);
        }
    } catch {
        return;
    }

    for (const repos of Object.values(data.extensions)) {
        for (const repo of repos) {
            const count = counts.get(repoUrlFromPath(repo.path));
            if (count !== undefined) repo.extensionCount = count;
        }
    }
}
