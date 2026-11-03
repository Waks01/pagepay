# Cloudflare Workers AI Gap Fixes Review

**Verdict**: CHANGES_REQUESTED

Three correctness fixes migrate the study feature from Gemini Vision to Cloudflare Workers AI (vision), add per-level tutoring prompts with education_level routing, and unify cost calculation across all AI operations.

**Watch for:** Cost calculation bug in chat_study (4× underestimate due to double-division); call_cf_vision and call_cf_tts do not use the unified calculate_ai_cost_neurons function despite spec claim.

---

## High-level view

The OCR implementation shifts from Gemini to Cloudflare's Moondream vision model. The rename from `_ocr_image_with_gemini` to `_ocr_image` with direct `call_cf_vision` invocation is clean, with one call site in study.py updated correctly. All Gemini imports and dependencies are removed from that file.

The chat_study endpoint now routes to one of four education-level-specific system prompts (primary/secondary/tertiary/research) based on the `education_level` parameter, defaulting to secondary. The routing logic is correct: lowercase normalization, if-elif-else branching, sensible secondary fallback.

Cost tracking introduces a unified calculate_ai_cost_neurons function, but the implementation has critical bugs: (1) chat_study passes pre-divided character count to the function, which divides by 4 again, resulting in costs 4× too low; (2) call_cf_chat works around this with a 4× multiplication factor that must be maintained in sync; (3) call_cf_vision and call_cf_tts do not use the unified function at all, despite specification claiming they do, breaking the single-source-of-truth pattern. The cost logging structure is sound, but actual values will be wrong for chat operations.

---

## Issues

<details>
<summary>Issues (3)</summary>

1. **Cost calculation double-division bug in chat_study (confirmed)** — Line 2273 passes `input_size_chars // 4` to calculate_ai_cost_neurons, but the function internally divides by 4 again for chat operations. This results in costs 4× too low. Example: 4000 char prompt → 1000 tokens → function computes (1000 // 4) = 250 → cost 0.5 neurons (should be 2.0). Fix: pass `input_size_chars` directly, not pre-divided.

2. **Incomplete use of unified cost function (confirmed)** — Specification claims calculate*ai_cost_neurons is called in all three call_cf*\* functions, but call_cf_vision returns hardcoded NEURONS_PER_IMAGE (150) and call_cf_tts returns inline calculation (len(text) / 10.0), neither using the unified function. Only call_cf_chat uses it (with its own workaround). This breaks the single-source-of-truth pattern and makes future cost adjustments error-prone.

3. **TTS cost logging gap** — synthesize_study_audio in tts_hybrid.py calls call_cf_tts but does not log cost to AiUsageLog. Vision and chat costs are audited; TTS operations have no billing trail. This is out of scope if tts_hybrid was not modified in this PR, but surfaces an asymmetry.

</details>

---

<details>
<summary>Details</summary>

### OCR rename and provider migration

The function `_ocr_image_with_gemini` is now `_ocr_image`, which calls `call_cf_vision(contents, "Extract all text and content from this image")` and returns the description + cost tuple. The rename propagates correctly: study.py calls `_ocr_image` in three background workers (\_process_sow_image_job, \_process_sow_multi_image_job, and implicitly through shared OCR logic). No dangling references remain.

Gemini imports are removed from study.py; the import statement now pulls only `call_cf_vision` and `calculate_ai_cost_neurons` from `app.ai.router`, and all `CHAT_TUTOR_SYSTEM_*` prompts from `app.ai.prompts`. The file-level comments about Gemini Vision caps are not updated (lines 119–121, 126, 210, 231 still mention "Gemini"), but these are documentation of the 5 MB cap's rationale (avoiding large base64 payloads and provider bills), which remains true under Cloudflare. No functional risk here.

### Prompt map for education levels

The chat_study endpoint receives education_level (optional, defaults to "secondary") and routes through four branches:

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

The logic is correct: the parameter is normalized to lowercase, then matched. The fallback is secondary (a sensible default). All four prompts are imported at the top of the file. The prompt template is then formatted with context and difficulty before being combined into full_prompt. No typos, no missing branches.

### Cost calculation and logging

The unified cost function computes neurons based on operation type. The logic is:

- chat: `tokens = input_size // 4` then `return tokens / 1000.0 * 2.0`
- vision: `return 150.0`
- audio_tts: `return max(1, input_size * 0.1)`

**Bug in chat_study (line 2273):** The code passes `calculate_ai_cost_neurons("chat", input_size_chars // 4)` where input_size_chars = len(full_prompt). This pre-divides by 4 (treating the char count as tokens), but the function divides by 4 again, resulting in 4× underestimation. Example: 4000 char prompt → pre-divided to 1000 → function computes (1000 // 4) = 250 tokens → 250 / 1000 \* 2 = 0.5 neurons (correct answer: 2.0 neurons). This underestimates billing by 4× and will cause auditing discrepancies.

**Inconsistency in call_cf_chat (line 177):** To work around the double-division, this function multiplies estimated_input_tokens by 4 before passing: `calculate_ai_cost_neurons("chat", estimated_input_tokens * 4)`. The 4× factor cancels the internal division, yielding correct results. But this workaround is undocumented and fragile; any future developer changing the function will likely break it.

**Vision and TTS not using unified function:** call_cf_vision returns hardcoded `NEURONS_PER_IMAGE` (150), and call_cf_tts returns inline `max(1, len(text) / 10.0)`. Neither uses calculate_ai_cost_neurons despite specification claiming it's called in all three. This breaks the single-source-of-truth for cost calculations and makes future price adjustments error-prone.

**Logging:** chat_study logs to AiUsageLog with operation="chat_tutor", but the logged cost_neurons value will be 4× too low due to the bug above. Vision cost logging in background workers is correct.

### Vision cost logging

In the three background workers (\_process_sow_image_job, \_process_sow_multi_image_job, \_process_sow_document_job via figure extraction), after calling `_ocr_image`, the cost is captured and logged to AiUsageLog with operation="vision_extract" or "vision_extract_batch". The call site is correct and the logging is comprehensive.

### TTS cost logging gap

The tts_hybrid.py synthesize_study_audio function calls call_cf_tts and receives (audio_bytes, duration_seconds), but does not log cost to AiUsageLog. This asymmetry means TTS operations are not metered for billing. Unlike vision and chat, there's no clear audit trail. The cost should be calculated (via calculate_ai_cost_neurons or inline) and logged wherever synthesize_study_audio is called. This is out of scope for this review if tts_hybrid was not modified, but it is a gap in the system.

</details>

---

## File map

- **backend/app/routers/study.py**: Renamed `_ocr_image_with_gemini()` → `_ocr_image()`, updated to call `call_cf_vision()` instead of Gemini. Updated import to include `calculate_ai_cost_neurons`. Added vision cost logging in all three background workers. Updated chat_study to select education-level-specific prompt and log chat cost.
- **backend/app/ai/router.py**: Added `calculate_ai_cost_neurons()` function. Updated `call_cf_chat()` to use it (passing tokens × 4 as workaround). `call_cf_vision()` and `call_cf_tts()` compute cost inline without using the unified function.

[View full diff](https://github.com/...)
