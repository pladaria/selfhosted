import {getCoverFile} from './archive/index.ts';
import {ocrComicCover} from './ocr/index.ts';
import {getInfoFromFilename} from './ia/index.ts';
import * as mangaupdates from './sources/mangaupdates.ts';
import * as tebeosfera from './sources/tebeosfera.ts';
import {basename} from 'path';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const IA_MODEL = process.env.IA_MODEL || 'gemma3:27b';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';
const ANSI_GRAY = '\x1b[90m';
const ANSI_RESET = '\x1b[0m';

function safeJson(value: unknown) {
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return `[unserializable: ${(error as Error).message}]`;
    }
}

function writeLogLine(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: unknown) {
    const ts = new Date().toISOString();
    const lines = [`[${ts}] [${level}] ${message}`];
    if (data !== undefined) {
        if (typeof data === 'string') {
            lines.push(data);
        } else {
            lines.push(safeJson(data));
        }
    }
    lines.push('');

    process.stderr.write(`${ANSI_GRAY}${lines.join('\n')}\n${ANSI_RESET}`);
}

function initPipelineLog(archivePath: string) {
    writeLogLine('INFO', 'Pipeline execution started', {archivePath});
}

function logInfo(message: string, data?: unknown) {
    writeLogLine('INFO', message, data);
}

function logWarn(message: string, data?: unknown) {
    writeLogLine('WARN', message, data);
}

function logError(message: string, data?: unknown) {
    writeLogLine('ERROR', message, data);
}

type SourceData = {
    mangaupdates: mangaupdates.MangaUpdatesSeriesDetails | null;
    tebeosfera: tebeosfera.TebeosferaCollectionDetails | null;
};

async function searchMangaupdates(
    title: string
): Promise<mangaupdates.MangaUpdatesSeriesDetails | null> {
    logInfo('[mangaupdates] Search started', {title});

    try {
        const searchResult = await mangaupdates.search(title);
        logInfo('[mangaupdates] Search completed', {results: searchResult.results.length});

        if (searchResult.results.length === 0) {
            logWarn('[mangaupdates] Discarded: empty search results');
            return null;
        }

        const selected = searchResult.results[0];
        logInfo('[mangaupdates] Selected top candidate', {title: selected.title, url: selected.url});
        const details = await mangaupdates.getSeries(selected.url);
        return details;
    } catch (e) {
        logError('[mangaupdates] Search failed', {error: (e as Error).message});
        return null;
    }
}

async function searchTebeosfera(
    title: string,
    author?: string
): Promise<tebeosfera.TebeosferaCollectionDetails | null> {
    logInfo('[tebeosfera] Search started', {title, author: author ?? null});

    try {
        const searchResult = author
            ? await tebeosfera.searchWithAuthor(title, {author})
            : await tebeosfera.search(title);
        logInfo('[tebeosfera] Search completed', {results: searchResult.results.length});

        if (searchResult.results.length === 0) {
            logWarn('[tebeosfera] Discarded: empty search results');
            return null;
        }

        const selected = searchResult.results[0];
        logInfo('[tebeosfera] Selected top candidate', {
            title: selected.title,
            url: selected.url,
            matchedAuthor: selected.matchedAuthor ?? null,
        });
        const details = await tebeosfera.getCollection(selected.url);
        return details;
    } catch (e) {
        logError('[tebeosfera] Search failed', {error: (e as Error).message});
        return null;
    }
}

function summarizeSourceData(sources: SourceData): string {
    const parts: string[] = [];

    if (sources.mangaupdates) {
        parts.push(
            `## MangaUpdates\n\`\`\`json\n${JSON.stringify(sanitizeForAggregation(sources.mangaupdates), null, 2)}\n\`\`\``
        );
    }

    if (sources.tebeosfera) {
        parts.push(
            `## Tebeosfera\n\`\`\`json\n${JSON.stringify(sanitizeForAggregation(sources.tebeosfera), null, 2)}\n\`\`\``
        );
    }

    return parts.join('\n\n');
}

type SourceReference = {
    title: string | null;
    authors: string[];
    publisher: string | null;
    work_type_estimate: string | null;
};

type SourceCandidate = {
    name: string;
    title: string | null;
    authors: string[];
    source_type_hint: string | null;
    data: unknown;
};

type ValidationDecision = {
    match: boolean;
    reason: string;
};

function uniqueStrings(values: string[]) {
    return [...new Set(values)];
}

function shouldOmitAggregationKey(key: string) {
    const normalized = key.toLowerCase();
    return normalized === 'isbn' || normalized.includes('language');
}

