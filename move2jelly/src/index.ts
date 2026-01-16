import {TMDB, type Movie, type Search} from 'tmdb-ts';
import 'dotenv/config';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import {parseArgs} from 'util';
import * as path from 'path';
import {cyan, gray, red, yellow} from 'kleur/colors';

const LOCALE_DEFAULT = 'en-US';
const EXTENSIONS_DEFAULT = 'mkv,avi,mp4,mov';
const TMDB_LANG = process.env.TMDB_LANG?.split('.')[0]?.replace('_', '-') || LOCALE_DEFAULT;

const logInfo = (msg: string = '') => {
    console.log(cyan(msg));
};

const logError = (msg: string = '') => {
    console.error(red(msg));
};

const logWarning = (msg: string = '') => {
    console.warn(yellow(msg));
};

const logAction = (msg: string = '') => {
    console.log(msg ? gray('> ' + msg) : '');
};

const HELP_MESSAGE = `
Usage: command [options]

Env vars:

* TMDB_API_ACCESS_TOKEN: your TMDB API access token.
* TMDB_LANG: language code for TMDB queries (if not set, fallbacks to: "${LOCALE_DEFAULT}").

Options:
  -i, --incoming             Path to incoming directory (default: current working directory)
  -e, --extensions           Comma-separated list of video file extensions (default: "${EXTENSIONS_DEFAULT}")
  -m, --moviesPath           Path to movies directory (default: same as incoming)
  -s, --seriesPath           Path to series directory (default: same as incoming)
  -l  --link                 Create hard links instead of moving files
  -k  --keepFileEpisode      Keep episode name from file
  -d, --dryRun               Perform a trial run with no changes made
  -h, --help                 Show this help message
`;

if (!process.env.TMDB_API_ACCESS_TOKEN) {
    logError('Error: TMDB_API_ACCESS_TOKEN environment variable is not set.');
    process.exit(1);
}

const tmdb = new TMDB(process.env.TMDB_API_ACCESS_TOKEN);

const {values} = parseArgs({
    args: process.argv,
    options: {
        incoming: {
            type: 'string',
            short: 'i',
            default: process.cwd(),
        },
        extensions: {
            type: 'string',
            short: 'e',
            default: EXTENSIONS_DEFAULT,
        },
        keepFileEpisode: {
            type: 'boolean',
            short: 'k',
            default: false,
        },
        moviesPath: {
            type: 'string',
            short: 'm',
            default: '',
        },
        seriesPath: {
            type: 'string',
            short: 's',
            default: '',
        },
        link: {
            type: 'boolean',
            short: 'l',
            default: false,
        },
        dryRun: {
            type: 'boolean',
            short: 'd',
            default: false,
        },
        help: {
            type: 'boolean',
            short: 'h',
        },
    },
    strict: true,
    allowPositionals: true,
});

const showHelp = () => {
    console.log(HELP_MESSAGE);
};

let seriesData: Record<string, {tmdbid?: string}> = {};
const seriesJsonFile = path.join(values.incoming, 'series.json');
if (fs.existsSync(seriesJsonFile)) {
    seriesData = JSON.parse(fs.readFileSync(seriesJsonFile, 'utf-8'));
}

type ParsedVideo = {
    raw: string;
    clean: string;
    folder: string;
};

const simplify = (str: string): string => {
    let result = str.toLocaleLowerCase();
    // remove accents: á -> a, etc
    result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // remove non-alphanumeric characters
    result = result.replace(/[^a-z0-9]/g, '');
    return result;
};

const sanitizeFilename = (name: string): string => {
    return name
        .replace(/[\/\0]/g, '-') // remove / and null character
        .replace(/:/g, '.'); // remove colon
};

const cleanTitle = (title: string): string => {
    return title
        .replace(/(\.[^.\s]+)$/, '') // remove extension
        .replace(/[._]/g, ' ') // replace dots and underscores with spaces
        .replace(/\[\s*/g, ' [') // normalize spaces around opening brackets
        .replace(/\s*\]/g, '] ') // normalize spaces around closing brackets
        .replace(/\(\s*/g, ' (') // normalize spaces around opening parentheses
        .replace(/\s*\)/g, ') ') // normalize spaces around closing parentheses
        .replace(/\s+/g, ' ') // remove repetitive spaces
        .trim();
};

