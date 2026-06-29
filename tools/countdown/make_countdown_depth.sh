#!/usr/bin/env bash
# =============================================================================
# TV Nightly — "Top 10 Poster Countdown" v2: DEPTH + BEAT-LOCKED
# Upgrades the basic builder with:
#   • reveals snapped to the music's REAL onsets (detect_beats.py + plan_reveals.py)
#   • DepthFlow 2.5D parallax push per card (cinematic reveal, not flat zoom)
#   • a beat-synced reveal HIT: zoom-punch + white flash + title fade-in on the
#     downbeat, and an end-darken "anticipation" dip into the next reveal
#   • #1 held to the music's loudest moment (climax)
# Free / local: ffmpeg + numpy + the DepthFlow venv (tools/depthflow/.venv).
#
# USAGE:  bash make_countdown_depth.sh        (needs posters/, cards.tsv, music.mp3)
#   Takes a few minutes (DepthFlow runs Depth-Anything once per card).
# =============================================================================
set -euo pipefail

# ----------------------------- CONFIG ----------------------------------------
W=1080; H=1920; FPS=30
INTENSITY=0.9                    # DepthFlow parallax strength (0.3–1.6)
DIP=0.12                         # end darken "anticipation" before next reveal
GRADE="${GRADE:-1}"              # 1 = final film grade + grain pass (cinematic polish)
# per-card variety, cycled by index — a cinematic transition + a depth camera move:
#   transitions: punch whip spin glitch zoomblast colorflash
#   cameras:     dolly-fwd dolly-back zoom-in pan-left pan-right orbit crane drone
TRANS_SEQ=(colorflash whip punch spin whip zoomblast colorflash glitch zoomblast glitch)
CAM_SEQ=(dolly-fwd pan-left zoom-in orbit pan-right crane dolly-back drone zoom-in dolly-fwd)
CAMERA="dolly-fwd"               # fallback depth camera
ACCENT="${ACCENT:-0x39d98a}"; BRAND="${BRAND:-TV NIGHTLY}"
TITLE_Y="h*0.77"                 # title vertical position (bottom third)
NUM_OP=0.72; NUMX=340; NUMY=260  # faint rank number: white opacity + far-right half-off-screen position
LOGO="logo_lockup.png"; LOGOW=440; LX=46; LY=54   # brand lockup overlay, top-left
REUSE=${REUSE:-0}                # 1 = reuse existing work/df_*.mp4 (skip DepthFlow)
INTRO=1; INTRO_LINE1="${INTRO_LINE1:-TOP 10 MOVIES}"; INTRO_LINE2="${INTRO_LINE2:-YOU MUST WATCH}"; INTRO_LINE3="${INTRO_LINE3:-HOW MANY HAVE YOU SEEN?}"
RAMP="${RAMP:-2}"                # last N cards cut at half-bar (speed-ramp into #1)
CTA=1; CTA_SEC=3.0               # append a CTA outro card (gets the music climax)
CTA_REASON="${CTA_REASON:-FULL RANKINGS + WHERE TO STREAM}"   # open-loop reason — resolves only on the site
CTA_URL="${CTA_URL:-tvnightly.com}"                          # the hero domain (button-styled, for recall)
CTA_COMMENT="${CTA_COMMENT:-COMMENT YOUR #1 BELOW}"          # engagement → surfaces the pinned-comment link
MUSIC="music.mp3"; FONT="font.ttf"
POSTERS_DIR="posters"; CARDS="cards.tsv"; OUT="out/countdown_depth.mp4"
DEPTH="${DEPTH:-1}"              # 1 = DepthFlow; 0 = fall back to flat zoompan
DF="../depthflow"                # DepthFlow tool dir (has .venv + render.py)
CRF=18; PRESET="medium"
# -----------------------------------------------------------------------------

