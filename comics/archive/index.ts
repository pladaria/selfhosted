import {open} from 'node:fs/promises';
import {tmpdir} from 'os';
import {join} from 'path';
import {randomBytes} from 'crypto';

type ArchiveType = 'zip' | 'rar';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'];

async function detectArchiveType(filePath: string): Promise<ArchiveType> {
    const handle = await open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(8);
        const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
        const header = buffer.subarray(0, bytesRead);

        const isZip =
            header.length >= 4 &&
            header[0] === 0x50 &&
            header[1] === 0x4b &&
            [0x03, 0x05, 0x07].includes(header[2]) &&
            [0x04, 0x06, 0x08].includes(header[3]);
        if (isZip) {
            return 'zip';
        }

        const isRarV4 =
            header.length >= 7 &&
            header[0] === 0x52 &&
            header[1] === 0x61 &&
            header[2] === 0x72 &&
            header[3] === 0x21 &&
            header[4] === 0x1a &&
            header[5] === 0x07 &&
            header[6] === 0x00;
        const isRarV5 =
            header.length >= 8 &&
            header[0] === 0x52 &&
            header[1] === 0x61 &&
            header[2] === 0x72 &&
            header[3] === 0x21 &&
            header[4] === 0x1a &&
            header[5] === 0x07 &&
            header[6] === 0x01 &&
            header[7] === 0x00;
        if (isRarV4 || isRarV5) {
            return 'rar';
        }
    } finally {
        await handle.close();
    }

    const lower = filePath.toLowerCase();
    if (lower.endsWith('.cbr') || lower.endsWith('.rar')) return 'rar';
    if (lower.endsWith('.cbz') || lower.endsWith('.zip')) return 'zip';
    throw new Error(`Unsupported archive format: ${filePath}`);
}

function isImageFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isMacOsMetadataPath(filename: string): boolean {
    return filename
        .split(/[\\/]+/)
        .some((segment) => segment.trim().toLowerCase() === '__macosx');
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
    const type = await detectArchiveType(archivePath);
    const files = await listFiles(archivePath, type);

    const images = files
        .filter((file) => !isMacOsMetadataPath(file))
        .filter(isImageFile)
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

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
