import {access, appendFile, copyFile, readdir, stat, unlink, writeFile} from 'node:fs/promises';
import {basename, dirname, extname, join, resolve} from 'node:path';
import OpenAI from 'openai';
import {logOpenAiCost} from './ai/pricing.ts';
import {getCoverFile} from './archive/index.ts';
import {ocrComicCover, type ComicCoverOcrResult} from './ocr/index.ts';
import * as filename from './sources/filename.ts';
import * as mangaupdates from './sources/mangaupdates.ts';
import * as tebeosfera from './sources/tebeosfera.ts';
import {debug} from './utils/log.ts';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_TEXT_MODEL || 'gemma3:27b';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';
const OLLAMA_TEMPERATURE = Number(process.env.OLLAMA_TEMPERATURE ?? '0');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const OPENAI_REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT || 'low') as 'low' | 'medium' | 'high';
const ERROR_LOG_PATH = '/tmp/comic-meta.log';

type JsonSchema = Record<string, unknown>;

type ValidationDecision = {
    match: boolean;
    reason: string;
};

type MangaUpdatesSelection = {
    selected_url: string | null;
    reason: string;
};

type SourceRunResult = {
    source: string;
    data: Record<string, unknown> | null;
    validation: ValidationDecision | null;
    accepted: boolean;
};

type SourceReference = {
    title?: string;
    authors?: string[];
    publisher?: string;
    language?: string;
    work_type_estimate?: string;
};

const BANNED_GENERIC_TAGS = new Set([
    'graphic novel',
    'graphic-novel',
    'collected edition',
    'omnibus',
    'hardcover',
    'paperback',
    'color interior',
    'interior color',
    'full color',
]);

const BANNED_GENERIC_TAG_HINTS = [
    'adapted to anime',
    'anime',
    'award-winning',
    'book',
    'comic',
    'completed',
    'collected edition',
    'doujinshi',
    'edition',
    'full color',
    'hardcover',
    'integral',
    'integrale',
    'long strip',
    'novel',
    'omnibus',
    'oversized',
    'paperback',
    'prestige format',
    'published in',
    'scanlated',
    'side story',
    'slipcase',
    'softcover',
    'volume',
    'web comic',
    'webtoon',
];

function isContentTag(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (BANNED_GENERIC_TAGS.has(normalized)) {
        return false;
    }

    return !BANNED_GENERIC_TAG_HINTS.some((hint) => normalized.includes(hint));
}

