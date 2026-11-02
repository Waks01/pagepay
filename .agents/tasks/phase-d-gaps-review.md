# Cloudflare AI Provider Migration: Gap Fix Review

This review covers three gap fixes applied to migrate from Gemini Vision to Cloudflare Workers AI across the study backend. The changes replace hardcoded Gemini calls with Cloudflare equivalents, implement education-level-aware system prompts in the chat endpoint, and add cost tracking via a unified neural cost calculation function.

**Watch for:** Unpacking error in the multi-image worker (`_process_sow_multi_image_job`); the `_ocr_image()` function returns a tuple `(text, cost)` but is called without unpacking the cost component, causing a runtime ValueError on the second and subsequent images.

**Verdict**: NEEDS_CHANGES

---

## High-level view

The OCR function rename from `_ocr_image_with_gemini` to `_ocr_image` is complete and clean — all references are eliminated and the function now delegates to `call_cf_vision()` from the router module. All Gemini imports have been removed from study.py.

The chat endpoint now selects the system prompt from a 4-way map keyed by education level (primary/secondary/tertiary/research), with a sensible fallback to secondary for unrecognized values. The prompt templates import correctly from `app.ai.prompts` and the `education_level` parameter is threaded through the request properly.

The single-image worker logs the vision cost to `AiUsageLog` after successfully creating the `StudyMaterial` row. However, the multi-image worker calls `_ocr_image()` in a loop without unpacking the cost tuple it returns, which will cause a ValueError at runtime when the function tries to assign both values to a single variable.

The `calculate_ai_cost_neurons()` function is correctly defined and called in the chat endpoint, but `call_cf_vision()` and `call_cf_tts()` return hardcoded cost constants rather than calling the unified function. This is a design asymmetry but not an error — the functions have internal cost logic, they just don't use the unified calculator. The vision function hardcodes `NEURONS_PER_IMAGE` (150.0), and the TTS function inlines its own cost calculation. Both are consistent with the constants defined at module level.

---

<details>
<summary>Issues (2)</summary>

1. **Unpacking error in multi-image worker** — Line 1140 calls `await _ocr_image(contents, content_type)` and assigns to `extracted_text` without unpacking the cost tuple. The function signature returns `tuple[str, float]`. This will raise `ValueError: too many values to unpack (expected 1)` on any multi-image batch with 2+ images. Fix: `extracted_text, vision_cost = await _ocr_image(...)` and capture cost for logging (likely not logged per file in this worker, but unpack to match the return type).

2. **Cost not logged per-image in multi-image worker** — The single-image worker logs each vision call to `AiUsageLog`, but the multi-image worker OCRs multiple images without logging their costs. This is a tracking gap: you can't see which multi-image batches consumed how many neurons. The merger pattern (multiple images → one StudyMaterial) makes per-file cost tracking tricky, but at minimum unpack the tuple to avoid runtime error; optionally accumulate total cost across all images in the batch and log once at the end.

</details>

---

## Function Rename and Gemini Removal

The `_ocr_image_with_gemini()` function has been successfully renamed to `_ocr_image()` at study.py line 655–665. The function signature is correct: it takes raw image bytes and a content-type string, returns a tuple of extracted text and neurons cost (from `call_cf_vision()`), and raises `HTTPException(503)` on API failure.

All references to the old function name have been eliminated. A workspace grep for `_ocr_image_with_gemini` returns only documentation files (planning notes and prior review docs), not active code.

Gemini imports have been fully removed from study.py. The import section no longer references any Gemini-specific packages. The file does import `call_cf_vision` and `calculate_ai_cost_neurons` from `app.ai.router` at line 45, which is correct.

One call site correctly unpacks the cost: line 890 in `_process_sow_image_job()` does `extracted_text, vision_neurons_cost = await _ocr_image(contents, content_type)` and then logs the cost to `AiUsageLog`. This pattern is correct.

However, line 1140 in `_process_sow_multi_image_job()` calls `await _ocr_image(contents, content_type)` without unpacking the cost tuple, treating it as a single-value return. This will fail at runtime with `ValueError: too many values to unpack (expected 1)`.

---

## Chat Endpoint System Prompt Selection

The chat endpoint (study.py, `@router.post("/chat")` at line 2209) correctly implements a 4-way prompt map keyed by `education_level`:

```python
level = (education_level or "secondary").lower()
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
```

All four prompt constants are imported at the top of the file (lines 22–27), and the prompts.py file defines all four (`CHAT_TUTOR_SYSTEM_PRIMARY`, `CHAT_TUTOR_SYSTEM_SECONDARY`, `CHAT_TUTOR_SYSTEM_TERTIARY`, `CHAT_TUTOR_SYSTEM_RESEARCH`). The fallback to secondary for unrecognized values is sensible.

The `system_prompt` is correctly formatted with `context` and `difficulty` arguments, and these values are passed from the request payload and a function parameter (defaulting to "medium"). The full prompt concatenates the system prompt with the student's message before sending to the AI.

---

## Cost Calculation and Logging

