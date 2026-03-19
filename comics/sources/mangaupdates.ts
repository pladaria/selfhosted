import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.mangaupdates.com';
const SEARCH_URL = `${BASE_URL}/site/search/result`;
const REAL_USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const RETRY_TIMEOUT_MS = 500;

export type MangaUpdatesSeriesResult = {
    title: string;
    url: string;
    genres: string[];
    year: number | null;
    rating: number | null;
};

export type MangaUpdatesSearchResponse = {
    query: string;
    url: string;
    results: MangaUpdatesSeriesResult[];
};

export type MangaUpdatesLinkedItem = {
    label: string;
    url: string;
};

export type MangaUpdatesRatingSummary = {
    average: number | null;
    bayesianAverage: number | null;
    votes: number | null;
};

export type MangaUpdatesSeriesDetails = {
    id: string | null;
    url: string;
    title: string;
    image: string | null;
    type: string | null;
    description: string | null;
    associatedNames: string[];
    genres: string[];
    tags: string[];
    authors: MangaUpdatesLinkedItem[];
    artists: MangaUpdatesLinkedItem[];
    year: number | null;
    originalPublishers: MangaUpdatesLinkedItem[];
    relatedSeries: MangaUpdatesLinkedItem[];
    rating: MangaUpdatesRatingSummary;
};

