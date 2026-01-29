#!/usr/bin/env bun

import {execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {parseArgs} from 'util';
import ExcelJS from 'exceljs';

// ============================================================================
// Types
// ============================================================================

interface VideoInfo {
    filename: string;
    codec: string;
    profile: string;
    bitDepth: string;
    hdr: string;
    resolution: string;
    audio: string;
    duration: string;
    bitrate: string;
    fps: string;
    fileSize: string;
}

interface FFProbeStream {
    codec_type: string;
    codec_name: string;
    profile?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    bits_per_raw_sample?: string;
    color_transfer?: string;
    color_space?: string;
    color_primaries?: string;
    side_data_list?: SideData[];
    r_frame_rate?: string;
    channel_layout?: string;
    channels?: number;
    index: number;
    tags?: {
        title?: string;
        language?: string;
    };
}

interface SideData {
    side_data_type: string;
}

interface FFProbeFormat {
    duration?: string;
    bit_rate?: string;
}

interface FFProbeData {
    streams?: FFProbeStream[];
    format?: FFProbeFormat;
}

interface FFProbeFrameData {
    frames?: Array<{
        side_data_list?: SideData[];
    }>;
}

// ============================================================================
// Constants
// ============================================================================

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];

const HDR_METADATA = {
    DOLBY_VISION: ['DOVI configuration record', 'Dolby Vision RPU', 'DOVI', 'Dolby'],
    HDR_VIVID: ['HDR dynamic metadata CUVA', 'CUVA', 'Vivid'],
    HDR10_PLUS: ['HDR dynamic metadata SMPTE2094-40 (HDR10+)', 'Dynamic HDR10+', 'SMPTE2094-40', 'HDR10+'],
    STATIC_METADATA: ['Mastering display metadata', 'Content light level metadata'],
} as const;

const HELP_TEXT = `
Video Catalog - Analyze video files and generate a catalog

Usage:
  bun video-catalog.ts <directory_path> [options]

Options:
  -o, --output <file>   Output file (format detected from extension: .csv or .xlsx)
                        If not specified, outputs CSV to stdout
  -h, --help           Show this help message

Examples:
  bun video-catalog.ts /path/to/videos
  bun video-catalog.ts /path/to/videos > catalog.csv
  bun video-catalog.ts /path/to/videos --output catalog.xlsx
  bun video-catalog.ts /path/to/videos -o my-videos.csv
`;

// ============================================================================
// File System
// ============================================================================

function getVideoFiles(dir: string): string[] {
    const files: string[] = [];

    function walkDir(currentPath: string): void {
        const items = fs.readdirSync(currentPath);

        for (const item of items) {
            const fullPath = path.join(currentPath, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walkDir(fullPath);
            } else if (VIDEO_EXTENSIONS.some((ext) => item.toLowerCase().endsWith(ext))) {
                files.push(fullPath);
            }
        }
    }

    walkDir(dir);
    return files;
}

// ============================================================================
// FFProbe Wrappers
// ============================================================================

function runFFProbe(filePath: string): FFProbeData | null {
    try {
        const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
        const output = execSync(command, {encoding: 'utf8'});
        return JSON.parse(output);
    } catch (error) {
        console.error(`FFProbe failed for ${filePath}: ${error}`, {stream: process.stderr});
        return null;
    }
}

function analyzeFirstFrame(filePath: string): SideData[] {
    try {
        const command = `ffprobe -v quiet -print_format json -show_frames -read_intervals "%+#1" -select_streams v:0 "${filePath}"`;
        const output = execSync(command, {encoding: 'utf8', timeout: 10000});
        const data: FFProbeFrameData = JSON.parse(output);
        return data.frames?.[0]?.side_data_list || [];
    } catch {
        return [];
    }
}

// ============================================================================
// Video Analysis
// ============================================================================

function detectBitDepth(stream: FFProbeStream): string {
    if (stream.pix_fmt?.includes('12')) return '12';
    if (stream.pix_fmt?.includes('10')) return '10';
    return stream.bits_per_raw_sample || '8';
}

function calculateFps(frameRate: string): string {
    try {
        const parts = frameRate.split('/').map(Number);
        const num = parts[0];
        const den = parts[1];
        if (num !== undefined && den !== undefined && !isNaN(num) && !isNaN(den) && den !== 0) {
            return (num / den).toFixed(2);
        }
        return frameRate;
    } catch {
        return 'unknown';
    }
}

function getResolutionLabel(width: number): string {
    if (width >= 3800) return '4K';
    if (width >= 1900) return '1080p';
    if (width >= 1260) return '720p';
    if (width >= 840) return '480p';
    return 'SD';
}

