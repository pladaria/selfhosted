# comic-metadata

A toolkit for managing, analyzing, and extracting metadata from comic book archives. Built with TypeScript,
runs with [Bun](https://bun.sh/).

## Overview

This project provides:

- **Shell scripts** for converting and repacking comic archives (CBZ/CBR)
- **Scraping sources** for fetching metadata from online databases (MangaUpdates, Tebeosfera)
- **AI-powered metadata inference** from filenames (OpenAI)
- **Archive utilities** for reading CBZ/CBR files and extracting cover images
- **OCR module** for extracting text and metadata from comic covers using Ollama (deepseek-ocr)

## Setup

```sh
bun install
```

## Modules

### `archive/`

Utilities for reading compressed comic archives (`.cbz`, `.cbr`, `.zip`, `.rar`). Uses Linux CLI tools
(`file`, `unzip`, `unrar`) under the hood.

**Exports:**

- `getCoverFile(archivePath: string): Promise<string>` — Extracts the first image (sorted alphabetically) from
  the archive and saves it to a temp file. Returns the path to the extracted image.

**Scripts:**

- `archive/verify.ts` — Verifies archive type and integrity for `.cbz`, `.cbr`, `.zip`, and `.rar` files,
  optionally traversing directories recursively. Fixes mismatched extensions, moves invalid archives to an
  error directory, and stores successful checks in `verification-status.jsonl` so later runs can skip already
  verified files silently.

**Usage:**

```sh
bun run archive/verify.ts <file-or-dir> [-r] <error-dir>
```

**Examples:**

```sh
# Verify all supported archives in a directory
bun run archive/verify.ts "/mnt/MEDIA/comics/Marvel" "/mnt/MEDIA/comics-errors"

# Verify recursively, including subdirectories
bun run archive/verify.ts "/mnt/MEDIA/comics" -r "/mnt/MEDIA/comics-errors"

# Verify a single file
bun run archive/verify.ts "/mnt/MEDIA/comics/Batman 001.cbr" "/mnt/MEDIA/comics-errors"

# Resume a previous run; files already recorded in verification-status.jsonl are skipped silently
bun run archive/verify.ts "/mnt/MEDIA/comics" -r "/mnt/MEDIA/comics-errors"
```

**Features:**

- Accepts either a single file or a directory
- When the input is a directory, processes `.cbr`, `.cbz`, `.rar`, and `.zip` files
- Supports recursive traversal with `-r`
- Uses `file` to detect whether each archive is really ZIP or RAR
- Renames files when the extension does not match the detected type
- Treats non-ZIP/RAR files as invalid and moves them to the error directory
- Verifies integrity with `unzip` or `unrar`
- Creates the error directory automatically if it does not exist
- Prints colored logs, including per-file processing time
- Stores successful verifications in `verification-status.jsonl` in the input directory so future runs can
  skip unchanged files silently

**Requirements:** `file`, `unzip`, `unrar`

### `ocr/`

OCR module that analyzes comic book cover images using a local Ollama instance.

**Exports:**

- `ocrComicCover(imagePath: string): Promise<ComicCoverOcrResult>` — Sends a cover image to Ollama for OCR
  analysis. Returns structured JSON with title, authors, publisher, volume, and other detected metadata.

**Configuration (env vars):**

- `OLLAMA_OCR_MODEL` — OCR model name (default: `gemma3:27b`)
- `OLLAMA_TEXT_MODEL` — Text/inference model name (default: `gemma3:27b`)

### `sources/`

Scraping modules for online comic/manga databases:

- `mangaupdates.ts` — MangaUpdates scraper
- `tebeosfera.ts` — Tebeosfera scraper

## Scripts

### `convert-to-webp.sh`

**Description:** Converts CBZ comic archives to use WebP images, resizing images to a maximum dimension.
Creates a new CBZ file with the suffix ` [webp]`.

**Usage:**

```sh
./convert-to-webp.sh [OPTIONS] <glob_pattern>
```

- You can provide a single `.cbz` file, a directory, or a glob pattern (e.g. `/foo/*.cbz`, `/foo/**/*.cbz`).
- All matching `.cbz` files will be processed.
- A new CBZ file is created for each input, with images converted to WebP and resized to a maximum of 2000px
  (default).

**Options:**

- `-s`, `--size N` Set max width/height for images (default: 2000)
- `-q`, `--quality N` Set WebP quality (default: 90)
- `-d`, `--delete` Delete original `.cbz` files after successful conversion
- `-h`, `--help` Show help message

**Features:**

- Converts images to WebP (default: 90% quality)
- Resizes images proportionally to a maximum width or height (default: 2000px)
- Requires: `unzip`, `zip`, and `ImageMagick` (`magick` or `convert` command)

**Example:**

```sh
# Process all cbz files in a folder
./convert-to-webp.sh /path/to/comics_folder/*.cbz

# Process all cbz files recursively
./convert-to-webp.sh '/path/to/comics_folder/**/*.cbz'

# Process a single file
./convert-to-webp.sh /path/to/comics_folder/mycomic.cbz
```

### `repack-cbz.sh`

**Description:** Recursively converts all `.cbr` files in a directory to `.cbz` format. By default, original
`.cbr` files are moved to `/tmp/cbr_backup`, but you can choose to delete them instead.

**Usage:**

```sh
./repack-cbz.sh [-d] <directory>
```

**Options:**

- `-d` Delete original `.cbr` files instead of moving them to backup
- `-h` Show help message

**Features:**

- Recursively finds and converts all `.cbr` files in the given directory
- Uses `unrar` to extract and `zip` to create `.cbz` files
- By default, moves original `.cbr` files to `/tmp/cbr_backup` (unless `-d` is used)
- Requires: `unrar`, `zip`

**Example:**

```sh
./repack-cbz.sh /path/to/comics_folder
./repack-cbz.sh -d /path/to/comics_folder
```

### `infer-comic-metadata.ts`

**Description:** Uses OpenAI `gpt-5.4` to identify a comic, manga, or graphic novel from a noisy filename and
prints normalized metadata as JSON.

**Requirements:**

- `bun`
- `OPENAI_API_KEY` in `.env` or shell environment

**Setup:**

```sh
bun install
```

**Usage:**

```sh
bun run infer-comic-metadata.ts "Ore Monogatari!! [SomeGroup] www.example.com.cbz"
```

**Output JSON fields:**

- `type`
- `original_title`
- `alternative_titles`
- `release_date`
- `end_date`
- `authors`
- `genres`
- `tags`
- `synopsis`
- `demographic`
- `volume_count`
- `completed`
- `additional_information`

## Disclaimer

These scripts were mostly vibe coded. Use at your own risk and feel free to improve them!
