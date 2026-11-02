# Phase D: Cloudflare AI Integration — Implementation Plan

**Status:** Ready for implementation  
**Scope:** Complete Cloudflare Workers AI integration (vision, chat prompts, unified cost calculation)  
**Target:** Backend AI system fully on Cloudflare with proper cost tracking and education-level tuning  

---

## Findings

### Current State
- **Vision (OCR):** WORKING — Function `_ocr_image_with_cloudflare()` at line 655 correctly calls `call_cf_vision()` from router.py
- **Chat:** PARTIALLY WORKING — Endpoint imports and uses level-specific prompts (lines 2253–2260) correctly; however, **cost is NOT logged** to `AiUsageLog`
- **Prompts:** COMPLETE — All 4 education-level variants imported and available (lines 27–31)
- **TTS/Audio:** WORKING — Uses Cloudflare TTS; logs cost via pre-calculated `episode.cost_sv`
- **Cost Calculation:** INCOMPLETE — Constants defined (router.py lines 37–39) but never used; each operation logs cost differently

### Root Cause of Gaps
1. **Gap 1 (Vision):** Already fixed. `_ocr_image_with_cloudflare()` and imports are in place.
2. **Gap 2 (Chat Prompts):** Already fixed. Education-level selection logic is in place (lines 2253–2260).
3. **Gap 3 (Cost Logging):** **REAL GAP** — Chat endpoint calls `route_ai()` but does not log the cost to `AiUsageLog`. The response is streamed but cost data is lost.

### Decision Made
Focus implementation on **Gap 3 only**: Add unified cost calculation and ensure all AI operations log costs to `AiUsageLog`.

**Rationale:** Vision and prompts are already correct. Chat endpoint works but doesn't audit costs — this is the real risk for billing and quota enforcement.

---

## Implementation Plan

### 1. Add Unified Cost Calculation Function to router.py

**What:** Create a single function that calculates cost in Neurons for any AI operation. Used by all AI call sites (chat, vision, TTS).

**Files:** `backend/app/ai/router.py`

**Changes:**
- After line 39 (after cost constants), add function `calculate_ai_cost_neurons()`:
  ```python
  def calculate_ai_cost_neurons(operation: str, input_size: int) -> float:
      """Calculate cost in Neurons for an AI operation.
      
      Args:
          operation: Type of operation ("chat", "vision", "audio_tts")
          input_size: Size of input (chars for chat/tts, bytes for vision)
          
      Returns:
          Cost in Neurons
      """
      if operation == "chat":
          # ~2 neurons per 1k tokens, ~4 chars per token
          tokens = max(1, input_size // 4)
          return tokens / 1000.0 * NEURONS_PER_CHAT_1K_TOKENS
      elif operation == "vision":
          # Flat cost per image
          return float(NEURONS_PER_IMAGE)
      elif operation == "audio_tts":
          # ~0.1 neurons per character
          return max(1.0, input_size * NEURONS_PER_TTS_CHAR)
      else:
          return 0.0
  ```

**Verify:** 
```bash
cd backend
python -c "from app.ai.router import calculate_ai_cost_neurons; print(calculate_ai_cost_neurons('chat', 4000)); print(calculate_ai_cost_neurons('vision', 0)); print(calculate_ai_cost_neurons('audio_tts', 5000))"
# Expected: prints approximately 2.0, 150.0, 500.0
```

---

### 2. Add Cost Logging to call_cf_vision()

**What:** Make `call_cf_vision()` accept an optional callback to log the cost, or return it for the caller to log.

**Files:** `backend/app/ai/router.py`

**Current state (lines 41–74):**
```python
async def call_cf_vision(image_bytes: bytes, prompt: str) -> tuple[str, int]:
    # ... (unchanged implementation)
    return description, NEURONS_PER_IMAGE  # Returns cost
```

**Changes:** No change needed. Function already returns `(description, neurons_cost)`. The caller (study.py) must log it.

**Verify:** Call is already correct; no changes in router.py.

---

### 3. Add Cost Logging to call_cf_chat()

**What:** Make `call_cf_chat()` return both response text AND cost estimate, so the caller can log it.

**Files:** `backend/app/ai/router.py`

**Current state (lines 113–157):**
```python
async def call_cf_chat(
    messages: list[dict],
    system_prompt: str = "",
    max_tokens: int = 4000,
) -> tuple[str, int]:
    # ... 
    estimated_input_tokens = sum(len(m.get("content", "")) for m in messages) // 4 + len(system_prompt) // 4
    return response_text, estimated_input_tokens
```

**Changes:**
- Update return type and calculation to use `calculate_ai_cost_neurons()`:
  ```python
  async def call_cf_chat(
      messages: list[dict],
      system_prompt: str = "",
      max_tokens: int = 4000,
  ) -> tuple[str, int]:  # (response_text, cost_neurons)
      # ... (API call unchanged)
      
      # Calculate cost based on input tokens
      estimated_input_tokens = sum(len(m.get("content", "")) for m in messages) // 4 + len(system_prompt) // 4
      cost_neurons = calculate_ai_cost_neurons("chat", estimated_input_tokens * 4)  # Convert tokens back to chars
      return response_text, cost_neurons
  ```

