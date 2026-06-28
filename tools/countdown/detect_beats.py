#!/usr/bin/env python3
# Dependency-free beat/onset detector: ffmpeg -> PCM -> spectral flux -> peaks + tempo.
import sys, json, subprocess, numpy as np

mp3, out = sys.argv[1], sys.argv[2]
SR = 22050; N = 1024; HOP = 512
raw = subprocess.run(["ffmpeg","-v","error","-i",mp3,"-ac","1","-ar",str(SR),"-f","f32le","-"],
                     capture_output=True).stdout
x = np.frombuffer(raw, dtype=np.float32)
dur = len(x)/SR

# --- spectral flux onset envelope ---
win = np.hanning(N)
nfr = 1 + (len(x)-N)//HOP
mag = np.empty((nfr, N//2+1), dtype=np.float32)
for i in range(nfr):
    fr = x[i*HOP:i*HOP+N]*win
    mag[i] = np.abs(np.fft.rfft(fr))
diff = np.diff(mag, axis=0)
flux = np.maximum(diff, 0).sum(axis=1)            # positive spectral flux
flux = np.concatenate([[0], flux])
flux = flux/(flux.max()+1e-9)
ft = np.arange(nfr)*HOP/SR                         # frame times

# --- adaptive peak pick (local max above moving mean+std) ---
w = 8
onsets, strengths = [], []
for i in range(2, nfr-2):
    lo, hi = max(0,i-15), min(nfr,i+16)
    thr = flux[lo:hi].mean() + 1.0*flux[lo:hi].std()
    if flux[i]>thr and flux[i]>=flux[i-1] and flux[i]>flux[i+1] and flux[i]>0.12:
        if not onsets or ft[i]-onsets[-1] > 0.12:   # 120ms refractory
            onsets.append(float(ft[i])); strengths.append(float(flux[i]))
onsets = np.array(onsets); strengths = np.array(strengths)

# --- tempo via autocorrelation of flux (search 70..180 BPM) ---
ac = np.correlate(flux-flux.mean(), flux-flux.mean(), "full")[nfr-1:]
fps = SR/HOP
lo_lag, hi_lag = int(fps*60/180), int(fps*60/70)
lag = lo_lag + int(np.argmax(ac[lo_lag:hi_lag]))
bpm = 60.0*fps/lag; beat = 60.0/bpm

print(f"DURATION {dur:.2f}s   TEMPO ~{bpm:.1f} BPM   beat≈{beat:.3f}s   {len(onsets)} onsets")
print("ONSETS:", " ".join(f"{t:.2f}" for t in onsets))
strong = onsets[strengths > np.quantile(strengths,0.55)]
print("STRONG onsets:", " ".join(f"{t:.2f}" for t in strong))

ref = [4.57,7.70,10.90,14.07,17.23,20.40,23.57,26.73,29.87,33.00]
print("\nREFERENCE-CUT ALIGNMENT:")
errs=[]
for c in ref:
    j=int(np.argmin(np.abs(onsets-c))); e=onsets[j]-c; errs.append(abs(e))
    print(f"  cut {c:5.2f} -> onset {onsets[j]:5.2f} (Δ{e:+.2f})")
print(f"  mean|Δ|={np.mean(errs):.3f}s")

# loudness envelope (climax)
rms = np.sqrt(np.convolve(x**2, np.ones(SR//10)/(SR//10), "same"))
print(f"LOUDEST ~{np.argmax(rms)/SR:.2f}s")

json.dump({"duration":dur,"bpm":bpm,"beat":beat,
           "onsets":[round(float(t),3) for t in onsets],
           "strengths":[round(float(s),3) for s in strengths],
           "strong":[round(float(t),3) for t in strong],
           "loudest":round(float(np.argmax(rms)/SR),3)}, open(out,"w"))
print("wrote", out)
