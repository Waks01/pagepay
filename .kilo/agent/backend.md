# Backend Engineer Agent
**Project:** PagePay — Read-to-Earn & AI Study Platform
**Stack:** Python 3.11+, FastAPI, PostgreSQL 18 (local Docker and production on Render), SQLAlchemy 2.0 async, Alembic, Gunicorn + Uvicorn

---

## Mission
Build, maintain, and evolve the PagePay backend API. Own database schema, API contracts, AI routing, ad verification, and business logic integrity. This is a production revenue system — no placeholders, no mock data, no TODOs. Every endpoint handles real money or real user engagement.

## Core Responsibilities

### 1. Database Layer
- **Database:** PostgreSQL 18 (local Docker via `docker-compose.yml` and production on Render.app)
- Use `asyncpg` driver with SQLAlchemy 2.0 async engine for PostgreSQL
- All models inherit from `DeclarativeBase`
- Use `Mapped` and `mapped_column` for typing (never raw `Column` without type)
- Use `AsyncSession` injected via FastAPI `Depends(get_db)`
- Always `await` session operations: `await db.execute()`, `await db.commit()`, `await db.refresh()`
- Connection pooling: `pool_size=20, max_overflow=10, pool_recycle=1800`
- `pool_pre_ping=False` currently; consider `True` for production stability if stale-connection errors appear
- Migrations: use Alembic for schema changes in production

### 2. API Design Rules
- Version prefix: `/api/v1/`
- RESTful endpoints: `GET` (read), `POST` (create/action), `PUT` (update), `DELETE` (remove)
- Response envelope: `{"data": ..., "meta": {"page": 1, "total": 100}}` for lists
- Error envelope: `{"error": {"code": "RESOURCE_NOT_FOUND", "message": "...", "details": {}}}`
- Status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 429 (rate limit), 500 (server error)
- All endpoints require JWT auth except public login/register
- Use Pydantic v2 models for request/response validation

### 3. Authentication
- JWT tokens (HS256) with 7-day expiry
- Refresh token rotation on login
- Store hashed passwords with bcrypt or argon2
- Phone or email as unique identifier
- Rate limit login: 5 attempts per 15 minutes per IP

### 4. Reading Engine
- Timer logic: server tracks slice start/end timestamps; client reads remaining time from `/progress/continue`
- Points formula: a flat slice completion bonus (2 pts base, env `READING_SLICE_BONUS_POINTS`) multiplied by the user's tier multiplier — 1.0x free, 1.5x any paid tier (read via `tier_benefits.get_multiplier`, never hardcoded per tier)
- Anti-cheat: server-side only — validate dwell time >= 60s per slice before awarding points; flag users with >3 suspicious sessions for admin review

### 5. AI Router
- **Single provider: Cloudflare Workers AI.** The old multi-provider pool (Gemini / Groq / Cerebras / OpenRouter / Mistral) was removed in commit `cd01eff`. There is no failover and no circuit breaker — a Cloudflare outage is a 503 on every AI feature.
- `route_ai(prompt, task_type=..., model_tier=...)` in `app/ai/router.py` is a **Python function, not an HTTP endpoint**. Callers import it; there is no `POST /api/v1/ai/route`.
- Two text models, chosen by tier:
  - `settings.ai_standard_model` = `@cf/ibm-granite/granite-4.0-h-micro` — definitions, recall, direct lookups (~₦0.68/turn)
  - `settings.ai_premium_model` = `@cf/zai-org/glm-4.7-flash` — multi-step reasoning, marking, exam strategy (~₦2.43/turn)
- `app/ai/routing.py::classify_turn()` decides the tier from the question; it errs toward premium because a cheap wrong answer costs a student more than a saved fraction. `settings.ai_routing_enabled` forces everything to premium while validating the split.
- Generation tasks (SOW parse, asset generation, exam questions) always use the premium model — a misparsed syllabus or a wrong answer key is not worth saving a fraction on.
- Vision: `@cf/meta/llama-3.2-11b-vision-instruct` for image/PDF OCR. TTS: `@cf/myshell-ai/melotts`.
- **Cloudflare returns text in `result.response`**, not `result.choices[0].message.content` (that is the OpenAI-compatible shape). Reading the wrong key silently produces an empty response and a 503.
- Streaming: use `StreamingResponse` with generator for chat endpoints

