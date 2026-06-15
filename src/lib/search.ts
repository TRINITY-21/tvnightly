// Search-text normalization so "Spider-Man", "spider man", and "spiderman" all
// match the same row: case, punctuation, spacing, and common Latin accents are
// folded away on BOTH sides of the comparison. foldText() does it for the query
// in JS; foldSql() builds the identical fold as a SQL expression over a column,
// so `foldSql("name") LIKE '%' || ? || '%'` lines up with a foldText(q) bind.
//
// Note: leading-wildcard LIKE still can't use an index — this trades a little CPU
// per row for much better recall. If the people/movies tables grow enough that
// per-keystroke scans strain the D1 budget, the upgrade path is an FTS5 trigram
// index, which this normalization layer would feed.

// [from, to] pairs, applied in order, identically in JS and SQL. SQLite's LOWER()
// is ASCII-only, which is why the lowercase accent rows are spelled out here.
const FOLD: ReadonlyArray<readonly [string, string]> = [
  ["'", ""], ["‘", ""], ["’", ""], ["ʼ", ""], ["`", ""],
  ['"', ""], ["“", ""], ["”", ""],
  ["-", ""], ["‐", ""], ["–", ""], ["—", ""],
  [" ", ""], [":", ""], [".", ""], [",", ""], ["!", ""], ["?", ""],
  ["&", "and"], ["+", "and"],
  ["é", "e"], ["è", "e"], ["ê", "e"], ["ë", "e"],
  ["á", "a"], ["à", "a"], ["â", "a"], ["ä", "a"], ["ã", "a"], ["å", "a"],
  ["í", "i"], ["ì", "i"], ["î", "i"], ["ï", "i"],
  ["ó", "o"], ["ò", "o"], ["ô", "o"], ["ö", "o"], ["õ", "o"], ["ø", "o"],
  ["ú", "u"], ["ù", "u"], ["û", "u"], ["ü", "u"],
  ["ñ", "n"], ["ç", "c"], ["ß", "ss"], ["æ", "ae"], ["œ", "oe"],
];

/** Collapse a string to its normalized search shape (JS side). */
export function foldText(s: string): string {
  let out = s.toLowerCase();
  for (const [from, to] of FOLD) out = out.split(from).join(to);
  return out;
}

/** SQL expression folding `col` the same way foldText folds a string. */
export function foldSql(col: string): string {
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return FOLD.reduce(
    (expr, [from, to]) => `REPLACE(${expr}, ${lit(from)}, ${lit(to)})`,
    `LOWER(${col})`,
  );
}

// --- fuzzy "did you mean" --- bigram Dice coefficient over already-folded text.
// Robust to a wrong/missing letter (a single typo only breaks ~2 bigrams), which
// plain substring matching can't catch. Used only on the results page, never
// per-keystroke.

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Similarity of two already-folded strings, 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const ba = bigrams(a);
  const bb = bigrams(b);
  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(g, c - 1);
    }
  }
  return (2 * inter) / (ba.length + bb.length);
}
