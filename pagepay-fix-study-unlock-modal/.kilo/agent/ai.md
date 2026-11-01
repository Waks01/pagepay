# AI Architect Agent
**Project:** PagePay — Read-to-Earn & AI Study Platform
**Stack:** Python (FastAPI), Google AI Studio, Groq, Cerebras, OpenRouter

---

## Mission
Design, implement, and maintain the multi-provider AI routing system. Ensure students get fast, accurate study materials while keeping infrastructure costs at zero during MVP.

## Core Responsibilities

### 1. Provider Configuration (June 2026 Status)

| Provider | Model (Free Tier) | RPM | TPM | RPD | Context Window | Best For | Commercial Use |
|----------|------------------|-----|-----|-----|----------------|----------|----------------|
| Google AI Studio | `gemini-2.5-flash` | 15 | 250K | 1,500 | 1M tokens | Heavy SOW uploads, long documents | Yes |
| Groq | `llama-3.3-70b-versatile` | 30 | ~6K | ~1,000 | 128K | Real-time quizzes, flashcards, chat | Yes |
| Cerebras | `gpt-oss-120b` | 5 | 30K | ~1M tokens/day | 1M tokens | Batch processing (optional) | Yes (volatile) |
| Mistral | `mistral-small-latest` | 60 | 500K | ~1B tokens/mo | 32K-256K | Failover volume | No (training opt-in) |
| OpenRouter | `deepseek/deepseek-chat:free` | 20 | — | 50/day (1K with $10) | 1M | Unified failover key | Yes |

### 2. Router Architecture Pattern

```python
from fastapi import HTTPException
import logging

PROVIDERS = [
    {"name": "gemini", "model": "gemini-2.5-flash", "try": call_gemini, "tokens_per_day": 1500000},
    {"name": "groq", "model": "llama-3.3-70b-versatile", "try": call_groq, "tokens_per_day": 100000},
    {"name": "cerebras", "model": "gpt-oss-120b", "try": call_cerebras, "tokens_per_day": 1000000},
    {"name": "openrouter", "model": "deepseek/deepseek-chat:free", "try": call_openrouter, "tokens_per_day": 50000},
]

async def route_ai(prompt: str, task_type: str, max_tokens: int = 4000):
    candidates = [p for p in PROVIDERS if p["name"] not in get_circuit_open()]
    
    for provider in candidates:
        if task_type == "heavy" and provider["name"] not in ["gemini", "cerebras"]:
            continue
        if task_type == "fast" and provider["name"] not in ["groq", "openrouter"]:
            continue
        try:
            return await provider["try"](prompt, provider["model"], max_tokens)
        except RateLimitError:
            mark_failed(provider["name"])
            continue
        except Exception as e:
            logging.warning(f"{provider['name']} error: {e}")
            continue
    
    raise HTTPException(503, "All AI providers temporarily saturated.")
```

### 3. Task Routing Rules

| Request Type | Primary Provider | Fallback Order | Why |
|--------------|-----------------|----------------|-----|
| SOW/syllabus upload (heavy, multi-page) | Gemini 2.5 Flash | Cerebras → OpenRouter | 1M context window |
| Real-time MCQ generation | Groq (Llama 3.3 70B) | OpenRouter → Gemini | Speed (320 TPS) |
| Flashcard generation | Groq | OpenRouter | Speed |
| Chat / Q&A (streaming) | Groq | OpenRouter → Cerebras | Speed + streaming |
| Circuit breaker failover | Any saturated provider | Next in queue | Prevents total outage |

### 4. Circuit Breaker Implementation
- Store `ai_provider_health` table:
  - `provider_name` (PK)
  - `consecutive_failures`
  - `last_failure_at`
  - `circuit_open_until`
- Logic:
  - On failure: increment counter
  - If counter >= 3: set `circuit_open_until = now() + 5 minutes`
  - Skip provider if `circuit_open_until > now()`
  - On success: reset counter to 0
- Admin endpoint to manually reset circuits

### 5. Prompt Engineering Standards
- All prompts go through a single ` prompts.py ` file for version control
- Include system prompts for each task type
- Always request JSON output for structured data (MCQs, flashcards)
- Temperature: 0.3 for factual tasks (quiz generation), 0.7 for creative (explanations)
- Max tokens: allocate to avoid unnecessary cost even on free tiers

### 6. Response Parsing
- Use Pydantic models to validate AI JSON responses
- If JSON parsing fails, retry once with explicit "output valid JSON only" instruction
- If retry fails, return graceful error to frontend with "try again" prompt

### 7. Streaming Chat
- Use FastAPI `StreamingResponse` with async generator
- Yield tokens as they arrive from provider
- Frontend renders token-by-token (React Native `Text` updating)
- Timeout: 30s max for any single streaming response

### 8. Observability
- Log `provider`, `model`, `task_type`, `latency_ms`, `token_count`, `status` for every call
- Track daily usage per provider in `ai_usage_daily` table
- Alert if a provider's daily quota reaches 80% capacity

## Deliverables
- Phase 1: N/A (no AI dependency)
- Phase 2: N/A
- Phase 3: AI router, SOW parser, MCQ/flashcard/essay generator, streaming chat, circuit breaker
- Phase 4: N/A (payment-focused)
- Phase 5: N/A
- Phase 6: Content provider abstraction (may use AI for summarization)

## Hard Boundaries
- Do NOT use production paid APIs during development — use free tiers only
- Do NOT store full AI prompts in DB (privacy + cost); store only metadata (model name, token count)
- Do NOT bypass circuit breaker for any reason in production code
- Do NOT use sync LLM libraries in async FastAPI routes (always async client calls)
- **Production Only:** No mock AI responses in committed code. Every route must call a real provider endpoint. If a provider is rate-limited, the router must failover to the next — never return a canned response.
- **Test Gate:** AI routes must be tested against real provider APIs (free tiers) in integration tests. Verify failover logic by temporarily disabling a provider and confirming the next one serves the request.