cd "$(dirname "$0")"
mkdir -p out work
[[ -f "$FONT" ]] || cp /System/Library/Fonts/Supplemental/Impact.ttf "$FONT"
[[ -f "$LOGO" ]] || ( cd ../.. && node tools/countdown/render_lockup.mjs ) >/dev/null 2>&1 || true
[[ -f "$LOGO" ]] || { echo "need $LOGO (run: node tools/countdown/render_lockup.mjs)"; exit 1; }
[[ -f "$MUSIC" ]] || { echo "need $MUSIC"; exit 1; }
S="${W}x${H}"
FGW=$(awk "BEGIN{printf \"%d\",$W*0.92}"); FGH=$(awk "BEGIN{printf \"%d\",$H*0.86}")
DFPY="$DF/.venv/bin/python"; DFRENDER="$DF/render.py"
esc(){ printf '%s' "$1" | sed "s/'/’/g; s/%/\\\\%/g; s/:/\\\\:/g"; }  # ’ avoids ffmpeg quote-break; escape % and :
# auto-fit any text to the frame: sets FIT_SIZE + FIT_TEXT (esc'd, may hold a real
# newline for a 2-line wrap) + FIT_ML. Args: text maxsize maxwidth minsize wrap(0|1)
fit(){
  local out raw; out="$(python3 fit_text.py "$FONT" "$2" "$3" "$4" "${5:-0}" "$1" 2>/dev/null)"
  if [ -z "$out" ]; then FIT_SIZE="$2"; FIT_TEXT="$(esc "$1")"; FIT_ML=0; return; fi
  FIT_SIZE="$(printf '%s' "$out" | cut -f1)"
  raw="$(printf '%s' "$out" | cut -f2-)"; raw="${raw//\\n/$'\n'}"
  case "$raw" in *$'\n'*) FIT_ML=1 ;; *) FIT_ML=0 ;; esac
  FIT_TEXT="$(esc "$raw")"
}
find_poster(){ local r="$1" e; for e in jpg jpeg png webp JPG JPEG PNG; do
  [[ -f "$POSTERS_DIR/$r.$e" ]] && { printf '%s' "$POSTERS_DIR/$r.$e"; return; }; done; printf ''; }

