import { Meilisearch } from 'meilisearch';
import { join } from 'node:path';
import type { SearchIndexEntry } from '../src/lib/types';
import { parseSearchIndex } from '../src/lib/validation';

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
    const searchIndexFile = join(STATIC_DIR, 'indexes.json');

    try {
        const client = new Meilisearch({ host: env.host, apiKey: env.apiKey });
        await client.health();
        const index = client.index<SearchIndexEntry>('extensions');

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

        const allExtensions = parseSearchIndex(await Bun.file(searchIndexFile).json());

        if (!allExtensions.length) {
            console.warn('No extension files found for Meilisearch');
            return;
        }

        const existingDocs = await index.getDocuments<{ id: string }>({
            fields: ['id'],
            limit: 10000
        });

        const newDocuments = allExtensions.map((ext) => ({
            ...ext,
            id: `${ext.formattedSourceName.replace(/\./g, '_')}-${ext.pkg.replace(/\./g, '_')}`
        }));

        const newIds = new Set(newDocuments.map((doc) => doc.id));
        const existingIds = new Set(existingDocs.results.map((doc) => doc.id));
        const idsToDelete = Array.from(existingIds).filter((id) => !newIds.has(id));

        if (idsToDelete.length > 0) {
            console.log(`Deleting ${idsToDelete.length} removed extensions from Meilisearch`);
            await index.deleteDocuments(idsToDelete);
        }

        const task = await index.updateDocuments(newDocuments, { primaryKey: 'id' });
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