### 6. Ad SSV (Server-Side Verification)
- **AdMob is the only live ad network.** AppLovin is not implemented — `applovin_sdk_key` / `applovin_webhook_secret` are inert config fields.
- Webhook endpoint:
  - `GET /api/v1/study/ads/complete` — AdMob Server-Side Verification (AdMob uses GET in practice). This is the callback URL registered on the rewarded ad unit in the AdMob UI.
- Verification lives in `app/services/admob_ssv.py`:
  - ECDSA P-256 signature using AdMob's published public keys (`verifier-keys.json`, cached ≤ 24h because the keys rotate). **The key fetch must follow redirects** — `gstatic.com` answers 301 to `www.gstatic.com` and httpx does not follow redirects by default, so without `follow_redirects=True` the key fetch fails on every call.
  - Signed data is the raw query string up to `&signature=`, preserving original parameter order
  - Signature is base64url without standard padding
  - The caller's IP must reverse-resolve to a Google-owned host. The allowlist is `googlebot.com`, `google.com`, **`1e100.net`**, **`dns.google`**, **`googleusercontent.com`** — `1e100.net` is Google Front End, which is where AdMob's SSV calls actually originate. A narrower list rejects every real callback.
  - **A DNS failure must not block a valid callback.** The ECDSA signature is the real gate (only Google holds the private key). Google re-sends a callback five times then gives up, so a callback blocked by a DNS timeout is a permanently lost credit. `origin_is_google()` returns `None` for an unresolvable host (allow it) and `False` only for a host that resolves to something genuinely non-Google (refuse it).
- Idempotency: `transaction_id` is the dedupe key — AdMob retries up to 5 times, so a replayed callback must not double-credit
- Credit only after the signature verifies. On failure: log, return non-200, credit nothing.
- Payout: `rewarded_ad_gross_points` (20) is the ad's value; `rewarded_ad_payout_points` (16) is what the user gets, derived from `platform_ad_revenue_percent` (20%). **Never let the two disagree.**
- Ad-earned credit must land in `service_credit_balance`, never `cashable_balance` — a withdrawable payout collapses the ad margin from 60% to 20%

### 7. Payments & Wallet (Paystack)
- **Wallet Deposits:**
  - `POST /api/v1/wallet/deposit` → returns Paystack checkout URL
  - Minimum deposit: ₦500 (50,000 kobo)
  - Points conversion: 10 points = ₦1
  - NOTE: Webhook wallet credit after deposit is not yet implemented; `payments/paystack/webhook` currently only handles subscription tier upgrades
  - Per-tx and 24h rolling deposit caps enforced before Paystack call
   
- **Withdrawals:**
  - `POST /api/v1/payouts/withdraw` → sends money to user's bank via Paystack Transfers
  - Fee tiers: ≤₦5k = ₦15, ≤₦50k = ₦35, >₦50k = ₦70
  - Minimum withdrawal: ₦1,000
  - Webhook: `POST /api/v1/payouts/webhook` → confirms transfer, handles failures
   
- **Premium Subscription (one plan):**
  - `POST /api/v1/payments/initiate` → returns payment URL
  - **₦3,000/month or ₦30,000/year.** There is one product, not two.
  - The tier structure collapsed in commit `6ce5d72`. The old keys `study_plus_monthly` / `study_plus_yearly` / `complete_plus_monthly` / `complete_plus_yearly` all remain in `UserTier` and all resolve to the identical benefits and price, because renaming the enum is a data migration and an unknown key falls back to the *free* tier — a rename could silently demote paying users.
  - The old Study+ ₦1,000 / Complete+ ₦2,000 prices are gone.
  - What ₦3,000 buys today: free asset unlocks, free audio narration, 15 chat turns/day, 1.5x reading/task/bills/daily multipliers, a **2,500 SV monthly allowance** (`premium_sv_monthly_allowance`, granted by the scheduler via `services/sv_allowance.py`) and a **30% top-up discount** (`premium_top_up_discount_percent`, applied in `services/money.py` to unified deposits). Ad rewards stay 1.0x — free and paid both get a flat 16 SV per ad, deliberately.
  - The allowance is credited as **service credit, never withdrawable** — a withdrawable monthly grant would turn the subscription into a cash giveaway.
  - Webhook upgrades user tier after successful payment

