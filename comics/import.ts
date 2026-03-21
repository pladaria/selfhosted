import {copyFile, mkdir, readdir, stat, unlink, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {getComicMeta} from './comic-meta.ts';
import {extractFilenameMeta} from './sources/filename.ts';
import {debug} from './utils/log.ts';

type ComicMeta = Partial<{
    id: string;
    title: string;
    alternateTitles: Array<{locale: string; title: string}>;
    volumeCount: number;
    series: string;
    summary: string;
    notes: string;
    releaseDate: string;
    artists: Array<{name: string; aka?: string[] | null; role: string}>;
    publisher: string;
    genre: string[];
    tags: string[];
    rating: number;
    publishingTradition: string;
    demography: string;
}>;

type ImportCache = Map<string, string>;

function isComicArchivePath(filePath: string) {
    return /\.(cbz|cbr)$/i.test(filePath);
}

function sortNaturally(values: string[]) {
    return [...values].sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
}

function normalizeWhitespace(value: string) {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function slugifySegment(value: string, fallback: string) {
    const normalized = normalizeWhitespace(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');

    return normalized || fallback;
}

function sanitizePathSegment(value: string, fallback: string) {
    const sanitized = normalizeWhitespace(value).replace(/\0/g, ' ').replace(/\//g, ' ').trim();

    if (!sanitized || sanitized === '.' || sanitized === '..') {
        return fallback;
    }

    return sanitized;
}

function buildImportCacheKey(value: string | undefined) {
    return slugifySegment(value || '', '');
}

async function listComicFiles(rootDir: string): Promise<string[]> {
    const entries = (await readdir(rootDir, {withFileTypes: true})).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'})
    );
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = join(rootDir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'reviewed') {
                continue;
            }
            files.push(...(await listComicFiles(fullPath)));
            continue;
        }

        if (entry.isFile() && isComicArchivePath(entry.name)) {
            files.push(fullPath);
        }
    }

    return files;
}

async function getExistingFolderCoverPath(dirPath: string) {
    const entries = await readdir(dirPath, {withFileTypes: true});
    const folderFiles = sortNaturally(
        entries
            .filter((entry) => entry.isFile() && /^folder\.[^.]+$/i.test(entry.name))
            .map((entry) => join(dirPath, entry.name))
    );

    return folderFiles[0] ?? null;
}

async function moveFileReplacing(sourcePath: string, destinationPath: string) {
    if (resolve(sourcePath) === resolve(destinationPath)) {
        return;
    }

    await mkdir(dirname(destinationPath), {recursive: true});
    await copyFile(sourcePath, destinationPath);
    await unlink(sourcePath);
}

function mapTraditionFolder(publishingTradition: string | undefined) {
    const normalized = slugifySegment(publishingTradition || '', 'desconocido');

    switch (normalized) {
        case 'american':
        case 'american comic':
            return 'americano';
        case 'manga':
            return 'manga';
        case 'franco belgian':
        case 'french comic':
            return 'franco-belga';
        case 'spanish':
        case 'spanish comic':
            return 'español';
        case 'portuguese':
            return 'portugues';
        default:
            return normalized.replace(/\s+/g, '-');
    }
}

function getTitleFolder(metadata: ComicMeta) {
    return sanitizePathSegment(metadata.title || metadata.series || 'desconocido', 'desconocido');
}

function getPublisherFolder(metadata: ComicMeta) {
    return sanitizePathSegment(metadata.publisher || 'desconocido', 'desconocido');
}

function normalizeDemography(value: string | undefined) {
    const normalized = slugifySegment(value || '', 'desconocido');

    switch (normalized) {
        case 'shoujo':
            return 'shojo';
        case 'shounen':
            return 'shonen';
        default:
            return normalized;
    }
}

function getDemographyFolder(metadata: ComicMeta) {
    return sanitizePathSegment(normalizeDemography(metadata.demography), 'desconocido');
}

function getDestinationDirectory(rootDir: string, metadata: ComicMeta) {
    const reviewedDir = join(rootDir, 'reviewed');
    const traditionFolder = mapTraditionFolder(metadata.publishingTradition);
    const titleFolder = getTitleFolder(metadata);

    if (traditionFolder === 'americano') {
        const publisherFolder = getPublisherFolder(metadata);
        return join(reviewedDir, traditionFolder, publisherFolder, titleFolder);
    }

    if (traditionFolder === 'manga') {
        const demographyFolder = getDemographyFolder(metadata);
        return join(reviewedDir, traditionFolder, demographyFolder, titleFolder);
    }

    return join(reviewedDir, traditionFolder, titleFolder);
}

async function getFilenameTitleKey(archivePath: string) {
    try {
        const filenameMeta = await extractFilenameMeta(archivePath);
        const key = buildImportCacheKey(
            filenameMeta.title ||
                filenameMeta.collection ||
                filenameMeta.query_texts?.at(-1) ||
                basename(archivePath)
        );
        if (key) {
            return key;
        }
    } catch (error) {
        debug('[import] filename key fallback', {
            archivePath,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    return buildImportCacheKey(basename(archivePath).replace(/\.[^.]+$/, ''));
}

async function moveComicToKnownDestination(archivePath: string, destinationDir: string) {
    const destinationArchivePath = join(destinationDir, basename(archivePath));
    const sourceCoverPath = await getExistingFolderCoverPath(dirname(archivePath));

    await mkdir(destinationDir, {recursive: true});
    await moveFileReplacing(archivePath, destinationArchivePath);
    debug('[import] comic movido por cache', {from: archivePath, to: destinationArchivePath});

    if (sourceCoverPath) {
        await unlink(sourceCoverPath).catch(() => {});
        debug('[import] portada descartada', {path: sourceCoverPath});
    }
}

async function processComicFile(rootDir: string, archivePath: string, importCache: ImportCache) {
    debug('[import] procesando comic', {archivePath});

    const filenameTitleKey = await getFilenameTitleKey(archivePath);
    const cachedDestinationDir = importCache.get(filenameTitleKey);
    if (cachedDestinationDir) {
        debug('[import] cache hit por titulo de filename', {
            archivePath,
            filenameTitleKey,
            destinationDir: cachedDestinationDir,
        });
        await moveComicToKnownDestination(archivePath, cachedDestinationDir);
        return;
    }

    const metadata = (await getComicMeta(archivePath)) as ComicMeta;
    const destinationDir = getDestinationDirectory(rootDir, metadata);
    const destinationArchivePath = join(destinationDir, basename(archivePath));
    const destinationMetadataPath = join(destinationDir, 'metadata.json');

    debug('[import] metadata obtenido', {
        title: metadata.title ?? null,
        publisher: metadata.publisher ?? null,
        publishingTradition: metadata.publishingTradition ?? null,
        demography: metadata.demography ?? null,
    });
    debug('[import] destino decidido', {destinationDir});

    await mkdir(destinationDir, {recursive: true});

    const sourceCoverPath = await getExistingFolderCoverPath(dirname(archivePath));

    await moveFileReplacing(archivePath, destinationArchivePath);
    debug('[import] comic movido', {from: archivePath, to: destinationArchivePath});

    await writeFile(destinationMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    debug('[import] metadata guardado', {path: destinationMetadataPath});

    if (filenameTitleKey) {
        importCache.set(filenameTitleKey, destinationDir);
        debug('[import] cache guardada', {filenameTitleKey, destinationDir});
    }

    if (sourceCoverPath) {
        await unlink(sourceCoverPath).catch(() => {});
        debug('[import] portada descartada', {path: sourceCoverPath});
    } else {
        debug('[import] portada no encontrada tras metadata', {archivePath});
    }
}

async function main() {
    const targetPath = process.argv[2];
    if (!targetPath) {
        console.error('Usage: bun run import.ts <directory>');
        process.exit(1);
    }

    const rootDir = resolve(targetPath);
    const targetStat = await stat(rootDir);
    if (!targetStat.isDirectory()) {
        throw new Error('import.ts expects a directory path');
    }

    const comicFiles = await listComicFiles(rootDir);
    debug('[import] comics detectados', {count: comicFiles.length});

    const importCache: ImportCache = new Map();
    let imported = 0;
    let failed = 0;

    for (const archivePath of comicFiles) {
        try {
            await processComicFile(rootDir, archivePath, importCache);
            imported += 1;
        } catch (error) {
            failed += 1;
            debug('[import] error procesando comic', {
                archivePath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    console.log(JSON.stringify({rootDir, total: comicFiles.length, imported, failed}, null, 2));
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
