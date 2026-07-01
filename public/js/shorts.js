/* TV Nightly — /admin/shorts controller.
   Search → Top 10 angle → curate the ranked 10 → captions → export render_short.sh.
   Vanilla, no deps. State lives here; each stage calls a JSON endpoint. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const api = async (path, opts) => {
    const r = await fetch(path, { credentials: "same-origin", ...opts });
    if (!r.ok) throw new Error(path + " → " + r.status);
    return r.json();
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const app = $(".shorts-app");
  if (!app) return;
  const STAGES = ["search", "angles", "curate", "export"];
  const state = { subject: null, angle: null, entries: [], captions: null };

  // ---- stage navigation -------------------------------------------------
  function setStage(name) {
    const idx = STAGES.indexOf(name);
    $$(".shorts-stage", app).forEach((s) => (s.hidden = s.dataset.stage !== name));
    $$(".shorts-step", app).forEach((s) => {
      const i = STAGES.indexOf(s.dataset.step);
      s.classList.toggle("on", i === idx);
      s.classList.toggle("done", i < idx);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- stage 1: search --------------------------------------------------
  const q = $("#shorts-q");
  const subjectsBox = $("#shorts-subjects");
  const KIND_ICON = { tv: "📺", movie: "🎬", person: "★", genre: "🎭", year: "📅" };

  const runSearch = debounce(async () => {
    const v = q.value.trim();
    if (v.length < 2) { subjectsBox.innerHTML = '<p class="shorts-empty">Start typing to find a subject to rank.</p>'; return; }
    subjectsBox.innerHTML = '<p class="shorts-empty">Searching…</p>';
    try {
      const { subjects } = await api("/admin/shorts/search?q=" + encodeURIComponent(v));
      if (!subjects.length) { subjectsBox.innerHTML = '<p class="shorts-empty">No matches. Try a movie, show, actor, genre or year.</p>'; return; }
      subjectsBox.innerHTML = "";
      subjects.forEach((s) => {
        const row = el("button", "shorts-subject");
        row.type = "button";
        const thumb = s.posterUrl
          ? `<img class="shorts-subject-thumb" src="${esc(s.posterUrl)}" alt="" loading="lazy">`
          : `<span class="shorts-subject-glyph">${KIND_ICON[s.kind] || "🎬"}</span>`;
        row.innerHTML = `${thumb}<span class="shorts-subject-body"><span class="shorts-subject-label">${esc(s.label)}</span><span class="shorts-subject-sub">${esc(s.sublabel || "")}</span></span><span class="shorts-badge">${esc(s.kind)}</span>`;
        row.addEventListener("click", () => pickSubject(s));
        subjectsBox.appendChild(row);
      });
    } catch (e) { subjectsBox.innerHTML = '<p class="shorts-empty">Search failed. Try again.</p>'; }
  }, 280);
  q.addEventListener("input", runSearch);

  const chip = $("#shorts-chip");
  chip.addEventListener("click", () => { setStage("search"); q.focus(); });

  async function pickSubject(s) {
    state.subject = s;
    chip.hidden = false;
    chip.innerHTML = `${s.posterUrl ? `<img src="${esc(s.posterUrl)}" alt="">` : `<span class="shorts-subject-glyph">${KIND_ICON[s.kind] || "🎬"}</span>`}<span>${esc(s.label)}</span><span class="shorts-chip-x">change</span>`;
    const box = $("#shorts-angles");
    box.innerHTML = '<p class="shorts-empty">Loading angles…</p>';
    setStage("angles");
    try {
      const { angles } = await api("/admin/shorts/angles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
      renderAngles(angles);
    } catch (e) { box.innerHTML = '<p class="shorts-empty">Could not build angles.</p>'; }
  }

  // ---- stage 2: angles --------------------------------------------------
  function renderAngles(angles) {
    const box = $("#shorts-angles");
    $("#shorts-angle-count").textContent = angles.length + " idea" + (angles.length === 1 ? "" : "s");
    box.innerHTML = "";
    if (!angles.length) { box.innerHTML = '<p class="shorts-empty">No angles for this subject.</p>'; return; }
    angles.forEach((a) => {
      const card = el("button", "shorts-angle");
      card.type = "button";
      card.innerHTML = `<span class="shorts-angle-kicker">${esc(a.type.replace(/-/g, " "))}</span><span class="shorts-angle-title">${esc(a.title)}</span><span class="shorts-angle-intro">${esc(a.intro.line1)} · ${esc(a.intro.line2)}</span>`;
      card.addEventListener("click", () => pickAngle(a, card));
      box.appendChild(card);
    });
  }

  async function pickAngle(a, card) {
    state.angle = a;
    $$(".shorts-angle", app).forEach((n) => n.classList.toggle("sel", n === card));
    const grid = $("#shorts-grid");
    grid.innerHTML = '<li class="shorts-empty">Ranking the top 10…</li>';
    setStage("curate");
    fillMeta(a);
    try {
      const { entries } = await api("/admin/shorts/rank", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: a.tmdbQuery }) });
      state.entries = (entries || []).slice(0, 10);
      renderGrid();
      renderPreview();
    } catch (e) { grid.innerHTML = '<li class="shorts-empty">Ranking failed.</li>'; }
  }

  // ---- stage 3: curate --------------------------------------------------
  function fillMeta(a) {
    $("#shorts-curate-title").textContent = a.title;
    $("#sf-l1").value = a.intro.line1;
    $("#sf-l2").value = a.intro.line2;
    $("#sf-l3").value = a.intro.line3;
    $("#sf-reason").value = a.ctaReason;
  }
  const renumber = () => state.entries.forEach((e, i) => (e.rank = i + 1));

  function renderGrid() {
    const grid = $("#shorts-grid");
    renumber();
    grid.innerHTML = "";
    if (!state.entries.length) { grid.innerHTML = '<li class="shorts-empty">No results — pick another angle.</li>'; return; }
    state.entries.forEach((e, i) => {
      const li = el("li", "shorts-pick");
      li.draggable = true;
      li.dataset.i = String(i);
      li.innerHTML =
        `<span class="shorts-rank${e.rank === 1 ? " is-one" : ""}">${e.rank}</span>` +
        (e.posterUrl ? `<img class="shorts-pick-poster" src="${esc(e.posterUrl)}" alt="" loading="lazy">` : `<span class="shorts-pick-poster shorts-pick-noposter">no art</span>`) +
        `<span class="shorts-pick-body"><span class="shorts-pick-title">${esc(e.title)}</span>` +
        `<span class="shorts-pick-meta">${e.rating ? `<span class="shorts-star">★ ${e.rating.toFixed(1)}</span>` : ""}${e.subLabel ? `<span class="shorts-pick-sub">${esc(e.subLabel)}</span>` : ""}</span></span>` +
        `<span class="shorts-pick-ctrl">` +
        `<button type="button" class="shorts-ic" data-act="up" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>` +
        `<button type="button" class="shorts-ic" data-act="down" title="Move down" ${i === state.entries.length - 1 ? "disabled" : ""}>↓</button>` +
        `<button type="button" class="shorts-ic shorts-ic--x" data-act="rm" title="Remove">✕</button>` +
        `</span>`;
      li.querySelector('[data-act="up"]').addEventListener("click", () => move(i, -1));
      li.querySelector('[data-act="down"]').addEventListener("click", () => move(i, 1));
      li.querySelector('[data-act="rm"]').addEventListener("click", () => { state.entries.splice(i, 1); renderGrid(); renderPreview(); });
      li.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/plain", String(i)); li.classList.add("drag"); });
      li.addEventListener("dragend", () => li.classList.remove("drag"));
      li.addEventListener("dragover", (ev) => ev.preventDefault());
      li.addEventListener("drop", (ev) => { ev.preventDefault(); const from = Number(ev.dataTransfer.getData("text/plain")); reorder(from, i); });
      grid.appendChild(li);
    });
  }
  function move(i, d) { const j = i + d; if (j < 0 || j >= state.entries.length) return; reorder(i, j); }
  function reorder(from, to) { const [x] = state.entries.splice(from, 1); state.entries.splice(to, 0, x); renderGrid(); renderPreview(); }

  function renderPreview() {
    const p = $("#shorts-preview");
    p.innerHTML = "";
    state.entries.slice(0, 10).forEach((e, i) => {
      const c = el("div", "shorts-prev-card");
      c.innerHTML = `${e.posterUrl ? `<img src="${esc(e.posterUrl)}" alt="">` : ""}<span class="shorts-prev-rank">${i + 1}</span>`;
      p.appendChild(c);
    });
  }

  $("#shorts-to-export").addEventListener("click", () => { setStage("export"); loadCaptions(); summarise(); });

  // ---- project assembly -------------------------------------------------
  function buildProject() {
    const accent = $("#sf-accent").value.trim() || "0x39d98a";
    renumber();
    return {
      subject: state.subject,
      angle: state.angle,
      entries: state.entries.map((e) => ({ ...e, accentHex: accent })),
      accentHex: accent,
      intro: { line1: $("#sf-l1").value, line2: $("#sf-l2").value, line3: $("#sf-l3").value },
      ctaReason: $("#sf-reason").value,
      ctaUrl: $("#sf-url").value.trim() || "tvnightly.com",
      ctaComment: $("#sf-comment").value,
      musicUrl: $("#sf-music").value.trim() || null,
      ramp: $("#sf-ramp").checked ? 2 : 0,
      grade: $("#sf-grade").checked ? 1 : 0,
      depth: $("#sf-depth").checked ? 1 : 0,
    };
  }

  // ---- stage 4: captions + export --------------------------------------
  async function loadCaptions() {
    const a = state.angle;
    try {
      const { captions } = await api("/admin/shorts/captions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: a.title.replace(/^top 10 /i, ""), query: a.query, kind: a.tmdbQuery.kind, ctaUrl: $("#sf-url").value.trim(), angleType: a.type, subjectLabel: state.subject && state.subject.label }),
      });
      state.captions = captions;
      fillCaptions(captions);
    } catch (e) { /* leave blank */ }
  }
  function fillCaptions(cs) {
    if (!cs) return;
    $$("[data-cap]", app).forEach((t) => { t.value = cs[t.dataset.cap] || ""; });
  }
  function summarise() {
    const titles = state.entries.map((e, i) => `${i + 1}. ${e.rawTitle}`).join("  ·  ");
    $("#shorts-summary").innerHTML = `<strong>${esc(state.angle.title)}</strong><br>${esc(titles)}`;
  }
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => { const o = btn.textContent; btn.textContent = "✓ Copied"; btn.classList.add("ok"); setTimeout(() => { btn.textContent = o; btn.classList.remove("ok"); }, 1400); });
  }
  app.addEventListener("click", (ev) => {
    const cp = ev.target.closest("[data-copy]");
    if (cp) { const ta = $(`[data-cap="${cp.dataset.copy}"]`); if (ta) copyText(ta.value, cp); }
  });
  $("#shorts-copy-all").addEventListener("click", (ev) => {
    if (!state.captions) return;
    const all = $$(".shorts-cap", app).map((b) => `=== ${b.querySelector(".shorts-cap-label").textContent} ===\n${b.querySelector("textarea").value}`).join("\n\n");
    copyText(all, ev.target);
  });

  const HELPER = "http://localhost:7788";
  const helperUp = async () => { try { const r = await fetch(HELPER + "/health", { signal: AbortSignal.timeout(900) }); return r.ok; } catch (e) { return false; } };
  const downloadBlob = (blob, name) => { const url = URL.createObjectURL(blob); const a = el("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
  const setRun = (html) => { $("#shorts-runbox").hidden = false; $("#shorts-runcmd").innerHTML = html; };

  $("#shorts-export").addEventListener("click", async (ev) => {
    const btn = ev.target;
    if (!state.entries.length) return;
    btn.disabled = true;
    try {
      btn.textContent = "Preparing…";
      const bundle = await api("/admin/shorts/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildProject()) });
      if (bundle.captions) { state.captions = bundle.captions; fillCaptions(bundle.captions); }

      if (await helperUp()) {
        // render on the local helper, then auto-download the finished MP4
        let secs = 0; btn.textContent = "Rendering… 0:00";
        const timer = setInterval(() => { secs++; btn.textContent = `Rendering… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`; }, 1000);
        setRun('<span class="shorts-spin"></span> Rendering on your Mac — this takes ~2–3 min. Saves to <code>tools/countdown/exports/</code> even if you close this tab.');
        try {
          const r = await fetch(HELPER + "/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ script: bundle.script, filename: bundle.filename }) });
          clearInterval(timer);
          if (r.ok && (r.headers.get("content-type") || "").includes("video")) {
            downloadBlob(await r.blob(), bundle.filename.replace(/\.sh$/, ".mp4"));
            setRun(`✓ Rendered, downloaded &amp; saved.<br><code>${esc(r.headers.get("x-saved-path") || "tools/countdown/exports/")}</code>`);
            btn.textContent = "✓ Done — make another";
          } else {
            const err = await r.json().catch(() => ({}));
            setRun(`Render failed.<br><code>${esc(String(err.log || err.error || "check the render-helper terminal").slice(-500))}</code>`);
            btn.textContent = "Render failed — retry";
          }
        } catch (e) { clearInterval(timer); setRun(`Lost the render helper mid-job. <code>${esc(String(e))}</code>`); btn.textContent = "Render failed — retry"; }
      } else {
        // helper offline → download the script + a one-time start hint
        downloadBlob(new Blob([bundle.script], { type: "text/x-shellscript" }), bundle.filename);
        setRun('Auto-render helper isn’t running. Start it once (leave it running):<br><code>npm run render</code><br>…then hit Export again — the video renders &amp; saves itself. <br><span class="shorts-muted">(A fallback script was downloaded just in case.)</span>');
        btn.textContent = "Helper offline — start it & retry";
      }
    } catch (e) { btn.textContent = "Export failed — retry"; }
    finally { btn.disabled = false; }
  });
  $("#shorts-copy-run").addEventListener("click", (ev) => copyText($("#shorts-runcmd").textContent, ev.target));

  q.focus();
})();
