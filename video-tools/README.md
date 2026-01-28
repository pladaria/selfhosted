# video-tools

Collection of TypeScript utilities for processing video files with Dolby Vision metadata.

## Index

- [crop-dolby-vision-mkv.ts](#crop-dolby-vision-mkvts) - Fix Dolby Vision metadata after cropping letterbox
  bars
- [dolby-vision-offsets.ts](#dolby-vision-offsetsts) - Identify files with incorrect Dolby Vision active area
  offsets
- [video-catalog.ts](#video-catalogts) - Generate CSV catalog of video files with metadata

## Scripts

### crop-dolby-vision-mkv.ts

Fixes Dolby Vision metadata for files where letterbox bars have been physically cropped but the active area
offsets still reference the removed padding. Sets all offsets to zero, preventing playback issues on Dolby
Vision-capable devices.

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

**Output:** Lists files with Dolby Vision active area padding that can be corrected with
crop-dolby-vision-mkv.ts.

**Requirements:**

- ffprobe
- ffmpeg
- dovi_tool

### video-catalog.ts

Scans directories recursively to generate a CSV catalog of video files with detailed metadata.

**Usage:**

```bash
bun video-catalog.ts <directory> > output.csv
```

**Features:**

- Detects video codec, profile, and bit depth
- Identifies HDR formats (HDR10, HDR10+, Dolby Vision, HLG, BT.2020)
- Extracts audio codec and channel configuration
- Reports resolution, duration, bitrate, FPS, and file size
- Outputs CSV format to stdout for easy redirection

**Output:** CSV with columns: relative_path, codec, profile, bit_depth, hdr, resolution, audio, duration,
bitrate, fps, file_size.

**Requirements:**

- ffprobe

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

## License

WTFPL - Do What The Fuck You Want To Public License