# ---- no-text composite: blurred same-poster fill + ghost rank + sharp poster
build_comp(){ local R="$1" P="$2" O="$3"
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$P" -frames:v 1 -filter_complex "
    [0:v]split=2[b][f];
    [b]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=38,eq=brightness=-0.10:saturation=1.12,vignette=PI/4.5[bg];
    [bg]drawtext=text='${R}':fontfile=${FONT}:fontcolor=white@0.18:fontsize=1100:x=(w-text_w)/2:y=(h-text_h)/2-30[bgn];
    [f]scale=${FGW}:${FGH}:force_original_aspect_ratio=decrease[fg];
    [bgn][fg]overlay=(W-w)/2:(H-h)/2" "$O"; }

# ---- motion clip from the composite: DepthFlow 2.5D, or flat zoompan fallback
motion(){ local IMG="$1" OUT="$2" SEC="$3" CAM="${4:-$CAMERA}"
  [[ "$REUSE" == "1" && -f "$OUT" ]] && return 0
  if [[ "$DEPTH" == "1" && -x "$DFPY" ]]; then
    "$DFPY" "$DFRENDER" -i "$IMG" -o "$OUT" --camera "$CAM" --seconds "$SEC" \
      --fps "$FPS" --size "$S" --intensity "$INTENSITY" >/dev/null 2>&1
  else
    local NF; NF=$(awk "BEGIN{printf \"%d\",$SEC*$FPS}")
    ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$IMG" -t "$SEC" -filter_complex \
      "scale=2160:-2,zoompan=z='min(1.0+0.0012*on,1.14)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${S},fps=${FPS}" \
      -frames:v "$NF" -pix_fmt yuv420p -c:v libx264 -crf "$CRF" -preset veryfast "$OUT"
  fi; }

# ---- beat-synced reveal: a per-card cinematic transition + title fade-in + end-dip
reveal(){ local IN="$1" OUT="$2" RANK="$3" TITLE="$4" A="$5" D="$6" TR="${7:-punch}"
  local TT HEAD NUM
  TT="$(esc "$TITLE")"; NUM="work/num_${RANK}.png"
  # large FAINT rank number, half-off the right edge — white glyph over a soft dark
  # glow (blurred black copy) so it reads on both bright and dark posters
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=black@0.0:s=1400x1400,format=rgba" -frames:v 1 \
    -vf "drawtext=text='${RANK}':fontfile=${FONT}:fontcolor=black@0.85:fontsize=1080:x=(w-text_w)/2:y=(h-text_h)/2,gblur=sigma=22,drawtext=text='${RANK}':fontfile=${FONT}:fontcolor=white@${NUM_OP}:fontsize=1080:x=(w-text_w)/2:y=(h-text_h)/2" "$NUM"
  # auto-fit the title — wrap long titles to 2 centered lines, shrink if still wide
  fit "$TITLE" 76 980 34 1
  local TFS="$FIT_SIZE" TXT="$FIT_TEXT" TY="${TITLE_Y}"
  [ "${FIT_ML:-0}" = 1 ] && TY="(${TITLE_Y})-$(( TFS / 2 + 6 ))"
  case "$TR" in
    whip)       HEAD="scale=$((W*106/100)):$((H*106/100)),crop=${W}:${H}:x='(iw-${W})/2+220*max(0,1-t/0.12)':y=(ih-${H})/2,avgblur=sizeX=70:sizeY=1:enable='lt(t,0.04)',avgblur=sizeX=34:sizeY=1:enable='between(t,0.04,0.08)',avgblur=sizeX=14:sizeY=1:enable='between(t,0.08,0.12)'," ;;
    spin)       HEAD="rotate=a='PI/20*max(0,1-t/0.18)':c=black,scale=w='${W}*(1+0.18*max(0,1-t/0.18))':h='${H}*(1+0.18*max(0,1-t/0.18))':eval=frame,crop=${W}:${H}," ;;
    glitch)     HEAD="rgbashift=rh=18:bh=-18:enable='lt(t,0.04)',rgbashift=rh=8:bh=-8:enable='between(t,0.04,0.09)',fade=t=in:st=0:d=0.05:color=white," ;;
    zoomblast)  HEAD="scale=w='${W}*(1+0.5*max(0,1-t/0.16))':h='${H}*(1+0.5*max(0,1-t/0.16))':eval=frame,crop=${W}:${H},gblur=sigma=18:enable='lt(t,0.05)',gblur=sigma=8:enable='between(t,0.05,0.10)',fade=t=in:st=0:d=0.05:color=white," ;;
    colorflash) HEAD="scale=w='${W}*(1+0.18*max(0,1-t/0.13))':h='${H}*(1+0.18*max(0,1-t/0.13))':eval=frame,crop=${W}:${H},fade=t=in:st=0:d=0.08:color=${A}," ;;
    epic)       HEAD="scale=w='${W}*(1+0.34*max(0,1-t/0.24))':h='${H}*(1+0.34*max(0,1-t/0.24))':eval=frame,crop=${W}:${H},fade=t=in:st=0:d=0.16:color=white," ;;
    *)          HEAD="scale=w='${W}*(1+0.20*max(0,1-t/0.14))':h='${H}*(1+0.20*max(0,1-t/0.14))':eval=frame,crop=${W}:${H},fade=t=in:st=0:d=0.06:color=white," ;;
  esac
  ffmpeg -hide_banner -loglevel error -y -i "$IN" -i "$LOGO" -i "$NUM" -filter_complex \
    "[1:v]scale=${LOGOW}:-1[lg];[0:v]${HEAD}eq=brightness='-0.20*max(0,(t-(${D}-${DIP}))/${DIP})'[base];[base][2:v]overlay=x=${NUMX}:y=${NUMY}[wn];[wn]drawtext=text='${TXT}':fontfile=${FONT}:fontcolor=${A}:fontsize=${TFS}:text_align=center:line_spacing=6:box=1:boxcolor=black@0.34:boxborderw=22:shadowcolor=black@0.85:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${TY}:alpha='clip(t/0.05,0,1)'[v0];[v0][lg]overlay=${LX}:${LY}[out]" \
    -map "[out]" -r "$FPS" -pix_fmt yuv420p -c:v libx264 -crf "$CRF" -preset "$PRESET" "$OUT"; }

