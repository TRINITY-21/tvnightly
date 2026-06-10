import { fetchShowWithEpisodes, fetchUpdates, type TvmShow } from "./tvmaze";
import { sendEmails, type EmailEnv } from "./email";
import { signToken } from "./tokens";

export interface SyncEnv extends EmailEnv {
  DB: D1Database;
  SITE_ORIGIN?: string;
  SECRET?: string;
}

// Free Workers allow 50 subrequests per invocation, and D1 calls count as
// subrequests too. Budget: 1 updates fetch + ~6 stale-scan queries + 1 preload
// + 10 shows x (1 fetch + 1 batch) + alert enqueue (2) + outbox drain
// (1 select + 1 send + 1 update) + 1 log = ~33, with headroom.
const MAX_SHOWS_PER_RUN = 10;
// Gmail free SMTP allows ~500 sends/day; 15/run x 24 runs = 360 stays safe.
const MAX_EMAILS_PER_RUN = 15;

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

export interface StatusChange {
  id: number;
  name: string;
  slug: string;
  oldStatus: string | null;
  newStatus: string | null;
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
          genres, runtime, blurb)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                 (SELECT blurb FROM shows WHERE id = ?))`,
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
      ),
  ];

  if (statusChanged) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO status_changes (show_id, old_status, new_status, detected_at)
           VALUES (?,?,?,unixepoch())`,
        )
        .bind(show.id, existing!.status, show.status ?? null),
    );
  }

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

/** Queue renewal-alert emails for confirmed subscribers of changed shows. */
async function enqueueAlerts(env: SyncEnv, changes: StatusChange[]): Promise<number> {
  if (changes.length === 0 || !env.SECRET) return 0;
  const origin = env.SITE_ORIGIN ?? "https://tvnightly.com";
  const byId = new Map(changes.map((ch) => [ch.id, ch]));

  const placeholders = changes.map(() => "?").join(",");
  const { results: subs } = await env.DB.prepare(
    `SELECT email, show_id FROM subscriptions
     WHERE confirmed = 1 AND kind = 'renewal' AND show_id IN (${placeholders})`,
  )
    .bind(...changes.map((ch) => ch.id))
    .all<{ email: string; show_id: number }>();
  if (subs.length === 0) return 0;

  const stmts: D1PreparedStatement[] = [];
  for (const sub of subs) {
    const ch = byId.get(sub.show_id)!;
    const unsubToken = await signToken(
      { email: sub.email, showId: sub.show_id, kind: "renewal", action: "unsub" },
      env.SECRET,
    );
    const subject = `${ch.name}: ${ch.oldStatus ?? "?"} → ${ch.newStatus ?? "?"}`;
    const html =
      `<p><strong>${ch.name}</strong> just changed status: ` +
      `<strong>${ch.oldStatus ?? "unknown"}</strong> → <strong>${ch.newStatus ?? "unknown"}</strong>.</p>` +
      `<p><a href="${origin}/show/${ch.slug}/release-date">See the latest release info</a></p>` +
      `<p style="color:#888;font-size:12px">You asked TV Nightly to notify you about this show. ` +
      `<a href="${origin}/unsubscribe?token=${unsubToken}">Unsubscribe</a></p>`;
    stmts.push(
      env.DB.prepare(
        "INSERT INTO outbox (to_email, subject, html, created_at) VALUES (?,?,?,unixepoch())",
      ).bind(sub.email, subject, html),
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

/**
 * Hourly cron entry point: pull TVmaze's daily update feed, refresh the
 * mirrored shows that are stale (highest popularity first), queue renewal
 * alerts for status changes, drain the email outbox, log the run.
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
  const changes: StatusChange[] = [];
  const errors: string[] = [];
  for (const { id } of batch) {
    try {
      const show = await fetchShowWithEpisodes(id);
      if (show) {
        const prev = existing.get(id) ?? null;
        const { statusChanged } = await upsertShow(db, show, prev);
        if (statusChanged && prev) {
          changes.push({
            id: show.id,
            name: show.name,
            slug: prev.slug,
            oldStatus: prev.status,
            newStatus: show.status ?? null,
          });
        }
        updated++;
      }
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let emailed = 0;
  try {
    await enqueueAlerts(env, changes);
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
