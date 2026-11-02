# Phase D: Cloudflare Workers AI Integration Investigation

**Date:** 2026-01-15  
**Scope:** Backend AI routing, chat endpoint, audio TTS, vision/OCR, cost logging  
**Status:** GAPS IDENTIFIED — Hybrid state, vision still on Gemini

---

## 1. CHAT ENDPOINT — WORKING ✓

**File:** `backend/app/routers/study.py` line 2212  
**Route:** `POST /api/v1/study/chat`

### Call Chain
```
POST /study/chat
  → study.py:chat_study()
  → route_ai(full_prompt, task_type="chat", max_tokens=2000, db=db)
  → app/ai/router.py:route_ai()
  → call_cf_chat(messages=[...], system_prompt=..., max_tokens=2000)
  → POST to CF_BASE_URL/{@cf/meta/llama-3.1-8b-instruct-fp8}
```

### System Prompt Selection
The endpoint builds a system prompt using `CHAT_TUTOR_SYSTEM` (generic):
```python
system_prompt = CHAT_TUTOR_SYSTEM.format(
    context=context or "No structured context available.",
    education_level=education_level or "secondary",
    difficulty=difficulty,
)
```

**ISSUE:** The code uses the generic `CHAT_TUTOR_SYSTEM` template, NOT the education-level variants (`CHAT_TUTOR_SYSTEM_PRIMARY`, `CHAT_TUTOR_SYSTEM_SECONDARY`, etc.) that exist in `prompts.py`.

### Model Used
- **Model:** `@cf/meta/llama-3.1-8b-instruct-fp8` ✓ Cloudflare
- **Cost Logging:** Yes — `AiUsageLog` records the model name correctly
- **Token Estimation:** ~4 chars per token (reasonable estimate)

### Verdict
**WORKING** but using a generic prompt instead of level-specific prompts. The chat endpoint correctly routes to Cloudflare.

---

## 2. AUDIO TTS ENDPOINT — WORKING ✓

**File:** `backend/app/routers/study.py` line 3919  
**Route:** `POST /api/v1/study/audio/generate-next/{material_id}`

### Call Chain
```
POST /study/audio/generate-next/{material_id}
  → study.py:generate_next_audio_episode()
  → synthesize_study_audio(episode_text, voice='default')
  → app/services/tts_hybrid.py:synthesize_study_audio()
  → call_cf_tts(text, voice="aura-2-en")
  → POST to CF_BASE_URL/{@cf/deepgram/aura-2-en}
```

### Model Used
- **Model:** `@cf/deepgram/aura-2-en` ✓ Cloudflare
- **Cost Logging:** Yes — logs `AiUsageLog` with model `@cf/deepgram/aura-2-en`
- **Duration Calculation:** Duration estimated from text length (`len(text) / 3.0` chars/sec)
- **Caching:** Audio is cached to disk (SHA256 hash key); repeat requests return cached data

### Cost Calculation in generate_next_audio_episode()
```python
log_entry = AiUsageLog(
    user_id=current_user.id,
    operation="audio_episode_generate",
    model="@cf/deepgram/aura-2-en",
    input_tokens=episode.char_count,
    cost_neurons=episode.cost_sv * 1000.0 / 11.0,  # Convert SV to Neurons
    metadata={...}
)
```

**ISSUE:** The code uses `episode.cost_sv` which is a pre-calculated value on the `AudioEpisode` row. This cost is set during **batch creation**, not during **retry**. If a retry recalculates the episode, the cost_sv may not align.

### Verdict
**WORKING** — correctly calls Cloudflare TTS. No `tts_hybrid` legacy code remains in the active path. Cost logging is present but depends on pre-calculated episode.cost_sv.

---

## 3. VISION/OCR ENDPOINT — NOT WORKING ✗

**File:** `backend/app/routers/study.py` line 196  
**Route:** `POST /api/v1/study/sow/upload-image`

### Call Chain
```
POST /study/sow/upload-image
  → study.py:upload_sow_image()
  → _process_sow_image_job() [background task]
  → _ocr_image_with_gemini(contents, content_type, api_key)
  → POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
  → [Gemini Vision, NOT Cloudflare]
```

