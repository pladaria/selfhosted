import * as cheerio from 'cheerio';
import {readFile} from 'node:fs/promises';
import {llmQuery} from '../ai/llm.ts';
import {debug} from '../utils/log.ts';

const BASE_URL = 'https://www.tebeosfera.com';
const SEARCH_ENDPOINT = `${BASE_URL}/neko/templates/ajax/buscador_txt_post.php`;
const REAL_USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export type TebeosferaOcrContext = {
    title?: string | null;
    subtitle?: string | null;
    volume?: string | null;
    issue_number?: string | null;
    authors?: string[];
    artists?: string[];
    publisher?: string | null;
    collection?: string | null;
    language?: string | null;
    work_type_estimate?: string | null;
    year?: string | null;
    other_text?: string[];
};

export type ScrapeComicMetaOptions = {
    searchTitle?: string;
};

export type ComicMeta = {
    title: string;
    alternateTitles?: Array<{
        locale: string;
        title: string;
    }>;
    volume?: number;
    volumeCount?: number;
    series?: string;
    summary?: string;
    notes?: string;
    releaseDate?: string;
    artists?: Array<{
        name: string;
        role: 'writer' | 'penciller' | 'inker' | 'colorist' | 'letterer' | 'coverArtist' | 'author';
    }>;
    editor?: string;
    publisher?: string;
    genre?: string[];
    tags?: string[];
    pageCount?: number;
    publishingTradition?: string;
    demography?:
        | 'shojo'
        | 'shoujo'
        | 'seinen'
        | 'shonen'
        | 'shounen'
        | 'kodomo'
        | 'josei'
        | 'children'
        | 'young-adult'
        | 'adult'
        | 'adult-erotic'
        | 'hentai';
};

type SearchCandidate = {
    url: string;
    title: string;
    collectionTitle: string;
    year: number | null;
    publisher: string | null;
    subtitle: string | null;
    releaseDateText: string | null;
    format: string | null;
    pageCount: number | null;
    color: string | null;
};

type RankedSelection = {
    selected_url: string | null;
    reason?: string | null;
};

type IssueCredit = {
    role: string;
    names: string[];
};

type ScrapedIssue = {
    title: string;
    subtitle: string | null;
    series: string | null;
    volume: number | null;
    volumeCount: number | null;
    releaseDate: string | null;
    publisher: string | null;
    alternateTitles: Array<{locale: string; title: string}>;
    summary: string | null;
    notes: string | null;
    artists: ComicMeta['artists'];
    genre: string[];
    tags: string[];
    pageCount: number | null;
    publishingTradition: string | null;
};

