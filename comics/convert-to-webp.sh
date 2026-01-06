#!/usr/bin/env bash

set -euo pipefail  # Added -u for undefined variables and -o pipefail

show_help() {
  echo "Usage: convert-to-webp.sh [OPTIONS] <glob_pattern>"
  echo
  echo "Converts CBZ comics to WebP images (90% quality)."
  echo "Images are scaled proportionally to a maximum width or height."
  echo
  echo "Input can be:"
  echo "  - A single .cbz file (e.g. /foo/file.cbz)"
  echo "  - A glob pattern (e.g. /foo/*.cbz or /foo/**/*.cbz)"
  echo "  - A directory (all .cbz files inside will be processed)"
  echo "A new CBZ file is created with the suffix ' [webp]'."
  echo
  echo "Options:"
  echo "  -s, --size N     Set max width/height for images (default: 2000)"
  echo "  -q, --quality N  Set WebP quality (default: 90)"
  echo "  -d, --delete    Delete original .cbz files after successful conversion"
  echo "  -h, --help      Show this help message"
}

MAX_SIZE=2000
QUALITY=90

# Parse options
DELETE_ORIGINAL=false
while [[ "$1" == -* ]]; do
  case "$1" in
    -s|--size)
      if [[ -n "$2" && "$2" =~ ^[0-9]+$ ]]; then
        MAX_SIZE="$2"
        shift 2
      else
        echo "Error: -s|--size requires a numeric argument"
        exit 1
      fi
      ;;
    -q|--quality)
      if [[ -n "$2" && "$2" =~ ^[0-9]+$ ]]; then
        QUALITY="$2"
        shift 2
      else
        echo "Error: -q|--quality requires a numeric argument"
        exit 1
      fi
      ;;
    -d|--delete)
      DELETE_ORIGINAL=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

if [[ -z "$1" ]]; then
  show_help
  exit 0
fi

# Enable globstar for recursive globs
shopt -s globstar nullglob

# Dependencies
for cmd in unzip zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is required but not installed."
    exit 1
  fi
done

if command -v magick >/dev/null 2>&1; then
  IM_CMD="magick"
elif command -v convert >/dev/null 2>&1; then
  IM_CMD="convert"
else
  echo "Error: ImageMagick is required but not installed."
  exit 1
fi

process_cbz() {
  local cbz_file="$1"
  local base_name
  local tmp_dir
  local out_cbz
  local count=0
  local img

  base_name="$(basename "$cbz_file" .cbz)"
  out_cbz="$(dirname "$cbz_file")/${base_name} [webp].cbz"

  echo "Processing: $cbz_file"

  if [[ -f "$out_cbz" ]]; then
    read -r -p "  Destination file exists: $(basename "$out_cbz"). Overwrite? [y/N] " answer
    case "$answer" in
      [Yy]*)
        echo "  Overwriting $out_cbz";;
      *)
        echo "  Skipping $cbz_file"
        return
        ;;
    esac
  fi

  tmp_dir="$(mktemp -d)"
  # Ensure cleanup on error
  trap 'rm -rf "$tmp_dir"' EXIT

  echo "  Extracting..."
  unzip -q "$cbz_file" -d "$tmp_dir"

  # Use process substitution and while loop to preserve counter
  while IFS= read -r -d '' img; do
    count=$((count + 1))
    local rel_path="${img#"$tmp_dir"/}"
    echo "  [$count] Converting: $rel_path"
    local out_img="${img%.*}.webp"
    "$IM_CMD" "$img" -resize "${MAX_SIZE}x${MAX_SIZE}>" -quality "$QUALITY" "$out_img"
    rm "$img"
  done < <(find "$tmp_dir" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) -print0)

  echo "  Creating CBZ: $(basename "$out_cbz")"
  (cd "$tmp_dir" && zip -qr - .) > "$out_cbz"

  rm -rf "$tmp_dir"
  trap - EXIT  # Clear trap

  echo "Done: $out_cbz"
  if $DELETE_ORIGINAL; then
    echo "Deleting original: $cbz_file"
    rm -f "$cbz_file"
  fi
  echo
}


# Collect all input arguments as files
cbz_files=()
for input_pattern in "$@"; do
  if [[ -d "$input_pattern" ]]; then
    # If it's a directory, find all .cbz files inside
    while IFS= read -r -d '' file; do
      cbz_files+=("$file")
    done < <(find "$input_pattern" -type f -iname "*.cbz" -print0)
  elif [[ -f "$input_pattern" && "$input_pattern" == *.cbz ]]; then
    # If it's a file, add it directly
    cbz_files+=("$input_pattern")
  else
    # Try to expand as a glob pattern
    shopt -s nullglob
    for f in $input_pattern; do
      if [[ -f "$f" && "$f" == *.cbz ]]; then
        cbz_files+=("$f")
      fi
    done
  fi
done

if [[ ${#cbz_files[@]} -eq 0 ]]; then
  echo "Error: No .cbz files found for input: $*"
  exit 1
fi

for cbz in "${cbz_files[@]}"; do
  process_cbz "$cbz"
done

