import { basename } from "node:path";
import { llmQuery, type JsonSchema } from "../ai/llm.ts";
import type { ComicCoverOcrResult } from "../ocr/index.ts";

export type FilenameSourceResult = {
  title?: string;
  subtitle?: string;
  query_texts?: string[];
  authors?: string[];
  artists?: string[];
  year?: string;
  volume?: string;
  volumeCount?: string;
  issue_number?: string;
  scan_group?: string;
  translation_group?: string;
  release_group?: string;
  publisher?: string;
  collection?: string;
  language?: string;
  source_url?: string;
  format?: string;
  publishingTradition?: string;
  release_type?: string;
  notes?: string[];
  other?: string[];
};

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }

  const lowered = normalized.toLowerCase();
  if (lowered === "unknown" || lowered === "null" || lowered === "undefined" || lowered === "n/a") {
    return undefined;
  }

  return normalized;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = [
    ...new Set(value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item)))
  ];
  return normalized.length > 0 ? normalized : undefined;
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

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function normalizeFilenameInput(input: string) {
  const base = basename(input.trim());
  const withoutExtension = stripExtension(base);

  return {
    path: input,
    basename: base,
    without_extension: withoutExtension,
    normalized: withoutExtension.replace(/[_\.]+/g, " ").replace(/\s+/g, " ").trim()
  };
}

const systemPrompt = [
  "You are a comic filename metadata extraction specialist.",
  "You will receive a comic archive filename and optional OCR context from the cover.",
  "Extract only metadata that is explicitly present in the filename itself.",
  "Do not infer plausible metadata from world knowledge, prior knowledge, or model memory.",
  "If a field is not literally supported by text or tokens present in the filename, leave it null or empty.",
  "Use OCR context only as a tie-breaker to disambiguate text already present in the filename.",
  "OCR context must not introduce new metadata fields that are absent from the filename.",
  "Do not complete missing publisher, collection, publishingTradition, release_type, authors, artists, or other fields from memory or from OCR context unless they are explicitly present in the filename text.",
  "Return only valid JSON.",
  "Use null for unknown strings and empty arrays for unknown lists.",
  "Fields to extract:",
  "- title: main work title",
  "- subtitle: subtitle, arc, or secondary title",
  "- query_texts: ordered search queries for finding this exact work in external catalogs, from most specific to broader fallback queries",
  "- authors: writer names inferred from the filename",
  "- artists: artist names inferred from the filename",
  "- year: publication or release year if present",
  "- volume: specific volume label or number",
  "- volumeCount: total number of volumes if explicitly present",
  "- issue_number: issue, chapter, or book number if present",
  "- scan_group: scanning group or scanner person",
  "- translation_group: translator or scanlation group responsible for translation",
  "- release_group: release packager, uploader, or release group when distinct",
  "- publisher: publisher or editorial label",
  "- collection: collection, imprint, or line only if explicitly written in the filename",
  "- language: release language if present",
  "- source_url: website or source URL if present",
  "- format: release or file format hints such as digital, webrip, omnibus, deluxe, etc.",
  "- publishingTradition: only if the filename explicitly says it or includes an explicit equivalent label",
  "- release_type: only if explicitly visible in the filename, such as oneshot, anthology, tankobon, chapter-release, issue-release, artbook, magazine, novelization, omnibus",
  "- notes: short clarifying notes only about ambiguity in text that is actually present in the filename",
  "- other: other relevant tokens from the filename that do not fit the previous fields",
  "For query_texts, build short natural search strings that preserve important work-identifying terms from the filename, such as edition type, subtitle, or collection wording when they help identify the exact edition.",
  "Order query_texts from most specific to most general.",
  "Do not include scanner groups, websites, quality markers, archive noise, or redundant punctuation in query_texts.",
  'Example: if the filename clearly indicates "Spawn Edicion Integral", query_texts can be ["spawn edicion integral", "spawn"].'
].join("\n");

const filenameSourceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "subtitle",
    "query_texts",
    "authors",
    "artists",
    "year",
    "volume",
    "volumeCount",
    "issue_number",
    "scan_group",
    "translation_group",
    "release_group",
    "publisher",
    "collection",
    "language",
    "source_url",
    "format",
    "publishingTradition",
    "release_type",
    "notes",
    "other"
  ],
  properties: {
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    subtitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    query_texts: { type: "array", items: { type: "string" } },
    authors: { type: "array", items: { type: "string" } },
    artists: { type: "array", items: { type: "string" } },
    year: { anyOf: [{ type: "string" }, { type: "null" }] },
    volume: { anyOf: [{ type: "string" }, { type: "null" }] },
    volumeCount: { anyOf: [{ type: "string" }, { type: "null" }] },
    issue_number: { anyOf: [{ type: "string" }, { type: "null" }] },
    scan_group: { anyOf: [{ type: "string" }, { type: "null" }] },
    translation_group: { anyOf: [{ type: "string" }, { type: "null" }] },
    release_group: { anyOf: [{ type: "string" }, { type: "null" }] },
    publisher: { anyOf: [{ type: "string" }, { type: "null" }] },
    collection: { anyOf: [{ type: "string" }, { type: "null" }] },
    language: { anyOf: [{ type: "string" }, { type: "null" }] },
    source_url: { anyOf: [{ type: "string" }, { type: "null" }] },
    format: { anyOf: [{ type: "string" }, { type: "null" }] },
    publishingTradition: { anyOf: [{ type: "string" }, { type: "null" }] },
    release_type: { anyOf: [{ type: "string" }, { type: "null" }] },
    notes: { type: "array", items: { type: "string" } },
    other: { type: "array", items: { type: "string" } }
  }
};

export async function extractFilenameMeta(
  input: string,
  context?: Partial<ComicCoverOcrResult>
): Promise<FilenameSourceResult> {
  const payload = {
    filename: normalizeFilenameInput(input),
    ocr_context: context ?? {}
  };

  const response = await llmQuery<Record<string, unknown>>({
    engine: "ollama",
    schemaName: "filename_metadata",
    systemPrompt,
    prompt: JSON.stringify(payload, null, 2),
    schema: filenameSourceSchema,
  });

  const parsed = (response.data ?? {}) as Record<string, unknown>;

  return cleanObject({
    title: normalizeString(parsed.title),
    subtitle: normalizeString(parsed.subtitle),
    query_texts: normalizeStringArray(parsed.query_texts),
    authors: normalizeStringArray(parsed.authors),
    artists: normalizeStringArray(parsed.artists),
    year: normalizeString(parsed.year),
    volume: normalizeString(parsed.volume),
    volumeCount: normalizeString(parsed.volumeCount),
    issue_number: normalizeString(parsed.issue_number),
    scan_group: normalizeString(parsed.scan_group),
    translation_group: normalizeString(parsed.translation_group),
    release_group: normalizeString(parsed.release_group),
    publisher: normalizeString(parsed.publisher),
    collection: normalizeString(parsed.collection),
    language: normalizeString(parsed.language),
    source_url: normalizeString(parsed.source_url),
    format: normalizeString(parsed.format),
    publishingTradition: normalizeString(parsed.publishingTradition),
    release_type: normalizeString(parsed.release_type),
    notes: normalizeStringArray(parsed.notes),
    other: normalizeStringArray(parsed.other)
  });
}

if (import.meta.main) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: bun run sources/filename.ts <filename-or-path> [ocr-json-path]");
    process.exit(1);
  }

  let context: Partial<ComicCoverOcrResult> | undefined;
  const contextPath = process.argv[3];
  if (contextPath) {
    context = (await Bun.file(contextPath).json()) as Partial<ComicCoverOcrResult>;
  }

  const result = await extractFilenameMeta(input, context);
  console.log(JSON.stringify(result, null, 2));
}
