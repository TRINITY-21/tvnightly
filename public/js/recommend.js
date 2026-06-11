// Guided taste flow for /recommend: rate-a-deck → services → demographics →
// "creating your taste profile…" → Match% reveal. Progressive enhancement: the
// server renders a search-box fallback inside #taste-mount and this replaces it.
//
// Founder rule (PLAN.md §2): no client-side user data. All flow state lives in
// memory only; the single POST /api/taste is what persists (anonymous) verdicts.
(function () {
  "use strict";

  var root = document.getElementById("taste");
  var mount = document.getElementById("taste-mount");
  var dataEl = document.getElementById("taste-data");
  if (!root || !mount || !dataEl) return;

  var data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (e) {
    return; // leave the no-JS fallback in place
  }
  if (!data.deck || !data.deck.length) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Deck buttons map the four-way scale onto the engine's verdict words.
  var SCALE = [
    { v: "awful", label: "Awful", cls: "v-awful" },
    { v: "meh", label: "Meh", cls: "v-meh" },
    { v: "like", label: "Good", cls: "v-good" },
    { v: "love", label: "Amazing", cls: "v-amazing" }
  ];
  var MIN_RATED = 5;

  // ---- in-memory state (never persisted client-side) ----
  var state = {
    deck: data.deck.slice(),
    i: 0,
    ratings: [], // {kind, ref, verdict}
    history: [], // for undo: {type:'rate'|'skip'}
    services: [],
    servicesTab: "popular",
    region: data.region,
    gender: null,
    age: null
  };

  // ---- tiny DOM helper ----
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var val = attrs[k];
        if (val == null || val === false) continue;
        if (k === "class") n.className = val;
        else if (k === "html") n.innerHTML = val;
        else if (k.slice(0, 2) === "on" && typeof val === "function")
          n.addEventListener(k.slice(2).toLowerCase(), val);
        else n.setAttribute(k, val === true ? "" : val);
      }
    }
    if (kids != null) {
      (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
        if (c == null || c === false) return;
        n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
      });
    }
    return n;
  }

  function mountStep(node) {
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(node);
    mount.scrollIntoView({ block: "nearest" });
  }

  // ---- Match% ring (SVG, animates the arc on mount) ----
  function matchRing(pct, size) {
    size = size || 104;
    var r = size / 2 - 7;
    var circ = 2 * Math.PI * r;
    var off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
    var cls = pct >= 75 ? "ring-hi" : pct >= 60 ? "ring-mid" : "ring-lo";
    var wrap = el("div", { class: "match-ring " + cls });
    wrap.innerHTML =
      '<svg viewBox="0 0 ' + size + " " + size + '" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle class="ring-track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="6"/>' +
      '<circle class="ring-bar" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="6" stroke-linecap="round" ' +
      'stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + (reduceMotion ? off : circ).toFixed(1) + '" ' +
      'transform="rotate(-90 ' + size / 2 + " " + size / 2 + ')"/>' +
      "</svg>" +
      '<span class="match-ring-num">' + Math.round(pct) + "<small>%</small></span>";
    if (!reduceMotion) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var bar = wrap.querySelector(".ring-bar");
          if (bar) bar.style.strokeDashoffset = off.toFixed(1);
        });
      });
    }
    return wrap;
  }

  function posterImg(src, name, cls) {
    return src
      ? el("img", { src: src, alt: name, loading: "lazy" })
      : el("div", { class: cls || "tdeck-fallback" }, name);
  }

  // ============================ STEP 1: DECK ============================
  function renderDeck() {
    var item = state.deck[state.i];
    if (!item) return renderServices(); // rated through the whole deck

    var rated = state.ratings.length;
    var pct = Math.min(1, rated / MIN_RATED);

    var fill = el("div", { class: "taste-bar-fill" });
    fill.style.width = (reduceMotion ? pct * 100 : 0) + "%";

    var progress = el("div", { class: "taste-progress" }, [
      el("span", { class: "taste-progress-label" }, "Calculating your taste…"),
      el("div", { class: "taste-bar" }, fill)
    ]);

    var card = el("div", { class: "tdeck-card" }, [
      el("div", { class: "tdeck-poster" }, posterImg(item.poster, item.name)),
      el("div", { class: "tdeck-meta" }, [
        el("strong", null, item.name),
        item.year ? el("span", { class: "tdeck-year" }, item.year) : null
      ])
    ]);

    var circles = el(
      "div",
      { class: "tdeck-rate" },
      SCALE.map(function (s) {
        return el(
          "button",
          { class: "tcircle " + s.cls, type: "button", "aria-label": s.label, onClick: function () { rate(s.v); } },
          el("span", null, s.label)
        );
      })
    );

    var actions = el("div", { class: "tdeck-actions" }, [
      el("button", { class: "tdeck-undo", type: "button", title: "Undo last", disabled: state.history.length === 0, onClick: undo }, "↶"),
      el("button", { class: "tdeck-skip", type: "button", onClick: skip }, "Haven't Seen")
    ]);

    var next =
      rated >= MIN_RATED
        ? el("button", { class: "taste-next taste-next-float", type: "button", onClick: renderServices }, "See my matches →")
        : el("span", { class: "tdeck-hint muted" }, "Rate " + (MIN_RATED - rated) + " more to unlock your matches");

    mountStep(el("div", { class: "taste-step tstep-deck" }, [progress, card, circles, actions, next]));

    if (!reduceMotion) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fill.style.width = pct * 100 + "%"; });
      });
    }
  }

  function rate(v) {
    var item = state.deck[state.i];
    if (!item) return;
    state.ratings.push({ kind: item.kind, ref: item.ref, verdict: v });
    state.history.push({ type: "rate" });
    state.i++;
    renderDeck();
  }
  function skip() {
    state.history.push({ type: "skip" });
    state.i++;
    renderDeck();
  }
  function undo() {
    var last = state.history.pop();
    if (!last) return;
    state.i = Math.max(0, state.i - 1);
    if (last.type === "rate") state.ratings.pop();
    renderDeck();
  }

  // ========================== STEP 2: SERVICES ==========================
  function renderServices() {
    var list = state.servicesTab === "all" ? data.providers.all : data.providers.popular;

    var seg = el("div", { class: "seg" }, [
      segBtn("popular", "Popular"),
      segBtn("all", "All Services")
    ]);

    var region = el("div", { class: "svc-region-wrap" }, regionSelect());

    var grid = el(
      "div",
      { class: "svc-grid" },
      list.map(function (p) {
        var on = state.services.indexOf(p.name) >= 0;
        return el(
          "button",
          { class: "svc-tile" + (on ? " on" : ""), type: "button", onClick: function (ev) { toggleSvc(p.name, ev.currentTarget); } },
          [
            el("span", { class: "svc-logo" }, p.logo ? el("img", { src: p.logo, alt: p.name, width: "32", height: "32", loading: "lazy" }) : null),
            el("span", { class: "svc-name" }, p.name),
            el("span", { class: "svc-check", html: "&#10003;" })
          ]
        );
      })
    );

    var foot = el("div", { class: "taste-foot" }, [
      el("button", { class: "taste-ghost", type: "button", onClick: function () { state.services = []; renderDemo(); } }, "I don't have any"),
      el("button", { class: "taste-next", type: "button", onClick: renderDemo }, "Next")
    ]);

    mountStep(
      el("div", { class: "taste-step tstep-services" }, [
        el("div", { class: "taste-head" }, [
          el("h2", null, "Which services do you have?"),
          el("p", { class: "muted" }, "We'll bump picks you can actually stream to the top.")
        ]),
        el("div", { class: "svc-controls" }, [region, seg]),
        grid,
        foot
      ])
    );
  }
  function segBtn(tab, label) {
    return el(
      "button",
      { class: "seg-btn" + (state.servicesTab === tab ? " on" : ""), type: "button", onClick: function () { state.servicesTab = tab; renderServices(); } },
      label
    );
  }
  function regionSelect() {
    var sel = el("select", { class: "svc-region", "aria-label": "Region", onChange: function (e) { state.region = e.target.value; } });
    data.regions.forEach(function (rg) {
      var o = el("option", { value: rg }, rg);
      if (rg === state.region) o.selected = true;
      sel.appendChild(o);
    });
    return sel;
  }
  function toggleSvc(name, btn) {
    var i = state.services.indexOf(name);
    if (i >= 0) {
      state.services.splice(i, 1);
      btn.classList.remove("on");
    } else {
      state.services.push(name);
      btn.classList.add("on");
    }
  }

  // ======================== STEP 3: DEMOGRAPHICS ========================
  function renderDemo() {
    var genders = [["female", "Female"], ["male", "Male"], ["nonbinary", "Non-Binary"]];
    var ages = [["u18", "Under 18"], ["18-24", "18–24"], ["25-34", "25–34"], ["35-44", "35–44"], ["45-54", "45–54"], ["55+", "55+"]];

    function optButton(value, label, key) {
      return el(
        "button",
        { class: "demo-opt" + (state[key] === value ? " on" : ""), type: "button", onClick: function (ev) { pickOne(key, value, ev.currentTarget); } },
        label
      );
    }

    mountStep(
      el("div", { class: "taste-step tstep-demo" }, [
        el("div", { class: "taste-head" }, el("p", { class: "muted" }, "Last step — optional")),
        el("div", { class: "demo-group" }, [
          el("h2", null, "How do you identify?"),
          el("div", { class: "demo-opts" }, genders.map(function (g) { return optButton(g[0], g[1], "gender"); }))
        ]),
        el("div", { class: "demo-group" }, [
          el("h2", null, "How old are you?"),
          el("div", { class: "demo-opts demo-opts-age" }, ages.map(function (a) { return optButton(a[0], a[1], "age"); }))
        ]),
        el("p", { class: "muted demo-note" }, "Helps us find raters most similar to you. No name, nothing personal is stored."),
        el("div", { class: "taste-foot" }, [
          el("button", { class: "taste-ghost", type: "button", onClick: renderCalc }, "Skip"),
          el("button", { class: "taste-next", type: "button", onClick: renderCalc }, "See my matches →")
        ])
      ])
    );
  }
  function pickOne(key, value, btn) {
    var on = state[key] === value;
    state[key] = on ? null : value;
    var sibs = btn.parentNode.querySelectorAll(".demo-opt");
    for (var j = 0; j < sibs.length; j++) sibs[j].classList.remove("on");
    if (!on) btn.classList.add("on");
  }

  // ===================== STEP 4: CALCULATE + REVEAL =====================
  function renderCalc() {
    mountStep(
      el("div", { class: "taste-step tstep-calc" }, [
        el("div", { class: "taste-spinner", "aria-hidden": "true" }),
        el("p", { class: "taste-calc-label" }, "Creating your taste profile…")
      ])
    );
    var started = Date.now();
    fetch("/api/taste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ratings: state.ratings,
        services: state.services,
        gender: state.gender,
        age: state.age,
        region: state.region
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var wait = reduceMotion ? 0 : Math.max(0, 950 - (Date.now() - started));
        setTimeout(function () { renderReveal(res); }, wait);
      })
      .catch(renderError);
  }

  function matchClass(m) { return m >= 75 ? "m-hi" : m >= 60 ? "m-mid" : "m-lo"; }

  function renderReveal(res) {
    var picks = (res && res.picks) || [];
    var pm = (res && res.profileMatch) || 0;

    var head = el("div", { class: "reveal-head" }, [
      matchRing(pm, 112),
      el("h2", null, "Your taste is mapped"),
      el("p", { class: "muted" }, "Your picks and Match% come from raters who share your taste.")
    ]);

    var body = picks.length
      ? el(
          "div",
          { class: "reveal-grid" },
          picks.map(function (p) {
            return el("a", { class: "reveal-card", href: p.href }, [
              el("div", { class: "reveal-poster" }, [
                posterImg(p.poster, p.name, "reveal-fallback"),
                el("span", { class: "reveal-match " + matchClass(p.match) }, p.match + "% match")
              ]),
              el("div", { class: "reveal-meta" }, [
                el("strong", null, p.name),
                el("span", { class: "muted" }, (p.year || "") + (p.onService ? " · on your services" : ""))
              ])
            ]);
          })
        )
      : el("p", { class: "muted reveal-empty" }, "We need a touch more to go on — rate a few more, or try the picker.");

    var foot = el("div", { class: "taste-foot reveal-foot" }, [
      el("button", { class: "taste-ghost", type: "button", onClick: restart }, "Rate more"),
      el("a", { class: "taste-next", href: "/loved" }, "Browse community favorites →")
    ]);

    mountStep(el("div", { class: "taste-step tstep-reveal" }, [head, body, foot]));
  }

  function restart() {
    state.i = 0;
    state.ratings = [];
    state.history = [];
    renderDeck();
  }

  function renderError() {
    mountStep(
      el("div", { class: "taste-step tstep-calc" }, [
        el("p", { class: "muted" }, "Something hiccuped building your profile."),
        el("button", { class: "taste-next", type: "button", onClick: renderCalc }, "Try again")
      ])
    );
  }

  // ---- go ----
  root.classList.add("taste--active");
  renderDeck();
})();
