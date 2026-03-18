import type {ComicCoverOcrResult} from '../ocr/index.ts';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const IA_MODEL = process.env.IA_MODEL || 'gemma3:27b';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';

export type ComicFileInfo = {
    title: string | null;
    subtitle: string | null;
    volume: string | null;
    issue_number: string | null;
    year: string | null;
    authors: string[];
    artists: string[];
    publisher: string | null;
    collection: string | null;
    language: string | null;
    scan_group: string | null;
    translation_group: string | null;
    source_url: string | null;
    format: string | null;
    resolution: string | null;
    other: string[];
};

type Context = Partial<ComicCoverOcrResult> | Record<string, unknown>;

const systemPrompt = [
    'You are a comic book, manga, and graphic literature filename analysis specialist.',
    'Your task is to parse a comic archive filename and extract structured metadata from it.',
    '',
    'Filenames typically contain some combination of:',
    '- Title of the work',
    '- Subtitle or arc name',
    '- Volume or tome number (e.g. "Vol. 3", "Tomo 02", "v05")',
    '- Issue or chapter number (e.g. "#12", "Ch.05")',
    '- Year of publication',
    '- Author and artist names',
    '- Publisher name',
    '- Collection or imprint',
    '- Language (e.g. "Spanish", "ESP", "ENG")',
    '- Scan group (e.g. "[ScanGroup]", "(GroupName)")',
    '- Translation group',
    '- Source URL or website',
    '- Format or quality markers (e.g. "Digital", "HQ", "WebRip")',
    '- Resolution (e.g. "1920px", "HD")',
    '',
    'You may also receive additional context from OCR analysis of the cover image.',
    'Use that context to improve accuracy, especially for title, authors, and publisher.',
    'Trust the OCR context for names and text that are hard to infer from the filename alone.',
    '',
    'Return ONLY valid JSON with these fields:',
    '- title: Main title of the work',
    '- subtitle: Subtitle or arc name',
    '- volume: Volume/tome number or label',
    '- issue_number: Issue or chapter number',
    '- year: Publication year',
    '- authors: List of writer names',
    '- artists: List of artist/illustrator names',
    '- publisher: Publisher name',
    '- collection: Collection or imprint',
    '- language: Language of the release',
    '- scan_group: Scanning group name',
    '- translation_group: Translation group name',
    '- source_url: Source website if present in filename',
    '- format: Format or quality marker',
    '- resolution: Resolution if mentioned',
    '- other: Any other relevant info that does not fit above',
    '',
    'If a field cannot be determined, use null for strings, empty array for arrays.',
    'No markdown, no explanations. Return only the JSON object.',
].join('\n');

export async function getInfoFromFilename(filename: string, context?: Context): Promise<ComicFileInfo> {
    let userMessage = `Analyze this comic archive filename and extract metadata:\n\n${filename}`;

    if (context && Object.keys(context).length > 0) {
        userMessage += `\n\nAdditional context from cover OCR analysis:\n${JSON.stringify(context, null, 2)}`;
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: IA_MODEL,
            stream: false,
            keep_alive: OLLAMA_KEEP_ALIVE,
            messages: [
                {role: 'system', content: systemPrompt},
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

    const parsed = JSON.parse(content) as ComicFileInfo;

    return {
        title: parsed.title ?? null,
        subtitle: parsed.subtitle ?? null,
        volume: parsed.volume ?? null,
        issue_number: parsed.issue_number ?? null,
        year: parsed.year ?? null,
        authors: Array.isArray(parsed.authors) ? parsed.authors : [],
        artists: Array.isArray(parsed.artists) ? parsed.artists : [],
        publisher: parsed.publisher ?? null,
        collection: parsed.collection ?? null,
        language: parsed.language ?? null,
        scan_group: parsed.scan_group ?? null,
        translation_group: parsed.translation_group ?? null,
        source_url: parsed.source_url ?? null,
        format: parsed.format ?? null,
        resolution: parsed.resolution ?? null,
        other: Array.isArray(parsed.other) ? parsed.other : [],
    };
}

if (import.meta.main) {
    const filename = process.argv[2];
    if (!filename) {
        console.error('Usage: bun run ia/index.ts <filename> [ocr-json-path]');
        process.exit(1);
    }

    let context: Context | undefined;
    const contextPath = process.argv[3];
    if (contextPath) {
        const file = Bun.file(contextPath);
        context = (await file.json()) as Context;
    }

    const result = await getInfoFromFilename(filename, context);
    console.log(JSON.stringify(result, null, 2));
}
