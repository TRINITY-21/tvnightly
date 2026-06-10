import { fetchShowWithEpisodes, fetchUpdates, type TvmShow } from "./tvmaze";
import { sendEmails, type EmailEnv } from "./email";
import { signToken } from "./tokens";

export interface SyncEnv extends EmailEnv {
  DB: D1Database;
  SITE_ORIGIN?: string;
  SECRET?: string;
  TMDB_API_KEY?: string; // provider patrol (set via wrangler secret / .dev.vars)
}

// Free Workers allow 50 subrequests per invocation, and D1 calls count as
// subrequests too. Budget: ~13 fixed (updates fetch, stale scan, preload,
// event batch, alert enqueues, outbox drain, sync_log) + 8 shows x (1 TVmaze
// fetch + 1 old-episodes read + 1 batch) = ~40, with headroom.
const MAX_SHOWS_PER_RUN = 8;
// Gmail free SMTP allows ~500 sends/day; 15/run x 24 runs = 360 stays safe.
const MAX_EMAILS_PER_RUN = 15;
// "Instant classic" alerts: newly aired episode crosses this rating.
const TOP_EPISODE_RATING = 8.5;
const TOP_EPISODE_WINDOW_MS = 14 * 24 * 3600 * 1000;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "show"
  );
}

interface ExistingShow {
  slug: string;
  status: string | null;
}

export type ShowEventType = "status" | "season_announced" | "premiere_set" | "premiere_moved";