const parseMovieFilename = async (filename: string): Promise<ParsedVideo | null> => {
    // Decode from Windows-1252 to UTF-8
    const raw = iconv.decode(Buffer.from(filename, 'binary'), 'win1252');

    const extensionMatch = raw.match(/(\.[^.\s]+)$/);
    if (!extensionMatch) {
        logError(`No file extension found in filename: "${filename}"`);
        return null;
    }
    const extension = extensionMatch[0].slice(1);

    let clean = cleanTitle(raw);
    let movies: Array<Movie>;
    let tmdbId: string;
    let rest = '';
    let query = '';
    let yearStr = '';
    const idMatch = clean.match(/\[tmdbid-(\d+)\]/i);
    if (idMatch) {
        tmdbId = idMatch[1]!;
        rest = clean.slice((idMatch.index || 0) + idMatch[0].length).trim();
        logAction(`Get from TMDB by id: ${tmdbId}`);
        const movie = (await tmdb.movies.details(
            parseInt(tmdbId, 10),
            undefined,
            TMDB_LANG
        )) as unknown as Movie;
        movies = movie ? [movie] : [];
    } else {
        // year is a 4-digit number between 1900 and 2099 and is usually in parentheses or brackets
        let yearMatch = clean.match(/[\(\[](19|20)\d{2}[\)\]]/);
        if (!yearMatch) {
            // try with text after parentheses/brackets, for example: (Director name, 2010)
            yearMatch = clean.match(/[\(\[]\D*(19|20)\d{2}[\)\]]/);
        }
        if (!yearMatch) {
            // try without parentheses/brackets
            yearMatch = clean.match(/(19|20)\d{2}/);
        }
        if (!yearMatch) {
            logError(`No year found in filename`);
            logError(`Expected filename format: "Movie Title (year) extra info.ext"`);
            return null;
        }
        yearStr = yearMatch[0].replace(/[^\d]/g, '');
        const year = yearStr ? parseInt(yearStr, 10) : undefined;
        rest = clean.slice((yearMatch.index || 0) + yearMatch[0].length).trim();
        query = clean.slice(0, yearMatch.index).trim();

        logAction(`Search TMDB: ${JSON.stringify({query, year, language: TMDB_LANG})}`);
        const response = await tmdb.search.movies({query, year, language: TMDB_LANG as never});
        movies = response.results;
    }

    // try to narrow down results by exact title match
    if (movies.length > 1) {
        const newMovies = movies.filter((movie) => {
            return simplify(movie.title) === simplify(query) && movie.release_date.startsWith(yearStr);
        });
        if (newMovies.length === 1) {
            movies = newMovies;
        }
        const newMovies2 = newMovies.filter((movie) => {
            return !!movie.overview;
        });
        if (newMovies2.length === 1) {
            movies = newMovies2;
        }
    }

    if (movies.length === 1) {
        const movie = movies[0]!;
        const title = sanitizeFilename(movie.title.replace(/ - /g, '. ')); // to avoid conflicts with the rest part
        const year = movie.release_date.split('-')[0];
        return {
            raw: filename,
            folder: `${title} (${year}) [tmdbid-${movie.id}]`,
            clean: `${title} (${year}) [tmdbid-${movie.id}] - ${sanitizeFilename(rest)}.${extension}`,
        };
    }

    if (movies.length > 1) {
        logError(`Multiple titles found:`);
        logError();
        movies.forEach((movie, index) => {
            const year = movie.release_date.split('-')[0];
            logError(`${index + 1}. ${movie.title} (${year}) [tmdbid-${movie.id}] `);
            logError(`   https://www.themoviedb.org/movie/${movie.id}`);
            logError(`   ${movie.overview?.slice(0, 120) || ''}...`);
            logError();
        });
        logError(`Add "[tmdbid-xxxx]" to the filename to specify the correct movie.`);
        logError();
        return null;
    }

    logError(`No titles found for "${raw}". Skipping.`);
    return null;
};

const getVideosInDirectory = (path: string, extensions: Array<string>): Array<string> => {
    const files = fs
        .readdirSync(path)
        .filter((file) => extensions.includes(file.split('.').pop()?.toLowerCase() || ''));
    return files;
};

