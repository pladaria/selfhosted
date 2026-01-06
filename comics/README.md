# Comics Scripts

This folder contains utility scripts for managing comic book archives:

## 1. `convert-to-webp.sh`

**Description:** Converts CBZ comic archives to use WebP images, resizing images to a maximum dimension.
Creates a new CBZ file with the suffix ` [webp]`.

**Usage:**

```sh
./convert-to-webp.sh [OPTIONS] <glob_pattern>
```

-   You can provide a single `.cbz` file, a directory, or a glob pattern (e.g. `/foo/*.cbz`, `/foo/**/*.cbz`).
-   All matching `.cbz` files will be processed.
-   A new CBZ file is created for each input, with images converted to WebP and resized to a maximum of 2000px
    (default).

**Options:**

-   `-s`, `--size N` Set max width/height for images (default: 2000)
-   `-q`, `--quality N` Set WebP quality (default: 90)
-   `-d`, `--delete` Delete original `.cbz` files after successful conversion
-   `-h`, `--help` Show help message

**Features:**

-   Converts images to WebP (default: 90% quality)
-   Resizes images proportionally to a maximum width or height (default: 2000px)
-   Requires: `unzip`, `zip`, and `ImageMagick` (`magick` or `convert` command)

**Example:**

```sh
# Process all cbz files in a folder
./convert-to-webp.sh /path/to/comics_folder/*.cbz

# Process all cbz files recursively
./convert-to-webp.sh '/path/to/comics_folder/**/*.cbz'

# Process a single file
./convert-to-webp.sh /path/to/comics_folder/mycomic.cbz
```

---

## 2. `repack-cbz.sh`

**Description:** Recursively converts all `.cbr` files in a directory to `.cbz` format. By default, original
`.cbr` files are moved to `/tmp/cbr_backup`, but you can choose to delete them instead.

**Usage:**

```sh
./repack-cbz.sh [-d] <directory>
```

**Options:**

-   `-d` Delete original `.cbr` files instead of moving them to backup
-   `-h` Show help message

**Features:**

-   Recursively finds and converts all `.cbr` files in the given directory
-   Uses `unrar` to extract and `zip` to create `.cbz` files
-   By default, moves original `.cbr` files to `/tmp/cbr_backup` (unless `-d` is used)
-   Requires: `unrar`, `zip`

**Example:**

```sh
./repack-cbz.sh /path/to/comics_folder
./repack-cbz.sh -d /path/to/comics_folder
```

## Disclaimer

These scripts were mostly vibe coded. Use at your own risk and feel free to improve them!
