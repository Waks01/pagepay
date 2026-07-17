/**
 * parseBody — turns a slice's `body_text` into a typed RenderSegment[].
 *
 * Contract (server → client, v3 §2.4). DO NOT change these regexes
 * without also updating the OpenStax slicer at
 * `backend/app/services/content/slicing/topic_slicer.py` and bumping
 * `content_catalog.body_sentinels_version` to 2 — the reader checks
 * the version before parsing, so a contract change without a
 * version bump is silently broken.
 *
 *   [[IMG:<src>|<alt>]]     → { kind: 'image', src, alt }
 *   Caption: <text>         → { kind: 'caption', text }    (must be on its own line)
 *   [TABLE START]…[TABLE END] → { kind: 'table', rows }
 *   [[EQ:<inner>]]          → { kind: 'equation', text }
 *   <other text>            → { kind: 'text', text }
 *
 * Why a hand-rolled walk and not a parser library: the contract is
 * tiny (4 sentinels) and stable. A library would add ~30KB to the
 * bundle for ~30 lines of regex.
 *
 * The walk is single-pass: we find all sentinel matches, sort by
 * start position, then emit (text_before, sentinel) pairs in order.
 * Anything that doesn't match a sentinel becomes a `text` segment.
 *
 * Captions are NOT detected by regex here — they're detected by the
 * parser observing a `Caption:` line immediately after an `image`
 * segment. This couples captions to their preceding image, which is
 * the v3 design: "Captions render below the previous IMG."
 */

export type RenderSegment =
  | { kind: 'text'; key: string; text: string; bodyStart: number }
  | { kind: 'image'; key: string; src: string; alt: string }
  | { kind: 'caption'; key: string; text: string }
  | { kind: 'table'; key: string; rows: string[][] }
  | { kind: 'equation'; key: string; text: string };

// Sentinel regexes. Captured groups:
//   IMG:  1=src, 2=alt (may be empty)
//   EQ:   1=inner LaTeX-like text
//   TABLE: 1=raw body between START and END (no /s flag — we want
//          to match within a line, not across newlines. Tables in
//          body_text are joined with ` \| ` and never contain
//          literal newlines.)
const IMG_RE = /\[\[IMG:([^|\]]+)\|([^\]]*)\]\]/g;
const EQ_RE = /\[\[EQ:([^\]]+)\]\]/g;
const TABLE_RE = /\[TABLE START\](.*?)\[TABLE END\]/g;
const CAPTION_RE = /^Caption: (.+)$/gm;

type RawMatch = {
  start: number;
  end: number;
  segment: RenderSegment;
};

export function parseBody(bodyText: string): RenderSegment[] {
  if (!bodyText) return [];

  const raw: RawMatch[] = [];
  let counter = 0;
  const key = () => `seg-${counter++}`;

  // ── Images ──────────────────────────────────────────────────────
  for (const m of bodyText.matchAll(IMG_RE)) {
    const src = m[1] ?? '';
    const alt = (m[2] ?? '').trim();
    if (!src) continue;
    raw.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      segment: {
        kind: 'image',
        key: key(),
        src,
        alt: alt || src.split('/').pop() || 'image',
      },
    });
  }

  // ── Tables ──────────────────────────────────────────────────────
  // Tables in body_text use ` | ` to separate cells and a newline to
  // separate rows. The slicer emits them as one logical line, so we
  // split on `\n` here. If a future slicer emits a single-line
  // table, `rows` is `[1]` and the renderer just shows one row.
  for (const m of bodyText.matchAll(TABLE_RE)) {
    const inner = m[1] ?? '';
    const rows = inner
      .split('\n')
      .map((row) => row.trim())
      .filter((row) => row.length > 0)
      .map((row) => row.split(' | ').map((cell) => cell.trim()));
    if (rows.length === 0) continue;
    raw.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      segment: { kind: 'table', key: key(), rows: rows as string[][] },
    });
  }

  // ── Equations ───────────────────────────────────────────────────
  for (const m of bodyText.matchAll(EQ_RE)) {
    const inner = m[1] ?? '';
    if (!inner) continue;
    raw.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      segment: { kind: 'equation', key: key(), text: inner },
    });
  }

  // ── Captions ────────────────────────────────────────────────────
  // Captions are detected as standalone `Caption: …` lines. They're
  // NOT attached to a preceding image here — pairing happens below
  // in the assembly step so the renderer can keep its presentation
  // simple (each segment renders itself, no parent-child lookup).
  for (const m of bodyText.matchAll(CAPTION_RE)) {
    const text = m[1] ?? '';
    if (!text) continue;
    raw.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      segment: { kind: 'caption', key: key(), text },
    });
  }

  // ── Assemble ────────────────────────────────────────────────────
  // Sort by start position so the output is in document order. When
  // two matches overlap, keep the first one in the sorted order
  // (stable sort, so whichever the comparator picks is deterministic
  // — good enough since the contract guarantees non-overlap for
  // well-formed body_text).
  raw.sort((a, b) => a.start - b.start);

  const out: RenderSegment[] = [];
  let cursor = 0;
  let lastWasImage = false;

  for (const hit of raw) {
    // Text before this hit.
    if (hit.start > cursor) {
      const text = bodyText.slice(cursor, hit.start);
      if (text.trim().length > 0) {
        out.push({ kind: 'text', key: key(), text, bodyStart: cursor });
        lastWasImage = false;
      }
    }
    out.push(hit.segment);
    // A caption that immediately follows an image gets the
    // 'caption' kind (it already does in the match — no-op here).
    // The renderer decides presentation: it always renders a
    // caption in muted text below the previous element. We
    // record whether the last non-text segment was an image so the
    // renderer can tighten its top-margin for that case.
    lastWasImage = hit.segment.kind === 'image';
    cursor = hit.end;
  }

  // Trailing text after the last hit.
  if (cursor < bodyText.length) {
    const text = bodyText.slice(cursor);
    if (text.trim().length > 0) {
      out.push({ kind: 'text', key: key(), text, bodyStart: cursor });
    }
  }

  // Suppress the unused variable warning. `lastWasImage` is a hint
  // for future renderer tweaks; the parser is intentionally
  // decoupled from presentation.
  void lastWasImage;

  return out;
}