### 8. Bills & VTU (Peyflex / BigiSub)
- **Two providers are supported**, selected by `settings.bills_provider` (default `peyflex`; set `bigisub` to switch). `_get_vtu_client()` in `routers/bills.py` picks the client — code that hardcodes one provider is wrong.
- **Endpoints:**
  - `POST /api/v1/bills/airtime` → buy airtime
  - `POST /api/v1/bills/data` → buy data bundle
  - `POST /api/v1/bills/electricity` → buy electricity tokens
  - `POST /api/v1/bills/tv` → buy TV subscription
  - `GET /api/v1/bills/data/networks` → list networks
  - `GET /api/v1/bills/data/plans` → list plans for network
  - `POST /api/v1/bills/detect-network` → detect phone network from number
  - `POST /api/v1/bills/validate-meter` → validate meter (exists but NOT automatically called before purchase)
  - `POST /api/v1/bills/validate-smartcard` → validate smartcard (exists but NOT automatically called before purchase)

- **Commission Model:**
  - Real-time commission from the provider's `discount` field in the response
  - User gets `bills_user_share` (0.70) of commission as points; platform keeps 30%
  - The credited amount is **service credit, never cashable** — the cashable variant of this is what drained the wallet before (commit `c5a8011`)
  - All prices come from the provider API (no hardcoded fallbacks)

- **Payment Flow:**
  1. Debit user's points balance
  2. Call the provider to fulfill purchase
  3. Extract commission from response
  4. Credit the user's share of commission back as points
  5. Record BillTransaction for audit
- **Validation:** Meter/smartcard validation endpoints exist but are NOT enforced before purchase calls. Users can buy electricity/TV without prior validation.

### 9. AI Study System (SOW Upload)
- Upload: `POST /api/v1/study/sow/upload` (text), `/upload-image`, `/upload-document` (PDF/DOCX/TXT)
- Each upload creates a `SowUploadJob` row and a background task; the client polls `GET /api/v1/study/sow/jobs/{job_id}`.
- **PDFs are read as pictures, not as text.** A PDF is rendered page by page with PyMuPDF and each page goes to the same Cloudflare Vision model the image route uses. A PDF's embedded text layer is not used — a scan or a photo has none, and the parser would receive an empty string. There is no text-extraction fallback and no `pdf_has_no_text_layer` error.
  - Render at 1400px wide (`_OCR_PAGE_MAX_WIDTH`) — the 900px preview thumbnails are too soft to read
  - Pages OCR 4 at a time (`_OCR_PAGE_CONCURRENCY`), capped at 20 pages (`_OCR_MAX_PAGES`)
  - A page that fails OCR is logged and skipped; only a total failure raises
- DOCX and TXT are read as text — they have a real text layer.
- The job row carries **real progress**: `progress` (0-100) and `stage` (`queued` | `reading_pages` | `parsing_ai` | `saving` | `completed`). The client renders these; never fake progress with a poll counter.
- The SOW parser prompt is `SOW_PARSER` in `app/ai/prompts.py`; it runs on the **premium** model — a misparsed syllabus is not worth saving a fraction on.
- **Page and figure artifacts** (`app/services/page_artifacts.py`, migration `047`): after the text is read, the document's pages are rendered at full fidelity (1800px, `study_page_render_width`) and its diagrams are cropped out and stored in Cloudflare R2, so the app can show the student their own material without the phone pulling a whole PDF. Figures are located by Tesseract's prose boxes — the ink that is *not* prose is the diagram. **Nothing in this path is allowed to fail the upload**: a material with no page images is still a valid material and the app falls back to rendering the source on demand. Tesseract is used for figure geometry only — it is **not** an OCR path for the AI.

#### 9a. Nothing On The Page Is Lost
A student's upload is a *document*, not a wall of text. It has diagrams, graphs, circuits, tables and worked illustrations, and the study screen promises that none of it is thrown away. The pipeline is in `app/services/page_artifacts.py`.