function normalizeWhitespace(value: string) {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toAbsoluteUrl(path: string) {
    return new URL(path, BASE_URL).toString();
}

function slugifyQuery(query: string) {
    return query
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function formatSearchCandidate(candidate: SearchCandidate) {
    const details = [
        candidate.year ? String(candidate.year) : null,
        candidate.publisher,
        candidate.releaseDateText,
        candidate.format,
    ].filter(Boolean);

    const subtitle = candidate.subtitle ? ` - ${candidate.subtitle}` : '';
    return details.length > 0
        ? `${candidate.title}${subtitle} (${details.join(', ')})`
        : `${candidate.title}${subtitle}`;
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

async function fetchText(url: string, init?: RequestInit) {
    const response = await fetch(url, {
        headers: {
            'user-agent': REAL_USER_AGENT,
        },
        ...init,
    });

    if (!response.ok) {
        throw new Error(`Tebeosfera request failed with ${response.status} ${response.statusText}`);
    }

    return response.text();
}

async function searchNumbers(query: string): Promise<SearchCandidate[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        throw new Error('search query cannot be empty');
    }

    const html = await fetchText(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
            referer: `${BASE_URL}/buscador/${slugifyQuery(trimmedQuery)}/Números/`,
        },
        body: new URLSearchParams({
            tabla: 'T3_numeros',
            busqueda: slugifyQuery(trimmedQuery),
        }).toString(),
    });

    const $ = cheerio.load(html);
    const results: SearchCandidate[] = [];

    $('.linea_resultados').each((_, element) => {
        const row = $(element);
        const link = row.find('a[href*="/numeros/"]').first();
        const href = link.attr('href')?.trim();
        const heading = normalizeWhitespace(link.clone().children('span').remove().end().text());
        const subtitle = normalizeWhitespace(link.find('span').first().text()).replace(/^:\s*/, '') || null;

        if (!href || !heading) {
            return;
        }

        const headingMatch = heading.match(/^(.*?)\s*\((\d{4}),\s*([^)]+)\)$/);
        const detailLines = row
            .find("div[style*='font-size: 14px']")
            .first()
            .text()
            .split(/\n+/)
            .map((part) => normalizeWhitespace(part))
            .filter(Boolean);

        const releaseDateText = detailLines.find((line) => /\d{1,2}-[IVXLCDM]+-\d{4}/i.test(line)) ?? null;
        const format = detailLines.find((line) => /RÚSTICA|GRAPA|CARTONÉ|LIBRO/i.test(line)) ?? null;
        const pageCountMatch = detailLines.join(' ').match(/(\d{1,5})\s*p[aá]gs?/i);
        const colorMatch = detailLines.join(' ').match(/\b(BICOLOR|COLOR|BLANCO Y NEGRO|BN)\b/i);

        results.push({
            url: href.startsWith('http') ? href : toAbsoluteUrl(href),
            title: subtitle || (headingMatch?.[1] ? normalizeWhitespace(headingMatch[1]) : heading),
            collectionTitle: headingMatch?.[1] ? normalizeWhitespace(headingMatch[1]) : heading,
            year: headingMatch?.[2] ? Number(headingMatch[2]) : null,
            publisher: headingMatch?.[3] ? normalizeWhitespace(headingMatch[3]) : null,
            subtitle,
            releaseDateText,
            format,
            pageCount: pageCountMatch ? Number(pageCountMatch[1]) : null,
            color: colorMatch ? colorMatch[1].toUpperCase() : null,
        });
    });

    return results;
}

async function chooseCandidateWithIa(context: TebeosferaOcrContext, candidates: SearchCandidate[]) {
    if (candidates.length === 0) {
        return null;
    }

    const response = await llmQuery<RankedSelection>({
        engine: 'ollama',
        schemaName: 'tebeosfera_selection',
        systemPrompt: [
            'You select the best Tebeosfera issue candidate for a comic cover OCR context.',
            "The candidates all come from Tebeosfera's Números search results.",
            'Prioritize exact work/title match first.',
            'Use author names, publisher, year, work_type_estimate, volume, issue_number, and collection as tie-breakers.',
            'Reject candidates that clearly refer to a different work, even if some words overlap.',
            'Prefer the visible cover title over collection titles when they differ.',
            'Return ONLY valid JSON like {"selected_url":"...","reason":"brief"} or {"selected_url":null,"reason":"brief"}.',
        ].join('\n'),
        prompt: [
            'OCR context:',
            JSON.stringify(context, null, 2),
            '',
            'Candidates:',
            JSON.stringify(
                candidates.map((candidate) => ({
                    url: candidate.url,
                    title: candidate.title,
                    collectionTitle: candidate.collectionTitle,
                    year: candidate.year,
                    publisher: candidate.publisher,
                    subtitle: candidate.subtitle,
                    releaseDateText: candidate.releaseDateText,
                    format: candidate.format,
                    pageCount: candidate.pageCount,
                    color: candidate.color,
                })),
                null,
                2
            ),
        ].join('\n'),
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['selected_url', 'reason'],
            properties: {
                selected_url: {type: ['string', 'null']},
                reason: {type: 'string'},
            },
        },
    });

    return response.data;
}

function extractFieldValue($: cheerio.CheerioAPI, label: string) {
    const row = $('#cuerpo2_ficha .row-fluid').filter((_, element) => {
        const current = normalizeWhitespace($(element).find('.etiqueta').first().text()).replace(/:$/, '');
        return current === label;
    });

    return normalizeWhitespace(row.find('.dato').first().text()) || null;
}

