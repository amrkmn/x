import { MeiliSearch } from 'meilisearch';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

interface Extension {
    name: string;
    pkg: string;
    apk: string;
    lang: string;
    code: number;
    version: string;
    nsfw: number;
}

interface EnrichedExtension extends Extension {
    id: string;
    category: string;
    sourceName: string;
    formattedSourceName: string;
    repoUrl: string;
}

interface SourceMapping {
    name: string;
    repoUrl: string;
    category: string;
}

async function buildSourceMapping(path: string): Promise<Map<string, SourceMapping>> {
    const mapping = new Map<string, SourceMapping>();
    const data = await Bun.file(path).json();

    for (const category in data.extensions) {
        for (const repo of data.extensions[category]) {
            const normalizedPath = repo.path.replace(/^\//, '');
            mapping.set(normalizedPath, {
                name: repo.name,
                repoUrl: repo.path.substring(0, repo.path.lastIndexOf('/')),
                category
            });
        }
    }
    return mapping;
}

async function findExtensionFiles(dir: string): Promise<string[]> {
    let results: string[] = [];
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const file of entries) {
            const path = join(dir, file.name);
            if (file.isDirectory()) results.push(...(await findExtensionFiles(path)));
            else if (file.name === 'index.min.json') results.push(path);
        }
    } catch (e) {
        console.error(`Error reading ${dir}:`, e);
    }
    return results;
}

export async function updateMeilisearch() {
    const env = {
        host: process.env.MEILISEARCH_HOST,
        apiKey: process.env.MEILISEARCH_MASTER_KEY
    };

    if (!env.host || !env.apiKey) {
        console.log('Skipping Meilisearch update (not configured)');
        return;
    }

    console.log('Updating Meilisearch index...');
    const STATIC_DIR = join(process.cwd(), 'static');

    try {
        const client = new MeiliSearch({ host: env.host, apiKey: env.apiKey });
        await client.health();
        const index = client.index('extensions');

        await index.updateSettings({
            searchableAttributes: ['name', 'pkg', 'lang', 'sourceName'],
            filterableAttributes: [
                'sourceName',
                'formattedSourceName',
                'category',
                'lang',
                'nsfw',
                'pkg'
            ],
            sortableAttributes: ['name', 'lang', 'version'],
            rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
            pagination: { maxTotalHits: 10000 }
        });

        const sourceMapping = await buildSourceMapping(join(STATIC_DIR, 'data.json'));
        const files = await findExtensionFiles(STATIC_DIR);

        if (!files.length) {
            console.warn('No extension files found for Meilisearch');
            return;
        }

        const allExtensions: EnrichedExtension[] = [];
        const newIds = new Set<string>();

        for (const file of files) {
            try {
                const extensions: Extension[] = await Bun.file(file).json();
                const relativePath = file
                    .replace(STATIC_DIR, '')
                    .replace(/\\/g, '/')
                    .replace(/^\//, '');
                const pathParts = relativePath.split('/').filter(Boolean);
                const sourceInfo = sourceMapping.get(relativePath);

                const sourceName = sourceInfo?.name || pathParts[0] || 'Unknown';
                const repoUrl = sourceInfo?.repoUrl || '/' + pathParts.slice(0, -1).join('/');
                const category =
                    sourceInfo?.category ||
                    (pathParts[0]?.toLowerCase().includes('anime') ? 'aniyomi' : 'mihon');
                const formattedSourceName = sourceName.toLowerCase().replace(/\s+/g, '.');
                const idSafeSourceName = formattedSourceName.replace(/\./g, '_');

                const enrichedExtensions = extensions.map((ext) => ({
                    ...ext,
                    id: `${idSafeSourceName}-${ext.pkg.replace(/\./g, '_')}`,
                    category,
                    sourceName,
                    formattedSourceName,
                    repoUrl,
                    nsfw: typeof ext.nsfw === 'number' ? ext.nsfw : ext.nsfw ? 1 : 0
                }));

                for (const ext of enrichedExtensions) {
                    newIds.add(ext.id);
                }
                allExtensions.push(...enrichedExtensions);
            } catch (err) {
                console.error(`Error processing ${file}:`, err);
            }
        }

        const existingDocs = await index.getDocuments({ fields: ['id'], limit: 10000 });
        const existingIds = new Set(existingDocs.results.map((doc) => doc.id));
        const idsToDelete = Array.from(existingIds).filter((id) => !newIds.has(id));

        if (idsToDelete.length > 0) {
            console.log(`Deleting ${idsToDelete.length} removed extensions from Meilisearch`);
            await index.deleteDocuments(idsToDelete);
        }

        const task = await index.updateDocuments(allExtensions, { primaryKey: 'id' });
        const result = await client.tasks.waitForTask(task.taskUid, {
            timeout: 300000,
            interval: 1000
        });

        if (result.status === 'succeeded') {
            const stats = await index.getStats();
            console.log(`Meilisearch updated: ${stats.numberOfDocuments} documents indexed`);
        } else {
            console.error('Meilisearch indexing failed:', result.error);
        }
    } catch (error) {
        console.error('Meilisearch update error:', error);
    }
}

if (import.meta.main) {
    await updateMeilisearch();
}