function sanitizeForAggregation(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForAggregation(item));
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !shouldOmitAggregationKey(key))
            .map(([key, child]) => [key, sanitizeForAggregation(child)] as const);
        return Object.fromEntries(entries);
    }

    return value;
}

function normalizeAuthorLabel(value: string) {
    return value.trim().replace(/\s+/g, ' ');
}

function buildMangaupdatesCandidateAuthors(series: mangaupdates.MangaUpdatesSeriesDetails) {
    const ignored = new Set(['add', 'unknown', 'n/a', 'na', 'various', 'anonymous', 'anon']);
    return uniqueStrings(
        [...series.authors.map((a) => a.label), ...series.artists.map((a) => a.label)]
            .map(normalizeAuthorLabel)
            .filter((name) => name.length > 1)
            .filter((name) => !ignored.has(name.toLowerCase()))
    );
}

async function validateSource(candidate: SourceCandidate, reference: SourceReference): Promise<ValidationDecision> {
    const prompt = [
        'You are a matching validator. Determine if two entries refer to the SAME comic/manga/graphic work.',
        'Consider title similarity, author overlap, and publisher. Minor spelling differences are acceptable.',
        'Different works by the same author are NOT a match. Different editions or translations of the same work ARE a match.',
        'Use OCR work_type_estimate as a strong prior. If it suggests non-manga, penalize MangaUpdates candidates heavily unless evidence is overwhelming.',
        'If reference includes known authors and candidate authors do not overlap, that is strong evidence of mismatch.',
        'Do not accept based only on a vaguely similar title when author/type evidence conflicts.',
        'Return ONLY a JSON object with two fields:',
        '- match: true or false',
        '- reason: brief explanation',
    ].join('\n');

    const userMessage = [
        'Reference (from filename + cover OCR):',
        JSON.stringify(reference, null, 2),
        '',
        `Candidate from ${candidate.name}:`,
        JSON.stringify(
            {
                title: candidate.title,
                authors: candidate.authors,
                source_type_hint: candidate.source_type_hint,
            },
            null,
            2
        ),
    ].join('\n');
    logInfo('[validate] Starting validation', {
        source: candidate.name,
        reference,
        candidate: {title: candidate.title, authors: candidate.authors, source_type_hint: candidate.source_type_hint},
    });

    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                model: IA_MODEL,
                stream: false,
                keep_alive: OLLAMA_KEEP_ALIVE,
                messages: [
                    {role: 'system', content: prompt},
                    {role: 'user', content: userMessage},
                ],
                format: 'json',
            }),
        });

        if (!response.ok) {
            const reason = `validator HTTP ${response.status}`;
            logWarn(`[validate] ${candidate.name} discarded: ${reason}`);
            return {match: false, reason};
        }

        const data = (await response.json()) as {message?: {content?: string}};
        const content = data.message?.content;
        if (!content) {
            const reason = 'validator returned empty content';
            logWarn(`[validate] ${candidate.name} discarded: ${reason}`);
            return {match: false, reason};
        }

        const parsed = JSON.parse(content) as {match: boolean; reason: string};
        if (!parsed.match) {
            logWarn(`[validate] ${candidate.name} discarded: ${parsed.reason}`);
            return {match: false, reason: parsed.reason};
        }

        logInfo(`[validate] ${candidate.name} accepted`, {reason: parsed.reason});
        return {match: true, reason: parsed.reason || 'match'};
    } catch (error) {
        const reason = `validator error: ${(error as Error).message}`;
        logError(`[validate] ${candidate.name} discarded`, {reason});
        return {match: false, reason};
    }
}

async function filterSources(sources: SourceData, reference: SourceReference): Promise<SourceData> {
    const candidates: {key: keyof SourceData; candidate: SourceCandidate}[] = [];

    if (sources.mangaupdates) {
        candidates.push({
            key: 'mangaupdates',
            candidate: {
                name: 'MangaUpdates',
                title: sources.mangaupdates.title,
                authors: buildMangaupdatesCandidateAuthors(sources.mangaupdates),
                source_type_hint: 'manga',
                data: sources.mangaupdates,
            },
        });
    }

    if (sources.tebeosfera) {
        candidates.push({
            key: 'tebeosfera',
            candidate: {
                name: 'Tebeosfera',
                title: sources.tebeosfera.title,
                authors: [],
                source_type_hint: 'comic',
                data: sources.tebeosfera,
            },
        });
    }

    logInfo('[validate] Built source candidates', {
        count: candidates.length,
        candidates: candidates.map((c) => c.candidate.name),
    });

    const validations = await Promise.all(candidates.map((c) => validateSource(c.candidate, reference)));

    const filtered: SourceData = {mangaupdates: null, tebeosfera: null};
    candidates.forEach((c, i) => {
        const decision = validations[i];
        if (decision.match) {
            (filtered as any)[c.key] = c.candidate.data;
        }
    });

    logInfo('[validate] Filtered source payload', filtered);
    return filtered;
}

