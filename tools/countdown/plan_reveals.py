#!/usr/bin/env python3
# Turn detected onsets into a beat-locked reveal grid: intro + N cards, each
# reveal snapped to the nearest real onset. Optional speed-ramp (last K cards at
# half-bar) and a reserved CTA tail. Prints TSV the builder reads.
#   plan_reveals.py beats.json NCARDS [RAMP] [CTA_SECONDS]
import json, sys
d = json.load(open(sys.argv[1])); ncards = int(sys.argv[2])
ramp = int(sys.argv[3]) if len(sys.argv) > 3 else 0       # last K cards cut at half-bar
cta  = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0   # seconds reserved for CTA outro
onsets = d["onsets"]; beat = d["beat"]; dur = d["duration"]
bar = 4 * beat                                            # one bar = 4 beats

def nearest(t, win=0.5):
    c = [o for o in onsets if abs(o - t) <= win]
    return min(c, key=lambda o: abs(o - t)) if c else t

intro_end = next((o for o in onsets if o >= bar * 1.1), bar)
reveals = [round(intro_end, 3)]
for k in range(1, ncards):
    step = bar / 2 if k >= ncards - ramp else bar        # accelerate the last `ramp` cards
    nxt = nearest(reveals[-1] + step)
    if nxt <= reveals[-1] + step * 0.5:                  # snap failed/too close -> exact step
        nxt = reveals[-1] + step
    reveals.append(round(nxt, 3))

end = max(reveals[-1] + 0.8, dur - cta)                  # last card holds until the CTA starts
bounds = reveals + [end]
print(f"INTRO\t{intro_end:.3f}")
for i in range(ncards):
    print(f"{i}\t{reveals[i]:.3f}\t{bounds[i+1] - reveals[i]:.3f}")
if cta > 0:
    print(f"CTA\t{end:.3f}\t{dur - end:.3f}")
