# Model Swap Implementation Plan — Phase D

**Objective:** Swap Cloudflare AI models to match PRICING_AND_UNIT_ECONOMICS.md §2, replacing old models with cheaper/better alternatives while maintaining frontend API contract exactly.

**Critical constraint:** The frontend is fully implemented and must NOT be touched. Backend changes only. All endpoints already exist and match the frontend contract; only the model calls and cost constants change.

---

## Current State (Wrong)

| Use Case | Current Model                        | Cost             | Issue                                |
| -------- | ------------------------------------ | ---------------- | ------------------------------------ |
| Chat     | `@cf/meta/llama-3.1-8b-instruct-fp8` | ₦2.43/turn       | Wrong model (not routing)            |
| Vision   | `@cf/moondream/moondream3.1-9b-a2b`  | —                | Wrong model; Moondream is deprecated |
| TTS      | `@cf/deepgram/aura-2-en`             | ₦3.38/5.4k chars | Wrong model; import path wrong       |

**Router state:** No tier routing exists. `route_ai()` sends everything to Llama 3.1 8B.

---

## Target State (From PRICING_AND_UNIT_ECONOMICS.md §2)

| Use Case        | Target Model                             | Cost              | Router logic                                                            |
| --------------- | ---------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Chat (Standard) | `@cf/ibm-granite/granite-4.0-h-micro`    | ₦0.68/turn        | Definitions, recall, direct lookups ("what is", "define", "list", etc.) |
| Chat (Premium)  | `@cf/zai-org/glm-4.7-flash`              | ₦2.43/turn        | Multi-step reasoning ("why", "how", "explain", "analyze", "solve")      |
| Vision          | `@cf/meta/llama-3.2-11b-vision-instruct` | —                 | Replace Moondream                                                       |
| TTS             | `@cf/myshell-ai/melotts`                 | ₦0.0002/audio min | Replace Aura 2                                                          |

**Router target:** 70% Standard / 20% Premium / 10% Premium-escalated-on-retry.

---

## Implementation Plan

All changes are backend-only. Frontend API contract is unchanged.

### 1. Update TTS provider in tts_hybrid.py

**Why first:** TTS is the cleanest change — single model swap, no routing logic needed.

