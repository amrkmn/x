import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { deployGrebedoc } from '../scripts/deploy';
import type { BuildTarget } from '../scripts/targets';

describe('deployGrebedoc', () => {
    let tempDir: string;
    let mockServer: Server;
    let serverPort: number;
    let requestCount: number;
    const originalPassword = process.env.GIT_PAGES_PASSWORD;
    const originalRetries = process.env.GREBEDOC_RETRIES;
    const originalDelay = process.env.GREBEDOC_RETRY_DELAY;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'grebedoc-test-'));
        await writeFile(join(tempDir, 'index.html'), '<html>hello</html>');
        requestCount = 0;
    });

    afterEach(async () => {
        if (originalPassword !== undefined) {
            process.env.GIT_PAGES_PASSWORD = originalPassword;
        } else {
            delete process.env.GIT_PAGES_PASSWORD;
        }
        if (originalRetries !== undefined) {
            process.env.GREBEDOC_RETRIES = originalRetries;
        } else {
            delete process.env.GREBEDOC_RETRIES;
        }
        if (originalDelay !== undefined) {
            process.env.GREBEDOC_RETRY_DELAY = originalDelay;
        } else {
            delete process.env.GREBEDOC_RETRY_DELAY;
        }

        if (mockServer) {
            await new Promise<void>((resolve) => mockServer.close(() => resolve()));
        }
        await rm(tempDir, { recursive: true, force: true });
    });

    test('throws if GIT_PAGES_PASSWORD is missing', async () => {
        delete process.env.GIT_PAGES_PASSWORD;
        const target: BuildTarget = {
            name: 'grebedoc',
            siteUrl: 'https://x.amar.kim',
            analyticsDomain: 'x.amar.kim',
            outDir: tempDir
        };

        await expect(deployGrebedoc(target)).rejects.toThrow('GIT_PAGES_PASSWORD');
    });

    test('retries on 502 Bad Gateway and succeeds', async () => {
        process.env.GIT_PAGES_PASSWORD = 'test-password';

        mockServer = createServer((req, res) => {
            requestCount++;
            req.on('data', () => {});
            req.on('end', () => {
                if (requestCount === 1) {
                    res.statusCode = 502;
                    res.end('Bad Gateway');
                } else {
                    res.statusCode = 200;
                    res.end('OK');
                }
            });
        });

        await new Promise<void>((resolve) => {
            mockServer.listen(0, '127.0.0.1', () => {
                const address = mockServer.address();
                if (address && 'port' in address) {
                    serverPort = address.port;
                }
                resolve();
            });
        });

        const target: BuildTarget = {
            name: 'grebedoc',
            siteUrl: 'https://x.amar.kim',
            analyticsDomain: 'x.amar.kim',
            outDir: tempDir
        };

        await deployGrebedoc(target, {
            apiUrl: `http://127.0.0.1:${serverPort}/`,
            retries: 2,
            retryDelay: 1
        });

        expect(requestCount).toBe(2);
    });
});
