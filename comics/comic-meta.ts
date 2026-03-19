import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import OpenAI from "openai";
import { getCoverFile } from "./archive/index.ts";
import { ocrComicCover, type ComicCoverOcrResult } from "./ocr/index.ts";
import * as mangaupdates from "./sources/mangaupdates.ts";
import * as tebeosfera from "./sources/tebeosfera.ts";

const OLLAMA_BASE_URL = "http://localhost:11434";
const OLLAMA_MODEL = process.env.IA_MODEL || "gemma3:27b";
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "1h";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const ANSI_GRAY = "\x1b[90m";
const ANSI_RESET = "\x1b[0m";

type JsonSchema = Record<string, unknown>;
type OpenAiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
};

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

type JsonSchemaObject = Record<string, unknown>;

const BANNED_GENERIC_TAGS = new Set([
  "graphic novel",
  "graphic-novel"
]);

const BANNED_GENERIC_TAG_HINTS = [
  "adapted to anime",
  "anime",
  "award-winning",
  "book",
  "comic",
  "completed",
  "doujinshi",
  "full color",
  "hardcover",
  "long strip",
  "novel",
  "paperback",
  "published in",
  "scanlated",
  "side story",
  "volume",
  "web comic",
  "webtoon"
];

function logStderr(message: string, data?: unknown) {
  if (data === undefined) {
    process.stderr.write(`${ANSI_GRAY}${message}${ANSI_RESET}\n`);
    return;
  }

  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  process.stderr.write(`${ANSI_GRAY}${message}: ${payload}${ANSI_RESET}\n`);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
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

        if (typeof item === "string") {
          return item.trim().length > 0;
        }

        if (Array.isArray(item)) {
          return item.length > 0;
        }

        if (typeof item === "object") {
          return Object.keys(item).length > 0;
        }

        return true;
      }) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, cleanObject(child)] as const)
      .filter(([, child]) => {
        if (child === null || child === undefined) {
          return false;
        }

        if (typeof child === "string") {
          return child.trim().length > 0;
        }

        if (Array.isArray(child)) {
          return child.length > 0;
        }

        if (typeof child === "object") {
          return Object.keys(child).length > 0;
        }

        return true;
      });

    return Object.fromEntries(entries) as T;
  }

  return value;
}

function postProcessComicMeta(result: Record<string, unknown>) {
  const tags = Array.isArray(result.tags)
    ? uniqueStrings(
        result.tags
          .filter((tag): tag is string => typeof tag === "string")
          .filter((tag) => !BANNED_GENERIC_TAGS.has(tag.trim().toLowerCase()))
      )
    : undefined;

  return cleanObject({
    ...result,
    tags
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
  if (source === "mangaupdates") {
    const tagHints = uniqueStrings([
      ...(((data.categories as string[] | undefined) ?? []).filter((item) => typeof item === "string")),
      ...(((data.categoryRecommendations as string[] | undefined) ?? []).filter((item) => typeof item === "string")),
      ...(((data.genres as string[] | undefined) ?? []).filter((item) => typeof item === "string"))
    ]).filter(shouldKeepTagHint);

    return {
      ...data,
      suggestedTagHints: tagHints
    };
  }

  return data;
}

function makeNullableSchema(schema: JsonSchemaObject) {
  if (Array.isArray(schema.type)) {
    return schema;
  }

  if (schema.anyOf || schema.oneOf) {
    return schema;
  }

  return {
    anyOf: [schema, { type: "null" }]
  };
}

function toOpenAiStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => toOpenAiStrictSchema(item));
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const current = { ...(schema as JsonSchemaObject) };

  if (current.type === "object" && current.properties && typeof current.properties === "object") {
    const properties = Object.fromEntries(
      Object.entries(current.properties as Record<string, unknown>).map(([key, value]) => {
        const converted = toOpenAiStrictSchema(value);
        const required = Array.isArray(current.required) ? (current.required as string[]) : [];
        const isRequired = required.includes(key);
        return [key, isRequired ? converted : makeNullableSchema(converted as JsonSchemaObject)];
      })
    );

    return {
      ...current,
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    };
  }

  if (current.type === "array" && current.items) {
    return {
      ...current,
      items: toOpenAiStrictSchema(current.items)
    };
  }

  if (Array.isArray(current.anyOf)) {
    return {
      ...current,
      anyOf: current.anyOf.map((item) => toOpenAiStrictSchema(item))
    };
  }

  if (Array.isArray(current.oneOf)) {
    return {
      ...current,
      oneOf: current.oneOf.map((item) => toOpenAiStrictSchema(item))
    };
  }

  return current;
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY || null;
}