- **Pages.** Every page is rendered at 1800px wide and written to object storage under `study-pages/{job_id}/{n}.jpg`. The app's "My material" view loads them from the CDN. `GET /api/v1/study/materials/{id}/page-images` returns the URLs.
- **Figures.** Every diagram-like region is cropped and written to `study-figures/{job_id}/{n}.png`. `GET /api/v1/study/materials/{id}/figures` returns them with a plain-language description.
- **Figures are found from the file's own geometry, never from a vision model.** A PDF already knows where its graphics are: `page.get_drawings()` for vector art, `page.get_image_rects()` for photographs, `page.get_text("blocks")` for prose. A region that carries ink but no prose is a figure. Vision models are good at *describing* a picture and bad at saying *where* it is — asking one for coordinates produces confident nonsense and wrong crops.
  - **PyMuPDF traps to avoid.** `Rect.is_empty` is true when either side has no length, so it throws away every horizontal rule and every vertical one — and the arrows between the boxes of a flowchart are exactly those. `Rect | Rect` is the intersection, not the union, and `include_rect` silently refuses a rectangle with no area. The clustering in `_cluster_rects` therefore works on plain `(x0, y0, x1, y1)` tuples.
  - A scanned page has no geometry. There, Tesseract supplies the prose boxes and the ink that is *not* prose is separated out. When Tesseract is not installed the whole page is kept as one figure, which loses nothing.
- **A page's pictures are found by a second, separate call.** The transcription prompt is not asked about pictures at all. Asking one call to transcribe a page *and* to describe its pictures made the model invent a parabola with a vertex at (−1, 2) on two pages of a real algebra textbook that contain nothing but prose — and a made-up graph is worse than no graph, because the student is then taught something that is not in their material. `FIGURE_DETECTION_PROMPT` asks one focused question ("does this page hold a picture that shows information?") and it answers NO for prose and YES for graphs, naming the equations on them correctly.
  - The same call reports the page's **running header and footer**, which are then stripped from the transcribed text with `_strip_furniture`. A footer left in becomes a paragraph in the student's lesson.
  - A description that mentions nothing that shows information — a crest, a letterhead, a decorative border — is discarded by `_is_decoration_only`. A letterhead logo is not a figure to teach.
- **Descriptions.** Every crop is sent to the vision model with `FIGURE_DESCRIPTION_PROMPT`. The description is what the teaching layer explains and what the narration speaks, so a student who cannot see the picture still gets its content.
- The OCR prompt is `VISION_OCR_PROMPT`. It demands markdown structure, `[TABLE: …]` lines, and `[ILLEGIBLE]` for text the model cannot read, and it asks for mathematics in dollar signs. It does **not** ask for explanations — faithfulness and teaching are separate jobs.
- **A prompt that is never `format()`ed must not carry format escapes.** `VISION_OCR_PROMPT` is sent as it stands, so a `{{` in it is a `{{` the model copies into the material: every formula came out as `ax^{{2}}`. The prompts that *are* `format()`ed need the doubling. `TEACH_FROM_LESSON` is a *substituted value*, so it needs single braces — `str.format` does not unescape what it substitutes. `tests/test_study_artifacts.py::TestPromptBraces` guards all of this.

#### 9b. The Teaching Layer
`parsed_structure` is deliberately faithful to the source. The teaching layer is a second column, `study_materials.explanation_structure`, holding the same material rewritten for a beginner: plain language first and the technical term second, everyday analogies, every worked example walked through, every diagram described in words.

- Prompt: `STUDY_EXPLANATION` in `app/ai/prompts.py`. Builder: `app/services/study_explanation.py`.
- The teaching layer is what the reader shows in "Explained" mode, what the tutor quotes, and what the narration speaks. The faithful layer is never overwritten — the student still sees exactly what they uploaded in "My material" mode.
- A failure here is **not** a failure of the upload. `_build_explanation_safely` swallows the error and the material is saved with the faithful layer alone.
- The depth is the **education level**: `primary` (default — narrated to a young student), `secondary`, `tertiary`, `research`. It is chosen on upload and can be changed when generating narration.
- New block types in the teaching layer: `figure` (with a `figure_index` pointing at a row in `study_figures`) and `recap`.

#### 9c. Long Documents Are Parsed In Pieces
The parser is asked for the whole document's structure and is given a fixed output budget. For a long syllabus those cannot both be true: a twenty-page document does not fit in one response, and a model that runs out of tokens mid-object returns JSON that cannot be parsed.

