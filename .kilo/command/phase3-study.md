# Command: Phase 3 — Student AI Exam Prep

**Duration:** Weeks 7–10
**Agents:** Backend + Frontend + AI
**Goal:** Ship the AI study tab: SOW upload → structured outline → MCQs/flashcards/essays → ad-gate modals.
**Status:** ✅ Shipped. The spec below is the June 2026 plan; the **AI provider
section was rewritten in Oct 2026** to match what shipped. Everything else
still describes the phase as built.

---

## Backend Tasks

### Step 1: AI Router Implementation
- **Shipped as `app/ai/router.py`** — a single provider, not a failover pool:
  - **Cloudflare Workers AI**, one endpoint, one bill:
    - `@cf/zai-org/glm-4.7-flash` — **premium**: SOW parsing, generation, reasoning
    - `@cf/ibm-granite/granite-4.0-h-micro` — **standard**: definitions, recall, lookups
    - `@cf/meta/llama-3.2-11b-vision-instruct` — vision (OCR for SOW images and rendered PDF pages)
    - `@cf/myshell-ai/melotts` — narration TTS
  - `app/ai/routing.py::classify_turn()` picks the tier for chat; generation tasks always use premium
  - **No circuit breaker, no `ai_provider_health` table, no failover.** A Cloudflare outage is a 503 on every AI feature.
  - **Cloudflare returns text in `result.response`**, not `result.choices[0].message.content`
  - Environment variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
  - Cost control is the quota (`study_chat_daily_limit` etc.) plus per-user cost logging, not a provider list

### Step 2: SOW Upload & Parsing
- `POST /api/v1/study/upload`:
  - Accept: `multipart/form-data` (image) OR `application/json` (text)
  - If image:
    1. Validate file type (jpg, png, pdf)
    2. Send to the Cloudflare vision model for OCR extraction
    3. Parse extracted text
  - If text: use directly
  - Send to AI router with `SOW_PARSER` prompt
  - Expected JSON structure: `{topics: [{name, subtopics[], key_concepts[]}]}`
  - Save: `StudyMaterial(user_id, title, raw_input, parsed_structure, ai_model_used)`
  - Return: `{id, title, parsed_structure, created_at}`
- **PDF handling (shipped, Oct 2026):** a PDF is rendered page by page with
  PyMuPDF and each page is OCR'd by the vision model — the same path as an
  uploaded image. The PDF's embedded text layer is **not** used, because a
  scan or a photo has none. There is no `pdf_has_no_text_layer` error and no
  text-extraction fallback.
- **Nothing on the page is lost (shipped, Oct 2026):** an upload is a
  document, not a wall of text.
  - Every page is rendered at 1800px and written to object storage
    (`study-pages/`), so the app can show the student their own material at
    any zoom. `GET /api/v1/study/materials/{id}/page-images`.
  - Every diagram-like region is cropped and written to `study-figures/`.
    `GET /api/v1/study/materials/{id}/figures` returns the crops with a
    plain-language description of each one.
  - Figures are found from the PDF's own geometry — `page.get_drawings()`,
    `page.get_image_rects()`, `page.get_text("blocks")` — never from a
    vision model asked for coordinates. See `app/services/page_artifacts.py`
    and the PyMuPDF traps noted in `.kilo/agent/backend.md`.
  - The OCR prompt is `VISION_OCR_PROMPT`: markdown structure, `[FIGURE: …]`
    and `[TABLE: …]` lines, and `[ILLEGIBLE]` for text it cannot read.
- **The teaching layer (shipped, Oct 2026):** `study_materials.explanation_structure`
  holds the material rewritten in plain language for a beginner — analogies,
  every worked example walked through, every diagram described in words.
  `parsed_structure` stays faithful to the source and is never overwritten.
  The reader shows one in "Explained" mode and the other in "My material"
  mode.
- Error handling:
  - OCR failure → return error, suggest manual text entry
  - JSON parsing failure → **retry with a stricter prompt** (`_SOW_REPAIR_PROMPT`,
    one attempt), then give up. The material is still saved with its raw
    text so the student is not left with a blank screen.

### Step 3: Asset Generation Endpoints
- `POST /api/v1/study/generate` (single endpoint, not `/mcq`, `/flashcards`, `/essay`):
  - Request: `{material_id, topic?, count: 5-20, type: "mcq" | "flashcards" | "essay"}`
  - AI generates content based on `type`
  - Save to `study_assets` table with matching `asset_type`
  - Return generated content without correct answers (locked until payment/ad)
- `GET /api/v1/study/materials/{id}`:
  - Return material with all associated assets (questions shown, answers locked)
- All generation endpoints use circuit breaker pattern for provider failover

### Step 4: Ad-Gated Access
- `POST /api/v1/study/unlock`:
  - Request: `{asset_id, method: "ad|points"}`
  - If method="points": check `User.points_balance >= 50`, deduct, unlock
  - If method="ad": return `{"ad_unit_id": "..."}` → client plays ad → calls back
  - Return: `{unlocked: true, answer/explanation: "..."}`