const aggregationSystemPrompt = [
    'You are a comics, manga, and graphic literature metadata specialist.',
    'You will receive data gathered from multiple sources about a comic work:',
    '- Filename analysis with AI',
    '- OCR from the cover image',
    '- MangaUpdates database',
    '- Tebeosfera database (Spanish comics)',
    '',
    'Your task is to aggregate all this information and produce a single, authoritative JSON with the following fields:',
    '- type: The publishing tradition (manga, manhua, manhwa, franco-belgian, american, spanish, graphic-novel, etc.)',
    '- original_title: The original title of the work',
    '- alternative_titles: Array of {locale, title} objects with known translations',
    '- release_date: First publication date (ISO 8601: YYYY, YYYY-MM, or YYYY-MM-DD)',
    '- end_date: End date if the series is finished, null otherwise',
    '- authors: Array of {name, role} (writer, artist, author, etc.)',
    '- genres: Array of genre strings',
    '- tags: Array of descriptive tags',
    '- synopsis: Faithful synopsis that preserves all relevant details from the original source text without summarizing away content',
    '- demographic: Target demographic (shonen, seinen, adult, children, etc.) or null',
    '- publisher: Primary publisher name',
    '- volume_count: Total number of volumes if known, null otherwise',
    '- page_count: Number of pages when known (for one-shot works use the book page count), null otherwise',
    '- completed: Whether the series is finished overall (boolean)',
    '- additional_information: Notable context (awards, adaptations, magazine, etc.)',
    '',
    'All textual output must be in English, except personal names and original titles.',
    'Cross-reference all sources. Prefer verified facts over guesses.',
    'If sources conflict, prefer the most authoritative (databases over filename/OCR).',
    'Use OCR work_type_estimate as a prior: if OCR suggests non-manga, down-rank incompatible manga-only sources unless there is strong corroboration.',
    'For Tebeosfera, treat volumeCountEstimate/completedEstimate as strong hints for volume_count/completed.',
    'For Tebeosfera, treat pageCountEstimate as a strong hint for page_count.',
    'Tebeosfera synopsis can include physical-edition details and labels like "Información de la editorial:". Keep plot in synopsis and move non-plot context to additional_information.',
    'If issueSummary is "1 ordinario", infer a single-volume completed work unless stronger evidence contradicts it.',
    'Do not rewrite synopsis as a short summary. Preserve the original meaning and details as completely as possible.',
    'Personal names should remain in their standard original forms.',
    'Return ONLY valid JSON. No markdown, no explanations.',
].join('\n');

function toPageCount(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(1, Math.round(value));
    }

    if (typeof value === 'string') {
        const match = value.match(/\d+/);
        if (match) {
            return Number(match[0]);
        }
    }

    return null;
}

function ensureFinalPageCount(result: Record<string, unknown>, sources: SourceData) {
    const current = toPageCount(result.page_count);
    const fallback = sources.tebeosfera?.pageCountEstimate ?? null;
    return {
        ...result,
        page_count: current ?? fallback,
    };
}

function stripFinalFields(result: Record<string, unknown>) {
    const sanitized = {...result};
    delete sanitized.language;
    delete sanitized.isbn;
    return sanitized;
}