function parseNumber(value: string) {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function splitGenres(value: string) {
    return value
        .split(',')
        .map((genre) => genre.trim())
        .filter(Boolean);
}

function normalizeWhitespace(value: string) {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function unique<T>(values: T[]) {
    return [...new Set(values)];
}

function textListFromNode($root: cheerio.CheerioAPI, element: cheerio.Element) {
    const values = $root(element)
        .find('div, p, li, span, a, time')
        .map((_, node) => normalizeWhitespace($root(node).text()))
        .get()
        .filter(Boolean);

    if (values.length > 0) {
        return unique(values);
    }

    const text = normalizeWhitespace($root(element).text());
    return text ? [text] : [];
}

function cleanList(values: string[], patterns: RegExp[] = []) {
    return unique(
        values
            .map((value) => normalizeWhitespace(value))
            .filter(Boolean)
            .filter((value) => !patterns.some((pattern) => pattern.test(value)))
    );
}

function getLinkedLabels($: cheerio.CheerioAPI, node: cheerio.Element | undefined, patterns: RegExp[] = []) {
    if (!node) {
        return [];
    }

    return cleanList(
        extractLinks($, node).map((item) => item.label),
        patterns
    );
}

function cleanDescription(rawSections: Record<string, string[]>, schemaOrg: Record<string, unknown> | null) {
    const raw = rawSections['Description'] ?? [];
    const primary = cleanList(raw);

    if (primary.length > 0) {
        return primary.join('\n\n');
    }

    return typeof schemaOrg?.description === 'string' ? normalizeWhitespace(schemaOrg.description) : null;
}

function extractLinks($root: cheerio.CheerioAPI, element: cheerio.Element) {
    return $root(element)
        .find('a[href]')
        .map((_, anchor) => {
            const label = normalizeWhitespace($root(anchor).text());
            const href = $root(anchor).attr('href')?.trim();
            if (!label || !href) {
                return null;
            }

            return {
                label,
                url: href.startsWith('http') ? href : new URL(href, BASE_URL).toString(),
            };
        })
        .get()
        .filter((item): item is MangaUpdatesLinkedItem => Boolean(item));
}

function parseBoolean(value: string | null) {
    if (!value) {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'yes') {
        return true;
    }

    if (normalized === 'no') {
        return false;
    }

    return null;
}

function parseVotes(value: string) {
    const match = value.match(/\((\d+)\s+votes?\)/i);
    return match ? Number(match[1]) : null;
}

function extractInfoSections($: cheerio.CheerioAPI) {
    const headers = $('div[data-cy$="-header"]').filter((_, element) =>
        $(element).attr('data-cy')?.startsWith('info-box-')
    );

    const rawSections: Record<string, string[]> = {};
    const sectionNodes = new Map<string, cheerio.Element>();

    headers.each((_, header) => {
        const label = normalizeWhitespace($(header).find('b').first().text());
        if (!label) {
            return;
        }

        let content = $(header).next();
        while (content.length && !content.attr('data-cy')?.startsWith('info-box-')) {
            if (content.attr('data-cy')?.startsWith('info-box-')) {
                break;
            }
            if (content.is('br')) {
                content = content.next();
                continue;
            }
            break;
        }

        const contentElement = content.get(0);
        if (!contentElement) {
            rawSections[label] = [];
            return;
        }

        sectionNodes.set(label, contentElement);
        rawSections[label] = textListFromNode($, contentElement);
    });

    return {rawSections, sectionNodes};
}

function parseSchemaOrg($: cheerio.CheerioAPI) {
    const scripts = $('script[type="application/ld+json"]').toArray();
    for (const script of scripts) {
        const text = $(script).contents().text().trim();
        if (!text) {
            continue;
        }

        try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            if (parsed['@type'] === 'CreativeWork') {
                return parsed;
            }
        } catch {
            continue;
        }
    }

    return null;
}

function parseRating(section: string[]) {
    const averageLine = section.find((line) => /Average:/i.test(line)) ?? null;
    const bayesianLine = section.find((line) => /Bayesian Average:/i.test(line)) ?? null;

    return {
        average: averageLine ? parseNumber(averageLine.match(/Average:\s*([0-9.]+)/i)?.[1] ?? '') : null,
        bayesianAverage: bayesianLine
            ? parseNumber(bayesianLine.match(/Bayesian Average:\s*([0-9.]+)/i)?.[1] ?? '')
            : null,
        votes: averageLine ? parseVotes(averageLine) : null,
    };
}

function parseSeriesId(url: string, schemaOrg: Record<string, unknown> | null) {
    const fromSchema = schemaOrg?.identifier;
    if (typeof fromSchema === 'string' || typeof fromSchema === 'number') {
        return String(fromSchema);
    }

    const match = url.match(/\/series\/([^/]+)/);
    return match?.[1] ?? null;
}

function isTag(node: cheerio.Element, tagName: string) {
    return node.type === 'tag' && node.tagName === tagName;
}

function getSeriesSectionHtml($: cheerio.CheerioAPI) {
    const headings = $('h2').toArray();
    const seriesHeading = headings.find((heading) => $(heading).text().trim() === 'Series');

    if (!seriesHeading) {
        return null;
    }

    const chunks: string[] = [];
    let current = (seriesHeading as cheerio.Element).nextSibling;

    while (current) {
        if (isTag(current, 'h2')) {
            break;
        }

        const html = $.html(current);
        if (html) {
            chunks.push(html);
        }

        current = current.nextSibling;
    }

    return chunks.join('');
}

function parseSeriesSection(seriesSectionHtml: string) {
    const $section = cheerio.load(seriesSectionHtml);
    const seen = new Set<string>();
    const results: MangaUpdatesSeriesResult[] = [];

    $section('a[title="Click for Series Info"]').each((_, anchor) => {
        const link = $section(anchor);
        const row = link.closest('div[class*="series-list-module"]');
        if (!row.length) {
            return;
        }

        const title = link.text().trim();
        const href = link.attr('href')?.trim() ?? '';
        if (!title || !href || seen.has(href)) {
            return;
        }

        const columns = row.find('> div > div');
        const genreText = $section(columns.get(1)).text().trim();
        const yearText = $section(columns.get(2)).text().trim();
        const ratingText = $section(columns.get(3)).text().trim();

        seen.add(href);
        results.push({
            title,
            url: href.startsWith('http') ? href : new URL(href, BASE_URL).toString(),
            genres: splitGenres(genreText),
            year: parseNumber(yearText),
            rating: parseNumber(ratingText),
        });
    });

    return results;
}

function buildBrowserLikeHeaders(referer?: string) {
    return {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,es;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        priority: 'u=0, i',
        referer: referer ?? BASE_URL,
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Linux"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': REAL_USER_AGENT,
    };
}

async function fetchMangaUpdates(url: string, timeoutMs?: number) {
    const controller = timeoutMs ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        const response = await fetch(url, {
            headers: buildBrowserLikeHeaders(BASE_URL),
            signal: controller?.signal,
        });

        if (!response.ok) {
            throw new Error(`MangaUpdates request failed with ${response.status} ${response.statusText}`);
        }

        return response;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`MangaUpdates request timed out after ${timeoutMs}ms`);
        }

        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

