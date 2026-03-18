import * as cheerio from "cheerio";

const BASE_URL = "https://www.tebeosfera.com";
const SEARCH_ENDPOINT = `${BASE_URL}/neko/templates/ajax/buscador_txt_post.php`;
const OLLAMA_BASE_URL = "http://localhost:11434";
const IA_MODEL = process.env.IA_MODEL || "gemma3:27b";
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "1h";

export type TebeosferaLinkedItem = {
  label: string;
  url: string;
};

export type TebeosferaSearchResult = {
  title: string;
  url: string;
  image: string | null;
  summaryTitle: string | null;
  publicationDate: string | null;
  summary: string | null;
  score?: number;
  matchedAuthor?: string | null;
};

export type TebeosferaSearchResponse = {
  query: string;
  url: string;
  total: number | null;
  results: TebeosferaSearchResult[];
};

export type TebeosferaSearchOptions = {
  author?: string;
};

type TebeosferaAuthorCandidate = {
  url: string;
  title: string;
  summaryTitle: string | null;
  publicationDate: string | null;
  summary: string | null;
  authors: string[];
};

type TebeosferaAuthorRanking = {
  ranked_urls: string[];
  selected_url: string | null;
  matches?: Array<{
    url: string;
    matched_author: string | null;
    reason?: string | null;
  }>;
};

export type TebeosferaCollectionIssue = {
  title: string;
  url: string;
  image: string | null;
  publicationDate: string | null;
  subtitle: string | null;
  kind: "ordinary" | "variant" | "other";
};

export type TebeosferaCollectionDetails = {
  url: string;
  title: string;
  subtitle: string | null;
  publishers: TebeosferaLinkedItem[];
  publisherLine: string | null;
  location: string | null;
  distribution: string[];
  dates: string | null;
  issueSummary: string | null;
  format: string[];
  dimensions: string | null;
  pagination: string | null;
  color: string | null;
  records: string[];
  linkedCollections: TebeosferaLinkedItem[];
  genres: TebeosferaLinkedItem[];
  image: string | null;
  issues: TebeosferaCollectionIssue[];
  rawFields: Record<string, string>;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(path: string) {
  return new URL(path, BASE_URL).toString();
}

function slugifyQuery(query: string) {
  return query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeForMatch(value).split(" ").filter(Boolean);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function extractLinks($root: cheerio.CheerioAPI, selectorOrNode: string | cheerio.Element) {
  return $root(selectorOrNode)
    .find("a[href]")
    .addBack("a[href]")
    .map((_, element) => {
      const href = $root(element).attr("href")?.trim();
      const label = normalizeWhitespace($root(element).text());
      if (!href || !label) {
        return null;
      }

      return {
        label,
        url: href.startsWith("http") ? href : toAbsoluteUrl(href)
      };
    })
    .get()
    .filter((item): item is TebeosferaLinkedItem => Boolean(item));
}

async function fetchText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "comics-scripts/1.0 (+https://www.tebeosfera.com)"
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Tebeosfera request failed with ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function postSearch(table: string, query: string, refererSection: string) {
  const form = new URLSearchParams({
    tabla: table,
    busqueda: slugifyQuery(query)
  });

  const referer = `${BASE_URL}/buscador/${slugifyQuery(query)}/${refererSection}/`;
  return fetchText(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer
    },
    body: form.toString()
  });
}

function extractIssueKind(title: string): "ordinary" | "variant" | "other" {
  const normalized = title.toLowerCase();
  if (normalized.includes("variante")) {
    return "variant";
  }

  return "ordinary";
}

function extractFieldRows($: cheerio.CheerioAPI) {
  const rawFields: Record<string, string> = {};

  $("#cuerpo2_ficha .row-fluid").each((_, row) => {
    const label = normalizeWhitespace($(row).find(".etiqueta").first().text()).replace(/:$/, "");
    const value = normalizeWhitespace($(row).find(".dato").first().text());
    if (label && value) {
      rawFields[label] = value;
    }
  });

  return rawFields;
}

