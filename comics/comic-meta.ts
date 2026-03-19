import {unlink} from 'node:fs/promises';
import {basename} from 'node:path';
import OpenAI from 'openai';
import {logOpenAiCost} from './ai/pricing.ts';
import {getCoverFile} from './archive/index.ts';
import {ocrComicCover, type ComicCoverOcrResult} from './ocr/index.ts';
import * as filename from './sources/filename.ts';
import * as mangaupdates from './sources/mangaupdates.ts';
import * as tebeosfera from './sources/tebeosfera.ts';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_MODEL = process.env.IA_MODEL || 'gemma3:27b';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const ANSI_GRAY = '\x1b[90m';
const ANSI_RESET = '\x1b[0m';

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

const BANNED_GENERIC_TAGS = new Set(['graphic novel', 'graphic-novel']);

const BANNED_GENERIC_TAG_HINTS = [
    'adapted to anime',
    'anime',
    'award-winning',
    'book',
    'comic',
    'completed',
    'doujinshi',
    'full color',
    'hardcover',
    'long strip',
    'novel',
    'paperback',
    'published in',
    'scanlated',
    'side story',
    'volume',
    'web comic',
    'webtoon',
];

function logStderr(message: string, data?: unknown) {
    if (data === undefined) {
        process.stderr.write(`${ANSI_GRAY}${message}${ANSI_RESET}\n`);
        return;
    }

    const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    process.stderr.write(`${ANSI_GRAY}${message}: ${payload}${ANSI_RESET}\n`);
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

function postProcessComicMeta(result: Record<string, unknown>) {
    const genres = Array.isArray(result.genre)
        ? uniqueStrings(result.genre.filter((genre): genre is string => typeof genre === 'string'))
        : undefined;

    const genreSet = new Set((genres ?? []).map((genre) => genre.trim().toLowerCase()));
    const tags = Array.isArray(result.tags)
        ? uniqueStrings(
            result.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .filter((tag) => {
                    const normalized = tag.trim().toLowerCase();
                    return !BANNED_GENERIC_TAGS.has(normalized) && !genreSet.has(normalized);
                })
        )
        : undefined;

    return cleanObject({
        ...result,
        genre: genres,
        tags,
    });
}

function shouldKeepTagHint(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (BANNED_GENERIC_TAGS.has(normalized)) {
        return false;
    }

    return !BANNED_GENERIC_TAG_HINTS.some((hint) => normalized.includes(hint));
}

function buildSourceMarkdownPayload(source: string, data: Record<string, unknown>) {
    return data;
}

function getApiKey() {
    return process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY || null;
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
    const filenameTitle = typeof filenameData?.title === 'string' ? filenameData.title : '';
    const ocrTitle = buildSearchTitle(ocrResult, archivePath);

    return uniqueStrings([filenameTitle, ocrTitle].filter(Boolean));
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
    for (const searchTitle of searchTitles) {
        try {
            logStderr('[mangaupdates] buscando', {searchTitle});
            const searchResult = await mangaupdates.search(searchTitle);
            if (searchResult.results.length === 0) {
                logStderr('[mangaupdates] sin resultados', {searchTitle});
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
            logStderr('[mangaupdates] candidato elegido', {
                searchTitle,
                title: selected.title,
                url: selected.url,
                reason: selection?.reason ?? null,
            });

            const details = toRecord(await mangaupdates.getSeries(selected.url));
            const validation = await validateSource('mangaupdates', buildReference(context), details);

            logStderr('[mangaupdates] validacion', validation);
            if (!validation.match) {
                logStderr('[mangaupdates] descartando candidato y probando siguiente titulo', {searchTitle});
                continue;
            }

            return {
                source: 'mangaupdates',
                data: details,
                validation,
                accepted: true,
            };
        } catch (error) {
            logStderr('[mangaupdates] error', {
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
        logStderr('[filename] analizando', {archivePath});
        const data = toRecord(await filename.extractFilenameMeta(archivePath, context));
        logStderr('[filename] resultado', data);
        const validation = context ? await validateSource('filename', buildReference(context), data) : null;
        if (validation) {
            logStderr('[filename] validacion', validation);
        }

        return {
            source: 'filename',
            data,
            validation,
            accepted: true,
        };
    } catch (error) {
        logStderr('[filename] error', error instanceof Error ? error.message : String(error));
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
            logStderr('[tebeosfera] buscando', {searchTitle});
            const data = toRecord(
                await tebeosfera.scrapeComicMetaFromOcrContext(context, {
                    searchTitle,
                })
            );
            const validation = await validateSource('tebeosfera', buildReference(context), data);
            logStderr('[tebeosfera] validacion', validation);

            if (!validation.match) {
                logStderr('[tebeosfera] descartando candidato y probando siguiente titulo', {searchTitle});
                continue;
            }

            return {
                source: 'tebeosfera',
                data,
                validation,
                accepted: true,
            };
        } catch (error) {
            logStderr('[tebeosfera] error', {
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
        reasoning: {effort: 'medium'},
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
            'Use OCR as fallback when scraper data is absent.',
            'Keep summary focused on the synopsis or premise of the work itself.',
            'If source summary text mixes synopsis with editorial copy, edition details, author commentary, biographical remarks, publication history, trivia, curiosities, or format information, extract only the real plot or premise into summary and move the rest into notes.',
            "Do not keep labels like 'Información de la editorial' in summary unless they are part of the actual synopsis.",
            'Notes should absorb non-synopsis material such as edition details, printing history, publication context, curiosities, author remarks, bonus contents, format details, and other supplementary information.',
            'Do not use notes as a dump for facts that already belong to structured fields.',
            'Do not repeat in notes information already captured in title, alternateTitles, artists, publisher, releaseDate, volume, volumeCount, genre, tags, publishingTradition, demography, or other explicit fields.',
            'If a fact is already represented elsewhere in the JSON, omit it from notes unless the note adds genuinely new context, nuance, ambiguity, or editorial detail.',
            'Notes should add value, not restate the structured metadata.',
            'In particular, do not use notes to restate publisher, year, demography, publishingTradition, genre, tags, creator list, alternate titles, related works, or basic release format.',
            "Bad notes example: 'Publisher: East Press. Publishing tradition: manga. Demography: josei. Genre/mood: psychological drama.'",
            "Bad notes example: 'Related works referenced in source materials: Hitori Koukan Nikki; Meisou Senshi Nagata Kabi.'",
            "Bad notes example: 'Original publisher: East Press; 2019 release. English edition title: My Alcoholic Escape from Reality.'",
            'Do not repeat in notes original publisher, release year/date, or translated/English edition titles when those facts are already captured in publisher, releaseDate, or alternateTitles.',
            'Good notes should capture only meaningful extra context such as edition-specific quirks, publication history, bonus contents, adaptation context, author commentary, controversies, or source ambiguities that do not fit better elsewhere.',
            'Deduplicate alternate titles, genres, tags, and artists intelligently.',
            'Never output duplicate artists entries with the same person and the same role.',
            'If the same creator appears more than once with the same role, merge them into a single artists entry and combine any alias information into aka.',
            'Normalize creator name casing so names are not left in random shouty uppercase fragments.',
            "For example, prefer 'Nagata Kabi' over 'NAGATA Kabi' unless the uppercase form is a true acronym or intentional stylization.",
            'Keep genuine acronyms or initials uppercase, but otherwise use normal human name capitalization.',
            'Tags must be high-signal content descriptors that help a human understand at a glance what the work is about.',
            'Good tags include themes, settings, conflicts, motifs, subject matter, historical periods, political contexts, occupations, creature types, erotic content, war settings, speculative elements, or distinctive narrative hooks.',
            'Keep all tags that meet the quality criteria defined here.',
            'Keep a tag if it is specific, informative, and supported by the sources, even when there are many such tags.',
            'Do not omit good source tags that already appear in the provided markdown unless they fail the quality criteria.',
            'Do not invent new tags unless they are a very direct, well-supported normalization or inference from the provided sources.',
            'Prefer preserving valid source tags over replacing them with newly invented wording.',
            'Remove tags only when they are generic, redundant, contradictory, unsupported, or about packaging, format, publisher/language metadata, or other catalog boilerplate rather than story/content.',
            'A good result often has several tags, not just two or three, as long as they are specific and useful.',
            'Treat source tags as a priority pool for final tags, and keep their high-signal entries unless they fail the quality criteria above.',
            'Some structural or classification tags can still be useful when they help filter works, such as manga, manhwa, manhua, oneshot, sequel, prequel, spinoff, spin-off, crossover, anthology, or adaptation.',
            'Keep those classification tags when they are clearly true and useful for catalog filtering.',
            'When an author name string contains aliases or alternative names, split them intelligently.',
            "For example, if a source contains something like 'Pepito (Jose Luis Perales)', infer the primary display name and put the alternate form in aka.",
            'Use aka for pen names, aliases, full-name expansions, alternate spellings, transliterations, romanizations, or name forms found in parentheses.',
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
    let coverPath: string | null = null;

    try {
        const filenamePromise = runFilenameSource(archivePath);
        const schemaPromise = Bun.file('./schema/comicmeta.json').text();

        logStderr('extrayendo portada', archivePath);
        coverPath = await getCoverFile(archivePath);
        logStderr('portada extraida', coverPath);

        logStderr('ejecutando ocr');
        const ocrResult = await ocrComicCover(coverPath);
        logStderr('ocr completado', ocrResult);

        const filenameResult = await filenamePromise;
        const searchTitles = buildSearchTitles(archivePath, ocrResult, filenameResult.data);
        if (searchTitles.length === 0) {
            throw new Error('Could not infer a search title from OCR or filename');
        }

        logStderr('titulos de busqueda', searchTitles);

        const [mangaupdatesResult, tebeosferaResult, schemaText] = await Promise.all([
            runMangaUpdatesScraper(ocrResult, searchTitles),
            runTebeosferaScraper(ocrResult, searchTitles),
            schemaPromise,
        ]);

        const sourceResults = [filenameResult, mangaupdatesResult, tebeosferaResult];
        const markdown = buildSourcesMarkdown(ocrResult, sourceResults);
        logStderr('markdown intermedio', markdown);

        const finalResult = postProcessComicMeta(
            await aggregateComicMeta(client, markdown, JSON.parse(schemaText) as JsonSchema)
        );
        logStderr(
            'fuentes aceptadas',
            sourceResults.filter((result) => result.accepted).map((result) => result.source)
        );

        return finalResult;
    } finally {
        if (coverPath) {
            logStderr('eliminando portada temporal', coverPath);
            await unlink(coverPath).catch(() => {});
        }
    }
}

async function main() {
    const archivePath = process.argv[2];
    if (!archivePath) {
        console.error('Usage: bun run comic-meta.ts <archive-path>');
        process.exit(1);
    }

    const result = await getComicMeta(archivePath);
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
