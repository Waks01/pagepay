# Design Plan v3: Education Catalog Depth & Reader Experience

**Date:** 2026-07-13
**Scope:** v2 follow-on — education catalog taxonomy, content class-level
granularity, diagram support, and a 3-mode reader
**Status:** 📋 **DRAFT — pending review** — not yet implemented
**Supersedes:** v2 § Home, Catalog, Reader (deeper taxonomy + reader modes)
**Pairs with:** `books/design-plan-v2.html` (visual design), `books/books.md` (OER strategy)

---

## Why this doc exists 

v2 shipped the OpenStax education ingest and the work-level social
features. The catalog has an `education_level` filter and a per-class
class-level grid, but only one slice per chapter is being persisted in
practice (now fixed in the ingest — see §5). Beyond the ingest bug, three
gaps are visible to a real Nigerian student:

1. **No way to find "WAEC-relevant content for SS2."** The catalog
   filters by subject and level, not by class. A JSS2 student looking
   for "JSS2 Mathematics" sees everything tagged "secondary" and has
   to guess.
2. **Diagrams are stripped at ingest time.** OpenStax chapters contain
   30-50 inline images per chapter. We strip them with the rest of the
   HTML, so a physics slice is a wall of text with "see Figure 3.1"
   references to nothing.
3. **One reader mode for every use case.** A student cramming for an
   exam, a casual reader, and a commuter listening with earphones are
   all using the same screen. The reader is the highest-leverage place
   in the app; it should be a swiss army knife, not a single blade.

This plan addresses all three.

---

## 1. Education catalog taxonomy (decisions)

### 1.1 Education levels — keep the existing 6

```
creche     → 0-2 yrs      (coloring, basic picture books)
primary    → 3-11 yrs     (Primary 1-6)
secondary  → 12-17 yrs    (JSS1-3, SS1-3)
tertiary   → 18-24 yrs    (Year 1-4, 100-400 level courses)
research   → postgrad     (papers, monographs, advanced texts)
```

**Decision:** Keep all 6. Do NOT add a "technical / vocational" level
— that's a content source, not a level, and gets modeled as `subject`
(see §1.3).

### 1.2 Class-level field (NEW)

Add `class_level: str | None` to `content_catalog`. Populated by the
ingest pipeline.

**Vocabulary decision: use international Grade 1-12.**

The app may go global tomorrow, and country-specific labels
("JSS1", "Year 1", "100L") only make sense in one educational
system. Grade 1-12 is the international standard and maps cleanly:

- Creche: `class_level = None` (no grade system)
- Primary: `"Grade 1"` … `"Grade 6"`
- Secondary: `"Grade 7"` … `"Grade 12"` (Grade 7-9 = JSS1-3, Grade
  10-12 = SS1-3, both systems align at this mapping)
- Tertiary: `"Year 1"` … `"Year 4"` (international undergrad) — Grade
  N/A at this level
- Research: `None`

**Future country/region scoping:** the `class_level` column is a free
string, so a country-specific vocabulary (e.g. `"NG-SS2"`,
`"US-Grade 10"`) can coexist with the global `Grade N` form. Filter
UI can hide the country prefix and show only the grade when the user
isn't opted into a region.

**Migration:** Alembic 015 adds the column with `IF NOT EXISTS`,
indexed on `(education_level, class_level)` for catalog filter speed.

**Display:** A new chip on the book detail and catalog cards, e.g.
"Grade 10 · Physics · First Term". Localized via i18n (en/yo/ig/ha).

### 1.3 Subject — the *primary* filter, not level

The v2 plan already has `subject` (physics, biology, mathematics, …).
Treat subject as the **first** filter a user picks, level/class as the
**second**. This is how a JSS2 student actually searches:

```
subject=Mathematics → level=Secondary → class=SS2
```

Not:

```
level=Secondary → class=SS2 → subject=Mathematics
```

UI: subject chips on the catalog screen, level/class as a secondary
collapsible grid. This matches v2's catalog layout but reverses the
default collapsed/expanded state.

**Cut from plan:** Per-department tertiary routing (Mechanical
Engineering, MBBS, etc.). OpenStax's "University Physics Vol 1" is the
same book across engineering, physics, and applied-math departments —
department is a moving target per school, and we don't have content
varied enough to justify the dimension. Tag the book at the source
level (e.g. `subject=physics, course=university-physics-v1`) and let
the search handle the rest.

