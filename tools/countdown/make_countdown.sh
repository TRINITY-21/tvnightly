#!/usr/bin/env bash
# =============================================================================
# TV Nightly — "Top 10 Poster Countdown" short builder  (free, local, ffmpeg)
# Reproduces the reference flow: blurred same-poster fill (no black bars) +
# sharp poster + ghost rank number + color title + brand watermark, a slow
# Ken Burns push per card, HARD CUTS on a beat grid, ONE whip/blur accent at
# the intro->first-card seam, climax hold on #1, then a muxed music bed.
#
# USAGE:  bash make_countdown.sh
#   needs: ffmpeg, awk; a cards.tsv; a posters/ dir; a music file.
#   cards.tsv  (TAB-separated, ONE LINE PER PICK, in countdown order 10..1):
#       rank <TAB> title <TAB> accentHex(optional) <TAB> posterPath(optional)
#   If posterPath is blank, looks for posters/<rank>.{jpg,jpeg,png,webp}.
#   If accentHex is blank, uses $ACCENT (brand color).
# =============================================================================
set -euo pipefail

# ----------------------------- CONFIG ----------------------------------------
W=1080; H=1920; FPS=30          # 9:16 vertical, 30fps (matches the reference)
CARD=3.20                        # seconds per card (reference cadence ~3.17s)
CLIMAX_HOLD=1.35                 # last card (#1) held this x longer (the reveal)
WHIP=0.20                        # whip/blur transition length, intro->first card
ZOOM=0.0012; ZMAX=1.14           # Ken Burns push speed / max zoom
ACCENT="0x39d98a"                # default title accent (TV Nightly green)
BRAND="TV NIGHTLY"               # persistent lower-third watermark
INTRO=1                          # 1 = render an intro title card, 0 = skip
INTRO_LINE1="TOP 10 MOVIES"
INTRO_LINE2="YOU MUST WATCH"
MUSIC="music.mp3"                # soundtrack (muxed; export is otherwise silent)
FONT="font.ttf"                  # auto-copied from Impact if missing; drop your own
POSTERS_DIR="posters"
CARDS="cards.tsv"
OUT="out/countdown.mp4"
ENCODER="libx264"; CRF=18; PRESET="medium"   # swap ENCODER=h264_videotoolbox for speed
# -----------------------------------------------------------------------------

cd "$(dirname "$0")"
mkdir -p out work
[[ -f "$FONT" ]] || cp /System/Library/Fonts/Supplemental/Impact.ttf "$FONT"
S="${W}x${H}"
FGW=$(awk "BEGIN{printf \"%d\", $W*0.92}")
FGH=$(awk "BEGIN{printf \"%d\", $H*0.86}")
frames(){ awk "BEGIN{printf \"%d\", $1*$FPS}"; }   # seconds -> frame count

esc(){ printf '%s' "$1" | sed "s/'/\\\\\\\\'/g; s/:/\\\\:/g"; }  # escape drawtext text

find_poster(){ local r="$1" e
  for e in jpg jpeg png webp JPG JPEG PNG WEBP; do
    [[ -f "$POSTERS_DIR/$r.$e" ]] && { printf '%s' "$POSTERS_DIR/$r.$e"; return; }
  done; printf ''; }

# ---- build ONE finished still card: $1 rank  $2 title  $3 accent  $4 poster  $5 out.png
build_card(){
  local R="$1" T="$2" A="$3" P="$4" O="$5"
  local TT; TT="$(esc "$R. $T")"
  local BR; BR="$(esc "$BRAND")"
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$P" -frames:v 1 -filter_complex "
    [0:v]split=2[bg0][fg0];
    [bg0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},
         gblur=sigma=38,eq=brightness=-0.10:saturation=1.12,vignette=PI/4.5[bg];
    [bg]drawtext=text='${R}':fontfile=${FONT}:fontcolor=white@0.18:fontsize=1100:
        x=(w-text_w)/2:y=(h-text_h)/2-30[bgn];
    [fg0]scale=${FGW}:${FGH}:force_original_aspect_ratio=decrease[fg];
    [bgn][fg]overlay=(W-w)/2:(H-h)/2[c];
    [c]drawtext=text='${TT}':fontfile=${FONT}:fontcolor=${A}:fontsize=76:
       box=1:boxcolor=black@0.34:boxborderw=24:
       shadowcolor=black@0.85:shadowx=2:shadowy=3:x=(w-text_w)/2:y=h*0.785,
       drawtext=text='${BR}':fontfile=${FONT}:fontcolor=white@0.92:fontsize=34:
       shadowcolor=black@0.6:shadowx=1:shadowy=1:x=(w-text_w)/2:y=h*0.885
  " "$O"
}

# ---- Ken Burns clip from a still: $1 card.png  $2 out.mp4  $3 dir(in|out)  $4 seconds
make_clip(){
  local IMG="$1" OUT="$2" DIR="$3" SEC="$4" NF Z
  NF=$(frames "$SEC")
  if [[ "$DIR" == "out" ]]; then Z="max(${ZMAX}-${ZOOM}*on,1.0)"; else Z="min(1.0+${ZOOM}*on,${ZMAX})"; fi
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$IMG" -t "$SEC" -filter_complex \
    "scale=2160:-2,zoompan=z='${Z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${S},fps=${FPS}" \
    -frames:v "$NF" -pix_fmt yuv420p -c:v "$ENCODER" -crf "$CRF" -preset "$PRESET" "$OUT"
}

