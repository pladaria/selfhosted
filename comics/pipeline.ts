import {getCoverFile} from './archive/index.ts';
import {ocrComicCover} from './ocr/index.ts';
import {getInfoFromFilename} from './ia/index.ts';
import * as manganime from './sources/manganime.ts';
import * as openlibrary from './sources/openlibrary.ts';
import * as tebeosfera from './sources/tebeosfera.ts';
import {basename} from 'path';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const IA_MODEL = process.env.IA_MODEL || 'gemma3:27b';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';

type SourceData = {
    manganime: manganime.MangaUpdatesSeriesDetails | null;
    openlibrary: openlibrary.OpenLibraryWork | null;
    tebeosfera: tebeosfera.TebeosferaCollectionDetails | null;
};

async function searchManganime(
    title: string,
    author?: string
): Promise<manganime.MangaUpdatesSeriesDetails | null> {
    try {
        const searchResult = await manganime.search(title);
        if (searchResult.results.length === 0) return null;
        return await manganime.getSeries(searchResult.results[0].url);
    } catch (e) {
        console.error(`[manganime] search failed:`, (e as Error).message);
        return null;
    }
}

async function searchOpenlibrary(
    title: string,
    author?: string
): Promise<openlibrary.OpenLibraryWork | null> {
    try {
        const query = author ? `${title} ${author}` : title;
        const searchResult = await openlibrary.search(query, 3);
        if (searchResult.results.length === 0) return null;
        return await openlibrary.getWork(searchResult.results[0].key);
    } catch (e) {
        console.error(`[openlibrary] search failed:`, (e as Error).message);
        return null;
    }
}

async function searchTebeosfera(
    title: string,
    author?: string
): Promise<tebeosfera.TebeosferaCollectionDetails | null> {
    try {
        const searchResult = author
            ? await tebeosfera.searchWithAuthor(title, {author})
            : await tebeosfera.search(title);
        if (searchResult.results.length === 0) return null;
        return await tebeosfera.getCollection(searchResult.results[0].url);
    } catch (e) {
        console.error(`[tebeosfera] search failed:`, (e as Error).message);
        return null;
    }
}

function summarizeSourceData(sources: SourceData): string {
    const parts: string[] = [];

    if (sources.manganime) {
        const s = sources.manganime;
        parts.push(
            JSON.stringify({
                source: 'MangaUpdates',
                title: s.title,
                type: s.type,
                description: s.description,
                authors: s.authors.map((a) => a.label),
                artists: s.artists.map((a) => a.label),
                genres: s.genres,
                categories: s.categories,
                year: s.year,
                publishers: s.originalPublishers.map((p) => p.label),
                rating: s.rating,
                associatedNames: s.associatedNames,
                statusInCountryOfOrigin: s.statusInCountryOfOrigin,
            })
        );
    }

    if (sources.openlibrary) {
        const s = sources.openlibrary;
        parts.push(
            JSON.stringify({
                source: 'OpenLibrary',
                title: s.title,
                subtitle: s.subtitle,
                description: s.description,
                authors: s.authors?.map((a: any) => a.name),
                subjects: s.subjects,
                publishers: s.publishers,
                firstPublishDate: s.firstPublishDate,
                languages: s.languages,
                isbn10: s.isbn10,
                isbn13: s.isbn13,
            })
        );
    }

    if (sources.tebeosfera) {
        const s = sources.tebeosfera;
        parts.push(
            JSON.stringify({
                source: 'Tebeosfera',
                title: s.title,
                subtitle: s.subtitle,
                publishers: s.publishers.map((p) => p.label),
                genres: s.genres,
                dates: s.dates,
                format: s.format,
                pagination: s.pagination,
                issueCount: s.issues?.length ?? null,
            })
        );
    }

    return parts.join('\n\n');
}

type SourceReference = {
    title: string | null;
    authors: string[];
    publisher: string | null;
};

type SourceCandidate = {
    name: string;
    title: string | null;
    authors: string[];
    data: unknown;
};

async function validateSource(candidate: SourceCandidate, reference: SourceReference): Promise<boolean> {
    const prompt = [
        'You are a strict matching validator. Determine if two entries refer to the SAME comic/manga/graphic work.',
        'Consider title similarity, author overlap, and publisher. Minor spelling differences are acceptable.',
        'Different works by the same author are NOT a match. Different editions or translations of the same work ARE a match.',
        'Return ONLY a JSON object with two fields:',
        '- match: true or false',
        '- reason: brief explanation',
    ].join('\n');

    const userMessage = [
        'Reference (from filename + cover OCR):',
        JSON.stringify(reference, null, 2),
        '',
        `Candidate from ${candidate.name}:`,
        JSON.stringify({title: candidate.title, authors: candidate.authors}, null, 2),
    ].join('\n');

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

        if (!response.ok) return false;

        const data = (await response.json()) as {message?: {content?: string}};
        const content = data.message?.content;
        if (!content) return false;

        const parsed = JSON.parse(content) as {match: boolean; reason: string};
        if (!parsed.match) {
            console.error(`[validate] ${candidate.name} rejected: ${parsed.reason}`);
        }
        return !!parsed.match;
    } catch {
        return false;
    }
}

