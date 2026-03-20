import {tmpdir} from 'os';
import {join} from 'path';
import {randomBytes} from 'crypto';

type ArchiveType = 'zip' | 'rar';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'];

function detectArchiveType(filePath: string): ArchiveType {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.cbr') || lower.endsWith('.rar')) return 'rar';
    if (lower.endsWith('.cbz') || lower.endsWith('.zip')) return 'zip';
    throw new Error(`Unsupported archive format: ${filePath}`);
}

function isImageFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot) : '';
}

function generateTempPath(extension: string): string {
    const id = randomBytes(8).toString('hex');
    return join(tmpdir(), `comic-cover-${id}${extension}`);
}

function escapeUnzipEntryName(entryName: string): string {
    return entryName.replace(/[\\[\]*?]/g, (char) => `\\${char}`);
}

async function run(cmd: string[]): Promise<string> {
    const proc = Bun.spawn(cmd, {
        stdout: 'pipe',
        stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(' ')}\n${stderr}`);
    }

    return stdout;
}

async function listFiles(archivePath: string, type: ArchiveType): Promise<string[]> {
    const output =
        type === 'zip' ? await run(['unzip', '-Z1', archivePath]) : await run(['unrar', 'lb', archivePath]);

    return output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

async function extractFile(
    archivePath: string,
    entryName: string,
    type: ArchiveType,
    destPath: string
): Promise<void> {
    if (type === 'zip') {
        // unzip extracts to the specified directory; we use a temp dir then move
        const tempDir = join(tmpdir(), `comic-extract-${randomBytes(8).toString('hex')}`);
        await run(['unzip', '-o', '-j', archivePath, escapeUnzipEntryName(entryName), '-d', tempDir]);
        const extractedName = entryName.split('/').pop() ?? entryName;
        await run(['mv', join(tempDir, extractedName), destPath]);
        await run(['rm', '-rf', tempDir]);
    } else {
        const tempDir = join(tmpdir(), `comic-extract-${randomBytes(8).toString('hex')}`);
        await run(['unrar', 'e', '-y', archivePath, entryName, tempDir + '/']);
        const extractedName = entryName.split('/').pop() ?? entryName;
        await run(['mv', join(tempDir, extractedName), destPath]);
        await run(['rm', '-rf', tempDir]);
    }
}

/**
 * Extracts the first image (alphabetically sorted) from a comic archive (cbz/cbr).
 * Returns the path to the extracted image in a temporary location.
 */
export async function getCoverFile(archivePath: string): Promise<string> {
    const type = detectArchiveType(archivePath);
    const files = await listFiles(archivePath, type);

    const images = files.filter(isImageFile).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

    if (images.length === 0) {
        throw new Error(`No image files found in archive: ${archivePath}`);
    }

    const firstImage = images[0];
    const ext = getExtension(firstImage);
    const destPath = generateTempPath(ext);

    await extractFile(archivePath, firstImage, type, destPath);

    return destPath;
}

if (import.meta.main) {
    const archivePath = process.argv[2];
    if (!archivePath) {
        console.error('Usage: bun run archive/index.ts <archive-path>');
        process.exit(1);
    }
    const coverPath = await getCoverFile(archivePath);
    console.log(coverPath);
}
