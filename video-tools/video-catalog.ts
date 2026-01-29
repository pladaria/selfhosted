#!/usr/bin/env bun

import {execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {parseArgs} from 'util';

// ============================================================================
// Types
// ============================================================================

interface VideoInfo {
    relativePath: string;
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
        const [num, den] = frameRate.split('/').map(Number);
        if (!isNaN(num) && !isNaN(den) && den !== 0) {
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
            relativePath: path.relative(basePath, filePath),
            codec: (videoStream.codec_name || '???').toUpperCase(),
            profile: videoStream.profile || 'unknown',
            bitDepth: `${detectBitDepth(videoStream)}-bit`,
            hdr: detectHdrFormat(videoStream, filePath),
            resolution: getResolutionLabel(videoStream.width || 0),
            audio: analyzeAudioStreams(data.streams),
            duration: data.format?.duration ? `${Math.round(parseFloat(data.format.duration))}s` : 'unknown',
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
// CSV Output
// ============================================================================

function escapeCsv(str: string): string {
    return `"${str.replace(/"/g, '""')}"`;
}

function outputCsv(videoInfos: VideoInfo[]): void {
    console.log('relative_path,codec,profile,bit_depth,hdr,resolution,audio,duration,bitrate,fps,file_size');

    for (const info of videoInfos) {
        console.log(
            [
                escapeCsv(info.relativePath),
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

// ============================================================================
// Main
// ============================================================================

function main(): void {
    const {positionals} = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
    });

    const inputPath = positionals[0];

    if (!inputPath) {
        console.error('Usage: tsx video-catalog2.ts <directory_path>');
        process.exit(1);
    }

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Path "${inputPath}" does not exist`);
        process.exit(1);
    }

    const videoFiles = getVideoFiles(inputPath);
    const videoInfos = videoFiles
        .map((file) => getVideoInfo(file, inputPath))
        .filter((info): info is VideoInfo => info !== null)
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    outputCsv(videoInfos);
}

main();
