import {access, appendFile, mkdir, readdir, rename, stat} from 'node:fs/promises';
import {basename, dirname, extname, join, resolve} from 'node:path';

type ArchiveType = 'zip' | 'rar';

type VerifyResult = {
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
};

type VerificationStatusEntry = {
    path: string;
    size: number;
    mtimeMs: number;
    verifiedAt: string;
};

const SUPPORTED_EXTENSIONS = new Set(['.cbr', '.cbz', '.rar', '.zip']);
const ANSI_CYAN = '\x1b[36m';
const ANSI_ORANGE = '\x1b[33m';
const ANSI_RESET = '\x1b[0m';
const STATUS_FILENAME = 'verification-status.jsonl';

function printUsage() {
    console.error('Usage: bun run archive/verify.ts <file-or-dir> [-r] <error-dir>');
}

function warn(message: string) {
    console.log(`${ANSI_ORANGE}${message}${ANSI_RESET}`);
}

function info(message: string) {
    console.log(`${ANSI_CYAN}${message}${ANSI_RESET}`);
}

function isSupportedArchiveExtension(filePath: string) {
    return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function formatSize(bytes: number) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(milliseconds: number) {
    return `${(milliseconds / 1000).toFixed(2)} s`;
}

async function pathExists(filePath: string) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function ensureCommand(command: string) {
    if (Bun.which(command)) {
        return;
    }

    throw new Error(`Required command not found: ${command}`);
}

async function buildAvailablePath(targetPath: string) {
    if (!(await pathExists(targetPath))) {
        return targetPath;
    }

    const extension = extname(targetPath);
    const baseName = basename(targetPath, extension);
    const parentDir = dirname(targetPath);
    let attempt = 1;

    while (true) {
        const candidate = join(parentDir, `${baseName}.${attempt}${extension}`);
        if (!(await pathExists(candidate))) {
            return candidate;
        }
        attempt += 1;
    }
}

function buildStatusKey(filePath: string, size: number, mtimeMs: number) {
    return `${filePath}\t${size}\t${mtimeMs}`;
}

async function loadVerificationStatus(statusPath: string) {
    const file = Bun.file(statusPath);
    if (!(await file.exists())) {
        return new Set<string>();
    }

    const content = await file.text();
    const processed = new Set<string>();

    for (const line of content.split('\n').map((item) => item.trim()).filter(Boolean)) {
        try {
            const entry = JSON.parse(line) as VerificationStatusEntry;
            if (typeof entry.path !== 'string' || typeof entry.size !== 'number' || typeof entry.mtimeMs !== 'number') {
                continue;
            }

            processed.add(buildStatusKey(entry.path, entry.size, entry.mtimeMs));
        } catch {
            // Ignore malformed lines to keep the checkpoint file append-only and resilient.
        }
    }

    return processed;
}

async function appendVerificationStatus(statusPath: string, filePath: string) {
    const fileStats = await stat(filePath);
    const entry: VerificationStatusEntry = {
        path: filePath,
        size: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
        verifiedAt: new Date().toISOString(),
    };

    await appendFile(statusPath, `${JSON.stringify(entry)}\n`);

    return buildStatusKey(entry.path, entry.size, entry.mtimeMs);
}

function resolveExtension(type: ArchiveType, originalExtension: string) {
    const lower = originalExtension.toLowerCase();
    const isComicExtension = lower === '.cbr' || lower === '.cbz';

    if (type === 'zip') {
        return isComicExtension ? '.cbz' : '.zip';
    }

    return isComicExtension ? '.cbr' : '.rar';
}

function detectArchiveTypeFromFileOutput(output: string): ArchiveType | null {
    const normalized = output.toLowerCase();

    if (normalized.includes('zip archive')) {
        return 'zip';
    }

    if (normalized.includes('rar archive')) {
        return 'rar';
    }

    return null;
}

async function runCommand(command: string[]) {
    const proc = Bun.spawn(command, {
        stdout: 'pipe',
        stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);

    return {stdout, stderr, exitCode};
}

async function getArchiveType(filePath: string) {
    const result = await runCommand(['file', filePath]);
    if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `file failed for ${filePath}`);
    }

    return {
        fileDescription: result.stdout.trim(),
        archiveType: detectArchiveTypeFromFileOutput(result.stdout),
    };
}

async function verifyIntegrity(filePath: string, type: ArchiveType): Promise<VerifyResult> {
    if (type === 'zip') {
        const result = await runCommand(['unzip', '-tqq', filePath]);
        return {
            ok: result.exitCode === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
        };
    }

    const result = await runCommand(['unrar', 't', '-idq', filePath]);
    return {
        ok: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
    };
}

