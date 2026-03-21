import OpenAI from "openai";

type JsonSchema = Record<string, unknown>;

const MODEL = "gpt-5.4";
const OPENAI_REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT || "low") as "low" | "medium" | "high";

const systemPrompt = [
  "You are a comics, manga, and graphic literature metadata specialist.",
  "Your task is to infer the most likely work from a noisy release filename and then research it carefully.",
  "The filename may include scanlation group names, source websites, volume/chapter numbers, quality markers, language tags, or archive noise.",
  "Use web search when needed to verify the identity of the work and gather reliable metadata.",
  "Return metadata for the work itself, not for a specific release file, scanlation, edition rip, or uploader.",
  "All output values must be in English, except personal names and original titles which should remain in their standard original forms.",
  "Alternative titles should include English and Spanish when you can verify them, plus other common locales when confidently available.",
  "If the original title is written in a non-Latin script, always include a transliterated alternative title using the locale suffix -Latn, such as ja-Latn, ko-Latn, zh-Latn, ru-Latn, or ar-Latn, using the most standard romanization available.",
  "If a field cannot be verified confidently, prefer null, an empty array, or a cautious short note instead of inventing facts.",
  "The type field should classify the work at a high level, for example: manga, manhua, manhwa, franco-belgian, american, spanish, portuguese, graphic-novel, or another precise publishing tradition if more appropriate.",
  "For demographic, always provide a value. If it is manga use terms like shonen or shounen, shojo or shoujo, seinen, josei, kodomo, or hentai for adult manga with high sexual content; if it is not manga use a readership label such as children, young-adult, adult, or adult-erotic.",
  "The synopsis should be concise but informative.",
  "The additional_information field should contain notable context such as awards, historical significance, publication magazine, adaptations, or author context, but remain compact.",
  "The completed boolean must indicate whether the series is finished overall, not whether the specific file is complete.",
  "Dates must use ISO 8601 format YYYY-MM-DD when the exact day is known, otherwise YYYY-MM, otherwise YYYY.",
  "Do not include citations or markdown in the JSON."
].join(" ");

const metadataSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "original_title",
    "alternative_titles",
    "release_date",
    "end_date",
    "authors",
    "genres",
    "tags",
    "synopsis",
    "demographic",
    "volume_count",
    "completed",
    "additional_information"
  ],
  properties: {
    type: { type: "string" },
    original_title: { type: "string" },
    alternative_titles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["locale", "title"],
        properties: {
          locale: { type: "string" },
          title: { type: "string" }
        }
      }
    },
    release_date: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    end_date: {
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    authors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role"],
        properties: {
          name: { type: "string" },
          role: { type: "string" }
        }
      }
    },
    genres: {
      type: "array",
      items: { type: "string" }
    },
    tags: {
      type: "array",
      items: { type: "string" }
    },
    synopsis: { type: "string" },
    demographic: { type: "string" },
    volume_count: {
      anyOf: [{ type: "integer" }, { type: "null" }]
    },
    completed: { type: "boolean" },
    additional_information: { type: "string" }
  }
};

function printUsageAndExit(): never {
  console.error("Usage: bun run infer-comic-metadata.ts <file-name-or-path>");
  process.exit(1);
}

function sanitizeFilename(input: string) {
  const rawInput = input.trim();
  const basename = rawInput.split(/[\\/]/).pop() ?? rawInput;
  const withoutExtension = basename.replace(/\.[^.]+$/, "");

  const normalizedSpacing = withoutExtension
    .replace(/_/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const strippedNoise = normalizedSpacing
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*(scan|scans|scanlation|digital|rip|raw|eng|english|esp|spanish|spa|sub|v\d+|vol\.?\s*\d+|ch\.?\s*\d+|chapter|tomo|tomo\s*\d+|www|https?|pdf|cbz|cbr)[^)]*\)/gi, " ")
    .replace(/\b(?:www\.[^\s]+|https?:\/\/[^\s]+)\b/gi, " ")
    .replace(/\b(?:scanlation|scans?|digital|rip|raw|repack|compressed|complete|espa[nñ]ol|spanish|english|dual|omnibus)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    raw_input: rawInput,
    basename,
    without_extension: withoutExtension,
    normalized_candidate: strippedNoise || normalizedSpacing || withoutExtension
  };
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

function getApiKey() {
  return process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY || null;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    printUsageAndExit();
  }

  const apiKey = getApiKey();

  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY environment variable. OPEN_API_KEY is also accepted for backward compatibility.");
    process.exit(1);
  }

  const filenameContext = sanitizeFilename(arg);
  const client = new OpenAI({
    apiKey
  });

  const userPrompt = [
    "Identify the work from this filename-derived context and return the requested JSON metadata.",
    "Focus on the underlying work, not the release packaging.",
    "",
    JSON.stringify(filenameContext, null, 2)
  ].join("\n");

  const response = await client.responses.create({
    model: MODEL,
    reasoning: { effort: OPENAI_REASONING_EFFORT },
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "comic_metadata",
        strict: true,
        schema: metadataSchema
      }
    },
    instructions: systemPrompt,
    input: userPrompt
  });

  const text = extractText(response);
  const parsed = JSON.parse(text);
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