The `calculate_ai_cost_neurons(operation: str, input_size: int) -> float` function is correctly defined in router.py (lines 41–54). It branches on operation type and returns neurons cost based on hardcoded per-operation constants:
- `"chat"`: `(tokens / 1000.0 * 2.0)` (2 neurons per 1k tokens)
- `"vision"`: fixed `150.0` neurons
- `"audio_tts"`: `(chars * 0.1)` neurons
- default: `0.0`

The function is used in the chat endpoint (study.py, line 2265):
```python
cost_neurons = calculate_ai_cost_neurons("chat", input_size_chars)
```

The cost is then logged to `AiUsageLog` immediately after (lines 2267–2279).

In `_process_sow_image_job()`, the vision cost is logged similarly after the material is created (lines 913–923). The cost comes from the return value of `call_cf_vision()`, which returns `NEURONS_PER_IMAGE` (150.0).

However, `call_cf_vision()` and `call_cf_tts()` do not call `calculate_ai_cost_neurons()` internally; they return hardcoded or inlined cost constants. This is a design asymmetry but functionally correct:
- `call_cf_vision()` returns the module-level constant `NEURONS_PER_IMAGE` (150.0)
- `call_cf_tts()` inlines its own cost: `max(1, len(text) / 10.0)`
- `call_cf_chat()` does call `calculate_ai_cost_neurons("chat", ...)` at line 177

The functions are not required to call the unified calculator; they can have their own logic. The asymmetry is present but not harmful. All three functions return a cost value that gets logged by callers.

---

## Multi-Image Worker Cost Tracking Gap

The multi-image worker (`_process_sow_multi_image_job()`, starting at study.py line 1104) OCRs each image in a loop (lines 1137–1150). The loop calls `await _ocr_image(contents, content_type)` without unpacking the cost tuple:

```python
extracted_text = await _ocr_image(contents, content_type)
```

Since `_ocr_image()` returns `tuple[str, float]`, this assignment will fail on the second iteration with:
```
ValueError: too many values to unpack (expected 1)
```

The single-image worker avoids this by correctly unpacking:
```python
extracted_text, vision_neurons_cost = await _ocr_image(contents, content_type)
```

Even if this unpacking is fixed, the multi-image worker does not log per-image costs to `AiUsageLog`. The single-image worker logs the cost after creating the material row. For the multi-image case, the design question is whether to log each image's cost separately or accumulate and log once. Either way, the tuple must be unpacked to match the function's return type.

---

## Router Module: cost Constants and Implementation

The router.py module defines cost constants at module level (lines 35–37):
```python
NEURONS_PER_CHAT_1K_TOKENS = 2
NEURONS_PER_IMAGE = 150
NEURONS_PER_TTS_CHAR = 0.1
```

These are used in the `calculate_ai_cost_neurons()` function for chat, and `call_cf_vision()` returns the `NEURONS_PER_IMAGE` constant directly. The `call_cf_tts()` function computes cost as `max(1, len(text) / 10.0)`, which aligns with the module constant `NEURONS_PER_TTS_CHAR`.

The implementation is internally consistent. The only gap is that `call_cf_vision()` and `call_cf_tts()` don't call `calculate_ai_cost_neurons()` (they return fixed/inlined costs), but this is not an error — it's a design choice that works as long as callers capture and log the returned cost.

---

## Function Signatures and Compatibility

All function signatures remain unchanged except for the rename:
- `_ocr_image()` (renamed from `_ocr_image_with_gemini()`) maintains the return type `tuple[str, float]`
- `chat_study()` adds an optional `education_level` parameter (defaulting to `None`, which triggers the fallback in the prompt map)
- `calculate_ai_cost_neurons()` is new and doesn't conflict with existing signatures
- `call_cf_vision()`, `call_cf_tts()`, `call_cf_chat()` remain as defined in router.py

---

## No Regression in Existing Logic

The change does not break existing functionality:
- The import of `call_cf_vision()` at line 45 is correct and the function exists in router.py
- The prompt templates exist in prompts.py and are correctly imported
- The `AiUsageLog` model exists and is populated with the correct fields
- The background workers (`_process_sow_image_job()`, `_process_sow_document_job()`) structure is unchanged except for the vision call replacement

---

<details>
<summary>File map</summary>

- **study.py** (lines 45, 655–665, 890, 1140, 2209–2279): Renamed `_ocr_image_with_gemini()` to `_ocr_image()`, added call_cf_vision import, integrated education-level prompt selection in chat endpoint, logged vision cost in single-image worker, but multi-image worker has unpacking bug.
- **router.py** (lines 41–54, 57–96, 117–180): Added `calculate_ai_cost_neurons()` function, implemented `call_cf_vision()`, `call_cf_tts()`, and `call_cf_chat()` with internal cost logic, integrated cost calculation into chat function.
- **prompts.py** (no new lines): Already contains all four education-level variants (`CHAT_TUTOR_SYSTEM_PRIMARY`, `CHAT_TUTOR_SYSTEM_SECONDARY`, `CHAT_TUTOR_SYSTEM_TERTIARY`, `CHAT_TUTOR_SYSTEM_RESEARCH`).

See full diff in git history or version control.

</details>
