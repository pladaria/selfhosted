import * as fs from 'fs';
import * as path from 'path';
import {spawnSync} from 'child_process';

const FRAMES_TO_EXTRACT = 100;
const FRAME_TO_ANALYZE = 99;

// Recursively find .mkv files with "Dolby Vision" in the name
function findDolbyVisionMKVs(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(findDolbyVisionMKVs(fullPath));
        } else if (file.toLowerCase().endsWith('.mkv') && file.toLowerCase().includes('dolby vision')) {
            results.push(fullPath);
        }
    }
    return results;
}

// Get Level5 offsets from MKV file by extracting RPU and analyzing frame 99
function getLevel5OffsetsFromMKV(filePath: string): string | null {
    const hevcPath = '/tmp/tmp.hevc';
    const rpuPath = '/tmp/tmp.rpu';

    // 1. Extract first FRAMES_TO_EXTRACT frames of HEVC stream from MKV
    const ffmpegCmd = [
        'ffmpeg',
        '-y',
        '-i',
        filePath,
        '-c:v',
        'copy',
        '-an',
        '-bsf:v',
        'hevc_mp4toannexb',
        '-frames:v',
        FRAMES_TO_EXTRACT.toString(),
        '-f',
        'hevc',
        hevcPath,
    ];
    // console.log(`Executing: ${ffmpegCmd.join(' ')}`);
    let result = spawnSync(ffmpegCmd[0], ffmpegCmd.slice(1), {encoding: 'utf-8'});

    if (result.error || result.status !== 0) {
        console.error(`Error extracting HEVC for ${filePath}:`, result.error || result.stderr);
        return null;
    }

    // 2. Extract first FRAMES_TO_EXTRACT frames of RPU from HEVC
    const extractCmd = [
        'dovi_tool',
        'extract-rpu',
        '-i',
        hevcPath,
        '-o',
        rpuPath,
        '-l',
        FRAMES_TO_EXTRACT.toString(),
    ];
    // console.log(`Executing: ${extractCmd.join(' ')}`);
    result = spawnSync(extractCmd[0], extractCmd.slice(1), {encoding: 'utf-8'});

    if (result.error || result.status !== 0) {
        console.error(`Error extracting RPU for ${filePath}:`, result.error || result.stderr);
        return null;
    }

    // 3. Get summary info for the RPU file (analyze FRAME_TO_ANALYZE)
    const infoCmd = ['dovi_tool', 'info', '-i', rpuPath, '-f', FRAME_TO_ANALYZE.toString(), '-s'];
    // console.log(`Executing: ${infoCmd.join(' ')}`);
    result = spawnSync(infoCmd[0], infoCmd.slice(1), {encoding: 'utf-8'});

    if (result.error || result.status !== 0) {
        console.error(`Error running dovi_tool info for ${filePath}:`, result.error || result.stderr);
        return null;
    }

    // 4. Extract the line starting with "L5 offsets"
    const l5Line = result.stdout.split('\n').find((line) => line.trim().startsWith('L5 offsets:'));
    if (l5Line) {
        return l5Line.trim();
    }
    return null;
}

// Main
function main() {
    const dir = process.argv[2];
    if (!dir) {
        console.error('Usage: node index.js <directory>');
        process.exit(1);
    }

    const files = findDolbyVisionMKVs(dir);
    if (files.length === 0) {
        console.log('No Dolby Vision MKV files found.');
        return;
    }

    for (const file of files) {
        const offsets = getLevel5OffsetsFromMKV(file);
        // Only print if offsets exist and are not all zero or N/A
        if (
            offsets &&
            offsets !== 'L5 offsets: top=0, bottom=0, left=0, right=0' &&
            offsets !== 'L5 offsets: top=N/A, bottom=N/A, left=N/A, right=N/A'
        ) {
            console.log(`File: ${path.basename(file)}`);
            console.log(`Offsets: ${offsets}`);
            console.log('');
        }
    }
}

main();
