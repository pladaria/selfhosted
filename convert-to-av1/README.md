# Convert to AV1

## Get latest binaries from ffmpeg

Remove existing ffmpeg if any

```bash
sudo apt-get remove ffmpeg
```

Download latest static build from: https://github.com/BtbN/FFmpeg-Builds/releases

Extract and copy bin files to `/usr/local/bin` or add to `PATH` env var.

## Extract a 2-minute clip from a video starting at the given mark without re-encoding

ffmpeg -ss 00:52:00 -i file:"movie.mkv" \
-t 00:02:00 \
-map 0:v:0 \
-c copy \
sample.mkv

## Pass 1 encoding to AV1 using SVT-AV1 encoder

ffmpeg -i input.mkv \
-map 0:v:0 -an \
-c:v libsvtav1 \
-pix_fmt yuv420p10le \
-b:v 4M \
-pass 1 \
-svtav1-params \
preset=4:film-grain=8:film-grain-denoise=1 \
-f null -

## Pass 2 encoding to AV1 using SVT-AV1 encoder

ffmpeg -i input.mkv \
-map 0:v:0 -map 0:a \
-c:v libsvtav1 \
-pix_fmt yuv420p10le \
-b:v 4M \
-pass 2 \
-svtav1-params \
preset=4:film-grain=8:film-grain-denoise=1 \
-c:a copy \
output.mkv