async function aggregateWithAI(
    filename: string,
    fileInfo: Record<string, unknown>,
    ocrResult: Record<string, unknown>,
    sourceSummary: string
): Promise<Record<string, unknown>> {
    const sanitizedFileInfo = sanitizeForAggregation(fileInfo);
    const sanitizedOcrResult = sanitizeForAggregation(ocrResult);

    const userMessage = [
        `Filename: ${filename}`,
        '',
        `Filename analysis:`,
        JSON.stringify(sanitizedFileInfo, null, 2),
        '',
        `Cover OCR:`,
        JSON.stringify(sanitizedOcrResult, null, 2),
        '',
        `External sources data:`,
        sourceSummary || '(no external source data available)',
    ].join('\n');

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: IA_MODEL,
            stream: false,
            keep_alive: OLLAMA_KEEP_ALIVE,
            messages: [
                {role: 'system', content: aggregationSystemPrompt},
                {role: 'user', content: userMessage},
            ],
            format: 'json',
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        logError('[aggregate] AI aggregation failed', {status: response.status, errorText});
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {message?: {content?: string}};
    const content = data.message?.content;

    if (!content) {
        logError('[aggregate] AI aggregation failed: empty content');
        throw new Error('Ollama returned no content');
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;
    logInfo('[aggregate] AI aggregation result', parsed);
    return parsed;
}

export async function getComicMetadata(archivePath: string): Promise<Record<string, unknown>> {
    initPipelineLog(archivePath);
    const filename = basename(archivePath);
    logInfo('[pipeline] Input archive', {archivePath, filename});
    let coverPath: string | null = null;

    try {
        // Step 1: Extract cover and OCR it
        logInfo('[1/4] Extracting cover');
        coverPath = await getCoverFile(archivePath);
        logInfo('[1/4] Cover extracted', {coverPath});

        logInfo('[2/4] Running OCR on cover');
        const ocrResult = await ocrComicCover(coverPath);
        logInfo('[2/4] OCR result', ocrResult);

        // Step 2: Analyze filename with OCR context
        logInfo('[2/4] Analyzing filename');
        const fileInfo = await getInfoFromFilename(filename, ocrResult);
        logInfo('[2/4] Filename AI analysis result', fileInfo);

        // Step 3: Search all sources in parallel using title/author from filename analysis
        logInfo('[pipeline] Searching external sources');
        const searchTitle = fileInfo.title || ocrResult.title || filename.replace(/\.[^.]+$/, '');
        const searchAuthor = fileInfo.authors?.[0] || ocrResult.authors?.[0] || undefined;
        logInfo('[pipeline] Search strategy', {searchTitle, searchAuthor: searchAuthor ?? null});

        const [mangaupdatesResult, tebeosferaResult] = await Promise.all([
            searchMangaupdates(searchTitle),
            searchTebeosfera(searchTitle, searchAuthor),
        ]);
        logInfo('[pipeline] Scraper availability', {
            mangaupdates: mangaupdatesResult !== null,
            tebeosfera: tebeosferaResult !== null,
        });

        // Step 3b: Validate source results against OCR + filename reference
        const reference: SourceReference = {
            title: fileInfo.title || ocrResult.title,
            authors: fileInfo.authors?.length ? fileInfo.authors : (ocrResult.authors ?? []),
            publisher: fileInfo.publisher || ocrResult.publisher,
            work_type_estimate: ocrResult.work_type_estimate ?? null,
        };
        logInfo('[pipeline] Validation reference', reference);

        logInfo('[3/4] Validating source results');
        const rawSources: SourceData = {
            mangaupdates: mangaupdatesResult,
            tebeosfera: tebeosferaResult,
        };
        const sources = await filterSources(rawSources, reference);
        logInfo('[pipeline] Sources after validation', {
            mangaupdates: sources.mangaupdates !== null,
            tebeosfera: sources.tebeosfera !== null,
        });

        const hasAcceptedSource = Object.values(sources).some((value) => value !== null);
        if (!hasAcceptedSource) {
            logWarn('[validate] No external sources matched');
        }

        // Step 4: Aggregate everything with AI
        logInfo('[4/4] Aggregating metadata with AI');
        const sourceSummary = summarizeSourceData(sources);
        logInfo('[pipeline] Source summary sent to aggregator (markdown)', sourceSummary);
        const aggregated = await aggregateWithAI(filename, fileInfo as any, ocrResult as any, sourceSummary);
        const result = stripFinalFields(ensureFinalPageCount(aggregated, sources));

        logInfo('[pipeline] Final metadata result', result);
        logInfo('Pipeline execution finished successfully');
        return result;
    } catch (error) {
        logError('Pipeline execution failed', {
            error: (error as Error).message,
            stack: (error as Error).stack ?? null,
        });
        throw error;
    } finally {
        if (coverPath) {
            try {
                const {unlinkSync} = await import('fs');
                unlinkSync(coverPath);
                logInfo('[pipeline] Temporary cover file removed', {coverPath});
            } catch (error) {
                logWarn('[pipeline] Failed to remove temporary cover file', {
                    coverPath,
                    error: (error as Error).message,
                });
            }
        }
    }
}

if (import.meta.main) {
    const archivePath = process.argv[2];
    if (!archivePath) {
        console.error('Usage: bun run pipeline.ts <archive-path>');
        process.exit(1);
    }
    try {
        const result = await getComicMetadata(archivePath);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        process.exit(1);
    }
}