### Current Implementation (lines 651–691 in study.py)
```python
async def _ocr_image_with_gemini(
    contents: bytes, content_type: str, api_key: str
) -> str:
    """Send the image to Gemini Vision and return the extracted text."""
    # Calls Gemini, not Cloudflare
    import base64
    import httpx
    b64 = base64.b64encode(contents).decode()
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    headers = {"x-goog-api-key": api_key}
    # ... calls Gemini API
```

### Cloudflare Alternative Available
`app/ai/providers/cloudflare.py` already has `call_cf_vision()` implemented:
```python
async def call_cf_vision(image_base64: str, prompt: str) -> Tuple[str, int]:
    """Call Cloudflare Workers AI vision model (Moondream 3.1)."""
    # Calls @cf/moondream/moondream3.1-9b-a2b
```

### Verdict
**NOT WORKING** — Vision is still hardcoded to Gemini. The Cloudflare vision function exists but is not called. **Gap:** Need to replace `_ocr_image_with_gemini()` with a call to `call_cf_vision()`.

---

## 4. COST FORMULA — INCONSISTENT ⚠️

### Audio Episode Cost (batch creation vs. retry)

**Batch Creation** (when user requests episodes):
- Cost stored on `AudioEpisode.cost_sv` at creation time
- Formula: per-character cost × education_level_multiplier

**Episode Retry/Generation** (when processing queued episodes):
- Cost deducted from wallet using pre-stored `episode.cost_sv`
- Logged as: `episode.cost_sv * 1000.0 / 11.0` (convert SV to Neurons)

**ISSUE:** If an episode is retried after a failure, the cost_sv does not change, but the actual text may have been edited or re-chunked. The cost is immutable once set, which is correct for idempotency but may not reflect real usage if the content changes.

### Cost Formula Constants in config.py
```python
# ── Phase 3: AI providers ────────────────────────────────────────
# Cloudflare Workers AI (primary provider, 2026+)
cf_account_id: str | None = None
cf_ai_api_key: str | None = None
cf_ai_base_url: str = "https://api.cloudflare.com/client/v4/accounts"

# Cost constants (from router.py):
NEURONS_PER_CHAT_1K_TOKENS = 2      # ~$0.000022 per 1k tokens
NEURONS_PER_IMAGE = 150             # ~$0.0015 per image
NEURONS_PER_TTS_CHAR = 0.1          # ~$0.0000011 per character
```

**ISSUE:** The cost constants in `router.py` are not used anywhere — they are defined but not referenced. The actual cost logging uses `episode.cost_sv` (for audio) or derives neurons from other fields.

### Verdict
**INCONSISTENT** — Cost formula exists but is not unified. Audio uses pre-calculated cost_sv; vision/chat use different mechanisms. No central cost calculation function.

---

## 5. PROMPTS — COMPLETE ✓

### Available Prompts in prompts.py

**Chat Tutor (4 levels):**
- `CHAT_TUTOR_SYSTEM_PRIMARY` ✓ (line 394)
- `CHAT_TUTOR_SYSTEM_SECONDARY` ✓ (line 415)
- `CHAT_TUTOR_SYSTEM_TERTIARY` ✓ (line 439)
- `CHAT_TUTOR_SYSTEM_RESEARCH` ✓ (line 463)

**Podcast Narration (4 levels):**
- `PODCAST_NARRATION_SYSTEM_PRIMARY` ✓ (line 490)
- `PODCAST_NARRATION_SYSTEM_SECONDARY` ✓ (line 520)
- `PODCAST_NARRATION_SYSTEM_TERTIARY` ✓ (line 559)
- `PODCAST_NARRATION_SYSTEM_RESEARCH` ✓ (line 603)

### Usage Gap
**Chat endpoint (study.py:2212)** does NOT use the education-level variants. It uses the generic `CHAT_TUTOR_SYSTEM` instead:
```python
system_prompt = CHAT_TUTOR_SYSTEM.format(...)  # ← Generic, not level-specific
```

**Audio endpoint** does not use podcast narration prompts at all (TTS synthesizes, not generates text).

### Verdict
**COMPLETE** — All prompts exist for all education levels. **Gap:** Chat endpoint must be updated to select the correct prompt variant based on `education_level` parameter.

---

## 6. CONFIG — PRESENT BUT INCOMPLETE ⚠️

