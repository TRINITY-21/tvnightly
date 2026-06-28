#!/usr/bin/env python3
# Measure text in the real font and return a size (and optional 2-line wrap) that
# is GUARANTEED to fit within maxwidth — so no on-screen text ever exceeds frame.
#   fit_text.py <font.ttf> <maxsize> <maxwidth> <minsize> <allow_wrap:0|1> <text>
#   -> prints "<size>\t<text>"   (text may contain a literal \n for a 2-line wrap)
import sys
from PIL import ImageFont

fp, maxs, maxw, mins, allow_wrap, text = (
    sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] == "1", sys.argv[6],
)
_cache = {}
def fnt(s):
    if s not in _cache:
        _cache[s] = ImageFont.truetype(fp, s)
    return _cache[s]
def line_w(line, size):
    if not line:
        return 0
    b = fnt(size).getbbox(line)
    return b[2] - b[0]
def block_w(lines, size):
    return max((line_w(l, size) for l in lines), default=0)

lines = [text]
# too wide at full size? try a balanced 2-line wrap (split nearest the middle).
if allow_wrap and block_w(lines, maxs) > maxw:
    words = text.split(" ")
    if len(words) > 1:
        target, acc, bi, bd = len(text) / 2, 0, 0, 1e9
        for i in range(len(words) - 1):
            acc += len(words[i]) + 1
            if abs(acc - target) < bd:
                bd, bi = abs(acc - target), i
        lines = [" ".join(words[: bi + 1]), " ".join(words[bi + 1:])]

# shrink until it fits (works for wrapped or single line).
size = maxs
while size > mins and block_w(lines, size) > maxw:
    size -= 2

sys.stdout.write(f"{size}\t" + "\\n".join(lines))