function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// HDR Detection
// ============================================================================

function hasMetadata(sideDataList: SideData[], keywords: readonly string[]): boolean {
    return sideDataList.some((sd) => keywords.some((keyword) => sd.side_data_type?.includes(keyword)));
}

function detectHdrFormat(stream: FFProbeStream, filePath: string): string {
    const sideData = stream.side_data_list || [];

    // Fast checks first (no frame analysis needed)
    if (hasMetadata(sideData, HDR_METADATA.DOLBY_VISION)) {
        return 'Dolby Vision';
    }

    if (stream.color_transfer === 'arib-std-b67') {
        return 'HLG';
    }

    // For PQ content, analyze frame to differentiate HDR10+ from HDR10
    if (stream.color_transfer === 'smpte2084') {
        const frameSideData = analyzeFirstFrame(filePath);
        const allSideData = [...sideData, ...frameSideData];

        if (hasMetadata(allSideData, HDR_METADATA.HDR_VIVID)) {
            return 'HDR Vivid';
        }

        if (hasMetadata(allSideData, HDR_METADATA.HDR10_PLUS)) {
            return 'HDR10+';
        }

        return 'HDR10';
    }

    // Fallback for BT.2020 without PQ
    if (stream.color_space === 'bt2020nc' || stream.color_primaries === 'bt2020') {
        return 'BT.2020';
    }

    return 'SDR';
}

// ============================================================================
// Audio Analysis
// ============================================================================

function getChannelLayout(stream: FFProbeStream): string {
    if (stream.channel_layout) {
        if (stream.channel_layout.includes('5.1')) return '5.1';
        if (stream.channel_layout.includes('7.1')) return '7.1';
        if (stream.channel_layout === 'stereo') return '2.0';
        if (stream.channel_layout === 'mono') return '1.0';
        return stream.channel_layout;
    }

    if (stream.channels) {
        const channelMap: Record<number, string> = {
            1: '1.0',
            2: '2.0',
            6: '5.1',
            8: '7.1',
        };
        return channelMap[stream.channels] || `${stream.channels}.0`;
    }

    return '';
}

function formatAudioStream(stream: FFProbeStream): string {
    const codec = (stream.codec_name || 'unknown').toUpperCase();
    const channels = getChannelLayout(stream);
    const title = stream.tags?.title || stream.tags?.language || `stream ${stream.index}`;
    return `${codec}${channels ? ` ${channels}` : ''} (${title})`;
}

function analyzeAudioStreams(streams: FFProbeStream[]): string {
    const audioStreams = streams.filter((s) => s.codec_type === 'audio');
    if (audioStreams.length === 0) return 'none';
    return audioStreams.map(formatAudioStream).join('; ');
}

// ============================================================================
// Main Video Info Extraction
// ============================================================================

function getVideoInfo(filePath: string, basePath: string): VideoInfo | null {
    try {
        const data = runFFProbe(filePath);
        if (!data?.streams) return null;

        const videoStream = data.streams.find((s) => s.codec_type === 'video');
        if (!videoStream) return null;

        const stats = fs.statSync(filePath);

        return {
            filename: path.basename(filePath),
            codec: (videoStream.codec_name || '???').toUpperCase(),
            profile: videoStream.profile || 'unknown',
            bitDepth: `${detectBitDepth(videoStream)}-bit`,
            hdr: detectHdrFormat(videoStream, filePath),
            resolution: getResolutionLabel(videoStream.width || 0),
            audio: analyzeAudioStreams(data.streams),
            duration: data.format?.duration ? formatDuration(parseFloat(data.format.duration)) : 'unknown',
            bitrate: data.format?.bit_rate
                ? `${(parseInt(data.format.bit_rate) / 1000000).toFixed(2)}Mbps`
                : 'unknown',
            fps: videoStream.r_frame_rate ? calculateFps(videoStream.r_frame_rate) : 'unknown',
            fileSize: `${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
        };
    } catch (error) {
        console.error(`Error processing ${filePath}: ${error}`, {stream: process.stderr});
        return null;
    }
}

// ============================================================================
// Output Formatters
// ============================================================================

function escapeCsv(str: string): string {
    return `"${str.replace(/"/g, '""')}"`;
}

function outputCsv(videoInfos: VideoInfo[]): void {
    console.log('filename,codec,profile,bit_depth,hdr,resolution,audio,duration,bitrate,fps,file_size');

    for (const info of videoInfos) {
        console.log(
            [
                escapeCsv(info.filename),
                info.codec,
                info.profile,
                info.bitDepth,
                info.hdr,
                info.resolution,
                escapeCsv(info.audio),
                info.duration,
                info.bitrate,
                info.fps,
                info.fileSize,
            ].join(',')
        );
    }
}