### Present in config.py (lines ~305–315)
```python
# ── Phase 3: AI providers ────────────────────────────────────────
# Cloudflare Workers AI (primary provider, 2026+)
cf_account_id: str | None = None
cf_ai_api_key: str | None = None
# Base URL for Cloudflare Workers AI API. Default points to production.
cf_ai_base_url: str = "https://api.cloudflare.com/client/v4/accounts"

# Legacy providers (fallback, deprecated)
gemini_api_key: str | None = None
groq_api_key: str | None = None
openrouter_api_key: str | None = None
```

### Present in router.py (lines ~1–30)
```python
CF_MODELS = {
    "chat": "@cf/meta/llama-3.1-8b-instruct-fp8",
    "vision": "@cf/moondream/moondream3.1-9b-a2b",
    "tts": "@cf/deepgram/aura-2-en",
}

# Cost constants: 1,000 Neurons = $0.011 (Cloudflare pricing)
NEURONS_PER_CHAT_1K_TOKENS = 2
NEURONS_PER_IMAGE = 150
NEURONS_PER_TTS_CHAR = 0.1
```

### Missing or Incomplete
1. **No model selection override per task** — The cost constants are defined but not used to adjust model selection (standard vs. premium tiers).
2. **No per-user metering endpoint** — No way to query cumulative AI cost for a user.
3. **No quota enforcement** — No hard limits on per-user AI spend (the spec mentions this in PRICING_AND_UNIT_ECONOMICS.md but the code does not enforce it).
4. **Gemini still configured** — The `gemini_api_key` setting suggests vision may still fall back to Gemini if Cloudflare is unavailable (but there is no fallback logic in the vision endpoint).

### Verdict
**INCOMPLETE** — Settings are present but support legacy providers and lack quota enforcement. Cloudflare config is correct for primary models but cost model is not integrated.

---

## 7. GAPS — ORDERED LIST OF CONCRETE CHANGES NEEDED

### Critical (Blocks Phase D completion)

**1. Replace Gemini Vision with Cloudflare Vision**
- **File:** `backend/app/routers/study.py`
- **Function:** `_ocr_image_with_gemini()` (lines 651–691)
- **Change:** Replace direct Gemini API call with call to `app.ai.providers.cloudflare.call_cf_vision()`
- **Details:**
  - Delete the hardcoded Gemini endpoint URL
  - Import `call_cf_vision` from `app.ai.providers.cloudflare`
  - Base64-encode the image and pass to `call_cf_vision(image_base64, "Extract all text from this image...")`
  - Verify Cloudflare account ID and API key are set; raise HTTPException(503) if not
  - Cost logging: add operation `"vision_extract"` with model `@cf/moondream/moondream3.1-9b-a2b`
- **Verification:** Re-run SOW upload with an image; confirm it calls Cloudflare (check logs for CF API response, not Gemini URL)

**2. Update Chat Endpoint to Use Education-Level Prompts**
- **File:** `backend/app/routers/study.py`
- **Function:** `chat_study()` (lines 2212–2245)
- **Change:** Select the correct prompt template based on `education_level` parameter
- **Details:**
  ```python
  from app.ai.prompts import (
      CHAT_TUTOR_SYSTEM_PRIMARY,
      CHAT_TUTOR_SYSTEM_SECONDARY,
      CHAT_TUTOR_SYSTEM_TERTIARY,
      CHAT_TUTOR_SYSTEM_RESEARCH,
  )
  
  level = education_level or "secondary"
  if level == "primary":
      prompt_template = CHAT_TUTOR_SYSTEM_PRIMARY
  elif level == "secondary":
      prompt_template = CHAT_TUTOR_SYSTEM_SECONDARY
  elif level == "tertiary":
      prompt_template = CHAT_TUTOR_SYSTEM_TERTIARY
  elif level == "research":
      prompt_template = CHAT_TUTOR_SYSTEM_RESEARCH
  else:
      prompt_template = CHAT_TUTOR_SYSTEM_SECONDARY  # fallback
  
  system_prompt = prompt_template.format(
      context=context or "No structured context available.",
      difficulty=difficulty,
  )
  ```
- **Verification:** POST to /study/chat with `education_level: "primary"`; confirm the tutor response uses simple language (validate manually or via log inspection)

