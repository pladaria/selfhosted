# move2jelly

This service moves video files from a source directory to a Jellyfin media library, organizing them based on
metadata fetched from The Movie Database (TMDb) and renaming them according the expected convention for
[movies](https://jellyfin.org/docs/general/server/media/movies/) and
[series or TV Shows](https://jellyfin.org/docs/general/server/media/shows).

# HOWTO run

This tool assumes all your media files are directly in the folder, not in folders. e.g You can copy them like this if needed.

```
find . -mindepth 2 -type f -exec cp -n -t . {} +
```

Also make sure you avoid colons in titles as Jellyfin might not like them
```
find . -depth -type d -name '*:*' -exec bash -c 'for d; do mv -- "$d" "${d//:/.}"; done' _ {} +
```

```
export TMDB_API_ACCESS_TOKEN=YOUR_TMDB_ACCESS_TOKEN # You can register for free in https://www.themoviedb.org/ and obtain a key from your account
export TMDB_LANG=es-ES # Or the one you want

bun run src/index.ts --help
```

There might be titles where the tmdbid, those will be skipped with a warning so that you can review and proceed manually.
