type LogLevel = 'info' | 'warn' | 'error';

const SCOPE_COLORS: Record<string, string> = {
    cache: '\x1b[36m',
    extensions: '\x1b[35m',
    task: '\x1b[34m',
    search: '\x1b[32m',
    data: '\x1b[33m'
};

function supportsColor(): boolean {
    return process.stdout.isTTY && process.env.NO_COLOR === undefined;
}

function isInteractiveTerminal(): boolean {
    if (!process.stdout.isTTY) return false;
    if (process.env.TERM === 'dumb') return false;
    if (process.env.CI === 'true' || process.env.CI === '1') return false;

    const ciEnvVars = [
        'GITHUB_ACTIONS',
        'GITLAB_CI',
        'CIRCLECI',
        'TRAVIS',
        'JENKINS_HOME',
        'BUILDKITE',
        'DRONE',
        'RENDER',
        'CF_PAGES',
        'VERCEL'
    ];

    for (const envVar of ciEnvVars) {
        if (process.env[envVar]) return false;
    }

    return true;
}

function formatTransferStats(bytes: number, elapsedSeconds: number, totalBytes?: number): string {
    const sizeMB = (bytes / (1024 * 1024)).toFixed(2);
    const speedMBps =
        elapsedSeconds > 0 ? (bytes / (1024 * 1024) / elapsedSeconds).toFixed(2) : '0.00';
    const hasTotal = typeof totalBytes === 'number' && totalBytes > 0;
    const percentage = hasTotal ? Math.min((bytes / totalBytes) * 100, 100).toFixed(2) : '0.00';

    if (hasTotal) {
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
        return `${sizeMB}/${totalMB}MiB(${percentage}%) ${speedMBps}MiB/s`;
    }

    return `${sizeMB}MiB(${percentage}%) ${speedMBps}MiB/s`;
}

class ScopeFormatter {
    constructor(private readonly useColor = supportsColor()) {}

    prefix(scope: string): string {
        if (!this.useColor) return `[${scope}]`;
        const color = SCOPE_COLORS[scope] || '\x1b[37m';
        return `${color}[${scope}]\x1b[0m`;
    }

    message(scope: string, message: string): string {
        return `${this.prefix(scope)} ${message}`;
    }

    progressPrefix(prefix: string): string {
        const match = prefix.match(/^\[([^\]]+)\](.*)$/);
        if (!match) return prefix;

        const [, scope, rest] = match;
        return `${this.prefix(scope)}${rest}`;
    }
}

class TerminalWriter {
    constructor(private readonly interactive = isInteractiveTerminal()) {}

    log(level: LogLevel, message: string, ...args: unknown[]): void {
        const fn = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
        fn(message, ...args);
    }

    progress(message: string, newline = false): void {
        if (this.interactive) {
            process.stdout.write(`\r\x1b[K${message}${newline ? '\n' : ''}`);
            return;
        }

        console.log(message);
    }

    get isInteractive(): boolean {
        return this.interactive;
    }
}

abstract class ThrottledProgressLogger {
    private lastLogTime = Date.now();

    constructor(
        protected readonly writer: TerminalWriter,
        protected readonly throttleMs: number
    ) {}

    protected write(message: string, newline = false): void {
        this.writer.progress(message, newline);
    }

    protected shouldLog(): boolean {
        const now = Date.now();
        if (now - this.lastLogTime < this.throttleMs) return false;
        this.lastLogTime = now;
        return true;
    }
}

class TransferLogger extends ThrottledProgressLogger {
    private readonly startTime = Date.now();

    constructor(
        writer: TerminalWriter,
        private readonly prefix: string,
        private readonly totalBytes?: number
    ) {
        super(writer, writer.isInteractive ? 200 : 1000);
    }

    private message(bytes: number): string {
        const elapsed = (Date.now() - this.startTime) / 1000;
        return `${this.prefix} ${formatTransferStats(bytes, elapsed, this.totalBytes)}`;
    }

    progress(bytes: number): this {
        if (this.shouldLog()) {
            this.write(this.message(bytes));
        }
        return this;
    }

    complete(bytes: number): void {
        if (bytes > 0) {
            this.write(this.message(bytes), true);
        }
    }
}

class ValidationLogger extends ThrottledProgressLogger {
    private readonly prefix: string;

    constructor(
        writer: TerminalWriter,
        private readonly formatter: ScopeFormatter,
        prefix: string,
        totalItems: number
    ) {
        super(writer, writer.isInteractive ? 100 : 500);
        this.prefix = `${prefix} (${totalItems} files)`;
    }

    progress(current: number, total: number): this {
        if (this.shouldLog()) {
            this.write(`${this.prefix}: ${current}/${total} files validated`);
        }
        return this;
    }

    complete(current: number, valid: number, invalid: number, missing: number): void {
        const message =
            valid === current
                ? this.formatter.message('cache', `cache is valid files_matched=${valid}`)
                : this.formatter.message(
                      'cache',
                      `cache validation failed valid=${valid} invalid=${invalid} missing=${missing} total=${current}`
                  );

        this.write(message, true);
    }
}

export class Logger {
    private readonly formatter = new ScopeFormatter();
    private readonly writer = new TerminalWriter();

    info(scope: string, message: string, ...args: unknown[]): void {
        this.writer.log('info', this.formatter.message(scope, message), ...args);
    }

    warn(scope: string, message: string, ...args: unknown[]): void {
        this.writer.log('warn', this.formatter.message(scope, message), ...args);
    }

    error(scope: string, message: string, ...args: unknown[]): void {
        this.writer.log('error', this.formatter.message(scope, message), ...args);
    }

    transfer(prefix: string, totalBytes?: number): TransferLogger {
        return new TransferLogger(this.writer, this.formatter.progressPrefix(prefix), totalBytes);
    }

    validation(prefix: string, totalItems: number): ValidationLogger {
        return new ValidationLogger(
            this.writer,
            this.formatter,
            this.formatter.progressPrefix(prefix),
            totalItems
        );
    }
}

export const logger = new Logger();