function parseSpanishExactDate(value: string | null) {
    if (!value) {
        return null;
    }

    const match = normalizeWhitespace(value).match(/\b(\d{1,2})-([IVXLCDM]+)-(\d{4})\b/i);
    if (!match) {
        return null;
    }

    const romanMonth = match[2].toUpperCase();
    const romanToMonth: Record<string, string> = {
        I: '01',
        II: '02',
        III: '03',
        IV: '04',
        V: '05',
        VI: '06',
        VII: '07',
        VIII: '08',
        IX: '09',
        X: '10',
        XI: '11',
        XII: '12',
    };

    const month = romanToMonth[romanMonth];
    if (!month) {
        return null;
    }

    return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
}

function parseHeadingPublisherAndYear(text: string) {
    const match = normalizeWhitespace(text).match(/^(.*?)\s*\((\d{4}),\s*([^)]+)\)$/);
    return {
        title: match?.[1] ? normalizeWhitespace(match[1]) : normalizeWhitespace(text),
        year: match?.[2] ? Number(match[2]) : null,
        publisher: match?.[3] ? normalizeWhitespace(match[3]) : null,
    };
}

function parseTopCollectionLine(text: string) {
    const normalized = normalizeWhitespace(text);
    const volumeMatch = normalized.match(/^(\d+)\s+de\b/i);
    const totalMatch = normalized.match(/\[de\s+(\d+)\]/i);

    return {
        volume: volumeMatch ? Number(volumeMatch[1]) : null,
        volumeCount: totalMatch ? Number(totalMatch[1]) : null,
    };
}

function parsePageCount(value: string | null) {
    if (!value) {
        return null;
    }

    const match = normalizeWhitespace(value).match(/\b(\d{1,5})\b/);
    return match ? Number(match[1]) : null;
}

function normalizeRole(role: string): ComicMeta['artists'][number]['role'] {
    const normalized = role.toLowerCase();

    if (normalized.includes('guion')) {
        return 'writer';
    }
    if (normalized.includes('dibuj') || normalized.includes('lapiz')) {
        return 'penciller';
    }
    if (normalized.includes('entint')) {
        return 'inker';
    }
    if (normalized.includes('color')) {
        return 'colorist';
    }
    if (normalized.includes('rotul') || normalized.includes('letr')) {
        return 'letterer';
    }
    if (normalized.includes('portad')) {
        return 'coverArtist';
    }

    return 'author';
}

function extractCredits($: cheerio.CheerioAPI): IssueCredit[] {
    const authorRow = $('#cuerpo2_ficha .row-fluid')
        .filter((_, element) => {
            return normalizeWhitespace($(element).find('.etiqueta').first().text()).startsWith('Autores');
        })
        .first();

    if (!authorRow.length) {
        return [];
    }

    return authorRow
        .find('.dato .tab_datos')
        .map((_, element) => {
            const roleNode = $(element).find('.tab_subtitulo').first().clone();
            roleNode.find('*').remove();
            const role = normalizeWhitespace(roleNode.text()) || 'Autoría';
            const names = $(element)
                .find('a[href*="/autores/"]')
                .map((__, link) => normalizeWhitespace($(link).attr('title') || $(link).text()))
                .get()
                .filter(Boolean);

            if (names.length === 0) {
                return null;
            }

            return {
                role,
                names: uniqueStrings(names),
            };
        })
        .get()
        .filter((item): item is IssueCredit => Boolean(item));
}

function extractTitleAndSubtitle($: cheerio.CheerioAPI) {
    const titleNode = $('#titulo_ficha .titulo').first();
    const title = normalizeWhitespace(titleNode.clone().children().remove().end().text());
    const nestedSubtitle = normalizeWhitespace(titleNode.find('div, strong').first().text());
    const subtitle =
        nestedSubtitle || normalizeWhitespace($('#titulo_ficha .subtitulo').first().text()) || null;

    return {title, subtitle};
}

function extractGenres($: cheerio.CheerioAPI) {
    return uniqueStrings(
        $('#tab1 a[href]')
            .map((_, link) => normalizeWhitespace($(link).text()))
            .get()
            .filter(Boolean)
    );
}

