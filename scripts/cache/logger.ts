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
    private throttleMs: number;

    constructor(prefix: string) {
        this.isInteractive = isInteractiveTerminal();
        this.startTime = Date.now();
        this.lastLogTime = this.startTime;
        this.prefix = prefix;
        this.throttleMs = this.isInteractive ? 200 : 1000;
    }

    /**
     * Logs transfer progress at regular intervals.
     * Throttled to 200ms for TTY, 1 second for non-TTY.
     */
    progress(bytes: number): this {
        const now = Date.now();
        if (now - this.lastLogTime >= this.throttleMs) {
            const elapsed = (now - this.startTime) / 1000;
            const message = `${this.prefix} ${formatTransferStats(bytes, elapsed)}...`;

            if (this.isInteractive) process.stdout.write(`\r${message}`);
            else console.log(message);

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
            const message = `${this.prefix} ${formatTransferStats(bytes, elapsed)}`;

            if (this.isInteractive) process.stdout.write(`\r\x1b[K${message}\n`);
            else console.log(message);
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
