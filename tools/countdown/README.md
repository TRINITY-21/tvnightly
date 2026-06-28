# Poster Countdown — beat-synced "Top 10" short from poster covers (ffmpeg, free, local)

A standalone reproduction of the reference "Top 10 Most Watched Movies" vertical
short, built **only from movie/TV poster covers** (no host figures, no AI people).
Pure `ffmpeg` — free, runs locally on the Mac, no API, no GPU.

This is the **fast prototype** for eyeballing the look/flow before it's ported into
the `/admin/studio` canvas renderer. It mirrors, 1:1, what was measured from the
reference video:

| Reference behavior | How this reproduces it |
|---|---|
| Full-bleed **blurred copy of the same poster** as the background (never black bars) | `scale=…increase,crop` + `gblur` + darken + `vignette` |
| **Sharp poster** fit-to-width, centered on top | second `scale=…decrease` + `overlay` |
| Big **faint rank number** behind the poster | `drawtext '<rank>'` at `white@0.18`, fontsize 1100, drawn *before* the overlay |
| **Color title** `N. Title` + dark scrim for legibility | `drawtext` with per-card accent + `box`/`shadow` |
| Persistent **brand watermark** every frame | `drawtext '<BRAND>'` lower-third |
| Slow **Ken Burns push** per card (alternating in/out) | `zoompan` (2× pre-scale to kill jitter) |
| **Hard cuts on the beat grid** between cards | `concat` demuxer (no dissolves) |
| **One whip / motion-blur** accent at intro→first card | `xfade=transition=hblur` |
| Music **builds to a climax on #1** | longer hold on the last card (`CLIMAX_HOLD`) + audio mux |

Measured reference facts it's tuned to: 9:16, 1080×1920, 30fps, ~3.17s/card,
whip only at the intro seam, hard cuts everywhere else, loudest music on #1.

## Inputs

1. **`posters/`** — your poster covers, named by rank: `posters/10.jpg`, `posters/9.jpg`, … `posters/1.jpg` (`.jpg/.png/.webp` all fine). Use **hi-res** covers — TMDB `…/original/<path>` or TVmaze `original` (the sharp foreground must not be a blurry upscale; the blurred background can be anything).
2. **`cards.tsv`** — one line per pick, in countdown order (10→1): `rank⇥title⇥accentHex(opt)⇥posterPath(opt)`. See the included sample.
3. **`music.mp3`** — the soundtrack (the video export is otherwise silent). Pick/trim a track whose loudest section lands on #1.

## Run

```bash
cd tools/countdown
# drop posters/ + music.mp3 in place, edit cards.tsv, then:
bash make_countdown.sh
# → out/countdown.mp4   (1080×1920, 30fps, H.264 + AAC)
```

First run copies **Impact** to `font.ttf`. For a more modern look, drop your own
heavy TTF as `font.ttf` (free OFL options: **Anton**, **Bebas Neue**, **Montserrat
Black**, **Oswald**) — the script uses it automatically.

## Tuning (top of the script)

`CARD` seconds/card · `CLIMAX_HOLD` how much longer #1 holds · `WHIP` whip length ·
`ZOOM`/`ZMAX` Ken Burns speed/max · `ACCENT` brand title color · `BRAND` watermark ·
`INTRO` / `INTRO_LINE1/2` the opening title card · `ENCODER` (`libx264` quality, or
`h264_videotoolbox` for fast Apple-Silicon hardware encode).

## v2 — depth + beat-locked (`make_countdown_depth.sh`)

The upgrade that fixes the two things the basic builder gets wrong (flat motion,
fixed-timer cuts that drift off the beat):

```bash
bash make_countdown_depth.sh      # → out/countdown_depth.mp4   (takes a few minutes)
```

What it adds:
- **Reveals locked to the music's real onsets.** `detect_beats.py` (numpy + ffmpeg,
  no deps) finds the transients; `plan_reveals.py` snaps each poster reveal to the
  nearest onset ~1 bar apart. Validated: the detected grid matches the reference
  video's cut times to ~27 ms.
- **DepthFlow 2.5D parallax** per card (real depth push, not flat zoom) via
  `tools/depthflow`. Set `DEPTH=0` to fall back to flat zoompan if the venv's absent.
