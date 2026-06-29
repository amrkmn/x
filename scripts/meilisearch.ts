import { Meilisearch } from 'meilisearch';
import { join } from 'node:path';
import type { SearchIndexEntry } from '../src/lib/types';
import { parseSearchIndex } from '../src/lib/validation';
import { logger } from './log';

export async function updateMeilisearch() {
    const env = {
        host: process.env.MEILISEARCH_HOST,
        apiKey: process.env.MEILISEARCH_MASTER_KEY
    };

    if (!env.host || !env.apiKey) {
        logger.info('search', 'index update skipped reason="not_configured"');
        return;
    }

    logger.info('search', 'index update start');
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
            logger.warn('search', 'index update skipped reason="no_documents"');
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
            logger.info('search', `index delete removed_documents=${idsToDelete.length}`);
            await index.deleteDocuments(idsToDelete);
        }

        const task = await index.updateDocuments(newDocuments, { primaryKey: 'id' });
        const result = await client.tasks.waitForTask(task.taskUid, {
            timeout: 300000,
            interval: 1000
        });

        if (result.status === 'succeeded') {
            const stats = await index.getStats();
            logger.info('search', `index update complete documents=${stats.numberOfDocuments}`);
        } else {
            logger.error('search', `index update failed error=${JSON.stringify(result.error)}`);
        }
    } catch (error) {
        logger.error(
            'search',
            `index update error=${JSON.stringify(error instanceof Error ? error.message : error)}`
        );
    }
}

if (import.meta.main) {
    await updateMeilisearch();
}
