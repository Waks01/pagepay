# AI Architect Agent
**Project:** PagePay — Read-to-Earn & AI Study Platform
**Stack:** Python (FastAPI), Cloudflare Workers AI — Granite 4.0 H-Micro, GLM-4.7-Flash, Llama-3.2-11B-Vision, MeloTTS

> **Single provider.** The free multi-provider pool (Gemini / Groq /
> Cerebras / OpenRouter / Mistral / Kilo Gateway) was removed in commit
> `cd01eff`. `backend/app/ai/router.py` is the whole client.
>
> There is **no failover and no circuit breaker** — a Cloudflare outage
> is a 503 on every AI feature. The daily quota and rate limits in
> `services/ai_usage.py` and `routers/study.py` are therefore
> load-bearing, not optional.
>
> The models are **paid** (list price, not free tier). Every AI call
> costs money, so the routing split, the quotas and the per-user cost
> logging are the levers that keep the product solvent. See
> `PRICING_AND_UNIT_ECONOMICS.md`.

---

## Mission
Design, implement, and maintain the AI routing system. Ensure students get fast, accurate study materials while keeping infrastructure costs controlled (the current model is paid — quota-enforced).

## Core Responsibilities

### 1. Model Configuration (as it actually is)

| Model id | Role | Cost to us | Used for |
|---|---|---|---|
| `@cf/ibm-granite/granite-4.0-h-micro` | **Standard** | ~₦0.68/turn | Definitions, recall, direct lookups, rephrasing |
| `@cf/zai-org/glm-4.7-flash` | **Premium** | ~₦2.43/turn | Multi-step reasoning, exam strategy, "why" questions, marking |
| `@cf/meta/llama-3.2-11b-vision-instruct` | Vision | ~₦3.58/image | OCR of uploaded images and rendered PDF pages |
| `@cf/myshell-ai/melotts` | TTS | $0.0002/audio-min | All narration |

Config lives in `app/config.py`:
- `ai_standard_model`, `ai_premium_model` — override via `AI_STANDARD_MODEL` / `AI_PREMIUM_MODEL`
- `ai_routing_enabled` — when false, everything routes to premium (used to validate the split)
- `ai_model_cost_usd` — published list price per model, used to compute `AiUsageLog.cost_usd` at write time so telemetry survives a price change

**Cloudflare returns text in `result.response`.** It does *not* use the OpenAI-compatible `result.choices[0].message.content`. Reading the wrong key silently yields an empty response and a 503 — this has bitten the SOW parser before. `route_ai` reads `result.response` first and falls back to the OpenAI shape.

### 2. Router Architecture

`route_ai()` in `app/ai/router.py` is a **Python function, not an HTTP endpoint**. Callers import it.

```python
async def route_ai(
    prompt: str,
    task_type: str = "heavy",       # ignored for model selection today
    model_tier: str | None = None,  # "standard" | "premium" | None
    db=None,
    max_tokens: int | None = None,
) -> dict:
    """Returns {"response", "provider", "model", "usage", "latency_ms", "cost_usd"}"""
```

- `resolve_model(model_tier)` maps a tier to a model id. **An unknown or missing tier resolves to premium** — deliberately, so a bad tier argument can never silently downgrade a student to a weaker model.
- Generation tasks (SOW parse, asset generation, exam questions) omit `model_tier` and always get premium. A misparsed syllabus or a wrong answer key is not worth saving a fraction on.
- The classifier in `app/ai/routing.py::classify_turn()` picks the tier for chat turns. It errs toward premium: a cheap wrong answer costs a student more than a saved fraction.

### 3. Task Routing Rules

| Request type | Model | Why |
|---|---|---|
| SOW/syllabus upload | Premium | Misparsing a syllabus is expensive to get wrong |
| MCQ / exam question generation | Premium | A wrong answer key is worse than no material |
| Asset generation (explanations, flashcards) | Premium | Same |
| Chat / Q&A | Classified standard → premium | Definitions and recall go to Granite; reasoning escalates |
| Image/PDF OCR | Vision model | Separate capability, not a text tier |
| Narration | Premium + MeloTTS | Script quality is user-visible |

### 4. No circuit breaker

There is no `ai_provider_health` table and no circuit-breaker state. A failed Cloudflare call raises; callers convert it to a 503 with a user-safe message. Do not reintroduce a multi-provider failover list without first reading `PRICING_AND_UNIT_ECONOMICS.md` — a second provider is a second bill, and the routing split already does the cost work.

### 5. Prompt Engineering Standards
- All prompts go through a single `app/ai/prompts.py` file for version control
- Include system prompts for each task type
- Always request JSON output for structured data (MCQs, flashcards)
- Temperature: 0.3 for factual tasks (quiz generation), 0.7 for creative (explanations)
- Max tokens: allocate to avoid unnecessary cost — every token is money

### 6. Response Parsing
- Use Pydantic models to validate AI JSON responses
- If JSON parsing fails, retry once with explicit "output valid JSON only" instruction
- If retry fails, return graceful error to frontend with "try again" prompt

### 7. Streaming Chat
- Use FastAPI `StreamingResponse` with async generator
- Yield tokens as they arrive from provider
- Frontend renders token-by-token (React Native `Text` updating)
- Timeout: 30s max for any single streaming response

### 8. Quotas and Metering
- Free chat quota: 5/day (`study_chat_daily_limit`); Premium: 15/day (`study_chat_premium_daily_limit`)
- Beyond the quota a student can **buy turns with SV**: 15 SV standard, 35 SV premium (`study_chat_sv_standard` / `study_chat_sv_premium`), capped at 50 billable turns/day (`study_chat_paid_daily_limit`)
- Uploads and exams are deliberately **not** metered per-use — upload is the entry point and exams are the retention hook. Their cost is bounded by quotas that are still to be added.
- Enforced via `services/ai_usage.py` (`check_and_record` / `peek_count` / `release`)

### 9. Observability
- Log `provider`, `model`, `task_type`, `latency_ms`, `token_count`, `status` for every call
- `AiUsageLog` carries `cost_usd`; `services/ai_cost.py` aggregates per-user cost
- The unit-economics model is only trustworthy if per-user cost is measurable — this is not optional

### 10. Image and PDF reading
- Images and PDF pages are read by the **vision model**, not by text extraction. A PDF is rendered page by page with PyMuPDF and each page goes to the vision model — the same code path as an uploaded image. A PDF's embedded text layer is not used, because a scan or a photo has none.
- Render at 1400px wide for OCR; the 900px preview thumbnails are too soft to read.

## Deliverables
- Phase 1: N/A (no AI dependency)
- Phase 2: N/A
- Phase 3: AI router, SOW parser, MCQ/flashcard/essay generator, streaming chat
- Phase 4: N/A (payment-focused)
- Phase 5: N/A
- Phase 6: Content provider abstraction (may use AI for summarization)
- Phase 9: Standard/Premium model routing, per-user cost logging, metered chat turns

## Hard Boundaries
- Do NOT store full AI prompts in DB (privacy + cost); store only metadata (model name, token count)
- Do NOT use sync LLM libraries in async FastAPI routes (always async client calls)
- **Production Only:** No mock AI responses in committed code. Every route must call the real provider. If Cloudflare is unavailable, return a 503 with a user-safe message — never a canned response.
- **Test Gate:** Tests must **not** call the live provider. Monkeypatch `route_ai` (and the OCR helper) with a stub. A test that hits Cloudflare is slow, non-deterministic and burns the daily allowance.
- **Cost Gate:** Any new AI call site is a new bill. Before adding one, say what it costs per use, who pays for it, and which quota bounds it.
