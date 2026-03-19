import {readFileSync} from 'fs';
import {debug} from '../utils/log.ts';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_OCR_MODEL = process.env.OLLAMA_OCR_MODEL || 'gemma3:27b';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';

export type ComicCoverOcrResult = Partial<{
    title: string;
    subtitle: string;
    volume: string;
    issue_number: string;
    authors: string[];
    artists: string[];
    publisher: string;
    collection: string;
    language: string;
    work_type_estimate: string;
    year: string;
    other_text: string[];
}>;

function imageToBase64(imagePath: string): string {
    const buffer = readFileSync(imagePath);
    return buffer.toString('base64');
}

function normalizeString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) {
        return undefined;
    }

    const lowered = normalized.toLowerCase();
    if (lowered === 'unknown' || lowered === 'null' || lowered === 'undefined' || lowered === 'n/a') {
        return undefined;
    }

    return normalized;
}

function normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const normalized = [...new Set(value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item)))];
    return normalized.length > 0 ? normalized : undefined;
}

function cleanObject<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => cleanObject(item)).filter((item) => {
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

const systemPrompt = [
    'You are a comic book cover OCR and metadata extraction specialist.',
    'You will receive an image of a comic book cover.',
    'Your task is to extract ALL visible text from the cover and identify the following metadata fields:',
    '- title: The main title of the comic',
    '- subtitle: Any subtitle or tagline',
    "- volume: Volume number or label (e.g. 'Vol. 3', 'Tomo 2')",
    '- issue_number: Issue or chapter number',
    '- authors: List of writer/author names visible on the cover',
    '- artists: List of artist/illustrator names visible on the cover',
    "- publisher: Publisher name (e.g. 'Marvel', 'DC', 'Norma Editorial')",
    '- collection: Collection or imprint name if visible',
    '- language: Detected language of the text on the cover',
    "- work_type_estimate: Estimated work tradition/type based on visual/textual cues (e.g. 'manga', 'manhwa', 'manhua', 'franco-belgian', 'american-comic', 'spanish-comic', 'graphic-novel'). Use null if uncertain",
    '- year: Publication year if visible',
    "- other_text: Any other text visible on the cover that doesn't fit the above fields",
    '',
    'Return ONLY valid JSON matching the schema above. No markdown, no explanations.',
    'If a field is not visible or cannot be determined, use null for strings, empty array for arrays.',
].join('\n');

export async function ocrComicCover(imagePath: string): Promise<ComicCoverOcrResult> {
    debug('leyendo imagen', imagePath);
    const base64Image = imageToBase64(imagePath);
    debug('ejecutando ollama', {
        url: `${OLLAMA_BASE_URL}/api/chat`,
        model: OLLAMA_OCR_MODEL,
        keep_alive: OLLAMA_KEEP_ALIVE,
        imagePath,
    });

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: OLLAMA_OCR_MODEL,
            stream: false,
            keep_alive: OLLAMA_KEEP_ALIVE,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content:
                        'Extract all text and metadata from this comic book cover image. Return only JSON.',
                    images: [base64Image],
                },
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

    const parsed = JSON.parse(content) as Record<string, unknown>;

    const result = cleanObject({
        title: normalizeString(parsed.title),
        subtitle: normalizeString(parsed.subtitle),
        volume: normalizeString(parsed.volume),
        issue_number: normalizeString(parsed.issue_number),
        authors: normalizeStringArray(parsed.authors),
        artists: normalizeStringArray(parsed.artists),
        publisher: normalizeString(parsed.publisher),
        collection: normalizeString(parsed.collection),
        language: normalizeString(parsed.language),
        work_type_estimate: normalizeString(parsed.work_type_estimate),
        year: normalizeString(parsed.year),
        other_text: normalizeStringArray(parsed.other_text),
    });

    return result;
}

if (import.meta.main) {
    const imagePath = process.argv[2];
    if (!imagePath) {
        console.error('Usage: bun run ocr/index.ts <image-path>');
        process.exit(1);
    }
    const result = await ocrComicCover(imagePath);
    console.log(JSON.stringify(result, null, 2));
}
