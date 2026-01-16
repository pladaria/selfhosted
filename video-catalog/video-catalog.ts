#!/usr/bin/env tsx

import {execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {parseArgs} from 'util';

interface VideoInfo {
    relativePath: string;
    codec: string;
    profile: string;
    bitDepth: string;
    hdr: string; // Changed from boolean to string
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

            // Check for HDR10+ (dynamic metadata)
            if (
                videoStream.side_data_list?.some(
                    (sd: any) =>
                        sd.side_data_type === 'HDR dynamic metadata SMPTE2094-40 (HDR10+)' ||
                        sd.side_data_type === 'Dynamic HDR10+'
                )
            ) {
                return 'HDR10+';
            }

            // Check for Dolby Vision
            if (
                videoStream.side_data_list?.some(
                    (sd: any) =>
                        sd.side_data_type === 'DOVI configuration record' ||
                        sd.side_data_type === 'Dolby Vision RPU'
                )
            ) {
                return 'Dolby Vision';
            }

            // Check for HDR10 (PQ transfer function)
            if (colorTransfer === 'smpte2084') {
                return 'HDR10';
            }

            // Check for HLG (Hybrid Log-Gamma)
            if (colorTransfer === 'arib-std-b67') {
                return 'HLG';
            }

            // Check for BT.2020 color space (might indicate HDR)
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
        let bitDepth = videoStream.bits_per_raw_sample || '8'; // Default to 8 if not specified
        if (videoStream.pix_fmt?.includes('10')) {
            bitDepth = '10';
        } else if (videoStream.pix_fmt?.includes('12')) {
            bitDepth = '12';
        }

        return {
            relativePath,
            codec: codecName,
            profile: profile,
            bitDepth: `${bitDepth}-bit`,
            hdr: detectHdrFormat(), // Now returns the format string directly
            resolution: getResolutionLabel(videoStream.width),
            audio: audioInfo,
            duration: data.format?.duration ? `${Math.round(parseFloat(data.format.duration))}s` : 'unknown',
            bitrate: data.format?.bit_rate
                ? `${Math.round(parseInt(data.format.bit_rate) / 1000)}kbps`
                : 'unknown',
            fps: videoStream.r_frame_rate ? eval(videoStream.r_frame_rate).toFixed(2) : 'unknown',
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

function outputExcel(videoInfos: VideoInfo[], outputPath: string) {
    // Create a new workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data for the worksheet
    const worksheetData = [
        [
            'Relative Path',
            'Codec',
            'Profile',
            'Bit Depth',
            'HDR',
            'Resolution',
            'Audio',
            'Duration',
            'Bitrate',
            'FPS',
            'File Size',
        ],
        ...videoInfos.map((info) => [
            info.relativePath,
            info.codec,
            info.profile,
            info.bitDepth,
            info.hdr,
            info.resolution,
            info.audio,
            info.duration,
            info.bitrate,
            info.fps,
            info.fileSize,
        ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Auto-size columns
    const colWidths = [];
    for (let i = 0; i < (worksheetData?.[0]?.length || 0); i++) {
        const maxWidth = Math.max(...worksheetData.map((row) => (row[i] || '').toString().length));
        colWidths.push({width: Math.min(maxWidth + 2, 50)});
    }
    worksheet['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Video Catalog');

    // Write the file
    XLSX.writeFile(workbook, outputPath);
    console.error(`Excel file saved to: ${outputPath}`, {stream: process.stderr});
}

function main() {
    const {values, positionals} = parseArgs({
        args: process.argv.slice(2),
        options: {
            excel: {
                type: 'string',
                short: 'x',
            },
        },
        allowPositionals: true,
    });

    const inputPath = positionals[0];
    const outputFormat: 'csv' | 'excel' = values.excel !== undefined ? 'excel' : 'csv';
    const outputPath = values.excel || '';

    if (!inputPath) {
        console.error('Usage: tsx video-catalog.ts <directory_path> [--excel|-x <output_file.xlsx>]');
        console.error('  --excel, -x: Output in Excel format to the specified file.');
        console.error('               If not provided, outputs CSV to stdout.');
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

    if (outputFormat === 'excel') {
        outputExcel(videoInfos, outputPath);
    } else {
        outputCsv(videoInfos);
    }
}

main();
