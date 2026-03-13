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

export class SyncLogger {
    private isInteractive: boolean;
    private prefix: string;
    private throttleMs: number;
    private lastLogTime: number;

    constructor(prefix: string) {
        this.isInteractive = isInteractiveTerminal();
        this.prefix = prefix;
        this.throttleMs = this.isInteractive ? 100 : 500;
        this.lastLogTime = Date.now();
    }

    info(message: string): void {
        if (this.isInteractive) process.stdout.write(`\r${message}\n`);
        else console.log(message);
    }

    error(message: string): void {
        console.error(`[${this.prefix}] ${message}`);
    }

    complete(message: string): void {
        if (this.isInteractive) process.stdout.write(`\r${message}\n`);
        else console.log(message);
    }

    progress(current: number, total: number, label?: string): void {
        const now = Date.now();
        if (now - this.lastLogTime >= this.throttleMs) {
            const msg = label ? `${label} ${current}/${total}` : `${current}/${total}`;

            if (this.isInteractive) {
                process.stdout.write(`\r${msg}${' '.repeat(30)}\r`);
            } else {
                console.log(msg);
            }

            this.lastLogTime = now;
        }
    }
}
