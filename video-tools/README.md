# video-tools

Collection of TypeScript utilities for processing video files with Dolby Vision metadata.

## Scripts

### crop-dolby-vision-mkv.ts

Crops Dolby Vision active layer from HEVC-encoded MKV files by setting active area offsets to zero. This
removes letterbox bars while preserving all streams and metadata.

**Usage:**

```bash
bun crop-dolby-vision-mkv.ts <input.mkv>
```

**Process:**

1. Verifies video codec is HEVC
2. Extracts video stream using mkvextract
3. Crops Dolby Vision metadata using dovi_tool
4. Creates new MKV with cropped stream using mkvmerge
5. Preserves all audio, subtitle, chapter, and attachment streams

**Output:** Creates `<input>-cropped.mkv` in the same directory as the input file.

**Requirements:**

- ffprobe
- mkvextract
- dovi_tool
- mkvmerge

### dolby-vision-offsets.ts

Scans directories recursively to identify MKV files with non-zero Dolby Vision active area offsets.

**Usage:**

```bash
bun dolby-vision-offsets.ts <directory>
```

**Features:**

- Detects Dolby Vision using ffprobe metadata analysis
- Filters HEVC streams only (skips AV1 and other codecs)
- Real-time progress display with clearable lines
- Reports only files with non-zero offsets

**Output:** Lists files with letterbox bars that can be processed with crop-dolby-vision-mkv.ts.

**Requirements:**

- ffprobe
- ffmpeg
- dovi_tool

## Installation

Install Bun runtime:

```bash
curl -fsSL https://bun.sh/install | bash
```

Install required tools:

```bash
# Ubuntu/Debian
apt install ffmpeg mkvtoolnix

# Install dovi_tool from https://github.com/quietvoid/dovi_tool
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. All code, comments, and documentation must be written
in English.

## License

WTFPL - Do What The Fuck You Want To Public License
