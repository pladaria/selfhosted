import {readFileSync} from 'fs';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const OCR_MODEL = process.env.OCR_MODEL || 'gemma3:27b';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '1h';

export type ComicCoverOcrResult = {
    title: string | null;
    subtitle: string | null;
    volume: string | null;
    issue_number: string | null;
    authors: string[];
    artists: string[];
    publisher: string | null;
    collection: string | null;
    language: string | null;
    year: string | null;
    other_text: string[];
    raw_text: string;
};

function imageToBase64(imagePath: string): string {
    const buffer = readFileSync(imagePath);
    return buffer.toString('base64');
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
    '- year: Publication year if visible',
    "- other_text: Any other text visible on the cover that doesn't fit the above fields",
    '- raw_text: All text visible on the cover, concatenated',
    '',
    'Return ONLY valid JSON matching the schema above. No markdown, no explanations.',
    'If a field is not visible or cannot be determined, use null for strings, empty array for arrays.',
].join('\n');

export async function ocrComicCover(imagePath: string): Promise<ComicCoverOcrResult> {
    const base64Image = imageToBase64(imagePath);

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            model: OCR_MODEL,
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

    const parsed = JSON.parse(content) as ComicCoverOcrResult;

    return {
        title: parsed.title ?? null,
        subtitle: parsed.subtitle ?? null,
        volume: parsed.volume ?? null,
        issue_number: parsed.issue_number ?? null,
        authors: Array.isArray(parsed.authors) ? parsed.authors : [],
        artists: Array.isArray(parsed.artists) ? parsed.artists : [],
        publisher: parsed.publisher ?? null,
        collection: parsed.collection ?? null,
        language: parsed.language ?? null,
        year: parsed.year ?? null,
        other_text: Array.isArray(parsed.other_text) ? parsed.other_text : [],
        raw_text: parsed.raw_text ?? '',
    };
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