### 1.4 Early-years bundle

**Decision:** Collapse creche + nursery into a single "Early Years
(0-5)" top-level category. The content volume doesn't justify two
taxonomy entries, and "creche" + "nursery" is the same 4-5 books in
practice. Free up the level grid slot for "Primary" which has real
volume.

---

## 2. Diagrams in the reader (the highest-ROI change)

### 2.1 The problem

OpenStax chapters contain ~30-50 inline diagrams, photos, and equations
per chapter. Our current ingest strips all HTML including `<img>` tags
— the reader shows "see Figure 3.1" with nothing to see. For a STEM
app this is a deal-breaker: physics without free-body diagrams is just
prose.

### 2.2 What to keep

Keep these HTML elements during ingest (everything else continues to
be stripped):

- `<img src="..." alt="...">` — diagrams and photos
- `<figcaption>` — captions (render below the image)
- `<div data-type="equation">` — display equations (render with a
  simple MathJax-compatible server-side pass; or just preserve the
  LaTeX text in a `<span class="math">` for client-side KaTeX)
- `<table>` — data tables (small, education-critical)

### 2.3 Image hosting

OpenStax serves images from `https://openstax.org/apps/archive/...`
and `https://cnx.org/...`. The cheap-and-correct path:

**v1: hot-link OpenStax directly.**

- Zero infrastructure, instant. OpenStax is a non-profit and serves
  book images for free academic use with no rate limits.
- 5-10GB total image volume for 12 books fits inside any CDN-free
  budget.
- Risk: if OpenStax reorganizes their image paths, our `<img>` URLs
  break. Acceptable for v1 — we control the HTML output, so we can
  rewrite the proxy path in one place if/when needed.
- Cost: **$0.**

**v2 fallback: proxy + cache** if hot-link breaks.

- Add `GET /api/v1/content/images/{image_id}` that proxies OpenStax
  with a 30-day `Cache-Control` header and a local disk cache
  (~5-10GB).
- One-day backend change. No new vendor — we already run FastAPI.
- Cost: **disk only**, no monthly bill. Cloudflare's free tier covers
  the volume if we ever need an external CDN.

**Self-host (Option C in earlier drafts): cut.** Disk + bandwidth on
our own infra costs more than the proxy approach and buys us
nothing the proxy doesn't give us.

### 2.4 Reader rendering

The reader should:
- Render images at full column width with a max-height cap
- Show captions in smaller, muted text below
- Pin the first diagram to the top of the slice as a hero (opt-in, not
  forced)
- Cache decoded images on the client with `expo-image` (already
  installed for AdMob creatives — reuse it)

**Server→client element contract.** The slicer rewrites the four
preserved elements into stable text sentinels inside the body
text. The reader detects them with a regex and swaps in a native
component. The sentinels are:

| Source element | Sentinel in body text | Client rendering |
|---|---|---|
| `<img src="…" alt="…">` | `[[IMG:https://…/foo.png\|Alt text]]` | `expo-image` full-width |
| `<figcaption>…</figcaption>` | `Caption: <text>` on its own line | Muted text below the preceding IMG |
| `<table>…</table>` | `[TABLE START]` … rows joined with ` \| ` … `[TABLE END]` | V1: monospace block. V2: real table component |
| `<div data-type="equation">…</div>` | `[[EQ:<inner>]]` | V1: monospace inline. V2: `react-native-katex` |

The src/alt separator inside `[[IMG:…]]` is a literal pipe `|`.
The alt may be empty (`[[IMG:src|]]`); the reader falls back to
the src filename as the accessibility label. The four sentinels
are part of the server/client contract — don't change them
without a re-ingest of the catalog.

### 2.5 Migration order

1. Update `topic_slicer.py` to preserve `<img>` / `<figcaption>` /
   `<table>` / `<div data-type="equation">` tags during `_strip_html_tags`
2. Add `/content/images/{id}` proxy endpoint with disk cache
3. Update reader screen to render the preserved elements
4. Re-ingest the 12-book OpenStax curriculum (delete existing slices
   first — see §5 for the safe-delete procedure)

---