export interface ShowEvent {
  showId: number;
  name: string;
  slug: string;
  type: ShowEventType;
  season: number | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface TopEpisode {
  showId: number;
  showName: string;
  slug: string;
  epName: string;
  code: string;
  rating: number;
}

/**
 * Upsert a show and its embedded episodes in one D1 batch.
 * `existing` must be preloaded by the caller (null for brand-new shows —
 * the caller is responsible for slug uniqueness in that case).
 */
export async function upsertShow(
  db: D1Database,
  show: TvmShow,
  existing: ExistingShow | null,
): Promise<{ statusChanged: boolean }> {
  const slug = existing?.slug ?? `${slugify(show.name)}-${show.id}`;
  const statusChanged = existing !== null && existing.status !== (show.status ?? null);

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT OR REPLACE INTO shows
         (id, slug, name, status, premiered, ended, network, web_channel,
          rating, weight, image_url, summary, imdb_id, tvdb_id, updated_at,
          genres, runtime, blurb, providers_intl, tmdb_id, providers_checked_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                 (SELECT blurb FROM shows WHERE id = ?),
                 (SELECT providers_intl FROM shows WHERE id = ?),
                 (SELECT tmdb_id FROM shows WHERE id = ?),
                 (SELECT providers_checked_at FROM shows WHERE id = ?))`,
      )
      .bind(
        show.id,
        slug,
        show.name,
        show.status,
        show.premiered,
        show.ended,
        show.network?.name ?? null,
        show.webChannel?.name ?? null,
        show.rating?.average ?? null,
        show.weight ?? 0,
        show.image?.medium ?? null,
        show.summary,
        show.externals?.imdb ?? null,
        show.externals?.thetvdb ?? null,
        show.updated,
        show.genres?.length ? JSON.stringify(show.genres) : null,
        show.averageRuntime ?? null,
        show.id,
        show.id,
        show.id,
        show.id,
      ),
  ];

  for (const ep of show._embedded?.episodes ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO episodes
           (id, show_id, season, number, name, airdate, airstamp,
            runtime, rating, image_url, summary)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          ep.id,
          show.id,
          ep.season,
          ep.number,
          ep.name,
          ep.airdate,
          ep.airstamp,
          ep.runtime,
          ep.rating?.average ?? null,
          ep.image?.medium ?? null,
          ep.summary,
        ),
    );
  }

  await db.batch(stmts);
  return { statusChanged };
}

interface OldEpisode {
  id: number;
  rating: number | null;
  season: number | null;
  number: number | null;
  airstamp: string | null;
}

/**
 * Renewals rarely change TVmaze status — new-season episodes just appear.
 * Diff the old mirror against the fresh payload to derive the events people
 * actually subscribe for.
 */
function detectEvents(
  prev: ExistingShow,
  show: TvmShow,
  oldEps: OldEpisode[],
  nowMs: number,
): ShowEvent[] {
  const events: ShowEvent[] = [];
  const base = { showId: show.id, name: show.name, slug: prev.slug };

  if (prev.status !== (show.status ?? null)) {
    events.push({ ...base, type: "status", season: null, oldValue: prev.status, newValue: show.status ?? null });
  }

  // Never fire announcement events on a show whose episodes we had not
  // mirrored yet — the first fill would look like a renewal.
  if (oldEps.length === 0) return events;

  const newEps = show._embedded?.episodes ?? [];
  const maxOldSeason = Math.max(...oldEps.map((e) => e.season ?? 0));
  const oldById = new Map(oldEps.map((e) => [e.id, e]));

  const announced = new Set<number>();
  for (const ep of newEps) {
    const s = ep.season ?? 0;
    if (s > maxOldSeason && !announced.has(s)) {
      announced.add(s);
      events.push({ ...base, type: "season_announced", season: s, oldValue: null, newValue: String(s) });
    }
  }

  const dated = new Set<number>();
  for (const ep of newEps) {
    if (ep.number !== 1 || !ep.airstamp) continue;
    const t = Date.parse(ep.airstamp);
    if (!Number.isFinite(t) || t <= nowMs) continue;
    const s = ep.season ?? 0;
    const date = ep.airdate ?? ep.airstamp.slice(0, 10);
    const old = oldById.get(ep.id);
    if (!old || !old.airstamp) {
      if (!dated.has(s)) {
        dated.add(s);
        events.push({ ...base, type: "premiere_set", season: s, oldValue: null, newValue: date });
      }
    } else if (old.airstamp !== ep.airstamp) {
      events.push({
        ...base,
        type: "premiere_moved",
        season: s,
        oldValue: old.airstamp.slice(0, 10),
        newValue: date,
      });
    }
  }

  // A date-known new season fires both 'announced' and 'set' — keep the more
  // informative one.
  return events.filter(
    (ev) => !(ev.type === "season_announced" && dated.has(ev.season ?? -1)),
  );
}

function eventEmail(
  ev: ShowEvent,
  origin: string,
  unsubToken: string,
): { subject: string; html: string } {
  let subject: string;
  let line: string;
  switch (ev.type) {
    case "season_announced":
      subject = `${ev.name} is coming back — Season ${ev.season} confirmed 🎉`;
      line = `<strong>${ev.name}</strong> has been renewed: <strong>Season ${ev.season}</strong> is officially happening.`;
      break;
    case "premiere_set":
      subject = `${ev.name} Season ${ev.season} premieres ${ev.newValue}`;
      line = `<strong>${ev.name}</strong> Season ${ev.season} now has a premiere date: <strong>${ev.newValue}</strong>.`;
      break;
    case "premiere_moved":
      subject = `${ev.name} premiere moved to ${ev.newValue}`;
      line = `<strong>${ev.name}</strong> Season ${ev.season}'s premiere moved from ${ev.oldValue} to <strong>${ev.newValue}</strong>.`;
      break;
    default:
      subject = `${ev.name}: ${ev.oldValue ?? "?"} → ${ev.newValue ?? "?"}`;
      line = `<strong>${ev.name}</strong> just changed status: <strong>${ev.oldValue ?? "unknown"}</strong> → <strong>${ev.newValue ?? "unknown"}</strong>.`;
  }
  const html =
    `<p>${line}</p>` +
    `<p><a href="${origin}/show/${ev.slug}/release-date">See the latest release info</a></p>` +
    `<p style="color:#888;font-size:12px">You asked TV Nightly to notify you about this show. ` +
    `<a href="${origin}/unsubscribe?token=${unsubToken}">Unsubscribe</a></p>`;
  return { subject, html };
}

