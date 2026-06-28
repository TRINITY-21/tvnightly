#!/usr/bin/env bash
# Cinematic grade for a DepthFlow parallax clip — mirrors the TV Nightly studio
# look (subtle teal/orange, film grain, vignette, gentle contrast) on real footage,
# then encodes social-ready H.264. Pure FFmpeg, no deps beyond ffmpeg.
#
#   ./grade.sh in.mp4 out.mp4 [WIDTHxHEIGHT]
#
set -euo pipefail
IN="${1:?usage: grade.sh in.mp4 out.mp4 [WxH]}"
OUT="${2:?usage: grade.sh in.mp4 out.mp4 [WxH]}"
SIZE="${3:-1080x1920}"
W="${SIZE%x*}"; H="${SIZE#*x}"

ffmpeg -y -i "$IN" -vf "
  scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},
  format=yuv444p,
  eq=contrast=1.07:saturation=1.10:gamma=0.98,
  colorbalance=rs=-0.045:bs=0.05:rm=0.02:bm=-0.02:rh=0.05:bh=-0.06,
  curves=preset=medium_contrast,
  vignette=PI/5,
  noise=alls=4:allf=t,
  format=yuv420p
" \
  -c:v libx264 -profile:v high -crf 21 -preset slow -pix_fmt yuv420p \
  -r 30 -movflags +faststart -an \
  "$OUT"

echo "graded → $OUT"
