# DepthFlow render step — cinematic 2.5D parallax from a card PNG

A free / open-source, **self-hosted** alternative to the in-browser canvas renderer.
It estimates a depth map (Depth-Anything V2) and ray-marches a real 3D camera
through the still — genuine parallax depth, not flat Ken Burns. The card's text and
posters stay intact (no diffusion hallucination), then we apply the studio's filmic
grade with FFmpeg.

**Proven on this Mac (Apple M1 Pro), fully headless:** 1080×1920 renders at
~1.3–2.6× realtime (e.g. a 6 s clip in ~3 s of GPU time). The Depth-Anything model
downloads once (~first run), then is cached. Graded 8 s clip ≈ 3 MB.

## Install (one time)

Uses an isolated `uv` venv. **Use Homebrew's Python 3.12**, not Anaconda — Anaconda
forces a slow source-build of `imgui-bundle`; Homebrew pulls a prebuilt wheel.

```bash
cd tools/depthflow
uv venv --python /opt/homebrew/bin/python3.12 .venv
uv pip install --python .venv/bin/python depthflow
```

## Usage

```bash
# dolly-in, 8s, 9:16, with the studio grade
.venv/bin/python render.py -i your-card.png -o out.mp4 \
    --camera dolly-fwd --seconds 8 --fps 30 --size 1080x1920 --intensity 1.0 --grade
```

`--camera` mirrors the studio's Camera Movement vocabulary (1:1 A/B with the canvas):

```
zoom-in  zoom-out  pan-left  pan-right  tilt-up  tilt-down  orbit
crane  drone  fpv  dolly-fwd  dolly-back  handheld  steadicam  static
```

Other flags: `--size` (1080x1920 · 1000x1500 · 1080x1080 …), `--intensity` 0.3–1.6
(parallax depth + motion), `--ssaa` (edge sharpness), `--grade` (apply `grade.sh`).

`grade.sh` is standalone too: `./grade.sh raw.mp4 graded.mp4 1080x1920`.

## When to use what

- **DepthFlow (this):** best for the **branded cards** — keeps text/posters crisp,
  light enough to run on the Mac, scriptable. The everyday cinematic upgrade.
- **Generative I2V (Wan 2.2, Apache-2.0):** true motion (clouds/fire/people moving).
  Needs an NVIDIA GPU (~12 GB VRAM). Apply to **background art only**, then composite
  the card text on top. A later add-on once there's a GPU box.

The card design is unchanged — these treat the *video*. Depth assigns the baked-in
text a shallow depth so it rides along gently; for zero text movement, parallax the
backdrop/poster art and composite text afterward.

## Integration path

These are GPU/Python tools — they can't run inside Cloudflare Workers. Run this as a
small **headless render worker** (a FastAPI/CLI service or a queue consumer) that the
Worker calls; store the MP4 in **R2**. Keep the canvas renderer as the instant
in-browser preview; use DepthFlow for the final high-quality export.

## Licenses

- **DepthFlow — AGPL-3.0.** Using it as an unmodified render backend is fine
  commercially; the MP4s are yours. AGPL only obliges source disclosure if you
  **fork/modify DepthFlow itself** and expose that modified version as a network service.
- **Depth-Anything V2 — Apache-2.0** (the Small/Base weights). FFmpeg — LGPL/GPL.
