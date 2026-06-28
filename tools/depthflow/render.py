#!/usr/bin/env python3
"""
DepthFlow render step — turn a single TV Nightly card PNG into a cinematic 2.5D
parallax MP4 (real depth-based camera move via Depth-Anything V2), then optionally
apply the studio's filmic grade with FFmpeg.

Free / open-source (DepthFlow = AGPL-3.0), self-hostable, runs headless on Apple
Silicon. Preserves the card (text/posters intact) while adding genuine 3D parallax.

  .venv/bin/python render.py -i in.png -o out.mp4 --camera dolly-fwd \
      --seconds 8 --fps 30 --size 1080x1920 --intensity 1.0 --grade

--camera mirrors the studio's Camera Movement vocabulary so we can A/B 1:1.
"""
from __future__ import annotations
import argparse
import math
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CAMERAS = [
    "zoom-in", "zoom-out", "pan-left", "pan-right", "tilt-up", "tilt-down",
    "orbit", "crane", "drone", "fpv", "dolly-fwd", "dolly-back",
    "handheld", "steadicam", "static",
]


def build_scene(camera: str, intensity: float, seconds: float):
    """A DepthScene whose camera is animated per-frame by mapping our studio
    camera vocabulary onto DepthFlow's state (offset / dolly / zoom / isometric)."""
    from depthflow.scene import DepthScene

    class CinemaScene(DepthScene):
        def update(self):
            T = max(0.1, seconds)
            t = (self.time / T) % 1.0          # 0..1 loop progress
            c = 0.5 - 0.5 * math.cos(t * math.tau)  # smooth 0..1..0
            s = self.state
            k = intensity
            # parallax depth strength (the "3D" amount) scales with intensity
            s.height = 0.32 * (0.6 + 0.4 * k)
            ox = oy = 0.0
            s.isometric = 0.0; s.dolly = 0.0; s.zoom = 1.0
            m = camera
            if m in ("dolly-fwd", "fpv"):
                s.dolly = 0.6 * t * k
                if m == "fpv":
                    ox = 0.04 * math.sin(self.time * 3.0) * k
            elif m == "dolly-back":
                s.dolly = 0.6 * (1 - t) * k
            elif m == "zoom-in":
                s.zoom = 1.0 + 0.22 * t * k
            elif m == "zoom-out":
                s.zoom = 1.0 + 0.22 * (1 - t) * k
            elif m == "pan-left":
                ox = -0.30 * (t - 0.5) * 2 * k
            elif m == "pan-right":
                ox = 0.30 * (t - 0.5) * 2 * k
            elif m == "tilt-up":
                oy = 0.26 * (t - 0.5) * 2 * k
            elif m == "tilt-down":
                oy = -0.26 * (t - 0.5) * 2 * k
            elif m == "orbit":
                ox = 0.26 * math.sin(t * math.tau) * k
                oy = 0.12 * math.cos(t * math.tau) * k
                s.isometric = 0.45
            elif m == "crane":
                oy = 0.30 * (0.5 - t) * 2 * k
                s.dolly = 0.25 * t * k
            elif m == "drone":
                s.isometric = 0.5
                ox = 0.22 * math.sin(t * math.tau) * k
                s.dolly = 0.25 * (1 - t) * k
            elif m == "steadicam":
                ox = 0.16 * math.sin(t * math.tau) * k
                oy = 0.08 * math.cos(t * math.tau * 0.5) * k
            elif m == "handheld":
                ox = (0.05 * math.sin(self.time * 5.2) + 0.03 * math.sin(self.time * 11.0)) * k
                oy = (0.04 * math.cos(self.time * 4.4)) * k
                s.isometric = 0.2
            else:  # static — a barely-there breathing push
                s.zoom = 1.0 + 0.05 * c * k
            s.offset = (ox, oy)

    return CinemaScene()


def run(cmd: list[str]) -> None:
    print("· " + " ".join(map(str, cmd)), flush=True)
    subprocess.run(cmd, check=True)


def main() -> int:
    p = argparse.ArgumentParser(description="DepthFlow parallax render for TV Nightly cards")
    p.add_argument("-i", "--input", required=True)
    p.add_argument("-o", "--output", default="out.mp4")
    p.add_argument("--camera", default="dolly-fwd", choices=CAMERAS)
    p.add_argument("--seconds", type=float, default=8.0)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--size", default="1080x1920", help="WxH, e.g. 1080x1920 / 1000x1500 / 1080x1080")
    p.add_argument("--intensity", type=float, default=1.0, help="motion strength (0.3–1.6)")
    p.add_argument("--ssaa", type=float, default=1.5, help="supersampling (sharper edges, slower)")
    p.add_argument("--grade", action="store_true", help="apply the FFmpeg cinematic grade after")
    args = p.parse_args()

    src = Path(args.input)
    if not src.exists():
        print(f"input not found: {src}", file=sys.stderr)
        return 2
    w, h = (int(x) for x in args.size.lower().split("x"))
    raw = Path(args.output).with_suffix(".raw.mp4") if args.grade else Path(args.output)

    scene = build_scene(args.camera, args.intensity, args.seconds)
    scene.input(image=str(src))
    scene.ssaa = args.ssaa
    scene.main(output=str(raw), time=args.seconds, fps=float(args.fps), width=w, height=h)

    if args.grade:
        run(["bash", str(HERE / "grade.sh"), str(raw), str(args.output), args.size])
        raw.unlink(missing_ok=True)

    print(f"\n✓ done → {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