- Track `points_spent` in new `study_transactions` table

### Step 5: Database Tables
- `study_materials`: already exists (create in Phase 1)
- `quiz_sessions`: already exists (create in Phase 1)
- New `study_assets`: `id, material_id, asset_type, content_json, points_to_unlock, created_at`
- New `study_transactions`: `id, user_id, asset_id, method, points_spent, reward_granted, created_at`

---

## Frontend Tasks

### Step 1: Study Tab Setup
- `app/(tabs)/study.tsx`:
  - Show two sections: "Upload SOW" card + "My Materials" list
  - Empty state: "Upload your scheme of work to get started"
- Zustand store `useStudyStore()`:
  - `materials: StudyMaterial[]`
  - `uploading: boolean`
  - Fetch on tab focus via TanStack Query

### Step 2: SOW Upload UI
- Two buttons: "Camera" + "Upload File"
- `expo-image-picker` for camera/gallery
- `expo-document-picker` for PDF/text
- On select: show progress indicator
- Send to `POST /api/v1/study/generate` with `type: "outline"`
- On success: show parsed preview (expandable topics)
- Save `material_id` to list

### Step 3: Asset Browser
- Material detail screen: tabs for MCQ / Flashcards / Essay
  - MCQ section: list of question cards
    - Tap to select answer → instant feedback (correct/incorrect)
    - "Answer locked" state: show ad/paywall prompt
  - Flashcard section: tap-to-flip card
  - Essay section: list of prompts
- Unlock UI:
  - After rewarded ad → calls `POST /api/v1/study/unlock` with `method: "ad"`
  - On points: deducts via API, shows result

### Step 4: Chat Interface
- Chat screen per material
- FlatList of messages (user + AI)
- Streaming text: update state on each token
- Input bar at bottom + send button
- Loading shimmer while generating

### Step 5: Points Integration
- Quiz score ≥ 80%: bonus 20 pts (backend handles, but show UI notification)
- Ad-gate: "50 pts to unlock" button prominent

---

## AI Architect Tasks

### Step 1: Create Prompt Templates
File: `backend/app/ai/prompts.py`
```python
SOW_PARSER = """You are an academic curriculum parser...
Input: {raw_text}
Output strict JSON:
{{
  "topics": [
    {{"name": "Topic 1", "subtopics": ["Sub A", "Sub B"], "key_concepts": ["concept1"]}}
  ]
}}
Rules: No markdown. No backticks. Valid JSON only."""

MCQ_GENERATOR = """Generate {count} MCQs from: {context}
Output strict JSON:
{{
  "questions": [
    {{"question": "...", "options": ["A", "B", "C", "D"], "correct_index": 0, "explanation": "..."}}
  ]
}}"""

FLASHCARD_GENERATOR = """Generate {count} flashcards from: {context}
Output strict JSON:
{{"cards": [{{"front": "...", "back": "..."}}]}}"""
```

### Step 2: Implement the Cloudflare Client
- `backend/app/ai/router.py` — the whole client, one provider:
  - `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{model}`
  - Auth: `Authorization: Bearer {CLOUDFLARE_API_TOKEN}`
  - Text models: `{"messages": [...], "max_tokens": N, "temperature": T}`
  - Vision: the same endpoint with an image as a base64 data URI in the message content
  - **The response text is in `result.response`** — not in the OpenAI-compatible `result.choices[0].message.content`. Reading the wrong key silently yields an empty response and a 503.
  - `chat_template_kwargs: {"enable_thinking": false}` on the premium model — leaving reasoning on triples billed output tokens

### Step 3: ~~Circuit Breaker~~ — not built
- The `ai_provider_health` table and `app/ai/circuit_breaker.py` were planned
  but **never built**. There is one provider, so there is nothing to fail over
  to. A failed call raises and the caller returns a 503 with a user-safe
  message. Do not reintroduce a provider list without reading
  `PRICING_AND_UNIT_ECONOMICS.md` — a second provider is a second bill.

---

## Acceptance Criteria (Phase 3 Complete)
✅ Upload SOW (image or text) → AI parses to structured outline
✅ Upload SOW (PDF) → pages rendered and OCR'd → AI parses to structured outline
✅ Generate MCQs: 5 questions per topic, valid JSON, correct answers
✅ Generate flashcards: tap-to-flip UI works
✅ Generate essay prompts: list displays correctly
✅ "Unlock answer" via rewarded ad works (SSV → points credit)
✅ "Unlock answer" via 50 pts works (balance deducted)
✅ Streaming chat responds token-by-token
❌ ~~AI fails over to secondary provider on rate limit~~ — superseded. There is
no second provider; the cost control is model routing, the chat quota, and
per-user cost logging.
✅ Chat UI shows loading, streaming, and error states
✅ Live on Play Store update
✅ Backend + frontend: all previous phase tests still pass
✅ E2E: Upload syllabus → generate quiz → answer → earn points → premium gating works
✅ No TODO comments, placeholder strings, or mock data in committed code