function extractText(response: Awaited<ReturnType<OpenAI["responses"]["create"]>>) {
  if (response.output_text && response.output_text.trim()) {
    return response.output_text;
  }

  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text?.trim()) {
        return content.text;
      }
    }
  }

  throw new Error("OpenAI returned no text output.");
}

async function runOllamaJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
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

  return JSON.parse(content) as T;
}

function getModelPricing(model: string) {
  const normalized = model.toLowerCase();

  if (normalized.startsWith("gpt-5-mini")) {
    return {
      inputPerMillion: 0.25,
      cachedInputPerMillion: 0.025,
      outputPerMillion: 2.0
    };
  }

  if (normalized.startsWith("gpt-5-nano")) {
    return {
      inputPerMillion: 0.05,
      cachedInputPerMillion: 0.005,
      outputPerMillion: 0.4
    };
  }

  if (normalized.startsWith("gpt-5")) {
    return {
      inputPerMillion: 1.25,
      cachedInputPerMillion: 0.125,
      outputPerMillion: 10.0
    };
  }

  return null;
}

function estimateOpenAiCost(model: string, usage: OpenAiUsage | undefined) {
  const pricing = getModelPricing(model);
  if (!pricing || !usage) {
    return null;
  }

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const nonCachedInputTokens = Math.max(0, inputTokens - cachedTokens);

  const inputCost = (nonCachedInputTokens / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCost = inputCost + cachedInputCost + outputCost;

  return {
    model,
    input_tokens: inputTokens,
    cached_input_tokens: cachedTokens,
    output_tokens: outputTokens,
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
    estimated_cost_usd: Number(totalCost.toFixed(6))
  };
}

function logOpenAiCost(label: string, model: string, response: Awaited<ReturnType<OpenAI["responses"]["create"]>>) {
  const estimate = estimateOpenAiCost(model, response.usage as OpenAiUsage | undefined);
  if (!estimate) {
    logStderr(`${label} coste openai`, "estimacion no disponible para este modelo");
    return;
  }

  logStderr(`${label} coste openai`, estimate);
}

function jsonCodeBlock(value: unknown) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function buildSearchTitle(context: ComicCoverOcrResult, archivePath: string) {
  return (
    context.title ||
    context.collection ||
    stripExtension(basename(archivePath))
      .replace(/[_\.]+/g, " ")
      .replace(/\[[^\]]*]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
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
    work_type_estimate: context.work_type_estimate
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
}

function buildSourceCandidate(source: string, data: Record<string, unknown>) {
  if (source === "mangaupdates") {
    const authors = [
      ...((data.authors as Array<{ label?: string }> | undefined) ?? []).map((item) => item.label ?? ""),
      ...((data.artists as Array<{ label?: string }> | undefined) ?? []).map((item) => item.label ?? "")
    ];

    return {
      title: typeof data.title === "string" ? data.title : undefined,
      authors: uniqueStrings(authors),
      publisher: ((data.originalPublishers as Array<{ label?: string }> | undefined) ?? [])[0]?.label,
      publishingTradition: typeof data.type === "string" ? data.type : "manga",
      alternate_titles: Array.isArray(data.associatedNames) ? data.associatedNames : []
    };
  }

  if (source === "tebeosfera") {
    const artists = ((data.artists as Array<{ name?: string; aka?: string[] }> | undefined) ?? []).flatMap((artist) => [
      artist.name ?? "",
      ...((artist.aka ?? []).filter(Boolean))
    ]);

    return {
      title: typeof data.title === "string" ? data.title : undefined,
      authors: uniqueStrings(artists),
      publisher: typeof data.publisher === "string" ? data.publisher : undefined,
      publishingTradition:
        typeof data.publishingTradition === "string" ? data.publishingTradition : undefined,
      alternate_titles: ((data.alternateTitles as Array<{ title?: string }> | undefined) ?? []).map((item) => item.title ?? "")
    };
  }

  return {
    title: typeof data.title === "string" ? data.title : undefined,
    authors: [],
    publisher: undefined,
    publishingTradition: undefined,
    alternate_titles: []
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
      "You select the best MangaUpdates search candidate for a comic OCR context.",
      "Prefer exact title matches first.",
      "Use authors, publisher, year, language, and work_type_estimate as tie-breakers.",
      "Reject candidates that clearly refer to another work.",
      "Minor title wording differences and alternate spellings are acceptable.",
      'Return only valid JSON like {"selected_url":"...","reason":"brief"} or {"selected_url":null,"reason":"brief"}.'
    ].join("\n"),
    [
      `Search title: ${searchTitle}`,
      "",
      "OCR context:",
      JSON.stringify(context, null, 2),
      "",
      "Candidates:",
      JSON.stringify(candidates, null, 2)
    ].join("\n")
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
      "Determine if the source result refers to the same comic work as the OCR reference.",
      "Be tolerant to subtle title wording differences, punctuation, accents, translations, and abbreviations.",
      "Be tolerant to author name variants such as full names, initials, pen names, transliterations, or alternate spellings.",
      "If the source is clearly a different work, return match false.",
      "If known authors conflict strongly, return match false.",
      "Different editions or translations of the same work are still a match.",
      'Return only valid JSON like {"match":true,"reason":"brief"} or {"match":false,"reason":"brief"}.'
    ].join("\n"),
    [
      "OCR reference:",
      JSON.stringify(reference, null, 2),
      "",
      `Candidate from ${source}:`,
      JSON.stringify(candidate, null, 2)
    ].join("\n")
  );
}

