import { unlink } from "node:fs/promises";
import { getCoverFile } from "./archive/index.ts";
import { ocrComicCover } from "./ocr/index.ts";

const ANSI_GRAY = "\x1b[90m";
const ANSI_RESET = "\x1b[0m";

function logStderr(message: string, data?: unknown) {
  if (data === undefined) {
    process.stderr.write(`${ANSI_GRAY}${message}${ANSI_RESET}\n`);
    return;
  }

  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  process.stderr.write(`${ANSI_GRAY}${message}: ${payload}${ANSI_RESET}\n`);
}

async function main() {
  const archivePath = process.argv[2];
  if (!archivePath) {
    console.error("Usage: bun run ocr-from-archive.ts <archive-path>");
    process.exit(1);
  }

  logStderr("extrayendo imagen", archivePath);
  const coverPath = await getCoverFile(archivePath);
  logStderr("nombre de la imagen", coverPath);

  try {
    const result = await ocrComicCover(coverPath);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    logStderr("eliminando imagen temporal", coverPath);
    await unlink(coverPath).catch(() => {});
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