## 3. The 3-mode reader

A single screen cannot be optimized for reading, studying, and
listening. The reader becomes a switcher between three modes. Same
content, different jobs-to-be-done.

### 3.1 Mode A — **Read** (default)

Clean prose. Large text (17-19px body on mobile, not 14). Swipe
between units. The current implementation, with these refinements:

- **Sepia theme** as a third option (alongside light and dark). It's
  the single most-requested "comfortable reading" setting globally and
  costs nothing.
- **Larger default body text** — bump the current default from 14 to
  17. Users can shrink if they want.
- **Hero diagram** for slices that have one (rendered above the body
  text, max 30% of screen height)
- **Reading position indicator** — thin progress bar at the top of the
  slice, shows what % of the current unit is scrolled

### 3.2 Mode B — **Study**

Highlights, notes, and inline MCQ prompts. Activated by a tap on the
bookmark icon in the unit header.

- **Long-press any paragraph** to highlight. Highlights are persisted
  to `users.study_data` (see Appendix A) keyed by unit id
- **Highlight → share-as-image.** One tap converts the highlighted
  paragraph to a 1080×1080 PNG with the book title + page number, ready
  for WhatsApp. This is the viral loop: students share to class
  groups, friends see the screenshot, they install the app
- **End-of-unit MCQ prompt.** After finishing a unit, the Study mode
  offers a 3-question MCQ generated by the Phase 3 AI router. Skip if
  no AI available
- **Notes per unit.** A small textarea below the body. Stored in the
  same `users.study_data` blob (keyed by unit id)

### 3.3 Mode C — **Listen**

Audio narration, hands-free, screen-off friendly.

- **Pre-rendered MP3** per unit, hosted on the same `/content/images/`
  pattern (or a `/content/audio/` parallel)
- **Generated server-side** with `edge-tts` (free, decent quality)
  in a one-time batch job. ~30-50 hours of audio total for the
  OpenStax curriculum — fits in a day of batch processing
- **Free for unit 1** of every section; **premium for units 2+** —
  this is the natural upsell moment, since "I want to keep listening"
  is a high-intent signal
- **Player UI** in the unit header: play/pause, ±15s skip, speed
  (0.75x / 1x / 1.25x / 1.5x), background playback via
  `expo-av` audio mode

### 3.4 Mode switcher UX

A three-segment control pinned to the bottom of the reader (similar
to iOS's segmented control, custom-styled to match the PagePay theme):

```
[ Read ] [ Study ] [ Listen ]
```

Tap to switch. The user's choice persists per-slice (so a student who
defaults to Study on Physics keeps that preference). Stored in
`reading_progress` as a new `reader_mode: enum('read', 'study', 'listen')`
column, default `'read'`.

### 3.5 What to cut

- **3D models / animations** in the reader. Beautiful in pitch decks,
  not built on Nigerian mobile networks. Ship diagrams + audio, not
  WebGL.
- **Per-paragraph TTS highlight** (karaoke-style word tracking). Nice
  to have, not MVP. Add in a later phase.
- **Voice input for notes.** Out of scope.

---

## 4. Discoverability & resume flow

### 4.1 Resume-to-last-slice

**Problem:** If a user closes the app mid-section, the home screen
shows the work but not the specific slice they were on. They have to
navigate to the work detail, then pick the slice, then scroll to
where they were.

**Fix:** Home + catalog + search results show a "Continue reading" card
that opens directly to the user's last-read unit. The current "next
read" card exists; this is just making it deep-link to the unit, not
the slice.

### 4.2 Class-level filter on the catalog

The catalog's "By class" filter appears in the secondary tab:
- Primary: Grade 1, Grade 2, …, Grade 6
- Secondary: Grade 7, Grade 8, Grade 9, Grade 10, Grade 11, Grade 12
- Tertiary: Year 1, Year 2, Year 3, Year 4