function normalizeWhitespace(value: string) {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripExtension(filename: string) {
    return filename.replace(/\.[^.]+$/, '');
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function uniqueStringsCaseInsensitive(values: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values.map((item) => normalizeWhitespace(item)).filter(Boolean)) {
        const key = value.toLocaleLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(value);
    }

    return result;
}

function normalizePublishingTraditionValue(value: unknown) {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = normalizeWhitespace(value).toLowerCase().replace(/_/g, '-');
    if (!normalized) {
        return undefined;
    }

    switch (normalized) {
        case 'american-comic':
        case 'american comic':
        case 'comic americano':
            return 'american';
        case 'spanish-comic':
        case 'spanish comic':
            return 'spanish';
        case 'franco belgian':
            return 'franco-belgian';
        case 'graphic novel':
        case 'graphic-novel':
            return 'graphic-novel';
        default:
            return normalized;
    }
}

function resolvePublishingTradition(
    result: Record<string, unknown>,
    sourceResults: SourceRunResult[],
    ocrResult?: ComicCoverOcrResult
) {
    const current = normalizePublishingTraditionValue(result.publishingTradition);
    if (current && current !== 'graphic-novel') {
        return current;
    }

    const sourcePriority = ['tebeosfera', 'mangaupdates', 'filename'];
    const sourceCandidates = sourcePriority
        .map((sourceName) => sourceResults.find((result) => result.source === sourceName && result.accepted))
        .filter((result): result is SourceRunResult => Boolean(result))
        .map((result) => normalizePublishingTraditionValue(buildSourceCandidate(result.source, result.data ?? {}).publishingTradition))
        .filter((value): value is string => Boolean(value) && value !== 'graphic-novel');

    if (sourceCandidates[0]) {
        return sourceCandidates[0];
    }

    const ocrCandidate = normalizePublishingTraditionValue(ocrResult?.work_type_estimate);
    if (ocrCandidate && ocrCandidate !== 'graphic-novel') {
        return ocrCandidate;
    }

    return current;
}

function cleanObject<T>(value: T): T {
    if (Array.isArray(value)) {
        return value
            .map((item) => cleanObject(item))
            .filter((item) => {
                if (item === null || item === undefined) {
                    return false;
                }

                if (typeof item === 'string') {
                    return item.trim().length > 0;
                }

                if (Array.isArray(item)) {
                    return item.length > 0;
                }

                if (typeof item === 'object') {
                    return Object.keys(item).length > 0;
                }

                return true;
            }) as T;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .map(([key, child]) => [key, cleanObject(child)] as const)
            .filter(([, child]) => {
                if (child === null || child === undefined) {
                    return false;
                }

                if (typeof child === 'string') {
                    return child.trim().length > 0;
                }

                if (Array.isArray(child)) {
                    return child.length > 0;
                }

                if (typeof child === 'object') {
                    return Object.keys(child).length > 0;
                }

                return true;
            });

        return Object.fromEntries(entries) as T;
    }

    return value;
}

function postProcessComicMeta(result: Record<string, unknown>, sourceResults: SourceRunResult[], ocrResult?: ComicCoverOcrResult) {
    const genres = Array.isArray(result.genre)
        ? uniqueStrings(result.genre.filter((genre): genre is string => typeof genre === 'string'))
        : undefined;

    const genreSet = new Set((genres ?? []).map((genre) => genre.trim().toLowerCase()));
    const tags = Array.isArray(result.tags)
        ? uniqueStrings(
            result.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .filter((tag) => isContentTag(tag) && !genreSet.has(tag.trim().toLowerCase()))
        )
        : undefined;

    return cleanObject({
        ...result,
        genre: genres,
        tags,
        publishingTradition: resolvePublishingTradition(result, sourceResults, ocrResult),
    });
}

function shouldKeepTagHint(value: string) {
    return isContentTag(value);
}

function buildSourceMarkdownPayload(source: string, data: Record<string, unknown>) {
    return data;
}

function getApiKey() {
    return process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY || null;
}

function isComicArchivePath(filePath: string) {
    return /\.(cbz|cbr)$/i.test(filePath);
}

function sortNaturally(values: string[]) {
    return [...values].sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
}

async function pathExists(filePath: string) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function appendErrorLog(kind: string, archivePath: string, details: Record<string, unknown> = {}) {
    const payload = {
        timestamp: new Date().toISOString(),
        kind,
        archivePath,
        ...details,
    };

    await appendFile(ERROR_LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function persistCoverFile(archivePath: string, extractedCoverPath: string) {
    const coverExtension = extname(extractedCoverPath) || '.jpg';
    const persistentCoverPath = join(dirname(archivePath), `folder${coverExtension}`);
    await copyFile(extractedCoverPath, persistentCoverPath);
    await unlink(extractedCoverPath).catch(() => {});
    return persistentCoverPath;
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

async function removeExistingFolderCoverPaths(dirPath: string) {
    const entries = await readdir(dirPath, {withFileTypes: true});
    const folderFiles = entries
        .filter((entry) => entry.isFile() && /^folder\.[^.]+$/i.test(entry.name))
        .map((entry) => join(dirPath, entry.name));

    await Promise.all(folderFiles.map((filePath) => unlink(filePath).catch(() => {})));
}

async function ensureFolderCoverForArchive(archivePath: string) {
    const existingCoverPath = await getExistingFolderCoverPath(dirname(archivePath));
    if (existingCoverPath) {
        return existingCoverPath;
    }

    debug('extrayendo portada', archivePath);
    const extractedCoverPath = await getCoverFile(archivePath);
    const coverPath = await persistCoverFile(archivePath, extractedCoverPath);
    debug('portada guardada', coverPath);
    return coverPath;
}

async function extractFreshFolderCoverForArchive(archivePath: string) {
    await removeExistingFolderCoverPaths(dirname(archivePath));
    debug('extrayendo portada', archivePath);
    const extractedCoverPath = await getCoverFile(archivePath);
    const coverPath = await persistCoverFile(archivePath, extractedCoverPath);
    debug('portada guardada', coverPath);
    return coverPath;
}

async function findLeafComicDirectories(rootDir: string): Promise<string[]> {
    const entries = await readdir(rootDir, {withFileTypes: true});
    const childDirs = sortNaturally(entries.filter((entry) => entry.isDirectory()).map((entry) => join(rootDir, entry.name)));

    if (childDirs.length === 0) {
        const archiveFiles = entries
            .filter((entry) => entry.isFile() && isComicArchivePath(entry.name))
            .map((entry) => join(rootDir, entry.name));

        return archiveFiles.length > 0 ? [rootDir] : [];
    }

    const nestedResults = await Promise.all(childDirs.map((childDir) => findLeafComicDirectories(childDir)));
    return nestedResults.flat();
}

async function getFirstComicArchiveInDirectory(dirPath: string) {
    const entries = await readdir(dirPath, {withFileTypes: true});
    const archiveFiles = sortNaturally(
        entries.filter((entry) => entry.isFile() && isComicArchivePath(entry.name)).map((entry) => join(dirPath, entry.name))
    );

    return archiveFiles[0] ?? null;
}

async function processComicDirectory(dirPath: string, regenerate: boolean) {
    const metadataPath = join(dirPath, 'metadata.json');
    const archivePath = await getFirstComicArchiveInDirectory(dirPath);
    if (!archivePath) {
        debug('[dir] sin archivos de comic en directorio hoja', {dirPath});
        return {dirPath, status: 'empty' as const};
    }

    try {
        await ensureFolderCoverForArchive(archivePath);

        if (!regenerate && (await pathExists(metadataPath))) {
            debug('[dir] skip por metadata existente', {dirPath});
            return {dirPath, status: 'skipped' as const};
        }

        debug('[dir] generando metadata', {dirPath, archivePath});
        const result = await getComicMeta(archivePath);
        await writeFile(metadataPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

        return {dirPath, status: 'generated' as const, metadataPath, archivePath};
    } catch (error) {
        await appendErrorLog('generation_error', archivePath, {
            dirPath,
            error: error instanceof Error ? error.message : String(error),
        });
        debug('[dir] error generando metadata', {
            dirPath,
            archivePath,
            error: error instanceof Error ? error.message : String(error),
        });
        return {dirPath, status: 'error' as const, archivePath};
    }
}

function extractText(response: Awaited<ReturnType<OpenAI['responses']['create']>>) {
    if (response.output_text && response.output_text.trim()) {
        return response.output_text;
    }

    for (const item of response.output ?? []) {
        if (item.type !== 'message') {
            continue;
        }

        for (const content of item.content ?? []) {
            if (content.type === 'output_text' && content.text?.trim()) {
                return content.text;
            }
        }
    }

    throw new Error('OpenAI returned no text output.');
}

async function runOllamaJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            keep_alive: OLLAMA_KEEP_ALIVE,
            temperature: OLLAMA_TEMPERATURE,
            messages: [
                {role: 'system', content: systemPrompt},
                {role: 'user', content: userPrompt},
            ],
            format: 'json',
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {message?: {content?: string}};
    const content = data.message?.content;
    if (!content) {
        throw new Error('Ollama returned no content');
    }

    return JSON.parse(content) as T;
}

function jsonCodeBlock(value: unknown) {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function buildSearchTitle(context: ComicCoverOcrResult, archivePath: string) {
    return (
        context.title ||
        context.collection ||
        stripExtension(basename(archivePath))
            .replace(/[_\.]+/g, ' ')
            .replace(/\[[^\]]*]/g, ' ')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

function buildReference(context: ComicCoverOcrResult): SourceReference {
    const authors = uniqueStrings([...(context.authors ?? []), ...(context.artists ?? [])]);

    return cleanObject({
        title: context.title,
        authors,
        publisher: context.publisher,
        language: context.language,
        work_type_estimate: context.work_type_estimate,
    });
}

function buildSearchTitles(
    archivePath: string,
    ocrResult: ComicCoverOcrResult,
    filenameData: Record<string, unknown> | null
) {
    const filenameQueryTexts = Array.isArray(filenameData?.query_texts)
        ? filenameData.query_texts.filter((item): item is string => typeof item === 'string')
        : [];
    const filenameTitle = typeof filenameData?.title === 'string' ? filenameData.title : '';
    const ocrTitle = buildSearchTitle(ocrResult, archivePath);

    return uniqueStringsCaseInsensitive([...filenameQueryTexts, filenameTitle, ocrTitle].filter(Boolean));
}

function toRecord(value: unknown): Record<string, unknown> {
    return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

function buildSourceCandidate(source: string, data: Record<string, unknown>) {
    if (source === 'filename') {
        return {
            title: typeof data.title === 'string' ? data.title : undefined,
            authors: uniqueStrings([
                ...(Array.isArray(data.authors) ? data.authors : []).filter(
                    (item): item is string => typeof item === 'string'
                ),
                ...(Array.isArray(data.artists) ? data.artists : []).filter(
                    (item): item is string => typeof item === 'string'
                ),
            ]),
            publisher: typeof data.publisher === 'string' ? data.publisher : undefined,
            publishingTradition:
                typeof data.publishingTradition === 'string' ? data.publishingTradition : undefined,
            alternate_titles: [
                typeof data.subtitle === 'string' ? data.subtitle : null,
                typeof data.collection === 'string' ? data.collection : null,
            ].filter((item): item is string => Boolean(item)),
        };
    }

    if (source === 'mangaupdates') {
        const authors = [
            ...((data.authors as Array<{label?: string}> | undefined) ?? []).map((item) => item.label ?? ''),
            ...((data.artists as Array<{label?: string}> | undefined) ?? []).map((item) => item.label ?? ''),
        ];

        return {
            title: typeof data.title === 'string' ? data.title : undefined,
            authors: uniqueStrings(authors),
            publisher: ((data.originalPublishers as Array<{label?: string}> | undefined) ?? [])[0]?.label,
            publishingTradition: typeof data.type === 'string' ? data.type : 'manga',
            alternate_titles: Array.isArray(data.associatedNames) ? data.associatedNames : [],
        };
    }

    if (source === 'tebeosfera') {
        const artists = ((data.artists as Array<{name?: string; aka?: string[]}> | undefined) ?? []).flatMap(
            (artist) => [artist.name ?? '', ...(artist.aka ?? []).filter(Boolean)]
        );

        return {
            title: typeof data.title === 'string' ? data.title : undefined,
            authors: uniqueStrings(artists),
            publisher: typeof data.publisher === 'string' ? data.publisher : undefined,
            publishingTradition:
                typeof data.publishingTradition === 'string' ? data.publishingTradition : undefined,
            alternate_titles: ((data.alternateTitles as Array<{title?: string}> | undefined) ?? []).map(
                (item) => item.title ?? ''
            ),
        };
    }

    return {
        title: typeof data.title === 'string' ? data.title : undefined,
        authors: [],
        publisher: undefined,
        publishingTradition: undefined,
        alternate_titles: [],
    };
}

function shouldRunMangaUpdates(context: ComicCoverOcrResult) {
    const workType = normalizeWhitespace(context.work_type_estimate ?? '').toLowerCase();
    if (!workType) {
        return true;
    }

    const asianWorkTypes = ['manga', 'manhwa', 'manhua', 'webtoon', 'webcomic'];
    if (asianWorkTypes.some((type) => workType.includes(type))) {
        return true;
    }

    const nonAsianWorkTypes = [
        'american-comic',
        'american comic',
        'franco-belgian',
        'franco belgian',
        'spanish-comic',
        'spanish comic',
        'graphic-novel',
        'graphic novel',
        'european comic',
        'comic europeo',
        'comic americano',
    ];

    if (nonAsianWorkTypes.some((type) => workType.includes(type))) {
        return false;
    }

    return true;
}

async function chooseMangaUpdatesCandidate(
    context: ComicCoverOcrResult,
    searchTitle: string,
    candidates: mangaupdates.MangaUpdatesSeriesResult[]
) {
    if (candidates.length === 0) {
        return null;
    }

    return runOllamaJson<MangaUpdatesSelection>(
        [
            'You select the best MangaUpdates search candidate for a comic OCR context.',
            'Prefer exact title matches first.',
            'Use authors, publisher, year, language, and work_type_estimate as tie-breakers.',
            'Reject candidates that clearly refer to another work.',
            'Minor title wording differences and alternate spellings are acceptable.',
            'Return only valid JSON like {"selected_url":"...","reason":"brief"} or {"selected_url":null,"reason":"brief"}.',
        ].join('\n'),
        [
            `Search title: ${searchTitle}`,
            '',
            'OCR context:',
            JSON.stringify(context, null, 2),
            '',
            'Candidates:',
            JSON.stringify(candidates, null, 2),
        ].join('\n')
    );
}

async function validateSource(
    source: string,
    reference: SourceReference,
    data: Record<string, unknown>
): Promise<ValidationDecision> {
    const candidate = buildSourceCandidate(source, data);

    return runOllamaJson<ValidationDecision>(
        [
            'Determine if the source result refers to the same comic work as the OCR reference.',
            'Be tolerant to subtle title wording differences, punctuation, accents, translations, and abbreviations.',
            'Be tolerant to author name variants such as full names, initials, pen names, transliterations, or alternate spellings.',
            'If the source is clearly a different work, return match false.',
            'If known authors conflict strongly, return match false.',
            'Different editions or translations of the same work are still a match.',
            'Return only valid JSON like {"match":true,"reason":"brief"} or {"match":false,"reason":"brief"}.',
        ].join('\n'),
        [
            'OCR reference:',
            JSON.stringify(reference, null, 2),
            '',
            `Candidate from ${source}:`,
            JSON.stringify(candidate, null, 2),
        ].join('\n')
    );
}

async function runMangaUpdatesScraper(
    context: ComicCoverOcrResult,
    searchTitles: string[]
): Promise<SourceRunResult> {
    if (!shouldRunMangaUpdates(context)) {
        debug('[mangaupdates] omitido por tipo de obra detectado en OCR', {
            work_type_estimate: context.work_type_estimate ?? null,
        });
        return {
            source: 'mangaupdates',
            data: null,
            validation: null,
            accepted: false,
        };
    }

    for (const searchTitle of searchTitles) {
        try {
            debug('[mangaupdates] buscando', {searchTitle});
            const searchResult = await mangaupdates.search(searchTitle);
            if (searchResult.results.length === 0) {
                debug('[mangaupdates] sin resultados', {searchTitle});
                continue;
            }

            const selection = await chooseMangaUpdatesCandidate(
                context,
                searchTitle,
                searchResult.results.slice(0, 10)
            );
            const selectedUrl = selection?.selected_url;
            const selected =
                searchResult.results.find((result) => result.url === selectedUrl) ?? searchResult.results[0];
            debug('[mangaupdates] candidato elegido', {
                searchTitle,
                title: selected.title,
                url: selected.url,
                reason: selection?.reason ?? null,
            });

            const details = toRecord(await mangaupdates.getSeries(selected.url));
            const validation = await validateSource('mangaupdates', buildReference(context), details);

            debug('[mangaupdates] validacion', validation);
            if (!validation.match) {
                debug('[mangaupdates] descartando candidato y probando siguiente titulo', {searchTitle});
                continue;
            }

            return {
                source: 'mangaupdates',
                data: details,
                validation,
                accepted: true,
            };
        } catch (error) {
            debug('[mangaupdates] error', {
                searchTitle,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        source: 'mangaupdates',
        data: null,
        validation: null,
        accepted: false,
    };
}

async function runFilenameSource(
    archivePath: string,
    context?: ComicCoverOcrResult
): Promise<SourceRunResult> {
    try {
        debug('[filename] analizando', {archivePath});
        const data = toRecord(await filename.extractFilenameMeta(archivePath, context));
        debug('[filename] resultado', data);
        const validation = context ? await validateSource('filename', buildReference(context), data) : null;
        if (validation) {
            debug('[filename] validacion', validation);
        }

        return {
            source: 'filename',
            data,
            validation,
            accepted: true,
        };
    } catch (error) {
        debug('[filename] error', error instanceof Error ? error.message : String(error));
        return {
            source: 'filename',
            data: null,
            validation: null,
            accepted: false,
        };
    }
}

async function runTebeosferaScraper(
    context: ComicCoverOcrResult,
    searchTitles: string[]
): Promise<SourceRunResult> {
    for (const searchTitle of searchTitles) {
        try {
            debug('[tebeosfera] buscando', {searchTitle});
            const data = toRecord(
                await tebeosfera.scrapeComicMetaFromOcrContext(context, {
                    searchTitle,
                })
            );
            const validation = await validateSource('tebeosfera', buildReference(context), data);
            debug('[tebeosfera] validacion', validation);

            if (!validation.match) {
                debug('[tebeosfera] descartando candidato y probando siguiente titulo', {searchTitle});
                continue;
            }

            return {
                source: 'tebeosfera',
                data,
                validation,
                accepted: true,
            };
        } catch (error) {
            debug('[tebeosfera] error', {
                searchTitle,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        source: 'tebeosfera',
        data: null,
        validation: null,
        accepted: false,
    };
}

function buildSourcesMarkdown(ocrResult: ComicCoverOcrResult, results: SourceRunResult[]) {
    const sections: string[] = [];

    for (const result of results) {
        if (!result.data || !result.accepted) {
            continue;
        }

        sections.push(
            `## Scrape result from ${result.source}\n\n${jsonCodeBlock(buildSourceMarkdownPayload(result.source, result.data))}`
        );
    }

    sections.push(`## OCR from cover\n\n${jsonCodeBlock(ocrResult)}`);

    return sections.join('\n\n');
}

async function aggregateComicMeta(client: OpenAI, markdown: string, schema: JsonSchema) {
    const response = await client.responses.create({
        model: OPENAI_MODEL,
        reasoning: {effort: OPENAI_REASONING_EFFORT},
        text: {
            format: {
                type: 'json_schema',
                name: 'comicmeta',
                strict: true,
                schema: schema as JsonSchema,
            },
        },
        instructions: [
            'You are a comic metadata aggregation specialist.',
            'You will receive markdown containing OCR data and validated scraper results.',
            'Produce a single JSON object that matches the provided ComicMeta schema.',
            'All output values must be in English except personal names and titles already established in another language.',
            'When a title is written in a non-Latin script such as Japanese, Chinese, Korean, Russian, Arabic, or similar, append a standard Latin transliteration in parentheses.',
            "For example: 'アキラ (Akira)'. Apply this rule to the main title and alternate titles when relevant.",
            'Do not guess the language of a non-Latin title carelessly.',
            'Identify the script correctly before assigning any locale.',
            'If a title is written in Cyrillic, keep it as a Cyrillic-script locale, not a Japanese, Chinese, or Korean one.',
            'Do not assign locale uk to a Cyrillic title unless there is clear evidence of Ukrainian.',
            'Treat Russian as the default guess only when the sources indicate Russian or the spelling strongly looks Russian; otherwise use und rather than uk.',
            'Strong Ukrainian evidence includes characters such as i, yi, ie, or ghe with upturn used in Ukrainian Cyrillic spellings; without that evidence, do not jump to uk.',
            "For example, a Cyrillic title like 'Моя алко-втеча від реальности' must not be labeled as Japanese, and it should not be labeled uk unless the source clearly supports Ukrainian.",
            'Never label Japanese text as Chinese or Chinese text as Japanese unless the source explicitly proves it.',
            'If the exact language is uncertain, preserve the original script and transliterate when possible, but avoid assigning the wrong locale or language-specific interpretation.',
            'Prefer validated scraper data over OCR when they conflict.',
            'If the validated source named filename provides a plausible title, prefer that title over OCR and over other source titles.',
            'Treat the filename title as the primary title candidate when it matches the same work and is not obviously noisier, more truncated, or less specific than the alternatives.',
            'Use other sources to enrich, normalize, or transliterate the chosen title, but do not replace a correct validated filename title unnecessarily.',
            'Treat the final JSON as metadata for the underlying work or series in general, not for one specific collected edition, printing, binding, or volume package.',
            'Prefer the canonical work title, not the edition-marketing title.',
            'publishingTradition must describe the actual comics tradition or market, such as manga, manhwa, manhua, american, franco-belgian, spanish, or portuguese.',
            'Do not use publishingTradition for format labels such as graphic novel, album, omnibus, deluxe, hardcover, or similar packaging/release terms.',
            'If a work is a graphic novel in format but belongs to a tradition like franco-belgian, spanish, or american, set publishingTradition to that tradition instead.',
            'Do not include edition labels or packaging descriptors in title or alternateTitles unless they are clearly part of the true canonical title of the work itself.',
            "This means you should usually exclude words or phrases such as 'Integral', 'Deluxe', 'Absolute', 'Omnibus', 'Ultimate Edition', 'Edicion Integral', and similar edition wording when they only describe the release format.",
            'Do not include volume numbers, tome numbers, book numbers, or similar installment packaging in title or alternateTitles when describing the work as a whole.',
            "For example, prefer 'Spawn' over 'Spawn. Edicion Integral' or 'Spawn. Edicion Integral. Volumen I' when the latter only describe a specific release.",
            'Normalize title, alternateTitles, and series casing so they are not left in random ALL CAPS or shouty source formatting.',
            'Keep genuine acronyms, initials, and intentional stylization when clearly required, but otherwise use normal human-readable title casing.',
            "For example, prefer 'Spawn' over 'SPAWN' and 'Spawn. Edicion Integral' over 'SPAWN. EDICION INTEGRAL' when the uppercase form is just source formatting.",
            'Use OCR as fallback when scraper data is absent.',
            'Keep summary focused on the synopsis or premise of the work itself.',
            'When the provided sources contain enough reliable synopsis material, write a fairly detailed summary rather than an overly compressed one.',
            'Prefer a rich multi-sentence synopsis that captures the premise, major conflict, setting, and distinctive hook of the work when the sources support that level of detail.',
            'Do not make summary short just for brevity if the source material clearly supports a fuller description.',
            'Set rating only when the provided sources include a rating signal that can be mapped to a 0 to 10 numeric value; otherwise use null.',
            'If source summary text mixes synopsis with editorial copy, edition-specific quirks, author commentary, biographical remarks, trivia, curiosities, or format information, extract only the real plot or premise into summary and move the rest into notes only if it is genuinely useful and not already covered by another field.',
            "Do not keep labels like 'Información de la editorial' in summary unless they are part of the actual synopsis.",
            'Use notes only for meaningful extra context about the work itself that does not fit better in another field, such as adaptation context, author commentary, controversies, or source ambiguities.',
            'Prefer notes to be empty rather than filled with duplicated, obvious, or redundant metadata.',
            'Do not put into notes facts already represented in structured fields such as title, alternateTitles, artists, publisher, releaseDate, volumeCount, genre, tags, publishingTradition, demography, or related works.',
            'Do not use notes for edition-specific quirks, packaging details, bonus contents tied only to a particular release, or publication facts already represented elsewhere, including original publisher, publisher country, release year/date, edition title, creator identity, genre-like descriptors, or lists of related works.',
            'Do not use notes to describe what a specific edition, omnibus, integral, deluxe, or volume release collects, reprints, or corresponds to.',
            'Do not include mappings such as a specific volume containing issues 1-3, collecting volumes 1-3, or corresponding to a particular release package.',
            'If a note is only true for one specific edition or one specific volume, omit it.',
            "Bad notes examples: 'Publisher: East Press. Publishing tradition: manga. Demography: josei.' and 'Original publisher: East Press; 2019 release. English edition title: My Alcoholic Escape from Reality.'",
            'Deduplicate alternate titles, genres, tags, and artists intelligently.',
            'Order genre so the predominant genre of the work appears first, followed by secondary genres if needed.',
            'Never output duplicate artists entries with the same person and the same role.',
            'If the same creator appears more than once with the same role, merge them into a single artists entry and combine any alias information into aka.',
            'Avoid redundant multi-role duplication for the same creator when the roles do not add useful information.',
            'For manga, manhwa, and manhua, if the same single creator is effectively the main creator, prefer one artists entry with role author instead of repeating that same person as penciller, inker, or similar production roles.',
            'Only keep multiple roles for the same person when the distinction is explicit, important, and genuinely informative for this work.',
            'Normalize creator name casing so names are not left in random shouty uppercase fragments.',
            "For example, prefer 'Nagata Kabi' over 'NAGATA Kabi' unless the uppercase form is a true acronym or intentional stylization.",
            'Keep genuine acronyms or initials uppercase, but otherwise use normal human name capitalization.',
            'Tags must be high-signal content descriptors that help a human understand at a glance what the work is about.',
            'Good tags include themes, settings, conflicts, motifs, subject matter, historical periods, political contexts, occupations, creature types, erotic content, war settings, speculative elements, or distinctive narrative hooks.',
            'Prefer tags about the story, world, themes, conflicts, powers, creatures, tone, or setting of the work rather than about the physical edition or packaging.',
            'Keep all tags that meet the quality criteria defined here.',
            'Keep a tag if it is specific, informative, and supported by the sources, even when there are many such tags.',
            'Do not omit good source tags that already appear in the provided markdown unless they fail the quality criteria.',
            'Prefer preserving original source tags when they are specific, content-focused, and useful.',
            'If the source tags are too few, too generic, or fail to reflect important aspects of the work, add or replace tags using direct, well-supported inferences from the provided summary and other source text.',
            'If the summary strongly supports additional high-confidence story tags, add them even when they were not present in the scraped tags.',
            'Do not invent new tags unless they are a very direct, well-supported normalization or inference from the provided sources.',
            'Prefer preserving valid source tags over replacing them with newly invented wording, but improve the final set when the source tags are weak or incomplete.',
            'Remove tags only when they are generic, redundant, contradictory, unsupported, or about packaging, format, publisher/language metadata, or other catalog boilerplate rather than story/content.',
            "Bad tags include edition or format metadata such as 'omnibus', 'hardcover', 'paperback', 'collected edition', 'color interior', or generic labels like 'comic'.",
            "Good tags look more like story descriptors such as 'antihero', 'hell', 'demons', 'new york', 'vigilante', or other work-specific themes when supported by the sources.",
            'A good result often has several tags, not just two or three, as long as they are specific and useful.',
            'Treat source tags as a priority pool for final tags, and keep their high-signal entries unless they fail the quality criteria above.',
            'When needed, use the summary to recover missing high-signal story tags so the final tag list reflects the work rather than the edition.',
            'Do not drop good scraped tags just because additional tags can be inferred from the summary; combine both when they are all useful and non-redundant.',
            'Some structural or classification tags can still be useful when they help filter works, such as manga, manhwa, manhua, oneshot, sequel, prequel, spinoff, spin-off, crossover, anthology, or adaptation.',
            'Keep those classification tags when they are clearly true and useful for catalog filtering.',
            'When an author name string contains aliases or alternative names, split them intelligently.',
            "For example, if a source contains something like 'Pepito (Jose Luis Perales)', infer the primary display name and put the alternate form in aka.",
            'Use aka for pen names, aliases, full-name expansions, alternate spellings, transliterations, romanizations, or name forms found in parentheses.',
            'Do not use aka for mere casing variants such as NAGATA Kabi versus Nagata Kabi.',
            'Do not leave alias information embedded inside the main name field when it can be separated cleanly into aka.',
            'Do not invent facts.',
            'Return only the JSON object.',
        ].join('\n'),
        input: markdown,
    });

    logOpenAiCost('[aggregate] final', OPENAI_MODEL, response);

    return JSON.parse(extractText(response)) as Record<string, unknown>;
}

export async function getComicMeta(archivePath: string) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Missing OPENAI_API_KEY environment variable. OPEN_API_KEY is also accepted.');
    }

    const client = new OpenAI({apiKey});
    const filenamePromise = runFilenameSource(archivePath);
    const schemaPromise = Bun.file('./schema/comicmeta.json').text();

    const coverPath = await extractFreshFolderCoverForArchive(archivePath);
    debug('ejecutando ocr');
    const ocrResult = await ocrComicCover(coverPath);
    debug('ocr completado', ocrResult);

    const filenameResult = await filenamePromise;
    const searchTitles = buildSearchTitles(archivePath, ocrResult, filenameResult.data);
    if (searchTitles.length === 0) {
        throw new Error('Could not infer a search title from OCR or filename');
    }

    debug('titulos de busqueda', searchTitles);

    const [mangaupdatesResult, tebeosferaResult, schemaText] = await Promise.all([
        runMangaUpdatesScraper(ocrResult, searchTitles),
        runTebeosferaScraper(ocrResult, searchTitles),
        schemaPromise,
    ]);

    const sourceResults = [filenameResult, mangaupdatesResult, tebeosferaResult];
    const markdown = buildSourcesMarkdown(ocrResult, sourceResults);
    debug('markdown intermedio', markdown);

    const acceptedExternalSources = sourceResults.filter(
        (result) => result.accepted && result.source !== 'filename'
    );
    if (acceptedExternalSources.length === 0) {
        await appendErrorLog('no_external_scraper_match', archivePath, {
            searchTitles,
            filenameAccepted: filenameResult.accepted,
        });
    }

    const finalResult = postProcessComicMeta(
        await aggregateComicMeta(client, markdown, JSON.parse(schemaText) as JsonSchema),
        sourceResults,
        ocrResult
    );
    debug(
        'fuentes aceptadas',
        sourceResults.filter((result) => result.accepted).map((result) => result.source)
    );

    return finalResult;
}

async function main() {
    const args = process.argv.slice(2);
    const regenerate = args.includes('--regenerate');
    const targetPath = args.find((arg) => arg !== '--regenerate');

    if (!targetPath) {
        console.error('Usage: bun run comic-meta.ts <archive-path-or-directory> [--regenerate]');
        process.exit(1);
    }

    const resolvedTarget = resolve(targetPath);
    const targetStat = await stat(resolvedTarget);

    if (targetStat.isDirectory()) {
        const leafDirs = await findLeafComicDirectories(resolvedTarget);
        debug('[dir] directorios hoja detectados', {count: leafDirs.length});

        let generated = 0;
        let skipped = 0;

        for (const dirPath of leafDirs) {
            const outcome = await processComicDirectory(dirPath, regenerate);
            if (outcome.status === 'generated') {
                generated += 1;
                console.log(`[generated] ${outcome.metadataPath}`);
            } else if (outcome.status === 'skipped') {
                skipped += 1;
                console.log(`[skipped] ${dirPath}`);
            } else if (outcome.status === 'error') {
                console.log(`[error] ${dirPath}`);
            }
        }

        console.log(JSON.stringify({root: resolvedTarget, directories: leafDirs.length, generated, skipped}, null, 2));
        return;
    }

    const result = await getComicMeta(resolvedTarget);
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