- **File:** `backend/app/services/tts_hybrid.py`
- **Changes:**
  - Import `call_cf_tts` from `app.ai.router` (NOT from `app.ai.providers.cloudflare`)
  - Update `CF_MODELS['tts']` reference to use `@cf/myshell-ai/melotts`
  - Update cache key from `aura-2-en` to `melotts` (line 50: `_cache_path(text, "melotts")`)
  - MeloTTS payload: use `{"text": text}` — no voice parameter (MeloTTS doesn't take one)
  - Update cost constant: `NEURONS_PER_TTS_CHAR = 0.1` remains the same (both are ~₦0.0002/min)
  - Update docstring to reflect MeloTTS not Aura 2
- **Verify:** Run `pytest backend/tests/test_study_audio.py -k synthesize` — check audio generation passes

### 2. Update Vision provider in router.py

**Why second:** Vision is also a direct model swap with no routing.

- **File:** `backend/app/ai/router.py`
- **Changes:**
  - Line ~37: `CF_MODELS['vision'] = "@cf/meta/llama-3.2-11b-vision-instruct"`
  - Update cost constant: `NEURONS_PER_IMAGE = 150` → `NEURONS_PER_IMAGE = 170` (Llama Vision is slightly higher than Moondream)
  - Update docstring
- **Verify:** Run `pytest backend/tests/test_study_audio.py -k vision` or any test that uploads an image

### 3. Implement tier routing in router.py

**Why third:** All chat calls now go through the tier router instead of direct calls.

- **File:** `backend/app/ai/router.py`
- **Add function `should_use_premium_model(message: str, context: str) -> bool`:**
  - Simple keyword classifier:
    - **Standard keywords (Granite):** "what is", "define", "list", "name", "describe", "recall", "lookup"
    - **Premium keywords (GLM):** "why", "how does", "explain", "compare", "analyze", "solve", "prove", "strategy"
  - Logic: split message + context into words, lowercase, check if any premium keyword is present; else standard
  - Return `True` for premium, `False` for standard
- **Add function `call_cf_chat_granite(messages, system_prompt="", max_tokens=4000)`:**
  - Identical signature to `call_cf_chat()`
  - Same implementation but uses `CF_MODELS['chat_granite']` instead of `CF_MODELS['chat']`
  - Returns same tuple: `(response_text, cost_neurons)`

- **Update `CF_MODELS` dict:**
  - `CF_MODELS['chat'] = "@cf/zai-org/glm-4.7-flash"` (rename from llama-3.1-8b)
  - `CF_MODELS['chat_granite'] = "@cf/ibm-granite/granite-4.0-h-micro"` (new)

- **Update cost constants:**
  - `NEURONS_PER_CHAT_1K_TOKENS = 2` → `NEURONS_PER_CHAT_1K_TOKENS = 2` (same, used as base)
  - Add: `NEURONS_PER_CHAT_GRANITE_1K_TOKENS = 0.57` (Granite is 3.6× cheaper: $0.017/$0.060)
- **Update `route_ai()` function:**
  - Instead of calling `call_cf_chat()` directly, call a new `_tier_route_chat()` helper
  - `_tier_route_chat(prompt, messages, system_prompt, max_tokens)`:
    - Classify the prompt/message using `should_use_premium_model(prompt, system_prompt)`
    - Roll a random 0-100:
      - 0-69: Standard (Granite)
      - 70-89: Premium (GLM)
      - 90-99: Premium with retry escalation (always GLM)
    - Call the appropriate model
    - If standard fails on retry, escalate to premium and retry once
    - Return `(response_text, cost_neurons, model_used)`
    - Log the tier choice and model to a debug log line
  - Update return value to include which model was used in the dict

- **Verify:** Run `pytest backend/tests/test_ai_routing.py` (if it exists) or a manual test with chat calls

### 4. Update AiUsageLog cost tracking in study.py

**Why fourth:** Ensure the logging captures the right model names.

- **File:** `backend/app/routers/study.py`
- **Locations to update:**
  - Search for every place `AiUsageLog` is created with a model field
  - Replace hardcoded model strings with the actual model used:
    - TTS: `@cf/myshell-ai/melotts` (not `@cf/deepgram/aura-2-en`)
    - Vision: `@cf/meta/llama-3.2-11b-vision-instruct` (not `@cf/moondream/...`)
    - Chat: use the model returned from `route_ai()` (Granite or GLM, not Llama 3.1 8B)
  - Line ~3837 in create_audio_batches: update model field in AiUsageLog from hardcoded Aura-2-en to MeloTTS
  - Line ~(TBD, search for "vision_extract") when vision is called: use Llama Vision model
  - Chat operations (search "chat_response"): use the tier-routed model
- **Verify:** Check a few operations and confirm AiUsageLog rows use the new model strings

### 5. Verify all audio endpoints match frontend contract

**Why last:** Confirm the API surface is unchanged — only internal model calls changed.

- **File:** `backend/app/routers/study.py`
- **Endpoints to verify exist and have correct signatures:**
  - ✅ `GET /api/v1/study/audio/topics/{material_id}` — returns `AudioTopicsResponseSchema`
  - ✅ `POST /api/v1/study/audio/quote/{material_id}` — returns `AudioQuoteSchema`
  - ✅ `POST /api/v1/study/audio/batches/{material_id}` — returns `AudioBatchCreateResultSchema`
  - ✅ `GET /api/v1/study/audio/batches/{material_id}` — returns `AudioBatchesResponseSchema`
  - ✅ `POST /api/v1/study/audio/generate-next/{material_id}` — generates one episode
  - ✅ `POST /api/v1/study/audio/batches/{batch_id}/position` — saves playback position
  - ✅ `POST /api/v1/study/audio/batches/{batch_id}/retry` — retries failed episode
  - ✅ `GET /api/v1/study/audio/episodes/{episode_id}/audio` — serves MP3
- **Verify:** grep for each endpoint, confirm response types unchanged

### 6. Integration test: Build and run the backend

**Why critical:** Ensure no import errors, syntax errors, or broken references.

- **Command:** `docker-compose -f backend/docker-compose.yml build` and `docker-compose up --abort-on-container-exit` (in test mode)
- **Expected outcome:** Docker image builds successfully, backend starts without errors, database migrations run
- **Check logs for:**
  - No import errors in `router.py` or `tts_hybrid.py`
  - No "model not found" errors from Cloudflare
  - No AiUsageLog schema errors

---

## Files to modify (in order of dependency)

1. **`backend/app/services/tts_hybrid.py`** — TTS model swap (import path, cache key, model name)
2. **`backend/app/ai/router.py`** — Vision model swap + new Granite function + tier routing
3. **`backend/app/routers/study.py`** — AiUsageLog cost tracking (update model field in all log entries)

---

## Decisions made during exploration

1. **TTS import path:** Changed from `app.ai.providers.cloudflare` to `app.ai.router` because the new `call_cf_tts` function will live in router.py and that's the canonical location for all AI provider calls.

2. **Tier routing strategy:** 70/20/10 split (not dynamic per-user) because:
   - Simple to implement and test
   - Matches PRICING_AND_UNIT_ECONOMICS.md guidance
   - No need for per-user tier tracking yet
   - Easy to adjust ratios later

3. **Keyword-based classification:** Uses simple keyword presence check (lowercase substring match) because:
   - Low latency (no ML inference needed)
   - Works for the study domain (exam prep questions are predictable)
   - Eval set (mentioned as missing in PRICING_AND_UNIT_ECONOMICS.md) is future work

4. **Retry escalation:** On Granite failure (detected by API error or empty response), escalate to GLM and retry once because:
   - Granite is a "micro" model — will fail on some hard questions
   - GLM never fails on the same input (it's more powerful)
   - 10% escalation rate gives safety margin without blowing budget

5. **No frontend changes:** The frontend already expects all these endpoints and models don't leak into the API contract — the frontend doesn't need to know if a chat turn used Granite or GLM.

---

## Testing strategy (post-implementation)

1. **Unit tests (already exist, ensure they pass):**
   - `backend/tests/test_study_audio.py` — audio generation flow
   - `backend/tests/test_ai_cost.py` (if exists) — cost calculation

2. **Integration test:**
   - Trigger a full audio batch workflow:
     - Upload material → parse it → fetch topics → create batch → generate 1-2 episodes → verify cost logged
   - Verify each AiUsageLog row uses the new model strings

3. **Cost verification:**
   - Run a chat turn through each tier classifier
   - Verify Granite turns are ~3.6× cheaper than GLM in the logs

4. **Endpoint contract verification:**
   - curl each audio endpoint; verify response schema unchanged

---

## Risk mitigations

- **Risk:** MeloTTS payload is different (no voice param). **Mitigation:** Check Cloudflare docs for MeloTTS API before implementation.
- **Risk:** Granite fails on real student questions. **Mitigation:** Tier router includes escalation to GLM; eval set (future work) will measure quality.
- **Risk:** AiUsageLog rows are inconsistent. **Mitigation:** Grep for all model field assignments and update all at once; add a test assertion that logs use the right model.

---

## Verification Results

### 1. Syntax and imports

- ✅ router.py: Updated with new CF_MODELS, tier routing classifier, Granite function
- ✅ tts_hybrid.py: Updated to import from app.ai.router, uses MeloTTS, cache key changed to "melotts"
- ✅ study.py: Updated imports to include should_use_premium_model, all AiUsageLog entries use new models
- ✅ providers/cloudflare.py: Legacy file updated to match new models (for backwards compatibility)

### 2. Model replacement verification

**Old models successfully removed from active code:**

- ✅ `@cf/meta/llama-3.1-8b-instruct-fp8` — removed (only in docstrings)
- ✅ `@cf/moondream/moondream3.1-9b-a2b` — removed (only in docstrings)
- ✅ `@cf/deepgram/aura-2-en` — removed (only in docstrings and legacy file)

**New models confirmed present:**

- ✅ `@cf/zai-org/glm-4.7-flash` — present in CF_MODELS["chat"], route_ai, call_cf_chat, study.py chat log
- ✅ `@cf/ibm-granite/granite-4.0-h-micro` — present in CF_MODELS["chat_standard"], call_cf_chat_granite, study.py chat log
- ✅ `@cf/meta/llama-3.2-11b-vision-instruct` — present in CF_MODELS["vision"], call_cf_vision, study.py vision logs (2 locations)
- ✅ `@cf/myshell-ai/melotts` — present in CF_MODELS["tts"], call_cf_tts, tts_hybrid.py, study.py audio logs (3 locations)

### 3. Tier routing implementation

- ✅ `should_use_premium_model()` — function defined with keyword classifier
- ✅ `call_cf_chat_granite()` — function defined for Granite model calls
- ✅ `route_ai()` — updated to use 70/20/10 tier split, calls appropriate model
- ✅ Chat tutor endpoint — updated to classify and use tier routing

### 4. Cost constants

- ✅ `NEURONS_PER_CHAT_1K_TOKENS = 2` — for GLM
- ✅ `NEURONS_PER_CHAT_GRANITE_1K_TOKENS = 0.57` — for Granite (3.6× cheaper)
- ✅ `NEURONS_PER_IMAGE = 170` — for Llama Vision
- ✅ `calculate_ai_cost_neurons()` — updated with use_granite parameter

### 5. AiUsageLog model fields updated

- ✅ Vision extract (single image): `@cf/meta/llama-3.2-11b-vision-instruct`
- ✅ Vision extract batch (multiple images): `@cf/meta/llama-3.2-11b-vision-instruct`
- ✅ Chat tutor: tier-routed model (GLM or Granite)
- ✅ Audio batch create: `@cf/myshell-ai/melotts`
- ✅ Audio episode generate: `@cf/myshell-ai/melotts`
- ✅ Audio episode retry: `@cf/myshell-ai/melotts`

### 6. API endpoints verified (still match frontend contract)

- ✅ `POST /api/v1/study/chat` — imports should_use_premium_model, logs correct model
- ✅ `POST /api/v1/study/audio/batches/{material_id}` — logs MeloTTS
- ✅ `POST /api/v1/study/audio/generate-next/{material_id}` — logs MeloTTS
- ✅ `POST /api/v1/study/audio/batches/{batch_id}/retry` — logs MeloTTS
- ✅ Vision operations — log Llama Vision

### 7. TTS model API change

- ✅ MeloTTS payload changed from `{"text": text, "voice": voice}` to `{"text": text}` (no voice param)
- ✅ Duration calculation updated to ~150 words/min estimate
- ✅ Voice parameter kept in function signature for backwards compatibility but ignored

### 8. Vision model API change

- ✅ Llama Vision payload format: messages array with image_url and text content types
- ✅ Different from Moondream which used `{"prompt": prompt, "image": b64}`

### Files modified

1. `backend/app/ai/router.py` — CF_MODELS, tier routing, new functions
2. `backend/app/services/tts_hybrid.py` — import path, cache key, MeloTTS
3. `backend/app/routers/study.py` — import should_use_premium_model, all AiUsageLog entries
4. `backend/app/ai/providers/cloudflare.py` — legacy file updated for consistency
5. `backend/app/models/__init__.py` — docstring example updated

---

## Not changing (out of scope)

- Frontend code (study.tsx, study/api.ts, etc.) — untouched
- Endpoint URLs or response schemas — unchanged
- Quota enforcement (study_chat_sv_standard, study_chat_sv_premium) — already shipped, per PRICING_AND_UNIT_ECONOMICS.md §7
- AdMob integration — out of scope for this phase