async function fetchMangaUpdatesWithRetry(url: string) {
    try {
        return await fetchMangaUpdates(url);
    } catch {
        return fetchMangaUpdates(url, RETRY_TIMEOUT_MS);
    }
}

export async function search(query: string): Promise<MangaUpdatesSearchResponse> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        throw new Error('search query cannot be empty');
    }

    const url = new URL(SEARCH_URL);
    url.searchParams.set('search', trimmedQuery);

    const response = await fetchMangaUpdatesWithRetry(url.toString());

    const html = await response.text();
    const $ = cheerio.load(html);
    const seriesSectionHtml = getSeriesSectionHtml($);

    return {
        query: trimmedQuery,
        url: url.toString(),
        results: seriesSectionHtml ? parseSeriesSection(seriesSectionHtml) : [],
    };
}

export async function getSeries(urlOrPath: string): Promise<MangaUpdatesSeriesDetails> {
    const url = new URL(urlOrPath, BASE_URL).toString();
    const response = await fetchMangaUpdatesWithRetry(url);

    const html = await response.text();
    const $ = cheerio.load(html);
    const schemaOrg = parseSchemaOrg($);
    const {rawSections, sectionNodes} = extractInfoSections($);
    const title =
        normalizeWhitespace($('span.releasestitle').first().text()) ||
        (typeof schemaOrg?.name === 'string' ? schemaOrg.name : '') ||
        normalizeWhitespace(
            $('title')
                .first()
                .text()
                .replace(/\s*-\s*MangaUpdates\s*$/, '')
        );

    const image =
        $("meta[property='og:image']").attr('content')?.trim() ||
        $('div[data-cy="info-box-image"] img').attr('src')?.trim() ||
        (typeof schemaOrg?.image === 'string' ? schemaOrg.image : null) ||
        null;

    const authorsNode = sectionNodes.get('Author(s)');
    const artistsNode = sectionNodes.get('Artist(s)');
    const originalPublishersNode = sectionNodes.get('Original Publisher');
    const relatedSeriesNode = sectionNodes.get('Related Series');
    const categories = getLinkedLabels($, sectionNodes.get('Categories'), [/^Show all/i, /^Log in to vote/i]);
    const genres = getLinkedLabels($, sectionNodes.get('Genre'), [/^Search for series of same genre/i]);
    const tags = unique([...categories, ...genres]);

    return {
        id: parseSeriesId(url, schemaOrg),
        url,
        title,
        image,
        type: rawSections['Type']?.[0] ?? null,
        description: cleanDescription(rawSections, schemaOrg),
        associatedNames: rawSections['Associated Names'] ?? [],
        genres,
        tags,
        authors: authorsNode ? extractLinks($, authorsNode) : [],
        artists: artistsNode ? extractLinks($, artistsNode) : [],
        year: parseNumber(rawSections['Year']?.[0] ?? ''),
        originalPublishers: originalPublishersNode ? extractLinks($, originalPublishersNode) : [],
        relatedSeries: relatedSeriesNode ? extractLinks($, relatedSeriesNode) : [],
        rating: parseRating(rawSections['User Rating'] ?? []),
    };
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);

    if (!command) {
        console.error('Usage: bun run sources/mangaupdates.ts <search|getSeries> <query-or-url>');
        process.exit(1);
    }

    if (command === 'search') {
        const query = rest.join(' ').trim();
        if (!query) {
            console.error('Usage: bun run sources/mangaupdates.ts search <query>');
            process.exit(1);
        }

        const results = await search(query);
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    if (command === 'getSeries') {
        const url = rest.join(' ').trim();
        if (!url) {
            console.error('Usage: bun run sources/mangaupdates.ts getSeries <url>');
            process.exit(1);
        }

        const result = await getSeries(url);
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    const query = [command, ...rest].join(' ').trim();
    const results = await search(query);
    console.log(JSON.stringify(results, null, 2));
}

if (import.meta.main) {
    main().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