function extractIssues($: cheerio.CheerioAPI) {
  const issues: TebeosferaCollectionIssue[] = [];

  $(".div_titulo").each((_, titleBlock) => {
    const sectionTitle = normalizeWhitespace($(titleBlock).text());
    if (!/^N[uú]meros/i.test(sectionTitle)) {
      return;
    }

    const gallery = $(titleBlock).nextAll("div.row-fluid").first();
    gallery.find("li.thumbnail").each((__, item) => {
      const mainLink = $(item).find("a[href]").first();
      const textBlock = $(item).find(".texto_thumbs").first();
      const titleLink = textBlock.find("a[href]").last();
      const title = normalizeWhitespace(titleLink.text()) || normalizeWhitespace(mainLink.attr("title") ?? "");
      const href = titleLink.attr("href")?.trim() || mainLink.attr("href")?.trim();
      const image = $(item).find("img").first().attr("src")?.trim() ?? null;
      const publicationDate = normalizeWhitespace(textBlock.find("span").first().text()) || null;
      const subtitleLinks = textBlock.find("a.enlace_gris");
      const subtitle = subtitleLinks.length ? normalizeWhitespace(subtitleLinks.last().text()) : null;

      if (!title || !href) {
        return;
      }

      issues.push({
        title,
        url: href.startsWith("http") ? href : toAbsoluteUrl(href),
        image: image ? (image.startsWith("http") ? image : toAbsoluteUrl(image)) : null,
        publicationDate,
        subtitle,
        kind: extractIssueKind(sectionTitle)
      });
    });
  });

  return issues;
}

export async function search(query: string): Promise<TebeosferaSearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("search query cannot be empty");
  }

  const referer = `${BASE_URL}/buscador/${slugifyQuery(trimmedQuery)}/Colecciones/`;
  const html = await postSearch("T3_publicaciones", trimmedQuery, "Colecciones");

  const $ = cheerio.load(html);
  const totalText = normalizeWhitespace($("#span_total_T3_publicaciones").text());
  const results: TebeosferaSearchResult[] = [];

  $(".linea_resultados").each((_, element) => {
    const container = $(element);
    const link = container.find('a[href*="/colecciones/"]').first();
    const title = normalizeWhitespace(link.text());
    const href = link.attr("href")?.trim();
    const image = container.find("img").first().attr("src")?.trim() ?? null;
    const summaryTitle = normalizeWhitespace(container.find("strong").first().text()) || null;
    const detailText = normalizeWhitespace(container.find("div[style*='font-size: 14px']").text());
    const publicationDateMatch = detailText.match(/\b\d{1,2}-[A-ZÁÉÍÓÚÑ]+-\d{4}\b/i);
    const publicationDate = publicationDateMatch?.[0] ?? null;

    if (!title || !href) {
      return;
    }

    results.push({
      title,
      url: href.startsWith("http") ? href : toAbsoluteUrl(href),
      image: image ? (image.startsWith("http") ? image : toAbsoluteUrl(image)) : null,
      summaryTitle,
      publicationDate,
      summary: detailText || null
    });
  });

  return {
    query: trimmedQuery,
    url: referer,
    total: totalText ? Number(totalText) : null,
    results
  };
}

async function getIssueAuthors(issueUrl: string) {
  const html = await fetchText(issueUrl);
  const $ = cheerio.load(html);
  return unique(
    $("#cuerpo2_ficha .row-fluid")
      .filter((_, row) => normalizeWhitespace($(row).find(".etiqueta").first().text()).startsWith("Autores"))
      .find('.dato a[href*="/autores/"]')
      .map((_, link) => {
        const label = normalizeWhitespace($(link).text());
        const title = normalizeWhitespace($(link).attr("title") ?? "");
        return [label, title].filter(Boolean);
      })
      .get()
      .flat()
      .filter(Boolean)
  );
}

