import type { S3Client } from 'bun';

// ============================================================================
// Types
// ============================================================================

export interface FileMetadata {
    checksum: string;
    size: number;
}

export interface CacheMetadata {
    key: string;
    hash: string;
    timestamp: number;
    lastAccessed: number;
    files: Record<string, FileMetadata>;
    version: number;
}

export interface CacheLock {
    locked: boolean;
    timestamp: number;
    instance: string;
    ttl: number;
}

export interface S3ListObject {
    key: string;
    lastModified?: string;
}

export interface CacheEntry {
    key: string;
    timestamp: number;
    lastAccessed: number;
    hash: string;
}

export interface CacheManifest {
    version: number;
    caches: CacheEntry[];
}

// ============================================================================
// Constants
// ============================================================================

export const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const LOCK_RETRY_MS = 5000; // 5 seconds
export const LOCK_MAX_RETRIES = 3;

export const METADATA_VERSION = 1;
export const METADATA_KEY = 'metadata.json';
export const LOCK_KEY = 'cache.lock';

export const MAX_CACHE_FILES = 7;
export const MAX_CACHE_AGE_DAYS = 7;

export const TMP_DIR = 'tmp';
export const STATIC_DIR = 'static';
export const CACHE_FILE_NAME = 'extensions-cache.tar.zst';

// Cache configuration
export const CACHE_PATHS = ['static'];
export const CACHE_KEY_PREFIX = 'extensions-';
export const CACHE_RESTORE_KEYS = ['extensions-'];
export const EXTENSIONS_CONFIG_FILE = 'extensions.json';

// Helper to generate cache key from extensions.json
export async function generateCacheKey(): Promise<string> {
    const content = await Bun.file(EXTENSIONS_CONFIG_FILE).arrayBuffer();
    const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');
    return `${CACHE_KEY_PREFIX}${hash}.tar.zst`;
}

// Helper to write JSON to S3 file
export async function writeJsonToS3(s3: S3Client, key: string, data: any): Promise<void> {
    await Bun.write(s3.file(key), JSON.stringify(data, null, 2));
}

// ============================================================================
// Logger
// ============================================================================

/**
 * Checks if the current environment supports interactive terminal features
 * like carriage return (\r) for progress updates.
 *
 * Returns false for:
 * - Non-TTY environments (CI/CD logs, file redirects)
 * - Dumb terminals
 * - Environments without cursor control support
 */
function isInteractiveTerminal(): boolean {
    // Check if stdout is a TTY (interactive terminal)
    if (!process.stdout.isTTY) return false;
    // Check for dumb terminal
    if (process.env.TERM === 'dumb') return false;
    // Check for CI environments (most set CI=true)
    if (process.env.CI === 'true' || process.env.CI === '1') return false;

    // Check for common CI environment variables
    const ciEnvVars = [
        'GITHUB_ACTIONS',
        'GITLAB_CI',
        'CIRCLECI',
        'TRAVIS',
        'JENKINS_HOME',
        'BUILDKITE',
        'DRONE',
        'RENDER', // Render.com
        'CF_PAGES', // Cloudflare Pages
        'VERCEL' // Vercel
    ];

    for (const envVar of ciEnvVars) {
        if (process.env[envVar]) return false;
    }

    return true;
}

/**
 * Formats transfer statistics (size and speed).
 */
function formatTransferStats(bytes: number, elapsedSeconds: number): string {
    const sizeMB = (bytes / (1024 * 1024)).toFixed(2);
    const speedMBps = (bytes / (1024 * 1024) / elapsedSeconds).toFixed(2);
    return `${sizeMB} MB (${speedMBps} MB/s)`;
}

class TransferLogger {
    private isInteractive: boolean;
    private startTime: number;
    private lastLogTime: number;
    private prefix: string;

    constructor(prefix: string) {
        this.isInteractive = isInteractiveTerminal();
        this.startTime = Date.now();
        this.lastLogTime = this.startTime;
        this.prefix = prefix;
    }

    /**
     * Logs transfer progress at regular intervals (throttled to 1 second).
     */
    progress(bytes: number): this {
        const now = Date.now();
        if (now - this.lastLogTime >= 1000) {
            const elapsed = (now - this.startTime) / 1000;
            const stats = formatTransferStats(bytes, elapsed);
            const message = `${this.prefix} ${stats}...`;

            if (this.isInteractive) {
                process.stdout.write(`\r${message}`);
            } else {
                console.log(message);
            }

            this.lastLogTime = now;
        }
        return this;
    }

    /**
     * Logs final transfer completion message.
     */
    complete(bytes: number): void {
        if (bytes > 0) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            const stats = formatTransferStats(bytes, elapsed);
            const message = `${this.prefix} ${stats}`;

            if (this.isInteractive) {
                process.stdout.write(`\r\x1b[K${message}\n`);
            } else {
                console.log(message);
            }
        }
    }
}

class Logger {
    /**
     * Creates a transfer progress logger.
     * Usage: log.transfer('Received').progress(bytes).complete(bytes)
     */
    transfer(prefix: string): TransferLogger {
        return new TransferLogger(prefix);
    }
}

export const log = new Logger();