# ---- read cards.tsv ----
ranks=(); titles=(); accents=(); posters=()
while IFS=$'\t' read -r rank title accent poster || [[ -n "${rank:-}" ]]; do
  [[ -z "${rank:-}" ]] && continue
  [[ "$rank" == \#* ]] && continue
  ranks+=("$rank"); titles+=("$title")
  accents+=("${accent:-}"); posters+=("${poster:-}")
done < "$CARDS"
N=${#ranks[@]}
[[ $N -gt 0 ]] || { echo "no cards in $CARDS"; exit 1; }
echo "→ $N cards"

# ---- build per-card clips ----
clips=()
for ((i=0; i<N; i++)); do
  R="${ranks[$i]}"; T="${titles[$i]}"
  A="${accents[$i]}"; [[ -z "$A" ]] && A="$ACCENT"
  P="${posters[$i]}"; [[ -z "$P" ]] && P="$(find_poster "$R")"
  [[ -n "$P" && -f "$P" ]] || { echo "  ! no poster for rank $R (expected posters/$R.jpg or a 4th column)"; exit 1; }
  SEC="$CARD"; [[ $i -eq $((N-1)) ]] && SEC=$(awk "BEGIN{printf \"%.3f\", $CARD*$CLIMAX_HOLD}")  # hold #1
  DIR="in"; (( i % 2 == 1 )) && DIR="out"                                                       # alternate push
  echo "  • #$R  $T"
  build_card "$R" "$T" "$A" "$P" "work/card_$i.png"
  make_clip "work/card_$i.png" "work/clip_$i.mp4" "$DIR" "$SEC"
  clips+=("work/clip_$i.mp4")
done

# ---- intro + whip onto the first card ----
seg0="${clips[0]}"
if [[ "$INTRO" == "1" ]]; then
  P0="${posters[0]}"; [[ -z "$P0" ]] && P0="$(find_poster "${ranks[0]}")"
  L1="$(esc "$INTRO_LINE1")"; L2="$(esc "$INTRO_LINE2")"
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$P0" -t "$CARD" -filter_complex \
    "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=46,eq=brightness=-0.30:saturation=1.05,vignette=PI/5,
     zoompan=z='min(1.0+0.0010*on,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${S},fps=${FPS},
     drawtext=text='${L1}':fontfile=${FONT}:fontcolor=white:fontsize=96:shadowcolor=black@0.7:shadowx=2:shadowy=3:x=(w-text_w)/2:y=h*0.40,
     drawtext=text='${L2}':fontfile=${FONT}:fontcolor=${ACCENT}:fontsize=96:shadowcolor=black@0.7:shadowx=2:shadowy=3:x=(w-text_w)/2:y=h*0.40+115" \
    -frames:v "$(frames "$CARD")" -pix_fmt yuv420p -c:v "$ENCODER" -crf "$CRF" -preset "$PRESET" work/intro.mp4
  OFF=$(awk "BEGIN{printf \"%.3f\", $CARD-$WHIP}")
  ffmpeg -hide_banner -loglevel error -y -i work/intro.mp4 -i "${clips[0]}" -filter_complex \
    "[0:v][1:v]xfade=transition=hblur:duration=${WHIP}:offset=${OFF},format=yuv420p[v]" \
    -map "[v]" -c:v "$ENCODER" -crf "$CRF" -preset "$PRESET" work/seg0.mp4
  seg0="work/seg0.mp4"
fi

# ---- concat (hard cuts) ----
: > work/list.txt
echo "file '$(basename "$seg0")'" >> work/list.txt
for ((i=1; i<N; i++)); do echo "file 'clip_$i.mp4'"; done >> work/list.txt
( cd work && ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i list.txt -c copy ../work/body.mp4 )

# ---- mux music (fade out near end) + final encode ----
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 work/body.mp4)
if [[ -f "$MUSIC" ]]; then
  FOUT=$(awk "BEGIN{printf \"%.3f\", $DUR-0.8}")
  ffmpeg -hide_banner -loglevel error -y -i work/body.mp4 -i "$MUSIC" -filter_complex \
    "[1:a]afade=t=in:st=0:d=0.3,afade=t=out:st=${FOUT}:d=0.8[a]" \
    -map 0:v -map "[a]" -shortest -c:v copy -c:a aac -b:a 192k -movflags +faststart "$OUT"
else
  echo "  (no $MUSIC — exporting silent)"
  ffmpeg -hide_banner -loglevel error -y -i work/body.mp4 -c copy -movflags +faststart "$OUT"
fi

DUR_FMT=$(awk "BEGIN{printf \"%.1f\", $DUR}")
echo "✓ done → $OUT  (${DUR_FMT}s, ${S}, ${FPS}fps)"
