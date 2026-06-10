import { fetchShowWithEpisodes, fetchUpdates, type TvmShow } from "./tvmaze";

// Free Workers allow 50 subrequests per invocation, and D1 calls count as
// subrequests too. Budget per show: 1 TVmaze fetch + 1 D1 batch = 2, plus
// ~10 fixed calls (updates fetch, stale scan, preload, sync_log).
const MAX_SHOWS_PER_RUN = 15;

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
          rating, weight, image_url, summary, imdb_id, tvdb_id, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

/**
 * Hourly cron entry point: pull TVmaze's daily update feed, refresh the
 * mirrored shows that are stale (highest popularity first), log the run.
 * Status changes land in `status_changes` (feeds /renewals and, in M5,
 * Resend notify-me alerts).
 */
export async function runSync(db: D1Database): Promise<{ checked: number; updated: number }> {
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
  const errors: string[] = [];
  for (const { id } of batch) {
    try {
      const show = await fetchShowWithEpisodes(id);
      if (show) {
        await upsertShow(db, show, existing.get(id) ?? null);
        updated++;
      }
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await db
    .prepare(
      `INSERT INTO sync_log (started_at, finished_at, shows_checked, shows_updated, errors)
       VALUES (?,unixepoch(),?,?,?)`,
    )
    .bind(started, stale.length, updated, errors.length ? errors.join("; ") : null)
    .run();

  return { checked: stale.length, updated };
}