async function collectArchiveFiles(dirPath: string, recursive: boolean): Promise<string[]> {
    const entries = await readdir(dirPath, {withFileTypes: true});
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (recursive) {
                files.push(...(await collectArchiveFiles(fullPath, true)));
            }
            continue;
        }

        if (entry.isFile() && isSupportedArchiveExtension(entry.name)) {
            files.push(fullPath);
        }
    }

    files.sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    return files;
}

async function moveToErrorDir(filePath: string, errorDir: string) {
    const destinationPath = await buildAvailablePath(join(errorDir, basename(filePath)));
    await rename(filePath, destinationPath);
    return destinationPath;
}

async function verifyArchive(filePath: string, errorDir: string, statusPath: string) {
    const startedAt = performance.now();
    const initialStats = await stat(filePath);
    info(`*** Checking ${filePath} (${formatSize(initialStats.size)})`);

    const originalExtension = extname(filePath).toLowerCase();
    const {archiveType, fileDescription} = await getArchiveType(filePath);

    if (!archiveType) {
        warn(`Unsupported type: ${fileDescription}`);
        const movedPath = await moveToErrorDir(filePath, errorDir);
        warn(`Move to ${movedPath}`);
        console.log(`Done in ${formatDuration(performance.now() - startedAt)}`);
        return;
    }

    let currentPath = filePath;
    const expectedExtension = resolveExtension(archiveType, originalExtension);

    if (originalExtension === expectedExtension) {
        console.log('Extension OK');
    } else {
        const renamedPath = await buildAvailablePath(
            join(dirname(filePath), `${basename(filePath, extname(filePath))}${expectedExtension}`)
        );
        warn('Extension error');
        warn(`Renaming to ${renamedPath}`);
        await rename(filePath, renamedPath);
        currentPath = renamedPath;
    }

    console.log('Verifying integrity...');
    const result = await verifyIntegrity(currentPath, archiveType);

    if (result.ok) {
        console.log('Integrity OK');
        const statusKey = await appendVerificationStatus(statusPath, currentPath);
        console.log(`Done in ${formatDuration(performance.now() - startedAt)}`);
        return statusKey;
    }

    const movedPath = await moveToErrorDir(currentPath, errorDir);
    warn(`Integrity failed. Move to ${movedPath}`);

    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    if (details) {
        warn(details);
    }

    console.log(`Done in ${formatDuration(performance.now() - startedAt)}`);
    return null;
}

function parseArgs(argv: string[]) {
    if (argv.length < 2 || argv.length > 3) {
        return null;
    }

    const recursive = argv.includes('-r');
    const positional = argv.filter((arg) => arg !== '-r');

    if (positional.length !== 2) {
        return null;
    }

    return {
        inputPath: resolve(positional[0]),
        recursive,
        errorDir: resolve(positional[1]),
    };
}

const args = parseArgs(process.argv.slice(2));

if (!args) {
    printUsage();
    process.exit(1);
}

await mkdir(args.errorDir, {recursive: true});
await ensureCommand('file');
await ensureCommand('unzip');
await ensureCommand('unrar');

const inputStats = await stat(args.inputPath).catch(() => null);
if (!inputStats) {
    console.error(`Input path not found: ${args.inputPath}`);
    process.exit(1);
}

let files: string[] = [];
const statusDir = inputStats.isDirectory() ? args.inputPath : dirname(args.inputPath);
const statusPath = join(statusDir, STATUS_FILENAME);
const processedFiles = await loadVerificationStatus(statusPath);

if (inputStats.isFile()) {
    files = [args.inputPath];
} else if (inputStats.isDirectory()) {
    files = await collectArchiveFiles(args.inputPath, args.recursive);
} else {
    console.error(`Unsupported input path: ${args.inputPath}`);
    process.exit(1);
}

for (const filePath of files) {
    try {
        const fileStats = await stat(filePath);
        const statusKey = buildStatusKey(filePath, fileStats.size, fileStats.mtimeMs);
        if (processedFiles.has(statusKey)) {
            continue;
        }

        const processedKey = await verifyArchive(filePath, args.errorDir, statusPath);
        if (processedKey) {
            processedFiles.add(processedKey);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`Processing failed: ${message}`);
        const currentStats = await stat(filePath).catch(() => null);
        if (currentStats?.isFile()) {
            const movedPath = await moveToErrorDir(filePath, args.errorDir);
            warn(`Move to ${movedPath}`);
        }
    }
}