Tapping a class filters the list. Selection persists for the session
(not across app launches — that's noise).

### 4.3 Search

The current catalog has subject chips. Add a search bar that queries
`content_catalog.title` (full-text) and `subject`. Server-side
filtering on `(education_level, class_level, subject, search)`. A
single SQL query, no Algolia needed at this scale.

---

## 5. Re-ingest procedure (manual)

The v2 ingest had a bug where each chapter became 1 slice instead of
N. That's now fixed (chapter walks all section pages). To repopulate
the DB with the corrected data:

1. **Backup** the production DB before doing anything
2. Run a one-off SQL script to delete all rows with `source='openstax'`
   from `content_catalog` (cascade will handle `reading_progress` and
   `slice_bookmarks`)
3. Run the existing admin `POST /api/v1/admin/seed` endpoint, OR
   directly call `import_openstax_books()` from a Python shell
4. Verify: `SELECT count(*) FROM content_catalog WHERE parent_work_id
   IS NOT NULL AND source='openstax';` should return ~300+ (was ~24
   before)
5. Verify reading units: `SELECT count(*) FROM reading_units;` should
   return ~800+

The whole procedure is documented as
`backend/scripts/reingest_openstax.py` — run `--dry-run` first to
see the blast radius, then `--yes` to actually wipe + re-ingest.
Scope to a single slug with `--only-slug <slug>` for verification.

---

## 6. Migration plan (ordered by ROI)

### Now (1-2 days)
- [x] Alembic 015: add `content_catalog.class_level` (nullable, indexed)
- [x] Update `_strip_html_tags` to keep `<img>`, `<figcaption>`,
      `<table>`, `<div data-type="equation">`
- [x] Re-ingest script: `backend/scripts/reingest_openstax.py` (procedure in §5)
- [x] Sepia theme + larger default body text in the reader
- [x] Reorder catalog filters (subject first, level/class second)

### Next sprint (1-2 weeks)
- [ ] Image proxy endpoint + disk cache
- [ ] Reader renders images / tables / equations
- [ ] Class-level filter on the catalog secondary tab
- [ ] Resume-to-last-unit on the home + catalog screens

### Following sprint (Phase 3 prep)
- [ ] Highlights + share-as-image (stored in `users.study_data` blob,
      not a new table — see Appendix A and §1.5)
- [ ] TTS audio generation (edge-tts batch job)
- [ ] Reader mode switcher (Read / Study / Listen)
- [ ] `reading_progress.reader_mode` column
- [ ] `users.study_data` JSON column (single column, holds highlights
      + notes; saves a table)

### Cut from this plan
- [ ] Per-department tertiary routing — tagged at source level instead
- [ ] Creche + nursery as separate top-level — bundle as "Early Years"
- [ ] 3D models / WebGL — out of scope for this market and network
- [ ] Per-paragraph TTS highlight — post-MVP

---

## 7. Success metrics

We need to know if this is working. Track these post-launch:

| Metric | Target | How to measure |
|---|---|---|
| Re-ingest slice count | 300+ slices for OpenStax | DB count |
| OpenStax reader sessions / week | 1,000+ after launch | Client analytics |
| Average time on a slice (OpenStax) | > 90 sec | Reading session log |
| Highlights created / week | 500+ | `users.study_data.highlights` length |
| Share-as-image → installs | > 5% conversion | UTM-tagged install link |
| Listen mode sessions / week | 200+ | `reader_mode='listen'` log |
| Premium conversion from Listen paywall | > 2% | Wallet `user_tier` upgrade log |

If OpenStax reader sessions don't reach 1,000/week within a month, the
content isn't landing and we need to revisit the subject/class mix
before adding more features.

---

## 8. Open questions — resolved

1. **Class-level vocabulary.** ~~JSS1-SS3 vs Grade 7-12.~~ **Resolved: Grade 1-12.**
   International, future-proof for global. Country-specific labels can
   coexist as a future region-scoped vocabulary on the same column.
2. **Sepia as a 3rd theme.** ~~Adding a third option is more code.~~ **Resolved: yes, add sepia.**
3. **Image hosting: do we need a CDN?** ~~At the current book count.~~ **Resolved: hot-link for v1, proxy+cache fallback. Zero cost.**
4. **Audio generation cost.** ~~`edge-tts` is free.~~ **Resolved: confirmed. One-time batch on the cron container.**
5. **Highlights without a dedicated table.** ~~Could be local-only.~~ **Resolved: store as JSON blob on `users.study_data`** (see Appendix A).
   Server-side from day 1; students expect highlights to survive a
   phone reset. The "fetch directly" instinct is right for *shared
   catalog data* (where OER text is the same for everyone) but wrong
   for *per-user data* (where there's nothing to fetch from if the
   user never persisted it). See §1.5 below.

### 1.5 Per-user data: the "fetch directly" rule

When to store, when to fetch live:

| Data | Storage decision | Why |
|---|---|---|
| Highlights | `users.study_data` (JSON blob) | Per-user, no cross-user queries needed, must survive reinstall |
| Notes | `users.study_data` (JSON blob, same column) | Per-user, small, never queried across users |
| Last position per book | `reading_progress` (real table) | Real queries: "where did this user leave off?" |
| Reading unit text | `reading_units` (real table) | Has to be offline-cacheable; OER source is the same for everyone |
| Slice text | `content_catalog` (real table) | Same as above; allows editorial control |
| OER book metadata | `content_catalog` (real table) | Real queries: filter by subject/class/level |
| Class-level filter UI state | Client-side only | Session-scoped, no value in persisting |

**The principle:** use a real table when you need to query the data
(filter, join, aggregate). Use a JSON blob on the parent when the
data is owned by one parent and never queried across parents.

The "fetch directly" alternative would mean re-fetching OpenStax
content on every slice load. That's a regression: OpenStax goes
down → no reading, no offline, 2-5 second latency on every load.
We already ingest once into `content_catalog`; that is the right
trade.

---

## Appendix A: Data model changes

```python
# content_catalog
+ class_level: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
# example values: "Grade 1" .. "Grade 12", "Year 1" .. "Year 4", None

# reading_progress
+ reader_mode: Mapped[str] = mapped_column(String(16), default="read", server_default="read")
# enum: 'read' | 'study' | 'listen'

# users
+ study_data: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
# shape:
# {
#   "highlights": {
#     "<unit_id:int>": [
#       {"p": <paragraph_index>, "color": "yellow"|"green"|"pink", "ts": "<iso8601>"},
#       ...
#     ]
#   },
#   "notes": {
#     "<unit_id:int>": {"text": "<=2000 chars>", "ts": "<iso8601>"}
#   }
# }
# Why a blob and not a table: per-user data, never queried across users.
# Saves a JOIN on every read, keeps the data with its owner. Migration
# cost is low (default = {}). If we ever need cross-user analytics
# (e.g. "what's the most-highlighted paragraph in this book") we
# add a materialized view later — but at 1 write per highlight, the
# raw table is the wrong shape.
```

## Appendix B: API surface (additions only)

```
GET  /api/v1/content/works?class_level=Grade 10&subject=physics&page=1
GET  /api/v1/content/units/{unit_id}                          # new — unit detail
GET  /api/v1/content/users/me/study-data                      # new — fetch all highlights + notes
PUT  /api/v1/content/users/me/study-data                      # new — replace blob (atomic)
PATCH /api/v1/content/users/me/study-data/highlights/{unit_id} # new — append/remove one highlight
PATCH /api/v1/content/users/me/study-data/notes/{unit_id}     # new — upsert one note
GET  /api/v1/content/images/{image_id}                        # new — proxy + cache (v2 fallback)
GET  /api/v1/content/audio/{unit_id}.mp3                      # new — TTS audio
```

All endpoints are JWT-gated except `/images/` and `/audio/` (those are
public, cached at the CDN). The study-data endpoints use `PUT` (full
replace) and `PATCH` (delta) so the client can choose — full replace
is simpler for offline-first syncing, PATCH is leaner on bandwidth
when the user makes one small change.

**Why one blob, not a per-highlight endpoint:** a high-frequency
write pattern (the user is highlighting paragraphs while reading)
should not require a round trip per highlight. The client batches
local changes and syncs the blob every 10 seconds or on
app-background. This is the same pattern Notion and Apple Notes use.

## Appendix C: Dependencies to add

- `react-native-math-view` or `react-native-katex` for equation
  rendering (client-side, lazy-loaded)
- `expo-image` is already in the project — reuse for diagrams
- `expo-av` for audio playback (may already be in for video ads)
- `edge-tts` (Python, server-side) for audio generation — adds
  ~3 minutes to Docker build, no runtime cost

No new vendor dependencies. No Algolia, no Sentry, no third-party
CDN. The whole plan runs on the existing FastAPI + Expo stack.