async function runMangaUpdatesScraper(
  context: ComicCoverOcrResult,
  searchTitle: string
): Promise<SourceRunResult> {
  try {
    logStderr("[mangaupdates] buscando", { searchTitle });
    const searchResult = await mangaupdates.search(searchTitle);
    if (searchResult.results.length === 0) {
      return {
        source: "mangaupdates",
        data: null,
        validation: null,
        accepted: false
      };
    }

    const selection = await chooseMangaUpdatesCandidate(context, searchTitle, searchResult.results.slice(0, 10));
    const selectedUrl = selection?.selected_url;
    const selected = searchResult.results.find((result) => result.url === selectedUrl) ?? searchResult.results[0];
    logStderr("[mangaupdates] candidato elegido", {
      title: selected.title,
      url: selected.url,
      reason: selection?.reason ?? null
    });

    const details = toRecord(await mangaupdates.getSeries(selected.url));
    const validation = await validateSource("mangaupdates", buildReference(context), details);

    logStderr("[mangaupdates] validacion", validation);
    return {
      source: "mangaupdates",
      data: details,
      validation,
      accepted: validation.match
    };
  } catch (error) {
    logStderr("[mangaupdates] error", error instanceof Error ? error.message : String(error));
    return {
      source: "mangaupdates",
      data: null,
      validation: null,
      accepted: false
    };
  }
}

async function runTebeosferaScraper(
  context: ComicCoverOcrResult,
  searchTitle: string
): Promise<SourceRunResult> {
  try {
    logStderr("[tebeosfera] buscando", { searchTitle });
    const data = toRecord(
      await tebeosfera.scrapeComicMetaFromOcrContext(context, {
        searchTitle
      })
    );
    const validation = await validateSource("tebeosfera", buildReference(context), data);
    logStderr("[tebeosfera] validacion", validation);

    return {
      source: "tebeosfera",
      data,
      validation,
      accepted: validation.match
    };
  } catch (error) {
    logStderr("[tebeosfera] error", error instanceof Error ? error.message : String(error));
    return {
      source: "tebeosfera",
      data: null,
      validation: null,
      accepted: false
    };
  }
}

function buildSourcesMarkdown(ocrResult: ComicCoverOcrResult, results: SourceRunResult[]) {
  const sections = [`## OCR from cover\n\n${jsonCodeBlock(ocrResult)}`];

  for (const result of results) {
    if (!result.data || !result.accepted) {
      continue;
    }

    sections.push(
      `## Scrape result from ${result.source}\n\n${jsonCodeBlock(buildSourceMarkdownPayload(result.source, result.data))}`
    );
  }

  return sections.join("\n\n");
}