**Verify:** Unit test or manual check — call with a 1000-char prompt; confirm cost returned is ~0.5 neurons.

---

### 4. Update call_cf_tts() Return Type (Already Correct)

**What:** Verify `call_cf_tts()` already returns cost.

**Files:** `backend/app/ai/router.py`

**Current state (lines 78–110):**
```python
async def call_cf_tts(text: str, voice: str = "aura-2-en") -> tuple[bytes, float]:
    # ...
    neurons_cost = max(1, len(text) / 10.0)
    return audio_bytes, neurons_cost
```

**Status:** Already correct. Function returns `(audio_bytes, cost)`. No changes needed.

---

### 5. Add Cost Logging to Chat Endpoint

**What:** Log the cost of the chat operation to `AiUsageLog` when the chat endpoint completes.

**Files:** `backend/app/routers/study.py`

**Current state (lines 2222–2280):**
The `chat_study()` function streams the response but does NOT log cost.

**Changes:**
- After line 2280 (after the async generator), add a cost logging call:
  ```python
  @router.post("/chat")
  async def chat_study(
      payload: ChatRequest,
      education_level: str | None = None,
      difficulty: str = "medium",
      current_user: User = Depends(get_current_user),
      db: AsyncSession = Depends(get_db),
  ):
      # ... (existing code unchanged through line 2270)
      
      async def generate():
          ai_result = await route_ai(full_prompt, task_type="chat", max_tokens=2000, db=db)
          text = ai_result["response"]
          cost_neurons = ai_result.get("cost_neurons", 0)  # Extract cost from route_ai response
          
          # Stream token-by-token
          words = text.split(" ")
          chunk = []
          for word in words:
              chunk.append(word)
              yield " ".join(chunk) + " "
              chunk = []
          if chunk:
              yield " ".join(chunk)
          
          # Log cost after streaming is complete
          if cost_neurons > 0:
              log_entry = AiUsageLog(
                  user_id=current_user.id,
                  operation="chat_tutor",
                  model="@cf/meta/llama-3.1-8b-instruct-fp8",
                  input_tokens=len(full_prompt),
                  cost_neurons=cost_neurons,
                  metadata={
                      "education_level": education_level or "secondary",
                      "difficulty": difficulty,
                  }
              )
              db.add(log_entry)
              await db.commit()
      
      return StreamingResponse(generate(), media_type="text/plain")
  ```

**Issue:** This approach has a problem — the async generator is consumed by the client, and we can't guarantee the logging happens if the client disconnects. 

**Better approach:** Log cost BEFORE streaming starts (we know the input size).

**Revised changes (lines 2222–2280):**
- Move cost logging before the generator starts:
  ```python
  @router.post("/chat")
  async def chat_study(
      payload: ChatRequest,
      education_level: str | None = None,
      difficulty: str = "medium",
      current_user: User = Depends(get_current_user),
      db: AsyncSession = Depends(get_db),
  ):
      # ... (lines 2224–2269, existing code unchanged)
      
      # NEW: Calculate and log cost upfront based on input size
      input_size_chars = len(full_prompt)
      cost_neurons = calculate_ai_cost_neurons("chat", input_size_chars)
      
      log_entry = AiUsageLog(
          user_id=current_user.id,
          operation="chat_tutor",
          model="@cf/meta/llama-3.1-8b-instruct-fp8",
          input_tokens=input_size_chars,
          cost_neurons=cost_neurons,
          metadata={
              "education_level": education_level or "secondary",
              "difficulty": difficulty,
          }
      )
      db.add(log_entry)
      await db.commit()
      
      async def generate():
          ai_result = await route_ai(full_prompt, task_type="chat", max_tokens=2000, db=db)
          text = ai_result["response"]
          # Stream token-by-token
          words = text.split(" ")
          chunk = []
          for word in words:
              chunk.append(word)
              yield " ".join(chunk) + " "
              chunk = []
          if chunk:
              yield " ".join(chunk)
      
      return StreamingResponse(generate(), media_type="text/plain")
  ```

**Files to modify:** `backend/app/routers/study.py` (add import of `calculate_ai_cost_neurons` at top and add cost logging logic around lines 2269–2280)

**Verify:** 
```bash
# After deployment, POST to /study/chat with a material_id and message
# Query AiUsageLog for the chat_study entry
# Confirm cost_neurons > 0, operation="chat_tutor", user_id matches
```

---

### 6. Import calculate_ai_cost_neurons in study.py

**What:** Add the import at the top of study.py so chat_study() can use it.

**Files:** `backend/app/routers/study.py`

**Current state (line 45):**
```python
from app.ai.router import route_ai, call_cf_vision
```

**Changes:**
```python
from app.ai.router import route_ai, call_cf_vision, calculate_ai_cost_neurons
```

**Verify:** Syntax check — file must parse without errors.

---

### 7. Verify Vision Cost Logging (Already Correct)

**What:** Confirm that vision cost logging in `_process_sow_image_job()` is correct.

