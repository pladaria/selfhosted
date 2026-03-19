import { unlink } from "node:fs/promises";
import { getCoverFile } from "./archive/index.ts";
import { ocrComicCover } from "./ocr/index.ts";
import { debug } from "./utils/log.ts";

async function main() {
  const archivePath = process.argv[2];
  if (!archivePath) {
    console.error("Usage: bun run ocr-from-archive.ts <archive-path>");
    process.exit(1);
  }

  debug("extrayendo imagen", archivePath);
  const coverPath = await getCoverFile(archivePath);
  debug("nombre de la imagen", coverPath);

  try {
    const result = await ocrComicCover(coverPath);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    debug("eliminando imagen temporal", coverPath);
    await unlink(coverPath).catch(() => {});
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
