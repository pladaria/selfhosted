#!/usr/bin/env tsx

import {execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {parseArgs} from 'util';

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

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];

function getVideoFiles(dir: string): string[] {
    const files: string[] = [];

    function walkDir(currentPath: string) {
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

function getVideoInfo(filePath: string, basePath: string): VideoInfo | null {
    try {
        // Use ffprobe to get video information
        const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
        const output = execSync(command, {encoding: 'utf8'});
        const data = JSON.parse(output);

        const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
        if (!videoStream) return null;

        function getChannelLayout(stream: any): string {
            if (stream.channel_layout) {
                if (stream.channel_layout.includes('5.1')) return '5.1';
                if (stream.channel_layout.includes('7.1')) return '7.1';
                if (stream.channel_layout === 'stereo') return '2.0';
                if (stream.channel_layout === 'mono') return '1.0';
                return stream.channel_layout;
            }
            if (stream.channels) {
                switch (stream.channels) {
                    case 1:
                        return '1.0';
                    case 2:
                        return '2.0';
                    case 6:
                        return '5.1';
                    case 8:
                        return '7.1';
                    default:
                        return `${stream.channels}.0`;
                }
            }
            return '';
        }

        const audioStreams = data.streams?.filter((s: any) => s.codec_type === 'audio');
        const audioInfo =
            audioStreams
                ?.map((s: any) => {
                    const codec = (s.codec_name || 'unknown').toUpperCase();
                    const channels = getChannelLayout(s);
                    const title = s.tags?.title || s.tags?.language || `stream ${s.index}`;
                    return `${codec}${channels ? ` ${channels}` : ''} (${title})`;
                })
                .join('; ') || 'none';

        const relativePath = path.relative(basePath, filePath);
        const stats = fs.statSync(filePath);

        // Enhanced HDR detection
        function detectHdrFormat(): string {
            const colorTransfer = videoStream.color_transfer;
            const colorSpace = videoStream.color_space;
            const colorPrimaries = videoStream.color_primaries;
            const sideData = videoStream.side_data_list || [];

            // Check for Dolby Vision (highest priority)
            const hasDolbyVision = sideData.some(
                (sd: any) =>
                    sd.side_data_type === 'DOVI configuration record' ||
                    sd.side_data_type === 'Dolby Vision RPU' ||
                    sd.side_data_type?.includes('DOVI') ||
                    sd.side_data_type?.includes('Dolby')
            );
            if (hasDolbyVision) {
                return 'Dolby Vision';
            }

            // Check for HDR Vivid (CUVA dynamic metadata)
            const hasHdrVivid = sideData.some(
                (sd: any) =>
                    sd.side_data_type === 'HDR dynamic metadata CUVA' ||
                    sd.side_data_type?.includes('CUVA') ||
                    sd.side_data_type?.includes('Vivid')
            );
            if (hasHdrVivid) {
                return 'HDR Vivid';
            }

            // Check for HDR10+ (dynamic metadata)
            const hasHdr10Plus = sideData.some(
                (sd: any) =>
                    sd.side_data_type === 'HDR dynamic metadata SMPTE2094-40 (HDR10+)' ||
                    sd.side_data_type === 'Dynamic HDR10+' ||
                    sd.side_data_type?.includes('SMPTE2094-40')
            );
            if (hasHdr10Plus) {
                return 'HDR10+';
            }

            // Check for HDR10 (PQ transfer function with static metadata)
            if (colorTransfer === 'smpte2084') {
                // Verify it has HDR static metadata
                const hasHdrStaticMetadata = sideData.some(
                    (sd: any) =>
                        sd.side_data_type === 'Mastering display metadata' ||
                        sd.side_data_type === 'Content light level metadata'
                );
                if (hasHdrStaticMetadata || sideData.length === 0) {
                    return 'HDR10';
                }
            }

            // Check for HLG (Hybrid Log-Gamma)
            if (colorTransfer === 'arib-std-b67') {
                return 'HLG';
            }

            // Check for BT.2020 color space (might indicate HDR but without proper metadata)
            if (colorSpace === 'bt2020nc' || colorPrimaries === 'bt2020') {
                return 'BT.2020';
            }

            return 'SDR';
        }

        function getResolutionLabel(width: number): string {
            if (width >= 3800) return '4K';
            if (width >= 1900) return '1080p';
            if (width >= 1260) return '720p';
            if (width >= 840) return '480p';
            return 'SD';
        }

        const codecName = (videoStream.codec_name || '???').toUpperCase();
        const profile = videoStream.profile || 'unknown';

        // Determine bit depth from pix_fmt or bits_per_raw_sample
        let bitDepth = videoStream.bits_per_raw_sample || '8';
        if (videoStream.pix_fmt?.includes('10')) {
            bitDepth = '10';
        } else if (videoStream.pix_fmt?.includes('12')) {
            bitDepth = '12';
        }

        // Calculate FPS safely from r_frame_rate (format: "num/den")
        function calculateFps(frameRate: string): string {
            try {
                const parts = frameRate.split('/');
                if (parts.length === 2) {
                    const num = Number(parts[0]);
                    const den = Number(parts[1]);
                    if (!isNaN(num) && !isNaN(den) && den !== 0) {
                        return (num / den).toFixed(2);
                    }
                }
                return frameRate;
            } catch {
                return 'unknown';
            }
        }

        return {
            relativePath,
            codec: codecName,
            profile: profile,
            bitDepth: `${bitDepth}-bit`,
            hdr: detectHdrFormat(),
            resolution: getResolutionLabel(videoStream.width),
            audio: audioInfo,
            duration: data.format?.duration ? `${Math.round(parseFloat(data.format.duration))}s` : 'unknown',
            bitrate: data.format?.bit_rate
                ? `${Math.round(parseInt(data.format.bit_rate) / 1000)}kbps`
                : 'unknown',
            fps: videoStream.r_frame_rate ? calculateFps(videoStream.r_frame_rate) : 'unknown',
            fileSize: `${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
        };
    } catch (error) {
        console.error(`Error processing ${filePath}: ${error}`, {stream: process.stderr});
        return null;
    }
}

function outputCsv(videoInfos: VideoInfo[]) {
    // CSV header
    console.log('relative_path,codec,profile,bit_depth,hdr,resolution,audio,duration,bitrate,fps,file_size');

    for (const info of videoInfos) {
        // Escape commas and quotes in CSV
        const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;

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

function main() {
    const {positionals} = parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
    });

    const inputPath = positionals[0];

    if (!inputPath) {
        console.error('Usage: bun video-catalog.ts <directory_path>');
        process.exit(1);
    }

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Path "${inputPath}" does not exist`);
        process.exit(1);
    }

    const videoFiles = getVideoFiles(inputPath);
    const videoInfos: VideoInfo[] = [];

    for (const file of videoFiles) {
        const info = getVideoInfo(file, inputPath);
        if (info) {
            videoInfos.push(info);
        }
    }

    // Sort videoInfos by relativePath
    videoInfos.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    outputCsv(videoInfos);
}

main();
