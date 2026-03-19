const ANSI_GRAY = '\x1b[90m';
const ANSI_RESET = '\x1b[0m';

export function debug(message: string, data?: unknown) {
    if (data === undefined) {
        process.stderr.write(`${ANSI_GRAY}${message}${ANSI_RESET}\n`);
        return;
    }

    const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    process.stderr.write(`${ANSI_GRAY}${message}: ${payload}${ANSI_RESET}\n`);
}