function outputCsvFile(videoInfos: VideoInfo[], outputPath: string): void {
    const lines = ['filename,codec,profile,bit_depth,hdr,resolution,audio,duration,bitrate,fps,file_size'];

    for (const info of videoInfos) {
        lines.push(
            [
                escapeCsv(info.filename),
                info.codec,
                info.profile,
                info.bitDepth,
                info.hdr,
                info.resolution,
                escapeCsv(info.audio),
                info.duration,
                info.bitrate,
                info.fps,
                info.fileSize,
            ].join(',')
        );
    }

    fs.writeFileSync(outputPath, lines.join('\n') + '\n');
    console.log(`CSV file saved: ${outputPath}`);
}

async function outputExcel(videoInfos: VideoInfo[], outputPath: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Video Catalog');

    // Define columns
    worksheet.columns = [
        {header: 'Filename', key: 'filename', width: 60},
        {header: 'Codec', key: 'codec', width: 12},
        {header: 'Profile', key: 'profile', width: 20},
        {header: 'Bit Depth', key: 'bitDepth', width: 12},
        {header: 'HDR', key: 'hdr', width: 15},
        {header: 'Resolution', key: 'resolution', width: 12},
        {header: 'Audio', key: 'audio', width: 40},
        {header: 'Duration', key: 'duration', width: 12},
        {header: 'Bitrate', key: 'bitrate', width: 12},
        {header: 'FPS', key: 'fps', width: 10},
        {header: 'File Size', key: 'fileSize', width: 12},
    ];

    // Style header row
    worksheet.getRow(1).font = {bold: true};
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {argb: 'FF4472C4'},
    };
    worksheet.getRow(1).font = {bold: true, color: {argb: 'FFFFFFFF'}};
    worksheet.getRow(1).alignment = {vertical: 'middle', horizontal: 'center'};

    // Add data
    videoInfos.forEach((info) => {
        worksheet.addRow(info);
    });

    // Center align columns B, C, D, E (Codec, Profile, Bit Depth, HDR)
    ['B', 'C', 'D', 'E', 'F'].forEach((col) => {
        worksheet.getColumn(col).alignment = {horizontal: 'center'};
    });

    // Right align columns H, I, J, K (Duration, Bitrate, FPS, File Size)
    ['H', 'I', 'J', 'K'].forEach((col) => {
        worksheet.getColumn(col).alignment = {horizontal: 'right'};
    });

    // Add autofilter
    worksheet.autoFilter = {
        from: {row: 1, column: 1},
        to: {row: 1, column: 11},
    };

    // Freeze header row
    worksheet.views = [{state: 'frozen', ySplit: 1}];

    // Save file
    await workbook.xlsx.writeFile(outputPath);
    console.log(`Excel file saved: ${outputPath}`);
}

// ============================================================================
// Main
// ============================================================================

function showHelp(): void {
    console.log(HELP_TEXT);
}

async function main(): Promise<void> {
    const {positionals, values} = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        options: {
            output: {
                type: 'string',
                short: 'o',
            },
            help: {
                type: 'boolean',
                short: 'h',
                default: false,
            },
        },
    });

    if (values.help) {
        showHelp();
        process.exit(0);
    }

    const inputPath = positionals[0];
    const outputFile = values.output as string | undefined;

    if (!inputPath) {
        console.error('Error: Missing directory path\n');
        showHelp();
        process.exit(1);
    }

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Path "${inputPath}" does not exist`);
        process.exit(1);
    }

    // Validate output file extension if provided
    if (outputFile) {
        const ext = path.extname(outputFile).toLowerCase();
        if (ext !== '.csv' && ext !== '.xlsx') {
            console.error('Error: Output file must have .csv or .xlsx extension');
            process.exit(1);
        }
    }

    const videoFiles = getVideoFiles(inputPath);
    const videoInfos = videoFiles
        .map((file) => getVideoInfo(file, inputPath))
        .filter((info): info is VideoInfo => info !== null)
        .sort((a, b) => a.filename.localeCompare(b.filename));

    if (outputFile) {
        const ext = path.extname(outputFile).toLowerCase();
        if (ext === '.xlsx') {
            await outputExcel(videoInfos, outputFile);
        } else {
            outputCsvFile(videoInfos, outputFile);
        }
    } else {
        // No output file specified, print CSV to stdout
        outputCsv(videoInfos);
    }
}

main();