# ---- read cards.tsv ----
ranks=(); titles=(); accents=(); posters=()
while IFS=$'\t' read -r rank title accent poster || [[ -n "${rank:-}" ]]; do
  [[ -z "${rank:-}" || "$rank" == \#* ]] && continue
  ranks+=("$rank"); titles+=("$title"); accents+=("${accent:-}"); posters+=("${poster:-}")
done < "$CARDS"
N=${#ranks[@]}; [[ $N -gt 0 ]] || { echo "no cards"; exit 1; }

# ---- detect beats + plan the reveal grid (locked to real onsets) ----
echo "→ detecting beats…"
python3 detect_beats.py "$MUSIC" work/beats.json >/dev/null
echo "→ planning $N beat-locked reveals…"
PLAN="$(python3 plan_reveals.py work/beats.json "$N" "$RAMP" "$([[ "$CTA" == "1" ]] && echo "$CTA_SEC" || echo 0)")"
INTRO_END=$(printf '%s\n' "$PLAN" | awk -F'\t' '$1=="INTRO"{print $2}')
CTA_DUR=$(printf '%s\n' "$PLAN" | awk -F'\t' '$1=="CTA"{print $3}')
starts=(); durs=()
while IFS=$'\t' read -r idx s d; do [[ "$idx" == "INTRO" || "$idx" == "CTA" ]] && continue
  starts+=("$s"); durs+=("$d"); done <<< "$PLAN"
printf '   intro %ss · reveals:' "$INTRO_END"; printf ' %s' "${starts[@]}"; echo

# ---- per-card: composite -> depth motion -> reveal ----
clips=()
for ((i=0; i<N; i++)); do
  R="${ranks[$i]}"; T="${titles[$i]}"; A="${accents[$i]}"; [[ -z "$A" ]] && A="$ACCENT"
  P="${posters[$i]}"; [[ -z "$P" ]] && P="$(find_poster "$R")"
  [[ -n "$P" && -f "$P" ]] || { echo "  ! no poster for #$R"; exit 1; }
  D="${durs[$i]}"
  TR="${TRANS_SEQ[$((i % ${#TRANS_SEQ[@]}))]}"; CAM="${CAM_SEQ[$((i % ${#CAM_SEQ[@]}))]}"
  [[ $i -eq $((N-1)) ]] && TR="epic"      # the #1 reveal gets the big light-burst
  echo "  • #$R $T  (${D}s)  ${TR} / ${CAM}"
  build_comp "$R" "$P" "work/comp_$i.png"
  motion "work/comp_$i.png" "work/df_$i.mp4" "$D" "$CAM"
  reveal "work/df_$i.mp4" "work/clip_$i.mp4" "$R" "$T" "$A" "$D" "$TR"
  clips+=("work/clip_$i.mp4")
done

# ---- intro: kinetic poster-WALL hook (teases all 10 + engagement copy) ----
if [[ "$INTRO" == "1" ]]; then
  # poster wall: a 3-col grid of every poster (countdown order), darkened
  if command -v magick >/dev/null 2>&1; then
    rm -rf work/wall; mkdir -p work/wall; j=0
    for ((i=0; i<N; i++)); do
      WP="${posters[$i]}"; [[ -z "$WP" ]] && WP="$(find_poster "${ranks[$i]}")"
      magick "$WP" -resize 360x480^ -gravity center -extent 360x480 "work/wall/c$(printf %02d $j).png"; j=$((j+1))
    done
    while (( j % 3 != 0 || j < 12 )); do cp "work/wall/c$(printf %02d $((j % N))).png" "work/wall/c$(printf %02d $j).png"; j=$((j+1)); done
    rows=$(( j / 3 ))
    magick montage work/wall/c*.png -tile 3x${rows} -geometry +0+0 -background black -font "$FONT" work/wall_raw.png
    ffmpeg -hide_banner -loglevel error -y -i work/wall_raw.png -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=3,eq=brightness=-0.15:saturation=1.05,vignette=PI/6" work/wall.png
  else
    WP="${posters[0]}"; [[ -z "$WP" ]] && WP="$(find_poster "${ranks[0]}")"
    ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$WP" -frames:v 1 -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=46,eq=brightness=-0.14,vignette=PI/6" work/wall.png
  fi
  # soft center scrim (gaussian dark band so the title pops over the wall)
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=black:s=${W}x${H}" -frames:v 1 -vf "format=rgba,geq=r='0':g='0':b='0':a='130*exp(-((Y-980)/350)^2)'" work/scrim.png
  # kinetic intro: wall zoom + scrim + line-by-line title pops + logo + end-dip
  fit "$INTRO_LINE1" 108 980 50 0; I1S="$FIT_SIZE"; I1T="$FIT_TEXT"
  fit "$INTRO_LINE2" 108 980 50 0; I2S="$FIT_SIZE"; I2T="$FIT_TEXT"
  fit "$INTRO_LINE3" 52 880 30 0; I3S="$FIT_SIZE"; I3T="$FIT_TEXT"
  UU="$(esc "$CTA_URL")"
  NFI=$(awk "BEGIN{printf \"%d\",$INTRO_END*$FPS}")
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i work/wall.png -i "$LOGO" -i work/scrim.png -t "$INTRO_END" -filter_complex \
    "[1:v]scale=${LOGOW}:-1[lg];[0:v]scale=2160:-2,zoompan=z='min(1.0+0.0009*on,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H},fps=${FPS}[bg];[bg][2:v]overlay=0:0[bgs];[bgs]drawtext=text='${I1T}':fontfile=${FONT}:fontcolor=white:fontsize=${I1S}:text_align=center:line_spacing=6:shadowcolor=black@0.85:shadowx=3:shadowy=4:x=(w-text_w)/2:y='745+30*clip(1-(t-0.30)/0.18\,0\,1)':alpha='clip((t-0.30)/0.18\,0\,1)',drawtext=text='${I2T}':fontfile=${FONT}:fontcolor=0x4dffa0:fontsize=${I2S}:text_align=center:line_spacing=6:shadowcolor=black@0.85:shadowx=3:shadowy=4:x=(w-text_w)/2:y='872+30*clip(1-(t-0.85)/0.18\,0\,1)':alpha='clip((t-0.85)/0.18\,0\,1)',drawtext=text='${I3T}':fontfile=${FONT}:fontcolor=white:fontsize=${I3S}:box=1:boxcolor=0x12a35a@0.9:boxborderw=18:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=(w-text_w)/2:y='1160+26*clip(1-(t-1.90)/0.18\,0\,1)':alpha='clip((t-1.90)/0.18\,0\,1)',drawtext=text='${UU}':fontfile=${FONT}:fontcolor=0x4dffa0:fontsize=46:shadowcolor=black@0.7:shadowx=2:shadowy=2:x=(w-text_w)/2:y=1300:alpha='clip((t-2.40)/0.20\,0\,1)',eq=brightness='-0.22*max(0,(t-(${INTRO_END}-${DIP}))/${DIP})'[v];[v][lg]overlay=${LX}:${LY}[out]" \
    -map "[out]" -frames:v "$NFI" -r "$FPS" -pix_fmt yuv420p -c:v libx264 -crf "$CRF" -preset "$PRESET" work/intro.mp4
fi

# ---- CTA outro: poster-wall + engagement copy, fading out to loop into the intro ----
if [[ "$CTA" == "1" && -n "${CTA_DUR:-}" && -f work/wall.png ]]; then
  fit "$CTA_REASON" 52 940 28 0; RR="$FIT_SIZE"; R="$FIT_TEXT"
  fit "$CTA_URL" 98 840 36 0; UUU="$FIT_SIZE"; U="$FIT_TEXT"
  fit "$CTA_COMMENT" 46 900 26 0; CMM="$FIT_SIZE"; CM="$FIT_TEXT"
  NFC=$(awk "BEGIN{printf \"%d\",$CTA_DUR*$FPS}")
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i work/wall.png -i "$LOGO" -i work/scrim.png -t "$CTA_DUR" -filter_complex \
    "[1:v]scale=${LOGOW}:-1[lg];[0:v]scale=2160:-2,zoompan=z='min(1.0+0.0011*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H},fps=${FPS}[bg];[bg][2:v]overlay=0:0[bgs];[bgs]drawtext=text='${R}':fontfile=${FONT}:fontcolor=white:fontsize=${RR}:text_align=center:line_spacing=6:shadowcolor=black@0.85:shadowx=2:shadowy=3:x=(w-text_w)/2:y='h*0.40+26*clip(1-(t-0.15)/0.16\,0\,1)':alpha='clip((t-0.15)/0.16\,0\,1)*clip((${CTA_DUR}-t)/0.35\,0\,1)',drawtext=text='${U}':fontfile=${FONT}:fontcolor=0x0e0e11:fontsize=${UUU}:box=1:boxcolor=0x39d98a@0.95:boxborderw=28:x=(w-text_w)/2:y='h*0.485+30*clip(1-(t-0.40)/0.16\,0\,1)':alpha='clip((t-0.40)/0.16\,0\,1)*clip((${CTA_DUR}-t)/0.35\,0\,1)',drawtext=text='${CM}':fontfile=${FONT}:fontcolor=white@0.92:fontsize=${CMM}:text_align=center:line_spacing=6:shadowcolor=black@0.7:shadowx=2:shadowy=2:x=(w-text_w)/2:y='h*0.63+26*clip(1-(t-0.72)/0.16\,0\,1)':alpha='clip((t-0.72)/0.16\,0\,1)*clip((${CTA_DUR}-t)/0.35\,0\,1)'[v];[v][lg]overlay=${LX}:${LY}[out]" \
    -map "[out]" -frames:v "$NFC" -r "$FPS" -pix_fmt yuv420p -c:v libx264 -crf "$CRF" -preset "$PRESET" work/cta.mp4
fi

# ---- concat (intro + ALL cards + CTA, hard cuts ON the beat) + mux music ----
: > work/list.txt
[[ "$INTRO" == "1" ]] && echo "file 'intro.mp4'" >> work/list.txt
for ((i=0; i<N; i++)); do echo "file 'clip_$i.mp4'"; done >> work/list.txt
[[ "$CTA" == "1" && -f work/cta.mp4 ]] && echo "file 'cta.mp4'" >> work/list.txt
( cd work && ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i list.txt -c copy body.mp4 )

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 work/body.mp4)
FOUT=$(awk "BEGIN{printf \"%.3f\",$DUR-0.8}")
if [[ "$GRADE" == "1" ]]; then
  GV="eq=contrast=1.06:saturation=1.10:gamma=0.985,colorbalance=rs=-0.03:bs=0.04:rh=0.03:bh=-0.04,curves=preset=medium_contrast,noise=alls=6:allf=t+u"
else GV="null"; fi
ffmpeg -hide_banner -loglevel error -y -i work/body.mp4 -i "$MUSIC" -filter_complex \
  "[0:v]${GV}[v];[1:a]afade=t=in:st=0:d=0.3,afade=t=out:st=${FOUT}:d=0.8[a]" \
  -map "[v]" -map "[a]" -shortest -c:v libx264 -crf "$CRF" -preset "$PRESET" -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "$OUT"
DUR_FMT=$(awk "BEGIN{printf \"%.1f\",$DUR}")
echo "✓ done → $OUT  (${DUR_FMT}s, $S, ${FPS}fps, beat-locked + depth)"