async function rankCandidatesWithAuthorHint(
  query: string,
  authorQuery: string,
  candidates: TebeosferaAuthorCandidate[]
) {
  if (candidates.length === 0) {
    return null;
  }

  const prompt = [
    "You rank Tebeosfera search candidates for the SAME comic/manga/graphic collection the user is looking for.",
    "Prioritize title similarity first, then use the author hint to break ties or reject wrong works.",
    "Different works by the same author are NOT a match.",
    "Different editions, translations, or reprints of the same work CAN be a match.",
    "If a candidate has no authors, do not reject it only for missing authors when the title is very strong.",
    "Return ONLY valid JSON with this shape:",
    '{ "ranked_urls": ["..."], "selected_url": "..." | null, "matches": [{"url":"...","matched_author":"..." | null,"reason":"brief"}] }'
  ].join("\n");

  const userMessage = [
    `Target title: ${query}`,
    `Author hint: ${authorQuery}`,
    "",
    "Candidates:",
    JSON.stringify(candidates, null, 2)
  ].join("\n");

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: IA_MODEL,
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userMessage }
      ],
      format: "json"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) {
    throw new Error("Ollama returned no content");
  }

  return JSON.parse(content) as TebeosferaAuthorRanking;
}

function applyAiRanking(
  topCandidates: TebeosferaSearchResult[],
  ranking: TebeosferaAuthorRanking
) {
  const allowedUrls = new Set(topCandidates.map((result) => result.url));
  const rankedUrls = unique((ranking.ranked_urls ?? []).filter((url) => allowedUrls.has(url)));

  if (rankedUrls.length === 0) {
    if (ranking.selected_url && allowedUrls.has(ranking.selected_url)) {
      return [ranking.selected_url, ...topCandidates.map((result) => result.url).filter((url) => url !== ranking.selected_url)];
    }

    throw new Error("Ollama returned an invalid ranking for Tebeosfera candidates");
  }

  const missingUrls = topCandidates.map((result) => result.url).filter((url) => !rankedUrls.includes(url));
  return [...rankedUrls, ...missingUrls];
}

function scoreTitleMatch(query: string, result: TebeosferaSearchResult) {
  const queryNorm = normalizeForMatch(query);
  if (!queryNorm) {
    return 0;
  }

  const candidates = unique([result.title, result.summaryTitle ?? ""]).map(normalizeForMatch).filter(Boolean);
  let best = 0;

  for (const candidate of candidates) {
    if (candidate === queryNorm) {
      best = Math.max(best, 600);
      continue;
    }

    if (
      candidate === `la ${queryNorm}` ||
      candidate === `el ${queryNorm}` ||
      candidate === `los ${queryNorm}` ||
      candidate === `las ${queryNorm}` ||
      queryNorm === `la ${candidate}` ||
      queryNorm === `el ${candidate}` ||
      queryNorm === `los ${candidate}` ||
      queryNorm === `las ${candidate}`
    ) {
      best = Math.max(best, 520);
    }

    if (candidate.includes(queryNorm)) {
      best = Math.max(best, 160);
    }

    const queryTokens = tokens(queryNorm);
    const candidateTokens = new Set(tokens(candidate));
    const matchedTokens = queryTokens.filter((token) => candidateTokens.has(token)).length;
    if (matchedTokens > 0) {
      best = Math.max(best, matchedTokens * 60);
    }
  }

  return best;
}