**3. Unify Cost Calculation for Logging**
- **File:** `backend/app/ai/router.py` or new `backend/app/services/ai_cost.py`
- **Change:** Create a single cost calculation function that all AI endpoints use
- **Details:**
  ```python
  # In router.py or services/ai_cost.py:
  def calculate_ai_cost_neurons(operation: str, input_size: int) -> float:
      """Calculate cost in Neurons for an AI operation."""
      if operation == "chat":
          # ~2 neurons per 1k tokens, ~4 chars per token
          tokens = input_size // 4
          return max(1, tokens / 1000.0 * 2.0)
      elif operation == "vision":
          return 150.0  # flat cost per image
      elif operation == "audio_tts":
          # ~0.1 neurons per character
          return max(1, input_size * 0.1)
      else:
          return 0.0
  ```
  - Use this function in `generate_next_audio_episode()`, `call_cf_vision()`, and `route_ai()` when logging
- **Verification:** Log multiple operations (chat, vision, audio); check AiUsageLog table for consistent cost_neurons values

### Important (Completes Cloudflare integration)

**4. Add Fallback Logic for Cloudflare Unavailability**
- **File:** `backend/app/ai/router.py`
- **Function:** `route_ai()` (lines ~80–130)
- **Change:** Add a try-catch that falls back to a legacy provider if Cloudflare fails
- **Details:**
  - Current code raises HTTPException(503) if Cloudflare fails
  - Add optional fallback to Groq or Gemini (check if keys are configured)
  - Log a warning when fallback is used so ops can monitor provider health
- **Verification:** Simulate Cloudflare unavailability (block the CF API); confirm fallback works and logs the event

**5. Add Quota Enforcement**
- **File:** `backend/app/services/ai_cost.py` (new) or `backend/app/routers/study.py`
- **Change:** Check user's cumulative AI cost before processing any operation
- **Details:**
  - Query `AiUsageLog` for the user's total cost in the current billing period (e.g., last 30 days)
  - Reject the operation if cost + estimated_new_cost > user_quota (read from config or user profile)
  - Return HTTPException(402) "quota_exceeded" with remaining balance
- **Verification:** Create a test user with a low quota; confirm operations are blocked once quota is hit

**6. Migrate Audio Cost Calculation to Per-Episode**
- **File:** `backend/app/routers/study.py`
- **Function:** `generate_next_audio_episode()` (lines 3919–4020)
- **Change:** Recalculate cost_sv on each retry/generation instead of using the batch-time value
- **Details:**
  - Current code uses pre-stored `episode.cost_sv`
  - Recalculate cost from `episode.char_count` and `episode.education_level`
  - Deduct the recalculated cost (should match the original unless the episode was edited)
  - Log the recalculated cost (not the pre-stored value) to AiUsageLog
- **Verification:** Generate an episode; edit its text; retry generation; confirm cost reflects new text length

### Optional (Nice-to-have)

**7. Add Per-User AI Usage Dashboard Endpoint**
- **File:** `backend/app/routers/stats.py` (new) or extend `backend/app/routers/users.py`
- **Endpoint:** `GET /api/v1/users/me/ai-usage`
- **Return:** `{ total_neurons: float, total_cost_naira: float, operations: [...], period: "month" }`
- **Verification:** Query the endpoint after running multiple AI operations; confirm cost totals match AiUsageLog

---

## Summary

| Component | Status | Issue | Fix Complexity |
|-----------|--------|-------|-----------------|
| Chat endpoint | Working | Uses generic prompt, not level-specific | Low |
| Audio TTS | Working | Cost pre-calculated, immutable | Medium |
| Vision/OCR | **NOT WORKING** | Still calls Gemini, not Cloudflare | Low |
| Prompts | Complete | Not used by chat endpoint | Low |
| Config | Partial | Legacy providers still configured | Low |
| Cost logging | Partial | Constants defined but not used; no quota | Medium |

**Critical path to Phase D completion:**
1. ✓ Replace Gemini Vision with Cloudflare Vision (Gap #1)
2. ✓ Update Chat to use level-specific prompts (Gap #2)
3. ✓ Unify cost calculation (Gap #3)

**Estimated effort:** ~4 hours for critical path; ~8 hours total with quota enforcement.