const moveVideoToFolder = (video: ParsedVideo, videoFolder: string) => {
    const dry = values.dryRun;

    logAction(`Create folder: "${videoFolder}"`);
    if (!dry) {
        fs.mkdirSync(videoFolder, {recursive: true});
    }
    logAction(`${values.link ? 'Link' : 'Move'} file to: "${path.join(videoFolder, video.clean)}"`);
    if (!dry) {
        if (values.link) {
            fs.linkSync(path.join(values.incoming, video.raw), path.join(videoFolder, video.clean));
        } else {
            fs.renameSync(path.join(values.incoming, video.raw), path.join(videoFolder, video.clean));
        }
    }
};

const moveSubtitles = (video: ParsedVideo, videoFolder: string) => {
    const subtitleExtensions = ['srt', 'sub', 'ass', 'ssa', 'vtt', 'idx', 'smi'];
    const baseRawName = video.raw.replace(/\.[^.\s]+$/, '');
    const baseCleanName = video.clean.replace(/\.[^.\s]+$/, '');

    // Search for subtitle files with or without language code
    const incomingFiles = fs.readdirSync(values.incoming);
    for (const file of incomingFiles) {
        // Check if file starts with the base name
        if (!file.startsWith(baseRawName)) continue;

        // Extract the part after the base name
        const suffix = file.slice(baseRawName.length);

        // Check if it matches subtitle pattern: .ext or .lang.ext or .lang-code.ext
        const subtitleMatch = suffix.match(/^(\.([a-z]{2,3})([_-][a-z]{2,3})?)?\.(\w+)$/i);
        if (!subtitleMatch) continue;

        const extension = subtitleMatch[4]!.toLowerCase();
        if (!subtitleExtensions.includes(extension)) continue;

        const languageCode = subtitleMatch[2] || '';
        const destinationName = languageCode
            ? `${baseCleanName}.${languageCode}.${extension}`
            : `${baseCleanName}.${extension}`;

        logAction(
            `${values.link ? 'Link' : 'Move'} subtitle to: "${path.join(videoFolder, destinationName)}"`
        );
        if (!values.dryRun) {
            const sourcePath = path.join(values.incoming, file);
            const destPath = path.join(videoFolder, destinationName);
            if (values.link) {
                fs.linkSync(sourcePath, destPath);
            } else {
                fs.renameSync(sourcePath, destPath);
            }
        }
    }
};

const processVideoFile = async (video: ParsedVideo) => {
    const videoFolder = path.join(values.moviesPath, video.folder);
    moveVideoToFolder(video, videoFolder);

    // Move subtitle files
    moveSubtitles(video, videoFolder);

    const meta = [
        '.nfo',
        '.trickplay',
        '-backdrop.jpg',
        '-backdrop.webp',
        '-poster.jpg',
        '-poster.webp',
        '-logo.jpg',
        '-logo.png',
        '-logo.webp',
        '-landscape.jpg',
        '-landscape.webp',
    ];
    const baseRawName = video.raw.replace(/\.[^.\s]+$/, '');
    const baseCleanName = video.clean.replace(/\.[^.\s]+$/, '');
    for (const suffix of meta) {
        const metaFilePath = path.join(values.incoming, `${baseRawName}${suffix}`);
        if (fs.existsSync(metaFilePath)) {
            let destinationName = sanitizeFilename(
                suffix === '.nfo'
                    ? 'movie.nfo'
                    : suffix === '.trickplay'
                    ? `${baseCleanName}.trickplay`
                    : suffix.replace('-', '')
            );
            logAction(`Move ${suffix} to: "${path.join(videoFolder, destinationName)}"`);
            if (!values.dryRun) {
                fs.renameSync(metaFilePath, path.join(videoFolder, destinationName));
            }
        }
    }
};

const isEpisodeFile = (filename: string): boolean => {
    const lower = filename.toLowerCase().replace(/_/g, ' ');
    // 01x02, 1x2...
    if (lower.match(/\b\d{1,2}x\d{1,3}\b/)) {
        return true;
    }
    // S01E02, S1E2...
    if (lower.match(/\bs\d{1,2}e\d{1,3}\b/)) {
        return true;
    }
    return false;
};

