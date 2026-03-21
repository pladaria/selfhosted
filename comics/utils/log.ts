const ANSI_GRAY = '\x1b[90m';
const ANSI_RED = '\x1b[31m';
const ANSI_ORANGE = '\x1b[33m';
const ANSI_RESET = '\x1b[0m';

type LogLevel = 'DEBUG' | 'WARN' | 'ERROR';

function resolveColor(level: LogLevel): string {
    switch (level) {
        case 'ERROR':
            return ANSI_RED;
        case 'WARN':
            return ANSI_ORANGE;
        case 'DEBUG':
        default:
            return ANSI_GRAY;
    }
}

function isLogLevel(value: unknown): value is LogLevel {
    return value === 'DEBUG' || value === 'WARN' || value === 'ERROR';
}

export function debug(message: string, dataOrLevel?: unknown, level: LogLevel = 'DEBUG') {
    const data = isLogLevel(dataOrLevel) ? undefined : dataOrLevel;
    const resolvedLevel = isLogLevel(dataOrLevel) ? dataOrLevel : level;
    const color = resolveColor(resolvedLevel);

    if (data === undefined) {
        process.stderr.write(`${color}${message}${ANSI_RESET}\n`);
        return;
    }

    const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    process.stderr.write(`${color}${message}: ${payload}${ANSI_RESET}\n`);
}