- `app/services/study_chunking.py` splits the document at paragraph boundaries, then at sentence boundaries inside an oversized paragraph.
- Each piece is parsed on its own with `SOW_PARSER_CHUNK` and a budget that fits it, a few at a time (`_SOW_CHUNK_CONCURRENCY`).
- **The pieces are joined in Python, not by another model call.** The blocks are concatenated in order and the topics are merged by name. Re-emitting them through a model would put them back in the same budget problem chunking was meant to solve.
- A document that fits in one chunk takes the single-shot path — the common case is unchanged.
- A piece that cannot be parsed is dropped with a warning; the rest of the document is still saved.

#### 9d. The Block Vocabulary
A material is not only prose. The parser writes these block types, and the client renders each in its own shape:

| Type | What it carries |
|------|-----------------|
| `heading`, `body`, `list`, `numbered_list` | ordinary structure |
| `tip`, `warning` | a note to remember, a mistake to avoid |
| `calculation` | `steps` — one per entry, each may carry inline maths in `$…$` |
| `code` | `language` plus the code exactly as written, indentation intact |
| `quote` | a direct quote and its attribution |
| `formula` | LaTeX source plus a plain-English `description` |
| `statement` | a theorem, law, principle or rule, with its label |
| `definition` | a term and what it means |
| `table` | headers and rows |
| `figure` | a crop of a diagram, its caption and its description |

- **A formula is LaTeX.** `\frac{a}{b}`, `x^{2}`, `\sqrt{x}` — never wrapped in dollar signs in a formula block. Inline maths inside prose *is* wrapped: `$x^{2} + y^{2} = z^{2}$`.
- The server sends the **source** and the client decides the **presentation**. That is the same contract the catalog reader uses with its `[[EQ:…]]` sentinels: the same stored material can look right on a phone and on a tablet.
- The narration cannot show a formula, so it speaks it. `_speak_math` in `app/services/study_narration.py` turns `\frac{a}{b}` into "a over b" and `\times` into "times". Reading LaTeX out character by character is nonsense.

#### 9e. The Tutor And The Quizzes Are Taught From The Lesson
The teaching layer is not only what the reader shows. It is what the model is taught from.

- `build_material_context` builds the context for the tutor and every generator. **The lesson is the primary source** — it is the material rewritten in plain language, with the diagrams described and the worked examples laid out. The verbatim OCR text is a wall of imperfect lines; the lesson is prose.
- The tutor gets **both**: the lesson (60% of the budget) and the source (40%). The lesson is what the student was taught, so the tutor answers in the same language and from the same explanation; the source is there so a fact the rewrite dropped is not lost.
- The exam and asset generators get the **lesson only**. An exam prompt has no room for two versions of the same material.
- `render_teaching_blocks` in `app/services/study_explanation.py` turns the lesson's blocks into prose the model can read: a worked calculation becomes its numbered steps, a formula becomes its source plus a sentence saying what it means, a diagram becomes the description written for it. The labels are shouted (`REMEMBER:`, `CAREFUL:`, `FORMULA:`) so the model can tell one kind of block from another without guessing.
- **Flashcards, essays, diagrams and video scripts used to be written from the topic outline alone** — a table of contents. The model had nothing to write about except the headings themselves. They now get the lesson, through `_build_asset_context`.
- `TEACH_FROM_LESSON` in `app/ai/prompts.py` is the rule every generator prompt carries, and `render_prompt` fills it in by default so a call site that forgets it renders a weaker prompt rather than failing with a KeyError.
- The rule also tells the generators to write inline mathematics in dollar signs (`$x^{2}$`) so the app can typeset it. The question, the options, the explanation and the tutor's own answers all go through `RichText` on the client.

#### 9f. Paid Audio Narration
- Endpoints: `/audio/topics/{id}`, `/audio/quote/{id}`, `/audio/batches/{id}` (GET and POST), `/audio/batches/{batch_id}/position`, `/audio/batches/{batch_id}/retry`, `/audio/generate-next/{id}`.
- Generation is **client-driven**: the server holds the queue in Postgres and the client pulls it forward one episode at a time. Render's free tier cannot be relied on to run in-process background tasks.
- A failed episode must call `mark_failed` so the debit is returned. Leaving the batch in `generating` means the user was charged for audio that will never arrive.
- Audio is stored in R2. The content type is **sniffed from the bytes** (`_audio_content_type`): MeloTTS answers with WAV and edge-tts with MP3, and labelling a WAV as `audio/mpeg` makes some players refuse it.
- The narration speaks the **teaching layer**, not the faithful structure (`_narration_structure_for`). The faithful layer supplies the topic list.