/** Persist events and queue alert emails for confirmed subscribers. */
async function enqueueEventAlerts(env: SyncEnv, events: ShowEvent[]): Promise<void> {
  if (events.length === 0) return;
  await env.DB.batch(
    events.map((ev) =>
      env.DB.prepare(
        `INSERT INTO show_events (show_id, type, season, old_value, new_value, detected_at)
         VALUES (?,?,?,?,?,unixepoch())`,
      ).bind(ev.showId, ev.type, ev.season, ev.oldValue, ev.newValue),
    ),
  );
  if (!env.SECRET) return;
  const origin = env.SITE_ORIGIN ?? "https://tvnightly.com";
  const showIds = [...new Set(events.map((ev) => ev.showId))];
  const placeholders = showIds.map(() => "?").join(",");
  const { results: subs } = await env.DB.prepare(
    `SELECT email, show_id FROM subscriptions
     WHERE confirmed = 1 AND kind = 'renewal' AND show_id IN (${placeholders})`,
  )
    .bind(...showIds)
    .all<{ email: string; show_id: number }>();
  if (subs.length === 0) return;

  const stmts: D1PreparedStatement[] = [];
  for (const sub of subs) {
    const unsubToken = await signToken(
      { email: sub.email, showId: sub.show_id, kind: "renewal", action: "unsub" },
      env.SECRET,
    );
    for (const ev of events.filter((e) => e.showId === sub.show_id)) {
      const { subject, html } = eventEmail(ev, origin, unsubToken);
      stmts.push(
        env.DB.prepare(
          "INSERT INTO outbox (to_email, subject, html, created_at) VALUES (?,?,?,unixepoch())",
        ).bind(sub.email, subject, html),
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** Queue "instant classic" emails to a show's subscribers (deduped per episode). */
async function enqueueTopEpisodeAlerts(env: SyncEnv, tops: TopEpisode[]): Promise<number> {
  if (tops.length === 0 || !env.SECRET) return 0;
  const origin = env.SITE_ORIGIN ?? "https://tvnightly.com";
  const byShow = new Map(tops.map((t) => [t.showId, t]));
  const placeholders = tops.map(() => "?").join(",");
  const { results: subs } = await env.DB.prepare(
    `SELECT email, show_id FROM subscriptions
     WHERE confirmed = 1 AND kind = 'renewal' AND show_id IN (${placeholders})`,
  )
    .bind(...tops.map((t) => t.showId))
    .all<{ email: string; show_id: number }>();
  if (subs.length === 0) return 0;

  const stmts: D1PreparedStatement[] = [];
  for (const sub of subs) {
    const t = byShow.get(sub.show_id)!;
    const unsubToken = await signToken(
      { email: sub.email, showId: sub.show_id, kind: "renewal", action: "unsub" },
      env.SECRET,
    );
    const html =
      `<p><strong>${t.showName}</strong> just aired one of its best episodes ever: ` +
      `<strong>"${t.epName}"</strong> (${t.code}) — rated ★${t.rating.toFixed(1)}.</p>` +
      `<p><a href="${origin}/show/${t.slug}/best-episodes">See where it ranks</a></p>` +
      `<p style="color:#888;font-size:12px">You asked TV Nightly to notify you about this show. ` +
      `<a href="${origin}/unsubscribe?token=${unsubToken}">Unsubscribe</a></p>`;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO outbox (to_email, subject, html, created_at) VALUES (?,?,?,unixepoch())",
      ).bind(sub.email, `${t.showName}: "${t.epName}" is an instant classic (★${t.rating.toFixed(1)})`, html),
    );
  }
  await env.DB.batch(stmts);
  return stmts.length;
}

/** Send a budgeted batch of queued emails; one SMTP/API call covers the batch. */
export async function drainOutbox(env: SyncEnv): Promise<number> {
  const { results: pending } = await env.DB.prepare(
    "SELECT id, to_email, subject, html FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT ?",
  )
    .bind(MAX_EMAILS_PER_RUN)
    .all<{ id: number; to_email: string; subject: string; html: string }>();
  if (pending.length === 0) return 0;

  const flags = await sendEmails(
    env,
    pending.map((p) => ({ to: p.to_email, subject: p.subject, html: p.html })),
  );
  const sentIds = pending.filter((_, i) => flags[i]).map((p) => p.id);
  if (sentIds.length) {
    const placeholders = sentIds.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE outbox SET sent_at = unixepoch() WHERE id IN (${placeholders})`)
      .bind(...sentIds)
      .run();
  }
  return sentIds.length;
}

// ---------------------------------------------------------- provider patrol

const PATROL_REGIONS = ["US", "GB", "CA", "AU", "IN", "DE", "FR", "ES", "IT", "BR", "MX", "NG", "NL", "SE", "JP", "KR"];
// Per run: 9 movies + 9 shows = 18 TMDB fetches + ~6 D1 calls, well under the
// 50-subrequest budget of its own cron invocation. 18 x 24 runs/day cycles a
// ~1,000-title catalog every ~2.3 days.
const PATROL_PER_RUN = 9;

interface ProviderEvent {
  kind: "movie" | "tv";
  ref: string;
  title: string;
  slug: string;
  region: string;
  service: string;
  change: "added" | "removed";
}

function diffIntl(
  oldJson: string | null,
  fresh: Record<string, string[]>,
): { region: string; service: string; change: "added" | "removed" }[] {
  const old: Record<string, string[]> = oldJson ? JSON.parse(oldJson) : {};
  const out: { region: string; service: string; change: "added" | "removed" }[] = [];
  for (const region of PATROL_REGIONS) {
    const before = new Set(old[region] ?? []);
    const after = new Set(fresh[region] ?? []);
    for (const s of after) if (!before.has(s)) out.push({ region, service: s, change: "added" });
    for (const s of before) if (!after.has(s)) out.push({ region, service: s, change: "removed" });
  }
  return out;
}

async function fetchIntl(key: string, path: string): Promise<Record<string, string[]> | null> {
  const res = await fetch(`https://api.themoviedb.org/3${path}?api_key=${key}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: Record<string, { flatrate?: { provider_name: string }[] }> };
  const intl: Record<string, string[]> = {};
  for (const cc of PATROL_REGIONS) {
    const names = data.results?.[cc]?.flatrate?.map((p) => p.provider_name) ?? [];
    if (names.length) intl[cc] = names;
  }
  return intl;
}

/**
 * Second cron: re-check streaming providers on a stalest-first rotation, log
 * every add/removal to provider_events (feeds /whats-new), refresh the stored
 * snapshot, and alert show subscribers about US changes. Never drains the
 * outbox — only the main sync does, so the two crons can't double-send.
 */
export async function providerPatrol(env: SyncEnv): Promise<{ checked: number; events: number }> {
  const db = env.DB;
  if (!env.TMDB_API_KEY) return { checked: 0, events: 0 };

  const [{ results: movies }, { results: shows }] = await Promise.all([
    db
      .prepare(
        `SELECT imdb_id, title, slug, tmdb_id, providers_intl FROM movies
         WHERE tmdb_id IS NOT NULL
         ORDER BY providers_checked_at ASC NULLS FIRST LIMIT ?`,
      )
      .bind(PATROL_PER_RUN)
      .all<{ imdb_id: string; title: string; slug: string; tmdb_id: number; providers_intl: string | null }>(),
    db
      .prepare(
        `SELECT id, name, slug, tmdb_id, providers_intl FROM shows
         WHERE tmdb_id IS NOT NULL
         ORDER BY providers_checked_at ASC NULLS FIRST LIMIT ?`,
      )
      .bind(PATROL_PER_RUN)
      .all<{ id: number; name: string; slug: string; tmdb_id: number; providers_intl: string | null }>(),
  ]);

  const events: ProviderEvent[] = [];
  const updates: D1PreparedStatement[] = [];
  for (const m of movies) {
    const fresh = await fetchIntl(env.TMDB_API_KEY, `/movie/${m.tmdb_id}/watch/providers`);
    if (!fresh) continue;
    for (const d of diffIntl(m.providers_intl, fresh)) {
      events.push({ kind: "movie", ref: m.imdb_id, title: m.title, slug: m.slug, ...d });
    }
    updates.push(
      db
        .prepare("UPDATE movies SET providers_intl = ?, providers_checked_at = unixepoch() WHERE imdb_id = ?")
        .bind(Object.keys(fresh).length ? JSON.stringify(fresh) : null, m.imdb_id),
    );
  }
  for (const s of shows) {
    const fresh = await fetchIntl(env.TMDB_API_KEY, `/tv/${s.tmdb_id}/watch/providers`);
    if (!fresh) continue;
    for (const d of diffIntl(s.providers_intl, fresh)) {
      events.push({ kind: "tv", ref: String(s.id), title: s.name, slug: s.slug, ...d });
    }
    updates.push(
      db
        .prepare("UPDATE shows SET providers_intl = ?, providers_checked_at = unixepoch() WHERE id = ?")
        .bind(Object.keys(fresh).length ? JSON.stringify(fresh) : null, s.id),
    );
  }

  if (updates.length) await db.batch(updates);
  if (events.length) {
    await db.batch(
      events.map((ev) =>
        db
          .prepare(
            `INSERT INTO provider_events (kind, ref, title, slug, region, service, change, detected_at)
             VALUES (?,?,?,?,?,?,?,unixepoch())`,
          )
          .bind(ev.kind, ev.ref, ev.title, ev.slug, ev.region, ev.service, ev.change),
      ),
    );
  }

  // Show subscribers get US availability changes (one email per change).
  const usTvEvents = events.filter((ev) => ev.kind === "tv" && ev.region === "US");
  if (usTvEvents.length && env.SECRET) {
    const origin = env.SITE_ORIGIN ?? "https://tvnightly.com";
    const showIds = [...new Set(usTvEvents.map((ev) => Number(ev.ref)))];
    const placeholders = showIds.map(() => "?").join(",");
    const { results: subs } = await db
      .prepare(
        `SELECT email, show_id FROM subscriptions
         WHERE confirmed = 1 AND kind = 'renewal' AND show_id IN (${placeholders})`,
      )
      .bind(...showIds)
      .all<{ email: string; show_id: number }>();
    const stmts: D1PreparedStatement[] = [];
    for (const sub of subs) {
      const unsubToken = await signToken(
        { email: sub.email, showId: sub.show_id, kind: "renewal", action: "unsub" },
        env.SECRET,
      );
      for (const ev of usTvEvents.filter((e) => Number(e.ref) === sub.show_id)) {
        const subject =
          ev.change === "added"
            ? `${ev.title} is now streaming on ${ev.service}`
            : `${ev.title} just left ${ev.service}`;
        const html =
          `<p><strong>${ev.title}</strong> ${ev.change === "added" ? "is now streaming on" : "just left"} <strong>${ev.service}</strong> (US).</p>` +
          `<p><a href="${origin}/show/${ev.slug}">Where to watch it now</a></p>` +
          `<p style="color:#888;font-size:12px">You asked TV Nightly to notify you about this show. ` +
          `<a href="${origin}/unsubscribe?token=${unsubToken}">Unsubscribe</a></p>`;
        stmts.push(
          db
            .prepare("INSERT INTO outbox (to_email, subject, html, created_at) VALUES (?,?,?,unixepoch())")
            .bind(sub.email, subject, html),
        );
      }
    }
    if (stmts.length) await db.batch(stmts);
  }

  return { checked: movies.length + shows.length, events: events.length };
}

// ------------------------------------------------------------ daily digest

/**
 * The product's namesake: one email every day — tonight's episodes, fresh
 * renewal/streaming news, upcoming premieres, and a pick of the day — to
 * every confirmed 'daily' subscriber. Queued through the outbox (the hourly
 * sync drains it), one own-budget cron invocation per day.
 */
export async function sendDailyDigest(env: SyncEnv): Promise<{ queued: number }> {
  const db = env.DB;
  if (!env.SECRET) return { queued: 0 };
  const origin = env.SITE_ORIGIN ?? "https://tvnightly.com";

  const { results: subs } = await db
    .prepare(
      "SELECT email FROM subscriptions WHERE kind = 'daily' AND show_id IS NULL AND confirmed = 1 LIMIT 300",
    )
    .all<{ email: string }>();
  if (subs.length === 0) return { queued: 0 };

  const [tonight, premieres, events, arrivals, pick] = await Promise.all([
    db
      .prepare(
        `SELECT e.name AS ep, e.season, e.number, s.name, s.slug, s.network, s.web_channel
         FROM episodes e JOIN shows s ON s.id = e.show_id
         WHERE date(e.airstamp) = date('now') ORDER BY s.weight DESC LIMIT 8`,
      )
      .all<{ ep: string | null; season: number | null; number: number | null; name: string; slug: string; network: string | null; web_channel: string | null }>()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT e.airdate, e.season, s.name, s.slug FROM episodes e
         JOIN shows s ON s.id = e.show_id
         WHERE e.number = 1 AND e.airstamp > datetime('now')
           AND e.airstamp < datetime('now', '+7 days')
         ORDER BY e.airstamp LIMIT 5`,
      )
      .all<{ airdate: string | null; season: number | null; name: string; slug: string }>()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT ev.type, ev.season, ev.old_value, ev.new_value, s.name, s.slug
         FROM show_events ev JOIN shows s ON s.id = ev.show_id
         WHERE ev.detected_at > unixepoch() - 86400 ORDER BY ev.detected_at DESC LIMIT 6`,
      )
      .all<{ type: string; season: number | null; old_value: string | null; new_value: string | null; name: string; slug: string }>()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT title, slug, kind, service FROM provider_events
         WHERE region = 'US' AND change = 'added' AND detected_at > unixepoch() - 86400
         ORDER BY detected_at DESC LIMIT 5`,
      )
      .all<{ title: string; slug: string; kind: string; service: string }>()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT name, slug, rating FROM shows
         WHERE rating >= 8 AND weight >= 75 ORDER BY RANDOM() LIMIT 1`,
      )
      .first<{ name: string; slug: string; rating: number }>(),
  ]);

  if (!tonight.length && !premieres.length && !events.length && !arrivals.length) {
    return { queued: 0 }; // nothing worth sending today
  }

  const code = (s: number | null, n: number | null) =>
    `S${String(s ?? 0).padStart(2, "0")}E${String(n ?? 0).padStart(2, "0")}`;
  const li = (s: string) => `<li style="margin:4px 0">${s}</li>`;
  const section = (title: string, items: string[]) =>
    items.length
      ? `<h3 style="margin:18px 0 6px">${title}</h3><ul style="padding-left:18px;margin:0">${items.join("")}</ul>`
      : "";

  const eventLine = (ev: (typeof events)[number]) => {
    const link = `<a href="${origin}/show/${ev.slug}/release-date">${ev.name}</a>`;
    switch (ev.type) {
      case "season_announced":
        return `${link} renewed — Season ${ev.season} confirmed 🎉`;
      case "premiere_set":
        return `${link} Season ${ev.season} premieres ${ev.new_value}`;
      case "premiere_moved":
        return `${link} premiere moved to ${ev.new_value}`;
      default:
        return `${link}: ${ev.old_value ?? "?"} → ${ev.new_value ?? "?"}`;
    }
  };

  const bodyCore =
    section(
      "📺 On tonight",
      tonight.map((t) =>
        li(
          `<a href="${origin}/show/${t.slug}">${t.name}</a> ${code(t.season, t.number)}${t.ep ? ` — ${t.ep}` : ""}${
            t.network ?? t.web_channel ? ` · ${t.network ?? t.web_channel}` : ""
          }`,
        ),
      ),
    ) +
    section(
      "📰 Renewal & schedule news",
      events.map((ev) => li(eventLine(ev))),
    ) +
    section(
      "🆕 Just hit streaming (US)",
      arrivals.map((a) =>
        li(`<a href="${origin}/${a.kind === "movie" ? "movie" : "show"}/${a.slug}">${a.title}</a> → ${a.service}`),
      ),
    ) +
    section(
      "🗓 Premiering this week",
      premieres.map((p) =>
        li(`${p.airdate} — <a href="${origin}/show/${p.slug}/release-date">${p.name}</a> Season ${p.season}`),
      ),
    ) +
    (pick
      ? `<h3 style="margin:18px 0 6px">🎲 Tonight's pick</h3><p style="margin:0"><a href="${origin}/show/${pick.slug}">${pick.name}</a> (★${pick.rating.toFixed(1)}) — <a href="${origin}/show/${pick.slug}/essential">start with the essentials</a>.</p>`
      : "");

  const today = new Date().toISOString().slice(0, 10);
  const topName = tonight[0]?.name ?? premieres[0]?.name ?? pick?.name ?? "your shows";
  const subject = `Tonight: ${topName}${tonight.length > 1 ? ` + ${tonight.length - 1} more` : ""} — TV Nightly`;

  const stmts: D1PreparedStatement[] = [];
  for (const sub of subs) {
    const unsubToken = await signToken(
      { email: sub.email, showId: null, kind: "daily", action: "unsub" },
      env.SECRET,
    );
    const html =
      `<div style="font-family:sans-serif;max-width:560px">` +
      `<p style="margin:0 0 4px;color:#888;font-size:12px">TV Nightly · ${today}</p>` +
      bodyCore +
      `<p style="color:#888;font-size:12px;margin-top:22px">You asked for the TV Nightly daily email. ` +
      `<a href="${origin}/unsubscribe?token=${unsubToken}">Unsubscribe</a></p></div>`;
    stmts.push(
      db
        .prepare("INSERT INTO outbox (to_email, subject, html, created_at) VALUES (?,?,?,unixepoch())")
        .bind(sub.email, subject, html),
    );
  }
  await db.batch(stmts);
  return { queued: stmts.length };
}

/**
 * Hourly cron entry point: pull TVmaze's daily update feed, refresh the
 * mirrored shows that are stale (highest popularity first), derive renewal/
 * premiere/status events, queue alerts, drain the email outbox, log the run.
 */
export async function runSync(env: SyncEnv): Promise<{ checked: number; updated: number; emailed: number }> {
  const db = env.DB;
  const started = Math.floor(Date.now() / 1000);
  const updates = (await fetchUpdates("day")) ?? {};
  const ids = Object.keys(updates).map(Number);

  // Which of the shows TVmaze touched do we mirror, and which are stale?
  const stale: { id: number; weight: number }[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, weight, updated_at FROM shows WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: number; weight: number; updated_at: number }>();
    for (const r of results) {
      if ((updates[String(r.id)] ?? 0) > r.updated_at) stale.push({ id: r.id, weight: r.weight });
    }
  }
  stale.sort((a, b) => b.weight - a.weight);
  const batch = stale.slice(0, MAX_SHOWS_PER_RUN);

  // Preload slug/status for the whole batch in one query.
  const existing = new Map<number, ExistingShow>();
  if (batch.length) {
    const placeholders = batch.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, slug, status FROM shows WHERE id IN (${placeholders})`)
      .bind(...batch.map((s) => s.id))
      .all<{ id: number; slug: string; status: string | null }>();
    for (const r of results) existing.set(r.id, { slug: r.slug, status: r.status });
  }

  let updated = 0;
  const allEvents: ShowEvent[] = [];
  const topCandidates: (TopEpisode & { episodeId: number })[] = [];
  const errors: string[] = [];
  const now = Date.now();
  for (const { id } of batch) {
    try {
      const show = await fetchShowWithEpisodes(id);
      if (show) {
        const prev = existing.get(id) ?? null;
        const { results: oldEps } = await db
          .prepare("SELECT id, rating, season, number, airstamp FROM episodes WHERE show_id = ?")
          .bind(id)
          .all<OldEpisode>();
        const oldRating = new Map(oldEps.map((e) => [e.id, e.rating]));

        await upsertShow(db, show, prev);
        if (prev) {
          allEvents.push(...detectEvents(prev, show, oldEps, now));
          for (const ep of show._embedded?.episodes ?? []) {
            const rating = ep.rating?.average ?? null;
            const aired = ep.airstamp ? Date.parse(ep.airstamp) : NaN;
            const old = oldRating.get(ep.id) ?? null;
            if (
              rating != null &&
              rating >= TOP_EPISODE_RATING &&
              (old == null || old < TOP_EPISODE_RATING) &&
              Number.isFinite(aired) &&
              aired <= now &&
              now - aired < TOP_EPISODE_WINDOW_MS
            ) {
              topCandidates.push({
                episodeId: ep.id,
                showId: show.id,
                showName: show.name,
                slug: prev.slug,
                epName: ep.name ?? "New episode",
                code: `S${String(ep.season ?? 0).padStart(2, "0")}E${String(ep.number ?? 0).padStart(2, "0")}`,
                rating,
              });
            }
          }
        }
        updated++;
      }
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let emailed = 0;
  try {
    await enqueueEventAlerts(env, allEvents);
    // One alert per episode ever: filter against episode_alerts, then record.
    let tops: TopEpisode[] = [];
    if (topCandidates.length) {
      const placeholders = topCandidates.map(() => "?").join(",");
      const { results: already } = await db
        .prepare(`SELECT episode_id FROM episode_alerts WHERE episode_id IN (${placeholders})`)
        .bind(...topCandidates.map((t) => t.episodeId))
        .all<{ episode_id: number }>();
      const seen = new Set(already.map((r) => r.episode_id));
      const fresh = topCandidates.filter((t) => !seen.has(t.episodeId));
      if (fresh.length) {
        await db.batch(
          fresh.map((t) =>
            db
              .prepare("INSERT OR IGNORE INTO episode_alerts (episode_id, created_at) VALUES (?,unixepoch())")
              .bind(t.episodeId),
          ),
        );
        tops = fresh;
      }
    }
    await enqueueTopEpisodeAlerts(env, tops);
    emailed = await drainOutbox(env);
  } catch (e) {
    errors.push(`email: ${e instanceof Error ? e.message : String(e)}`);
  }

  await db
    .prepare(
      `INSERT INTO sync_log (started_at, finished_at, shows_checked, shows_updated, errors)
       VALUES (?,unixepoch(),?,?,?)`,
    )
    .bind(started, stale.length, updated, errors.length ? errors.join("; ") : null)
    .run();

  return { checked: stale.length, updated, emailed };
}