async function aggregateComicMeta(client: OpenAI, markdown: string, schema: JsonSchema) {
  const response = await client.responses.create({
    model: OPENAI_MODEL,
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        name: "comicmeta",
        strict: true,
        schema: toOpenAiStrictSchema(schema) as JsonSchema
      }
    },
    instructions: [
      "You are a comic metadata aggregation specialist.",
      "You will receive markdown containing OCR data and validated scraper results.",
      "Produce a single JSON object that matches the provided ComicMeta schema.",
      "All output values must be in English except personal names and titles already established in another language.",
      "When a title is written in a non-Latin script such as Japanese, Chinese, Korean, Russian, Arabic, or similar, append a standard Latin transliteration in parentheses.",
      "For example: 'アキラ (Akira)'.",
      "Apply this rule to the main title and alternate titles when relevant.",
      "Do not guess the language of a non-Latin title carelessly.",
      "Distinguish Japanese, Chinese, Korean, Cyrillic-script languages, Arabic-script languages, and other writing systems carefully.",
      "Never label Japanese text as Chinese or Chinese text as Japanese unless the source explicitly proves it.",
      "If the exact language is uncertain, preserve the original script and transliterate when possible, but avoid assigning the wrong locale or language-specific interpretation.",
      "Prefer validated scraper data over OCR when they conflict.",
      "Use OCR as fallback when scraper data is absent.",
      "Keep summary focused on the synopsis or premise of the work itself.",
      "If source summary text mixes synopsis with editorial copy, edition details, author commentary, biographical remarks, publication history, trivia, curiosities, or format information, extract only the real plot or premise into summary and move the rest into notes.",
      "Do not keep labels like 'Información de la editorial' in summary unless they are part of the actual synopsis.",
      "Notes should absorb non-synopsis material such as edition details, printing history, publication context, curiosities, author remarks, bonus contents, format details, and other supplementary information.",
      "Deduplicate alternate titles, genres, tags, and artists intelligently.",
      "Tags must be high-signal content descriptors that help a human understand at a glance what the work is about.",
      "Good tags include themes, settings, conflicts, motifs, subject matter, historical periods, political contexts, occupations, creature types, erotic content, war settings, speculative elements, or distinctive narrative hooks.",
      "Examples of useful tags: crime, robots, aliens, erotic, Spanish Civil War, political dystopia, body horror, cyberpunk, post-apocalyptic survival, coming of age.",
      "Discard generic, low-value, or format-only tags even if they appear in source data.",
      "Do not include tags like new, graphic novel, album, comic, book, volume 1, color interior, hardcover, paperback, publisher names, languages, edition labels, or other catalog boilerplate unless they are genuinely central to the work.",
      "If a candidate tag describes packaging, publication format, print characteristics, or collection metadata instead of the actual story/content, exclude it from tags.",
      "Prefer fewer strong tags over many weak or generic ones.",
      "MangaUpdates categories and category recommendations can be strong sources for tags when they describe story content, themes, settings, conflicts, relationships, historical context, or distinctive motifs.",
      "Use those category-like fields to derive better tags when appropriate, but still discard generic cataloging labels.",
      "Some structural or classification tags can still be useful when they help filter works, such as manga, manhwa, manhua, oneshot, sequel, prequel, spinoff, spin-off, crossover, anthology, or adaptation.",
      "Keep those classification tags when they are clearly true and useful for catalog filtering.",
      "When an author name string contains aliases or alternative names, split them intelligently.",
      "For example, if a source contains something like 'Pepito (Jose Luis Perales)', infer the primary display name and put the alternate form in aka.",
      "Use aka for pen names, aliases, full-name expansions, alternate spellings, transliterations, romanizations, or name forms found in parentheses.",
      "Do not leave alias information embedded inside the main name field when it can be separated cleanly into aka.",
      "Do not invent facts.",
      "Return only the JSON object."
    ].join("\n"),
    input: markdown
  });

  logOpenAiCost("[aggregate] final", OPENAI_MODEL, response);

  return JSON.parse(extractText(response)) as Record<string, unknown>;
}

export async function getComicMeta(archivePath: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable. OPEN_API_KEY is also accepted.");
  }

  const client = new OpenAI({ apiKey });
  let coverPath: string | null = null;

  try {
    logStderr("extrayendo portada", archivePath);
    coverPath = await getCoverFile(archivePath);
    logStderr("portada extraida", coverPath);

    logStderr("ejecutando ocr");
    const ocrResult = await ocrComicCover(coverPath);
    logStderr("ocr completado", ocrResult);

    const searchTitle = buildSearchTitle(ocrResult, archivePath);
    if (!searchTitle) {
      throw new Error("Could not infer a search title from OCR or filename");
    }

    logStderr("titulo de busqueda", searchTitle);

    const [mangaupdatesResult, tebeosferaResult, schemaText] = await Promise.all([
      runMangaUpdatesScraper(ocrResult, searchTitle),
      runTebeosferaScraper(ocrResult, searchTitle),
      Bun.file("./schema/comicmeta.json").text()
    ]);

    const sourceResults = [mangaupdatesResult, tebeosferaResult];
    const markdown = buildSourcesMarkdown(ocrResult, sourceResults);
    logStderr("markdown intermedio", markdown);

    const finalResult = postProcessComicMeta(
      await aggregateComicMeta(client, markdown, JSON.parse(schemaText) as JsonSchema)
    );
    logStderr(
      "fuentes aceptadas",
      sourceResults.filter((result) => result.accepted).map((result) => result.source)
    );

    return finalResult;
  } finally {
    if (coverPath) {
      logStderr("eliminando portada temporal", coverPath);
      await unlink(coverPath).catch(() => {});
    }
  }
}

async function main() {
  const archivePath = process.argv[2];
  if (!archivePath) {
    console.error("Usage: bun run comic-meta.ts <archive-path>");
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
