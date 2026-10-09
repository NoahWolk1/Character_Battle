// ─────────────────────────────────────────────────────────────────────────────
// Did-you-mean suggestions (Levenshtein). Used by the normalizers and the
// validator to turn typos ("knockBack", "sideSpecail") into helpful I-notes.
// Pure, deterministic, browser-safe.
// ─────────────────────────────────────────────────────────────────────────────

/** Classic edit distance (insert/delete/substitute = 1). Stops early past `max`. */
export function levenshtein(a, b, max = Infinity) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * Best candidate within `max` edits (default 2, per spec §4.1.7), or null.
 * Case/underscore/dash differences are free ("knock_back" → "knockback").
 * Ties go to the earlier candidate, so pass candidates in a stable order.
 */
export function didYouMean(word, candidates, { max = 2 } = {}) {
  if (typeof word !== 'string' || !word) return null;
  const fold = (s) => s.toLowerCase().replace(/[_\-\s]/g, '');
  const w = fold(word);
  let best = null, bestD = Infinity;
  for (const c of candidates || []) {
    if (typeof c !== 'string' || c === word) continue;
    const d = fold(c) === w ? 0 : levenshtein(w, fold(c), max);
    // Very short words match almost anything at distance 2; require closer hits.
    const n = Math.min(w.length, c.length);
    const limit = Math.min(max, n <= 2 ? 0 : n <= 4 ? 1 : max);
    if (d <= limit && d < bestD) { best = c; bestD = d; }
  }
  return best;
}

/** " Did you mean "x"?" or '' — ready to append to a message. */
export function suggestText(word, candidates, opts) {
  const s = didYouMean(word, candidates, opts);
  return s ? ` Did you mean "${s}"?` : '';
}
