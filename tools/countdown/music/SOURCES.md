# Shorts music library — free, license-clean cinematic beats

The shorts pipeline auto-picks a **mood track per category** (romance shorts sound
different from horror shorts). Drop one MP3 per mood into **this folder**, named
exactly:

| File | Mood | Used for categories |
|------|------|---------------------|
| `epic.mp3` | Epic / driving | Action, Adventure, War, History, Fantasy, Western, Documentary, all-time & year "best", person, network |
| `dark.mp3` | Tense / dark | Horror, Thriller, Crime, Mystery |
| `romance.mp3` | Emotional / warm | Romance, Drama, Family-ish |
| `upbeat.mp3` | Fun / bright | Comedy, Animation, Reality, "trending this week" |
| `scifi.mp3` | Electronic / synth | Sci-Fi, "most anticipated" |

That's it — once these five files exist, every generated `render_short.sh`
copies the right one automatically (see `src/lib/shorts.ts` → `resolveShortTheme`).
You can still override per-video with the **Music** field in the studio (paste any
`.mp3` URL). If a mood file is missing, the render tells you which one to add.

> **Pick tracks with a clear, steady beat.** The pipeline detects real onsets and
> snaps each poster reveal to them (`detect_beats.py`). A driving 90–140 BPM track
> with obvious downbeats looks far better than ambient pads. ~30–45s is plenty
> (the render trims/fades to length).

---

## Where to get them (commercial-safe, ranked)

### 1. Pixabay Music — best default, **no attribution** ⭐
<https://pixabay.com/music/>
**License:** Pixabay Content License — free for commercial *and* personal use, **no
attribution required**. (You just can't resell/redistribute the audio file itself
as a standalone product or on another stock site — using it as a video soundtrack
is exactly what it's for.) Download the MP3, rename to the mood slot.

Per-mood search links:
- Epic → <https://pixabay.com/music/search/epic%20cinematic/>
- Dark → <https://pixabay.com/music/search/dark%20tension/>
- Romance → <https://pixabay.com/music/search/emotional%20piano/>
- Upbeat → <https://pixabay.com/music/search/upbeat%20fun/>
- Sci-Fi → <https://pixabay.com/music/search/cinematic%20synth/>

### 2. Uppbeat — free tier, **credit required**
<https://uppbeat.io/browse/genre/cinematic>
**License:** Free tier is watermark-free but asks for a short credit in your
description (each track shows the exact credit line). Great cinematic/trailer beats.

### 3. YouTube Audio Library — free, some need credit
<https://studio.youtube.com> → *Audio Library* (needs a YouTube account).
Filter by "Attribution not required" for zero-hassle tracks. Genuinely free to use.

### 4. Incompetech / Kevin MacLeod — reliable, **CC BY 4.0 (attribution)**
<https://incompetech.com/music/royalty-free/music.html>
**License:** CC BY 4.0 — free commercially, but you **must credit**, e.g.:
`Music: "Track Name" by Kevin MacLeod (incompetech.com) — licensed under CC BY 4.0`
Huge, dependable cinematic catalogue; good fallback if Pixabay doesn't have the vibe.

---

## Avoid
- **"NC" (NonCommercial) Creative Commons** tracks (common on Free Music Archive /
  ccMixter) — TV Nightly will run ads, so NC is off-limits. Check each track's
  license before downloading from those sites.
- **Anything from a "free" YouTube-to-MP3 rip** — not licensed, will get your posts
  muted or struck.

## Attribution log
If you use a track that needs credit (Uppbeat / incompetech / some YT Library),
paste the required credit line into the post caption or pinned comment, and note it
here so future-you remembers:

| Mood file | Track + artist | Source | Credit needed? |
|-----------|----------------|--------|----------------|
| epic.mp3 | _(fill in)_ | | |
| dark.mp3 | | | |
| romance.mp3 | | | |
| upbeat.mp3 | | | |
| scifi.mp3 | | | |

*(Pixabay/no-attribution tracks: just write "Pixabay — no credit needed".)*