async function filterSources(sources: SourceData, reference: SourceReference): Promise<SourceData> {
    const candidates: {key: keyof SourceData; candidate: SourceCandidate}[] = [];

    if (sources.manganime) {
        candidates.push({
            key: 'manganime',
            candidate: {
                name: 'MangaUpdates',
                title: sources.manganime.title,
                authors: sources.manganime.authors.map((a) => a.label),
                data: sources.manganime,
            },
        });
    }

    if (sources.openlibrary) {
        candidates.push({
            key: 'openlibrary',
            candidate: {
                name: 'OpenLibrary',
                title: sources.openlibrary.title ?? null,
                authors: sources.openlibrary.authors?.map((a: any) => a.name) ?? [],
                data: sources.openlibrary,
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
                data: sources.tebeosfera,
            },
        });
    }

    const validations = await Promise.all(candidates.map((c) => validateSource(c.candidate, reference)));

    const filtered: SourceData = {manganime: null, openlibrary: null, tebeosfera: null};
    candidates.forEach((c, i) => {
        if (validations[i]) {
            (filtered as any)[c.key] = c.data;
        }
    });

    return filtered;
}

const aggregationSystemPrompt = [
    'You are a comics, manga, and graphic literature metadata specialist.',
    'You will receive data gathered from multiple sources about a comic work:',
    '- Filename analysis with AI',
    '- OCR from the cover image',
    '- MangaUpdates database',
    '- OpenLibrary database',
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
    '- synopsis: Concise but informative synopsis',
    '- demographic: Target demographic (shonen, seinen, adult, children, etc.) or null',
    '- publisher: Primary publisher name',
    '- volume_count: Total number of volumes if known, null otherwise',
    '- completed: Whether the series is finished overall (boolean)',
    '- language: Original language of the work',
    '- isbn: ISBN if available, null otherwise',
    '- additional_information: Notable context (awards, adaptations, magazine, etc.)',
    '',
    'Cross-reference all sources. Prefer verified facts over guesses.',
    'If sources conflict, prefer the most authoritative (databases over filename/OCR).',
    'Personal names should remain in their standard original forms.',
    'Return ONLY valid JSON. No markdown, no explanations.',
].join('\n');

async function aggregateWithAI(
    filename: string,
    fileInfo: Record<string, unknown>,
    ocrResult: Record<string, unknown>,
    sourceSummary: string
): Promise<Record<string, unknown>> {
    const userMessage = [
        `Filename: ${filename}`,
        '',
        `Filename analysis:`,
        JSON.stringify(fileInfo, null, 2),
        '',
        `Cover OCR:`,
        JSON.stringify(ocrResult, null, 2),
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
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {message?: {content?: string}};
    const content = data.message?.content;

    if (!content) {
        throw new Error('Ollama returned no content');
    }

    return JSON.parse(content) as Record<string, unknown>;
}

export async function getComicMetadata(archivePath: string): Promise<Record<string, unknown>> {
    const filename = basename(archivePath);

    // Step 1: Extract cover and OCR it
    console.error('[1/4] Extracting cover...');
    const coverPath = await getCoverFile(archivePath);

    console.error('[2/4] Running OCR on cover...');
    const ocrResult = await ocrComicCover(coverPath);

    // Step 2: Analyze filename with OCR context
    console.error('[2/4] Analyzing filename + searching sources...');
    const fileInfoPromise = getInfoFromFilename(filename, ocrResult);

    // Step 3: Search all sources in parallel using title/author from OCR
    const searchTitle = ocrResult.title || filename.replace(/\.[^.]+$/, '');
    const searchAuthor = ocrResult.authors?.[0] ?? undefined;

    const [fileInfo, mangaResult, openlibraryResult, tebeosferaResult] = await Promise.all([
        fileInfoPromise,
        searchManganime(searchTitle, searchAuthor),
        searchOpenlibrary(searchTitle, searchAuthor),
        searchTebeosfera(searchTitle, searchAuthor),
    ]);

    // Step 3b: Validate source results against OCR + filename reference
    const reference: SourceReference = {
        title: fileInfo.title || ocrResult.title,
        authors: fileInfo.authors?.length ? fileInfo.authors : (ocrResult.authors ?? []),
        publisher: fileInfo.publisher || ocrResult.publisher,
    };

    console.error('[3/4] Validating source results...');
    const rawSources: SourceData = {
        manganime: mangaResult,
        openlibrary: openlibraryResult,
        tebeosfera: tebeosferaResult,
    };
    const sources = await filterSources(rawSources, reference);

    // Step 4: Aggregate everything with AI
    console.error('[4/4] Aggregating metadata with AI...');
    const sourceSummary = summarizeSourceData(sources);
    const result = await aggregateWithAI(filename, fileInfo as any, ocrResult as any, sourceSummary);

    // Cleanup temp cover file
    try {
        const {unlinkSync} = await import('fs');
        unlinkSync(coverPath);
    } catch {}

    return result;
}

if (import.meta.main) {
    const archivePath = process.argv[2];
    if (!archivePath) {
        console.error('Usage: bun run pipeline.ts <archive-path>');
        process.exit(1);
    }
    const result = await getComicMetadata(archivePath);
    console.log(JSON.stringify(result, null, 2));
}