export async function searchWithAuthor(query: string, options: TebeosferaSearchOptions = {}) {
  const base = await search(query);
  const authorQuery = options.author?.trim();
  const titleRankedResults = base.results
    .map((result) => ({
      ...result,
      score: scoreTitleMatch(query, result),
      matchedAuthor: null
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (!authorQuery || titleRankedResults.length === 0) {
    return {
      ...base,
      results: titleRankedResults
    };
  }

  const topCandidates = titleRankedResults.slice(0, 12);
  const candidateDetails = await Promise.all(
    topCandidates.map(async (result) => {
      let authors: string[] = [];

      try {
        const collection = await getCollection(result.url);
        const primaryIssue = collection.issues.find((issue) => issue.kind === "ordinary") ?? collection.issues[0];

        if (primaryIssue) {
          authors = await getIssueAuthors(primaryIssue.url);
        }
      } catch {
        // Ignore per-result enrichment failures and keep title-only ranking.
      }

      return {
        url: result.url,
        title: result.title,
        summaryTitle: result.summaryTitle,
        publicationDate: result.publicationDate,
        summary: result.summary,
        authors
      };
    })
  );

  const ranking = await rankCandidatesWithAuthorHint(query, authorQuery, candidateDetails);
  const rankedTopUrls = applyAiRanking(topCandidates, ranking);
  const allowedUrls = new Set(topCandidates.map((result) => result.url));
  const matchedAuthorByUrl = new Map(
    (ranking.matches ?? [])
      .filter((match) => allowedUrls.has(match.url))
      .map((match) => [match.url, match.matched_author ?? null])
  );

  const rankedTopUrlSet = new Set(rankedTopUrls);
  const scoredResults = [
    ...rankedTopUrls
      .map((url) => {
        const result = topCandidates.find((candidate) => candidate.url === url);
        if (!result) {
          return null;
        }

        return {
          ...result,
          matchedAuthor: matchedAuthorByUrl.get(url) ?? null
        };
      })
      .filter((result): result is TebeosferaSearchResult => Boolean(result)),
    ...titleRankedResults
      .filter((result) => !rankedTopUrlSet.has(result.url))
      .map((result) => ({
        ...result,
        matchedAuthor: result.matchedAuthor ?? null
      }))
  ];

  return {
    ...base,
    results: scoredResults
  };
}

export async function getCollection(urlOrPath: string): Promise<TebeosferaCollectionDetails> {
  const url = toAbsoluteUrl(urlOrPath);
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const rawFields = extractFieldRows($);

  const publisherLinks = extractLinks($, "#cuerpo1_ficha .titulo").filter((item) => item.url.includes("/entidades/"));
  const genres = extractLinks($, "#tab1 p");
  const linkedCollections = extractLinks($, '#cuerpo2_ficha a[href*="/colecciones/"]').filter((item) => item.url !== url);
  const issues = extractIssues($);

  const imageSrc = $(".ficha_portada img, #img_principal").first().attr("src")?.trim() ?? null;
  const location = normalizeWhitespace($("#cuerpo1_ficha .subtitulo > div").first().text()) || null;
  const distribution = unique(
    $("#cuerpo1_ficha .subtitulo img[title]")
      .map((_, img) => normalizeWhitespace($(img).attr("title") ?? ""))
      .get()
      .filter(Boolean)
  );

  return {
    url,
    title: normalizeWhitespace($("#main_titulo h1").first().text()),
    subtitle: normalizeWhitespace($("#titulo_ficha .subtitulo").first().text()) || null,
    publishers: publisherLinks,
    publisherLine: normalizeWhitespace($("#cuerpo1_ficha .titulo").first().text()) || null,
    location,
    distribution,
    dates: rawFields["Fechas"] ?? null,
    issueSummary: rawFields["Números"] ?? null,
    format: unique(
      $("#cuerpo2_ficha .row-fluid")
        .filter((_, row) => normalizeWhitespace($(row).find(".etiqueta").first().text()).startsWith("Formato"))
        .find("a")
        .map((_, a) => normalizeWhitespace($(a).text()))
        .get()
        .filter(Boolean)
    ),
    dimensions: rawFields["Dimensiones"] ?? null,
    pagination: rawFields["Paginación"] ?? null,
    color: rawFields["Color"] ?? null,
    records: unique(
      $("#cuerpo2_ficha .row-fluid")
        .filter((_, row) => normalizeWhitespace($(row).find(".etiqueta").first().text()).startsWith("Registros"))
        .find(".dato div")
        .map((_, div) => normalizeWhitespace($(div).text()))
        .get()
        .filter(Boolean)
    ),
    linkedCollections,
    genres,
    image: imageSrc ? (imageSrc.startsWith("http") ? imageSrc : toAbsoluteUrl(imageSrc)) : null,
    issues,
    rawFields
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    console.error("Usage: bun run sources/tebeosfera.ts <search|getCollection> <query-or-url>");
    process.exit(1);
  }

  if (command === "search") {
    const query = rest[0]?.trim() ?? "";
    const author = rest.slice(1).join(" ").trim();
    if (!query) {
      console.error("Usage: bun run sources/tebeosfera.ts search <query> [author]");
      process.exit(1);
    }

    console.log(JSON.stringify(await searchWithAuthor(query, { author }), null, 2));
    return;
  }

  if (command === "getCollection") {
    const url = rest.join(" ").trim();
    if (!url) {
      console.error("Usage: bun run sources/tebeosfera.ts getCollection <url>");
      process.exit(1);
    }

    console.log(JSON.stringify(await getCollection(url), null, 2));
    return;
  }

  console.log(JSON.stringify(await search([command, ...rest].join(" ").trim()), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
