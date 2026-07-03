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

export function formatTransferStats(
    bytes: number,
    elapsedSeconds: number,
    totalBytes?: number
): string {
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
    private progressActive = false;

    constructor(private readonly interactive = isInteractiveTerminal()) {}

    log(level: LogLevel, message: string, ...args: unknown[]): void {
        if (this.progressActive) {
            this.endProgressLine();
        }

        const fn = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
        fn(message, ...args);
    }

    progress(message: string, newline = false): void {
        if (this.interactive) {
            this.progressActive = !newline;
            process.stdout.write(`\r\x1b[K${message}${newline ? '\n' : ''}`);
            return;
        }

        console.log(message);
    }

    endProgressLine(): void {
        if (this.interactive) {
            this.progressActive = false;
            process.stdout.write('\n');
        }
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
    private lastRenderedBytes?: number;

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
            this.lastRenderedBytes = bytes;
            this.write(this.message(bytes));
        }
        return this;
    }

    complete(bytes: number): void {
        if (bytes <= 0) return;

        if (this.lastRenderedBytes === bytes) {
            this.writer.endProgressLine();
            return;
        }

        this.lastRenderedBytes = bytes;
        this.write(this.message(bytes), true);
    }
}

class CounterLogger extends ThrottledProgressLogger {
    private readonly startTime = Date.now();
    private readonly scope: string;
    private readonly prefix: string;
    private lastLoggedBucket = 0;
    private lastLoggedCount = 0;
    private readonly bucketSize: number;
    private readonly isInteractive: boolean;

    constructor(
        writer: TerminalWriter,
        private readonly formatter: ScopeFormatter,
        scope: string,
        label: string,
        private readonly totalItems: number,
        private readonly totalBytes?: number,
        private readonly action?: string
    ) {
        super(writer, 200);
        this.isInteractive = writer.isInteractive;
        this.bucketSize = this.isInteractive ? 0 : 10;
        this.scope = scope;
        this.prefix = this.formatter.progressPrefix(`[${scope}] ${label}`);
    }

    private elapsedSeconds(): number {
        return (Date.now() - this.startTime) / 1000;
    }

    progress(current: number, bytes?: number): this {
        const percent = (current / this.totalItems) * 100;
        const bucket = this.bucketSize > 0 ? Math.floor(percent / this.bucketSize) : 0;

        if (bytes !== undefined && this.totalBytes !== undefined) {
            const shouldLog = this.isInteractive
                ? this.shouldLog()
                : bucket > this.lastLoggedBucket;
            if (shouldLog) {
                const elapsed = this.elapsedSeconds();
                const speedMiBs = bytes / (1024 * 1024) / elapsed;
                const pctFormatted = percent.toFixed(2);
                this.write(
                    `${this.prefix} ${current}/${this.totalItems}(${pctFormatted}%) ${speedMiBs.toFixed(2)}MiB/s`,
                    false
                );
                this.lastLoggedBucket = bucket;
                this.lastLoggedCount = current;
            }
        } else if (this.shouldLog()) {
            const pctFormatted = percent.toFixed(2);
            this.write(`${this.prefix} ${current}/${this.totalItems}(${pctFormatted}%)`, false);
            this.lastLoggedCount = current;
        }
        return this;
    }

    complete(stats: { valid?: number; invalid?: number; missing?: number; bytes?: number }): void {
        const elapsed = this.elapsedSeconds();

        // emit final 100% progress line if the last progress() call didn't already
        if (this.lastLoggedCount < this.totalItems) {
            const pctFormatted = '100.00';
            if (this.totalBytes !== undefined) {
                const speedMiBs = this.totalBytes / (1024 * 1024) / elapsed;
                this.write(
                    `${this.prefix} ${this.totalItems}/${this.totalItems}(${pctFormatted}%) ${speedMiBs.toFixed(2)}MiB/s`,
                    false
                );
            } else {
                this.write(
                    `${this.prefix} ${this.totalItems}/${this.totalItems}(${pctFormatted}%)`,
                    false
                );
            }
        }
        this.writer.endProgressLine();
        const { valid, invalid, missing, bytes } = stats;

        if (valid !== undefined && invalid !== undefined && missing !== undefined) {
            const isValid = invalid === 0 && missing === 0;
            const message = isValid
                ? this.formatter.message(this.scope, `cache is valid files_matched=${valid}`)
                : this.formatter.message(
                      this.scope,
                      `cache validation failed valid=${valid} invalid=${invalid} missing=${missing} total=${this.totalItems}`
                  );
            this.writer.log('info', message);
        }

        if (bytes !== undefined && this.action) {
            const sizeMiB = (bytes / (1024 * 1024)).toFixed(2);
            this.writer.log(
                'info',
                this.formatter.message(
                    this.scope,
                    `${this.action} size_mib=${sizeMiB} bytes=${bytes}`
                )
            );
            this.writer.log(
                'info',
                this.formatter.message(
                    this.scope,
                    `${this.action} complete seconds=${elapsed.toFixed(2)}`
                )
            );
        }
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

    counter(
        scope: string,
        label: string,
        totalItems: number,
        totalBytes?: number,
        action?: string
    ): CounterLogger {
        return new CounterLogger(
            this.writer,
            this.formatter,
            scope,
            label,
            totalItems,
            totalBytes,
            action
        );
    }
}

export const logger = new Logger();
