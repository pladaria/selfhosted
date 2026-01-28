#!/usr/bin/env bun

import {mkdtemp, rm} from 'node:fs/promises';
import {join, dirname, basename, extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

function showHelp() {
    console.log(`
Usage: bun crop-dolby-vision-mkv.ts [OPTIONS] <input.mkv>

Crop Dolby Vision active layer from MKV video files.

Processes HEVC-encoded MKV files with Dolby Vision metadata, removes
letterbox bars by setting active area offsets to 0, and creates a new
MKV file with the cropped video stream while preserving all other
streams (audio, subtitles, chapters, attachments).

Arguments:
  <input.mkv>    Path to input MKV file with Dolby Vision

Options:
  -h, --help     Show this help message and exit

Output:
  Creates <input>-cropped.mkv in the same directory as the input file.

Requirements:
  - ffprobe: Check video codec
  - mkvextract: Extract video stream from MKV
  - dovi_tool: Process Dolby Vision metadata
  - mkvmerge: Create output MKV file
`);
}

async function main() {
    const inputFile = process.argv[2];

    if (!inputFile || inputFile === '-h' || inputFile === '--help') {
        showHelp();
        process.exit(inputFile ? 0 : 1);
    }

    // Check if input file exists
    const file = Bun.file(inputFile);
    if (!(await file.exists())) {
        console.error(`Error: File not found: ${inputFile}`);
        process.exit(1);
    }

    console.log(`Processing: ${inputFile}`);

    // Check if video is HEVC
    console.log('Checking video codec...');
    const probeResult = spawnSync(
        'ffprobe',
        [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=codec_name',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            inputFile,
        ],
        {encoding: 'utf-8'}
    );

    if (probeResult.error) {
        throw new Error(`ffprobe failed: ${probeResult.error.message}`);
    }

    const codec = probeResult.stdout.trim();
    console.log(`Video codec: ${codec}`);

    if (codec !== 'hevc') {
        console.log('Video is not HEVC, skipping...');
        process.exit(0);
    }

    // Create temporary directory
    const tempDir = await mkdtemp(join(tmpdir(), 'dolby-vision-crop-'));
    console.log(`Using temporary directory: ${tempDir}`);

    try {
        // Extract video stream using mkvextract
        const extractedStream = join(tempDir, 'video.hevc');
        console.log('Extracting video stream...');
        const extractResult = spawnSync('mkvextract', ['tracks', inputFile, `0:${extractedStream}`], {
            encoding: 'utf-8',
        });

        if (extractResult.status !== 0) {
            throw new Error(`mkvextract failed: ${extractResult.stderr}`);
        }

        // Crop Dolby Vision using dovi_tool
        const croppedStream = join(tempDir, 'video-cropped.hevc');
        console.log('Cropping Dolby Vision active layer...');
        const doviResult = spawnSync(
            'dovi_tool',
            ['-c', 'convert', '-i', extractedStream, '-o', croppedStream],
            {
                encoding: 'utf-8',
            }
        );

        if (doviResult.status !== 0) {
            throw new Error(`dovi_tool failed: ${doviResult.stderr}`);
        }

        // Create output filename
        const inputDir = dirname(inputFile);
        const inputBasename = basename(inputFile, extname(inputFile));
        const outputFile = join(inputDir, `${inputBasename}-cropped.mkv`);

        // Replace video stream in MKV using mkvmerge
        console.log('Creating output MKV with cropped video...');
        const muxResult = spawnSync(
            'mkvmerge',
            [
                '-o',
                outputFile,
                '--no-video', // Exclude original video
                inputFile,
                '--language',
                '0:und', // Set language for new video track
                croppedStream,
            ],
            {encoding: 'utf-8'}
        );

        if (muxResult.status !== 0) {
            throw new Error(`mkvmerge failed: ${muxResult.stderr}`);
        }

        console.log(`✓ Successfully created: ${outputFile}`);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    } finally {
        // Clean up temporary directory
        console.log('Cleaning up temporary files...');
        await rm(tempDir, {recursive: true, force: true});
    }
}

main();
