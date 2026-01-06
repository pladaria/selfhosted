#!/bin/bash

set -e

TMP_DIR="/tmp/cbr_backup"
DELETE_MODE=false

show_help() {
  echo "Usage: $0 [-d] <directory>"
  echo
  echo "Converts all .cbr files inside the given directory (recursively)"
  echo "to .cbz format."
  echo
  echo "By default, original .cbr files are moved to /tmp/cbr_backup."
  echo "Options:"
  echo "  -d        Delete original .cbr files instead of moving them"
  echo "  -h        Show this help message"
  echo
  echo "Requirements:"
  echo "  - unrar"
  echo "  - zip"
}

while getopts ":dh" opt; do
  case "$opt" in
    d) DELETE_MODE=true ;;
    h) show_help; exit 0 ;;
    *) show_help; exit 1 ;;
  esac
done

shift $((OPTIND - 1))

if [ -z "$1" ]; then
  show_help
  exit 1
fi

TARGET_DIR="$1"

if [ "$DELETE_MODE" = false ]; then
  mkdir -p "$TMP_DIR"
fi

find "$TARGET_DIR" -type f -iname "*.cbr" -exec sh -c '
  for file do
    output="${file%.cbr}.cbz"
    echo "Processing: $file -> $output"
    unrar p "$file" | zip -q "$output" -
    if [ "'"$DELETE_MODE"'" = true ]; then
      rm -f "$file"
    else
      mv "$file" "'"$TMP_DIR"'"
    fi
  done
' sh {} +