function cleanPromotionalText(value: string | null) {
    if (!value) {
        return null;
    }

    const normalized = normalizeWhitespace(value)
        .replace(/^Descripci[oó]n editorial\s*:\s*/i, '')
        .replace(/^Sinopsis\s*:\s*/i, '')
        .replace(/^«|»$/g, '')
        .trim();

    return normalized || null;
}

function cleanOriginTitle(value: string | null) {
    if (!value) {
        return null;
    }

    return (
        normalizeWhitespace(value)
            .replace(/\s*\(\d{4}\)\s*$/, '')
            .trim() || null
    );
}

function inferAlternateTitleLocale(languageField: string | null) {
    const normalized = (languageField || '').toLowerCase();
    if (normalized.includes('ingl')) {
        return 'en';
    }
    if (normalized.includes('franc')) {
        return 'fr';
    }
    if (normalized.includes('ital')) {
        return 'it';
    }
    if (normalized.includes('alem')) {
        return 'de';
    }
    if (normalized.includes('portu')) {
        return 'pt';
    }
    if (normalized.includes('japon')) {
        return 'ja';
    }

    return 'und';
}

function normalizeWorkType(value: string | null) {
    if (!value) {
        return null;
    }

    const normalized = value.toLowerCase();
    if (normalized === 'american-comic') {
        return 'american';
    }
    if (normalized === 'spanish-comic') {
        return 'spanish';
    }
    return normalized;
}

function inferType(context: TebeosferaOcrContext, languageField: string | null, originField: string | null) {
    const fromContext = normalizeWorkType(context.work_type_estimate ?? null);
    if (fromContext) {
        return fromContext;
    }

    const combined = `${languageField || ''} ${originField || ''}`.toLowerCase();

    if (combined.includes('jap')) {
        return 'manga';
    }
    if (combined.includes('core')) {
        return 'manhwa';
    }
    if (combined.includes('china')) {
        return 'manhua';
    }
    if (combined.includes('estados unidos')) {
        return 'american';
    }
    if (combined.includes('espa')) {
        return 'spanish';
    }
    if (combined.includes('francia') || combined.includes('bélgica') || combined.includes('belgica')) {
        return 'franco-belgian';
    }

    return null;
}

async function scrapeIssue(url: string, context: TebeosferaOcrContext): Promise<ScrapedIssue> {
    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const {title, subtitle} = extractTitleAndSubtitle($);
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
    const headingMeta = parseHeadingPublisherAndYear(ogTitle);
    const collectionLine = normalizeWhitespace($('#cuerpo2_ficha > .row-fluid.dato').first().text());
    const collectionLink = $('#cuerpo2_ficha > .row-fluid.dato')
        .first()
        .find('a[href*="/colecciones/"]')
        .first();
    const distribution = extractFieldValue($, 'Distribución');
    const languageField = extractFieldValue($, 'Lengua');
    const originField = extractFieldValue($, 'Origen');
    const pagination = extractFieldValue($, 'Paginación');
    const color = extractFieldValue($, 'Color');
    const format = extractFieldValue($, 'Formato');
    const edition = extractFieldValue($, 'Edición');
    const synopsis = normalizeWhitespace($('.row-fluid.T3WISIWISI').first().text()) || null;
    const promotionalText = cleanPromotionalText(
        normalizeWhitespace($('.div_recension').first().text()) || null
    );
    const extraNotes = normalizeWhitespace($('.div_notas_numeros').first().text()) || null;
    const originTitle =
        cleanOriginTitle(
            normalizeWhitespace(
                $('#cuerpo2_ficha .row-fluid')
                    .filter((_, element) =>
                        normalizeWhitespace($(element).find('.etiqueta').first().text()).startsWith('Origen')
                    )
                    .first()
                    .find('em')
                    .first()
                    .text()
            )
        ) || null;
    const credits = extractCredits($);
    const artists = uniqueStrings(
        credits.flatMap((credit) => credit.names.map((name) => `${name}|||${normalizeRole(credit.role)}`))
    ).map((entry) => {
        const [name, role] = entry.split('|||');
        return {
            name,
            role: role as ComicMeta['artists'][number]['role'],
        };
    });

    const alternates = [];
    if (originTitle && originTitle.toLowerCase() !== title.toLowerCase()) {
        alternates.push({
            locale: inferAlternateTitleLocale(languageField),
            title: originTitle,
        });
    }

    const tagPool = [
        ...(edition ? edition.split('·') : []),
        ...(format ? format.split('·') : []),
        ...(color ? [color] : []),
    ]
        .map((part) => normalizeWhitespace(part).toLowerCase())
        .filter(Boolean);

    const notesParts = [];
    if (synopsis && promotionalText && synopsis !== promotionalText) {
        notesParts.push(synopsis);
    } else if (!promotionalText && synopsis) {
        notesParts.push(synopsis);
    }
    if (extraNotes) {
        notesParts.push(extraNotes);
    }

    const {volume, volumeCount} = parseTopCollectionLine(collectionLine);

    return {
        title,
        subtitle,
        series: normalizeWhitespace(collectionLink.text()) || null,
        volume,
        volumeCount,
        releaseDate: parseSpanishExactDate(distribution),
        publisher: headingMeta.publisher,
        alternateTitles: alternates,
        summary: promotionalText || synopsis,
        notes: notesParts.join('\n\n') || null,
        artists,
        genre: extractGenres($),
        tags: uniqueStrings(tagPool),
        pageCount: parsePageCount(pagination),
        publishingTradition: inferType(context, languageField, originField),
    };
}