- **A different cinematic transition per card**, cycled so no two adjacent repeat —
  `punch` (zoom + white flash), `whip` (horizontal blur + slide), `spin` (rotational
  settle), `glitch` (RGB chromatic split), `zoomblast` (big punch through blur),
  `colorflash` (flash in the card's accent). Each fires ON the downbeat, with an
  end-darken *anticipation* dip before it — the "before-and-after" that catches the
  eye. Set the order in `TRANS_SEQ`.
- **A different DepthFlow camera per card** (`CAM_SEQ`): push / pull / zoom / pan /
  orbit / crane / drone — so the depth move varies too.
- **Kinetic "poster-wall" hook intro:** instead of one blurred poster, the intro is
  a darkened grid of all 10 posters (slow push-in) so the viewer instantly sees the
  payoff, with a beat-synced line-by-line title that pops in and ends on an
  engagement question (`INTRO_LINE1/2/3`, default "TOP 10 MOVIES / YOU MUST WATCH /
  HOW MANY HAVE YOU SEEN?"). Builds the wall with ImageMagick `montage` (falls back
  to a single blurred poster if `magick` is absent).
- **Faint rank number, half-off the right edge.** A large semi-transparent rank
  digit bleeds off the far-right as a background design accent — a white glyph over a
  soft dark glow (blurred black copy) so it reads on dark *and* bright posters
  (plain white vanishes on yellow/white). `NUM_OP` opacity, `NUMX`/`NUMY` position. The
  title is just the movie name (the number carries the rank), sits in the **bottom
  third** (`TITLE_Y`), and reveals **on the beat with the poster** (no delay).
- **Speed-ramp finish + epic #1.** The last `RAMP` cards cut at half-bar (snapped to
  real onsets) so the countdown accelerates into #1, which gets a bigger light-burst
  reveal (`epic` transition) and a longer hold. `RAMP` controls how many cards ramp.
- **Website-driving CTA outro + seamless loop** (`CTA=1`): a `CTA_SEC` end card over
  the poster wall that lands on the music climax — an open-loop reason
  (`CTA_REASON`, "FULL RANKINGS + WHERE TO STREAM"), the **domain as a button-styled
  hero** (`CTA_URL`, "tvnightly.com"), and an engagement prompt (`CTA_COMMENT`,
  "COMMENT YOUR #1 BELOW" → surfaces the pinned-comment link). The domain also flashes
  once in the hook (seen twice = recalled; Shorts can't carry clickable links). Text
  fades out to the bare wall, matching the intro so the Short loops on replay.
- **Final film grade + grain** pass (`GRADE=1`): teal/orange filmic contrast +
  subtle grain, unifying everything into a produced look.
- **Real brand lockup** top-left on every card + intro: the TV Nightly standby mark
  + Archivo-Black wordmark + amber dot, rendered to `logo_lockup.png` by
  `render_lockup.mjs` (mirrors `ogBrand()` in `src/lib/social.ts`, uses the bundled
  `public/fonts/archivo-black.ttf`). Auto-regenerated if missing. Position/size:
  `LOGO`, `LOGOW`, `LX`, `LY`.
- Tunables: `TRANS_SEQ`, `CAM_SEQ`, `INTENSITY`, `DIP`, `GRADE`, `RAMP`, `CTA`,
  `CTA_SEC`, `CTA_REASON`/`CTA_URL`/`CTA_COMMENT`, `TITLE_Y` (title vertical position — `h*0.77` = bottom
  third; `(h-text_h)/2` centers it), `NUM_OP`/`NUMX`/`NUMY` (faint rank number).

Beat detection note: librosa is unusable here (numba's JIT is broken on the system
Python), so `detect_beats.py` is a dependency-free spectral-flux onset detector —
more portable anyway.

## Optional: tune the beat grid

`detect_beats.py music.mp3 out.json` prints tempo, onsets, and how well they line up
with the reference cuts. `plan_reveals.py out.json <ncards>` prints the reveal grid.
Edit `bar` / intro logic in `plan_reveals.py` to change the cadence (e.g. 8-beat holds).

## Notes / faithfulness

- The whip uses `xfade=transition=hblur` (ffmpeg ≥ 7). Verify with
  `ffmpeg -h filter=xfade | grep hblur`; if absent, swap to `slideleft` or `fade`.
- Poster→poster transitions are **hard cuts on purpose** — do not add crossfades
  (the reference doesn't). The whip is reserved for the single intro→#10 seam.
- `zoompan` on a still shimmers without the `scale=2160:-2` pre-upscale — keep it.
- Founder rule honored: no decorative gradient edge-accents; the card edge is just
  the sharp poster meeting its own blur.

## Next step

Port this flow into `public/js/studio.js` as a **Countdown** sequencer (the card
composite, Ken Burns, and motion-blur primitives already exist there — see
`tools/depthflow/README.md` and the studio audit) so it runs in-browser from live
TMDB/TVmaze data, with this script kept as the offline/batch path.
