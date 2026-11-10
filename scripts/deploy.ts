import { constants, zstdCompressSync } from 'node:zlib';

import $ from 'dax';

import { logger } from './log';
import { updateMeilisearch } from './meilisearch';
import { BUILD_TARGETS, type BuildTarget } from './targets';

export async function deployCloudflare(target: BuildTarget, message: string): Promise<void> {
    logger.info('deploy', `cloudflare deploy start outDir=${target.outDir}`);
    await $`nubx wrangler deploy --assets ${target.outDir} --message ${message}`;
    logger.info('deploy', 'cloudflare deploy complete');
}

export async function deployNetlify(target: BuildTarget, message: string): Promise<void> {
    logger.info('deploy', `netlify deploy start outDir=${target.outDir}`);
    await $`nubx netlify deploy --prod --dir ${target.outDir} --message ${message}`;
    logger.info('deploy', 'netlify deploy complete');
}

export interface DeployGrebedocOptions {
    retries?: number;
    retryDelay?: number;
    apiUrl?: string;
}

export async function deployGrebedoc(
    target: BuildTarget,
    options: DeployGrebedocOptions = {}
): Promise<void> {
    const password = process.env.GIT_PAGES_PASSWORD;
    if (!password) {
        throw new Error('GIT_PAGES_PASSWORD environment variable is not set');
    }

    const retries =
        options.retries ??
        (process.env.GREBEDOC_RETRIES ? Number.parseInt(process.env.GREBEDOC_RETRIES, 10) : 3);
    const retryDelay =
        options.retryDelay ??
        (process.env.GREBEDOC_RETRY_DELAY
            ? Number.parseInt(process.env.GREBEDOC_RETRY_DELAY, 10)
            : 5);

    const safeRetries = Number.isFinite(retries) && retries >= 0 ? retries : 3;
    const safeDelay = Number.isFinite(retryDelay) && retryDelay >= 0 ? retryDelay : 5;

    logger.info(
        'deploy',
        `grebedoc deploy start outDir=${target.outDir} retries=${safeRetries} retryDelay=${safeDelay}s`
    );

    // 1. Create tar archive bytes via dax
    const tarBytes = await $`tar -cf - -C ${target.outDir} .`.bytes();

    // 2. Compress using Node's native zstd
    const compressed = zstdCompressSync(tarBytes, {
        params: { [constants.ZSTD_c_compressionLevel]: 3 }
    });

    // 3. Upload directly via curl (curl preserves custom Host header)
    const host = new URL(target.siteUrl).host;
    const apiUrl = options.apiUrl || process.env.GREBEDOC_API_URL || 'https://grebedoc.dev/';
    await $`curl -fSL ${apiUrl} -X PUT -H ${`Host: ${host}`} -H ${`Authorization: Pages ${password}`} -H "Content-Type: application/x-tar+zstd" --retry ${safeRetries} --retry-delay ${safeDelay} --retry-all-errors --data-binary @-`.stdin(
        compressed
    );

    logger.info('deploy', 'grebedoc deploy complete');
}

export interface DeployAllOptions {
    message?: string;
    grebedocRetries?: number;
    grebedocRetryDelay?: number;
}

export async function deployAll(options: DeployAllOptions = {}): Promise<void> {
    const message = options.message || process.env.DEPLOY_MESSAGE || 'deploy';

    const cloudflareTarget = BUILD_TARGETS.find((t) => t.name === 'cloudflare');
    const netlifyTarget = BUILD_TARGETS.find((t) => t.name === 'netlify');
    const grebedocTarget = BUILD_TARGETS.find((t) => t.name === 'grebedoc');

    if (!cloudflareTarget || !netlifyTarget || !grebedocTarget) {
        throw new Error('Missing build target configuration for deployment');
    }

    const tasks = [
        {
            name: 'cloudflare',
            run: () => deployCloudflare(cloudflareTarget, message)
        },
        {
            name: 'netlify',
            run: () => deployNetlify(netlifyTarget, message)
        },
        {
            name: 'grebedoc',
            run: () =>
                deployGrebedoc(grebedocTarget, {
                    retries: options.grebedocRetries,
                    retryDelay: options.grebedocRetryDelay
                })
        },
        {
            name: 'search-index',
            run: () => updateMeilisearch(`${cloudflareTarget.outDir}/indexes.json`)
        }
    ];

    logger.info('deploy', `starting concurrent deployment of ${tasks.length} targets`);

    const results = await Promise.allSettled(tasks.map((task) => task.run()));

    const failures: { name: string; error: unknown }[] = [];
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            failures.push({ name: tasks[i].name, error: result.reason });
        }
    });

    if (failures.length > 0) {
        for (const failure of failures) {
            logger.error(
                'deploy',
                `deployment failed target=${failure.name} error=${failure.error instanceof Error ? failure.error.message : String(failure.error)}`
            );
        }
        throw new Error(`${failures.length} deployment task(s) failed`);
    }

    logger.info('deploy', 'all deployments completed successfully');
}