export async function scrapeComicMetaFromOcrContext(
    context: TebeosferaOcrContext,
    options: ScrapeComicMetaOptions = {}
): Promise<ComicMeta> {
    const searchTitle =
        options.searchTitle?.trim() || context.title?.trim() || context.collection?.trim() || '';
    if (!searchTitle) {
        throw new Error(
            'OCR context must include at least a title or collection, or you must pass a manual search title'
        );
    }

    debug('buscando titulo', `${searchTitle}, ${JSON.stringify(context)}`);

    const candidates = (await searchNumbers(searchTitle)).slice(0, 5);
    debug(
        'candidatos',
        candidates.map((candidate) => formatSearchCandidate(candidate))
    );

    if (candidates.length === 0) {
        throw new Error(`No Tebeosfera candidates found for "${searchTitle}"`);
    }

    const selection = await chooseCandidateWithIa(context, candidates);
    const selected = candidates.find((candidate) => candidate.url === selection?.selected_url) ?? null;

    if (!selected) {
        throw new Error(`LLM did not select a valid Tebeosfera candidate for "${searchTitle}"`);
    }

    debug('candidato elegido', formatSearchCandidate(selected));

    const issue = await scrapeIssue(selected.url, context);
    const title = issue.title || selected.title || selected.collectionTitle;

    return cleanObject({
        title,
        alternateTitles: issue.alternateTitles,
        volume: issue.volume ?? undefined,
        volumeCount: issue.volumeCount ?? undefined,
        series: issue.series ?? undefined,
        summary: issue.summary ?? undefined,
        notes: issue.notes ?? undefined,
        releaseDate: issue.releaseDate ?? undefined,
        artists: issue.artists,
        publisher: issue.publisher ?? undefined,
        genre: issue.genre,
        tags: issue.tags,
        pageCount: issue.pageCount ?? undefined,
        publishingTradition: issue.publishingTradition ?? undefined,
    });
}

async function readJsonInput(pathOrDash: string) {
    if (pathOrDash === '-') {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as TebeosferaOcrContext;
    }

    const content = await readFile(pathOrDash, 'utf8');
    return JSON.parse(content) as TebeosferaOcrContext;
}

async function main() {
    const [input, ...rest] = process.argv.slice(2);
    if (!input) {
        console.error('Usage: bun run sources/tebeosfera.ts <ocr-context.json|-> [manual-search-title]');
        process.exit(1);
    }

    const manualSearchTitle = rest.join(' ').trim() || undefined;
    const context = await readJsonInput(input);
    const result = await scrapeComicMetaFromOcrContext(context, {
        searchTitle: manualSearchTitle,
    });
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