const parseEpisodeFilename = async (filename: string) => {
    // Decode from Windows-1252 to UTF-8
    let raw = iconv.decode(Buffer.from(filename, 'binary'), 'win1252');

    const idMatch = raw.match(/\[tmdbid-(\d+)\]/i);
    let id: string = '';
    if (idMatch) {
        id = idMatch[1]!;
        logAction(`Found TMDB ID in filename: ${id}`);
        // remove id tag from raw
        raw = raw.slice(0, idMatch.index) + raw.slice((idMatch.index || 0) + idMatch[0].length).trim();
    }

    const extensionMatch = raw.match(/(\.[^.\s]+)$/);
    if (!extensionMatch) {
        logError(`No file extension found in filename: "${filename}"`);
        return null;
    }
    const extension = extensionMatch[0].slice(1);

    const clean = cleanTitle(raw);
    const match = clean.match(/\bS(\d{1,2})E(\d{1,3})\b/i) || clean.match(/\b(\d{1,2})x(\d{1,3})\b/i);
    let season: number;
    let episode: number;
    if (!match) {
        logError(`No season/episode info found in filename`);
        return null;
    }
    season = parseInt(match[1]!, 10);
    episode = parseInt(match[2]!, 10);

    // title is the string before the match
    let title = clean.slice(0, match.index).replace(/[._]/g, ' ').trim();
    let rest = clean.slice((match.index || 0) + match[0].length).trim();

    if (!id) {
        id =
            Object.entries(seriesData).find(([key, value]) => {
                const simpleKey = simplify(key);
                const simpleTitle = simplify(title);
                return simpleKey === simpleTitle && value.tmdbid;
            })?.[1].tmdbid || '';
        if (id) {
            logAction(`Found TMDB ID in series.json: ${id}`);
        }
    }

    // episode name, everything before a '(' or '[' in rest
    const episodeTitle = rest.split(/[\(\[]/)[0]?.trim() || '';
    // if episodeTitle is not empty, remove it from rest
    if (episodeTitle) {
        rest = rest.slice(episodeTitle.length).trim();
    }

    // try to match year between parentheses or brackets in title
    let yearMatch = title.match(/[\(\[](19|20)\d{2}[\)\]]/);
    let year: number | undefined;
    if (yearMatch) {
        const yearStr = yearMatch[0].replace(/[^\d]/g, '');
        year = parseInt(yearStr, 10);
        title = title.slice(0, yearMatch.index).trim();
    }

    let show;
    if (id) {
        logAction(`Get TV show from TMDB by id: ${id}`);
        show = await tmdb.tvShows.details(parseInt(id, 10), undefined, TMDB_LANG);
        if (!show) {
            logError(`TV show with TMDB ID ${id} not found`);
            return null;
        }
    } else {
        logAction(`Search TMDB TV show: ${JSON.stringify({query: title, year, language: TMDB_LANG})}`);
        const response = await tmdb.search.tvShows({
            query: title,
            year,
            language: TMDB_LANG as never,
        });
        if (response.results.length === 0) {
            logError(`No TV show found`);
            return null;
        }
        if (response.results.length > 1) {
            // try to narrow down results by exact title match
            const newResults = response.results.filter((show) => {
                return simplify(show.name) === simplify(title);
            });
            if (newResults.length === 1) {
                response.results = newResults;
            }
        }
        if (response.results.length > 1) {
            logError(`Multiple TV shows found:`);
            logError();
            response.results.forEach((show, index) => {
                const firstAirYear = show.first_air_date ? show.first_air_date.split('-')[0] : 'N/A';
                logError(`${index + 1}. ${show.name} (${firstAirYear}) [tmdbid-${show.id}] `);
                logError(`   https://www.themoviedb.org/tv/${show.id}`);
                logError(`   ${show.overview?.slice(0, 120) || ''}...`);
                logError();
            });
            return null;
        }
        show = response.results[0]!;
    }

    const seasonStr = String(season).padStart(2, '0');
    const episodeStr = String(episode).padStart(2, '0');
    const firstYear = show.first_air_date?.split('-')[0];

    if (!firstYear) {
        logError(`TV show first air date not found`);
        console.log(show);
        return null;
    }

    logAction(
        `Get TV episode details ${JSON.stringify({
            tvShowID: show.id,
            seasonNumber: season,
            episodeNumber: episode,
        })}`
    );
    const episodeInfo = await tmdb.tvEpisode.details(
        {
            tvShowID: show.id,
            seasonNumber: season,
            episodeNumber: episode,
        },
        undefined,
        {language: TMDB_LANG as never}
    );
    if (!episodeInfo) {
        logError(`TV episode not found`);
        return null;
    }

    if (episodeTitle && simplify(episodeInfo.name) !== simplify(episodeTitle)) {
        logWarning(
            `Warning: Episode title from filename ("${episodeTitle}") does not match TMDB title ("${
                episodeInfo.name
            }"). Using title from ${values.keepFileEpisode ? 'file' : 'TMDB'}.`
        );
    }
    const episodeYear = episodeInfo.air_date ? episodeInfo.air_date.split('-')[0] : year || firstYear;
    return {
        folder: `${sanitizeFilename(show.name)} (${firstYear}) [tmdbid-${show.id}]/Season ${seasonStr}`,
        clean: `${sanitizeFilename(
            show.name
        )} (${episodeYear}) S${seasonStr}E${episodeStr} ${sanitizeFilename(
            values.keepFileEpisode ? episodeTitle : episodeInfo.name
        )}${sanitizeFilename(rest ? ' - ' + rest : '')}.${extension}`,
        raw: filename,
    };
};

const processEpisodeFile = async (video: ParsedVideo) => {
    const videoPath = path.join(values.seriesPath, video.folder);
    moveVideoToFolder(video, videoPath);

    // Move subtitle files
    moveSubtitles(video, videoPath);
};

const isFileAlreadyLinked = (file: string): boolean => {
    const filePath = path.join(values.incoming, file);
    try {
        const {nlink, ino} = fs.statSync(filePath);
        // If nlink <= 1, the file has no hard links
        if (nlink <= 1) {
            return false;
        }

        const checkDir = (dir: string): boolean => {
            const entries = fs.readdirSync(dir, {withFileTypes: true});
            for (const entry of entries) {
                const entryPath = path.join(dir, entry.name);
                try {
                    if (fs.statSync(entryPath).ino === ino) {
                        return true;
                    }
                    if (entry.isDirectory() && checkDir(entryPath)) {
                        return true;
                    }
                } catch (error) {
                    // Skip files we can't access
                    continue;
                }
            }
            return false;
        };

        return checkDir(values.moviesPath) || checkDir(values.seriesPath);
    } catch (error) {
        logError(`Error checking if file is linked: ${error}`);
        return false;
    }
};

const main = async () => {
    if (values.help) {
        showHelp();
        process.exit(0);
    }

    // set fallbacks
    values.moviesPath = values.moviesPath || values.incoming;
    values.seriesPath = values.seriesPath || values.incoming;

    if (!values.incoming || !values.extensions || !values.moviesPath || !values.seriesPath) {
        showHelp();
        process.exit(1);
    }

    if (!fs.existsSync(values.moviesPath)) {
        logError(`Movies path does not exist: "${values.moviesPath}"`);
        process.exit(1);
    }
    if (!fs.existsSync(values.seriesPath)) {
        logError(`Series path does not exist: "${values.seriesPath}"`);
        process.exit(1);
    }

    const extensions = values.extensions.split(',').map((s) => s.trim().toLowerCase());
    let videoFiles = getVideosInDirectory(values.incoming, extensions);

    if (values.link) {
        videoFiles = videoFiles.filter((file) => !isFileAlreadyLinked(file));
    }

    if (!videoFiles.length) {
        logAction(
            `No ${values.link ? 'new ' : ''}video files (${extensions.join(', ')}) found in: "${
                values.incoming
            }"`
        );
        process.exit(0);
    }

    for (const file of videoFiles) {
        logInfo(`Processing${values.dryRun ? ' [dry run]' : ''}: "${file}"`);
        if (isEpisodeFile(file)) {
            const parsedEpisode = await parseEpisodeFilename(file);
            if (parsedEpisode) {
                processEpisodeFile(parsedEpisode);
            } else {
                logAction(`Skipping file`);
            }
        } else {
            const parsedFile = await parseMovieFilename(file);
            if (parsedFile) {
                processVideoFile(parsedFile);
            } else {
                logAction(`Skipping file`);
            }
        }
        logAction();
    }
};

main();