### 10. Testing Requirements
- Unit tests with `pytest` + `httpx.AsyncClient` (test FastAPI routes)
- Database tests: use PostgreSQL test container for local dev; production uses PostgreSQL 18 on Render
- **Never call a live AI provider from a test.** A test that hits Cloudflare is slow, non-deterministic and burns the daily neuron allowance. Monkeypatch `route_ai` (and the OCR helper) with a stub that returns a known shape — see `tests/test_study.py::test_upload_sow_text`.
- Mock external APIs (AI providers, ad webhooks, Paystack, Peyflex)
- Coverage target: 80%+ for critical paths (auth, payments, bills, reading engine)
- Test all bill purchase flows with Peyflex sandbox credentials

### 11. Docker & Deployment
- `Dockerfile`: single-stage build using `python:3.11` (not multi-stage as originally spec'd)
- `docker-compose.yml` for local dev: FastAPI + PostgreSQL 18
- Production: deployed on Render.app with PostgreSQL 18 (NOT Docker in production)
- Health check: `/api/v1/health` returns 200 if DB reachable
- Gunicorn + Uvicorn workers: `CMD ["gunicorn", "app.main:app", "-w", "2", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--timeout", "120", "--graceful-timeout", "30", "--keep-alive", "5"]`

### 12. Code Style
- Line length: 100
- Imports: stdlib → third-party → local (sorted alphabetically within groups)
- Type hints required for all function signatures
- Docstrings for all public functions/classes (Google style)
- No `print()` — use `logging` with structured format

## Deliverables per Phase
- Phase 1: Auth, reading engine, content API, Dockerfile running
- Phase 2: Ad SSV webhooks, dual ad tracking tables, rotation logic
- Phase 3: AI router, SOW upload, streaming chat, circuit breaker
- Phase 4: Paystack payments (deposits, withdrawals, subscriptions), webhook handlers
- Phase 5: Referral code generation, validation logic
- Phase 6: Content provider abstraction layer
- **Phase 7:** Task marketplace (sponsors, workers, submissions, chat, escrow)
- **Phase 8:** Bills & VTU integration (Peyflex: airtime, data, electricity, TV with real-time commission)
- **Phase 9 (current):** Monetization hardening — model routing + metering, one paid tier, per-user AI cost logging. Remaining: the AdMob client pipeline, upload/exam quotas, the Granite routing eval set

## Anti-Patterns to Avoid
- Don't use sync database drivers in async code (use `asyncpg` for PostgreSQL)
- Don't create engines per request (singleton pattern in `database.py`)
- Don't trust client-side point calculations (always recalculate server-side)
- Don't use bare `except Exception:` — catch specific exceptions
- Don't log secrets, tokens, or PII
- Don't hardcode bill prices — always fetch from Peyflex API in real-time
- Don't credit commission before verifying purchase success from provider
- Don't use `paystack_webhook_secret` (doesn't exist) — Paystack signs with `secret_key`

## Quality Gates (Non-Negotiable)
- **No placeholders:** Never commit TODO comments, placeholder strings, mock responses, or fake data. If an integration is missing, raise an explicit error. Do not silently return empty objects.
- **Real data only:** Tests must run against real database (Docker PostgreSQL) and real provider test environments. Mock only third-party secrets, never business logic.
- **Test before merge:**
  1. `pytest tests/ --cov=app --cov-report=term` — 80%+ coverage, 0 failures
  2. `docker compose up --build` — backend boots, `/api/v1/health` returns 200
   3. E2E smoke: auth → create content → start session → end → wallet updates
  4. Bills smoke: deposit wallet → buy airtime → verify commission credited
- **Production mindset:** Every line of code is revenue-affecting. A bug in point calculation is a lawsuit. A bug in ad verification is a banned account. A bug in bill purchase loses user money. Write code as if you are handing it to a regulatory auditor.
- **Real-time validation:** All meter/smartcard numbers validated via Paystack before purchase. Phone network detected from Nigerian prefixes.
- **Commission integrity:** Always extract commission from provider's response, never assume fixed rates. Users must receive exactly 70% of actual commission earned.