**Files:** `backend/app/routers/study.py`

**Current state (lines 903–951):**
The vision cost is logged correctly:
```python
extracted_text, vision_neurons_cost = await _ocr_image_with_cloudflare(contents, content_type)
# ...
vision_log = AiUsageLog(
    user_id=user_id,
    operation="vision_extract",
    model="@cf/moondream/moondream3.1-9b-a2b",
    input_tokens=len(contents),
    cost_neurons=vision_neurons_cost,
    # ...
)
```

**Status:** CORRECT. No changes needed.

**Verify:** Upload an image to SOW; query AiUsageLog for operation="vision_extract"; confirm cost_neurons=150.0.

---

### 8. Verify Audio TTS Cost Logging (Already Correct)

**What:** Confirm that audio TTS cost logging uses the correct calculation.

**Files:** `backend/app/routers/study.py`

**Current state (lines 4044–4050):**
```python
log_entry = AiUsageLog(
    user_id=current_user.id,
    operation="audio_episode_generate",
    model="@cf/deepgram/aura-2-en",
    input_tokens=episode.char_count,
    cost_neurons=episode.cost_sv * 1000.0 / 11.0,
    # ...
)
```

**Status:** CORRECT but using pre-calculated `cost_sv`. No changes needed for now (cost_sv is immutable once episode is created, which is correct for idempotency).

**Verify:** Generate an audio episode; query AiUsageLog for operation="audio_episode_generate"; confirm cost_neurons > 0.

---

## Implementation Order (Dependency Graph)

1. **Step 1** — Add `calculate_ai_cost_neurons()` to router.py (line 40–54)
   - No dependencies; foundation function
   - Verify: unit test or import check

2. **Step 2** — Update `call_cf_chat()` in router.py (line 155)
   - Depends on Step 1
   - Change return value calculation to use `calculate_ai_cost_neurons()`
   - Verify: manual test or unit test

3. **Step 3** — Import `calculate_ai_cost_neurons` in study.py (line 45)
   - Depends on Step 1 (function must exist)
   - Verify: syntax check

4. **Step 4** — Add cost logging to `chat_study()` in study.py (lines 2269–2280)
   - Depends on Step 2 and Step 3
   - Add AiUsageLog entry before streaming starts
   - Verify: integration test — POST /study/chat, check AiUsageLog

5. **Step 5** — Verify all AI operations log costs (no changes, validation only)
   - Vision: already logs (line 944–951)
   - TTS: already logs (line 4044–4050)
   - Chat: now logs (Step 4)
   - Verify: full integration test — run all 3 operations, query AiUsageLog, confirm all have entries

---

## Verification Checklist

After all changes:

1. **Syntax:** Backend builds without errors
   ```bash
   cd backend && python -m py_compile app/ai/router.py app/routers/study.py
   ```

2. **Vision OCR:** Upload SOW image → AiUsageLog has vision_extract entry with cost_neurons=150
   ```bash
   # Endpoint: POST /study/sow/upload-image
   # Query: SELECT * FROM ai_usage_log WHERE operation='vision_extract' ORDER BY created_at DESC LIMIT 1
   ```

3. **Chat:** POST /study/chat → AiUsageLog has chat_tutor entry with cost_neurons > 0
   ```bash
   # Endpoint: POST /study/chat with material_id, message, education_level
   # Query: SELECT * FROM ai_usage_log WHERE operation='chat_tutor' ORDER BY created_at DESC LIMIT 1
   ```

4. **Audio TTS:** Generate audio episode → AiUsageLog has audio_episode_generate entry with cost_neurons > 0
   ```bash
   # Endpoint: POST /study/audio/generate-next/{material_id}
   # Query: SELECT * FROM ai_usage_log WHERE operation='audio_episode_generate' ORDER BY created_at DESC LIMIT 1
   ```

5. **Cost Calculation:** Verify calculations are reasonable
   - Chat: 1000 chars input ≈ 250 tokens ≈ 0.5 neurons
   - Vision: flat 150 neurons per image
   - Audio TTS: 5000 chars ≈ 500 neurons

---

## Files Touched

- `backend/app/ai/router.py` — Add `calculate_ai_cost_neurons()` function; update `call_cf_chat()` return
- `backend/app/routers/study.py` — Import `calculate_ai_cost_neurons`; add cost logging to `chat_study()`

## Notes

- **No Breaking Changes:** All changes are additive or internal refactoring; endpoints remain the same.
- **Backward Compatibility:** Vision and TTS logging continue to work as-is; chat now logs (was not logging before).
- **Cost Model Assumption:** Uses constants from router.py (NEURONS_PER_CHAT_1K_TOKENS=2, NEURONS_PER_IMAGE=150, NEURONS_PER_TTS_CHAR=0.1). If Cloudflare pricing changes, update these constants.
- **Education Level:** Chat endpoint correctly selects prompt based on `education_level` parameter (already implemented in lines 2253–2260).
- **No Gemini Remaining:** Vision uses Cloudflare exclusively; no fallback to Gemini (not needed per requirements).
