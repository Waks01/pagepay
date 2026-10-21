"""AI provider router — Cloudflare Workers AI only.

Text generation runs on Cloudflare Workers AI. Two models are in play for
student chat, chosen by question complexity (see `app/ai/routing.py`):

- `settings.ai_standard_model` — cheap, handles definitions and recall
- `settings.ai_premium_model` — reasoning, reserved for "why" questions

Callers pass `model_tier="standard"` or `"premium"` to pick one explicitly.
Anything else (`task_type` alone, as every non-chat caller uses) goes to
premium, because a wrong answer costs a student more than a saved fraction
of a cent. Generation tasks — SOW parsing, exam questions, assets — are
always premium: a misparsed syllabus or a wrong answer key is not something
to economise on.

Two provider-specific details matter here:

1. Reasoning (thinking) must be disabled per call via
   `chat_template_kwargs: {"enable_thinking": false}`. The premium model is a
   reasoning model; with thinking on, hidden reasoning tokens are
   billed as output tokens (~3x cost measured on a tutor prompt) and
   can consume the whole `max_tokens` budget, leaving `content: null`.
2. The REST envelope carries `success`/`errors` fields even on HTTP
   200, so both are checked before trusting `result`.
"""

import logging

from fastapi import HTTPException

from app.ai.routing import PREMIUM, STANDARD
from app.config import settings

logger = logging.getLogger("uvicorn.error")


def resolve_model(model_tier: str | None = None) -> str:
    """Map a tier to a model id.

    An unknown or missing tier resolves to premium. That is deliberate:
    `route_ai` predates routing and its callers pass no tier, so defaulting
    to premium keeps every existing generation task on the better model
    until chat is explicitly migrated.
    """
    if model_tier == STANDARD:
        return settings.ai_standard_model
    return settings.ai_premium_model


async def route_ai(
    prompt: str,
    task_type: str = "fast",
    max_tokens: int = settings.ai_default_max_tokens,
    db=None,
    prefer_vision: bool = True,
    system_prompt: str | None = None,
    history: list[dict] | None = None,
    model_tier: str | None = None,
    temperature: float | None = None,
    user_id: int | None = None,
    endpoint: str = "ai",
) -> dict:
    """Send a prompt to Cloudflare Workers AI and return the text.

    `model_tier` selects the model for chat turns — see `resolve_model`.
    Omit it for generation tasks, which always use the premium model.

    `system_prompt` is sent with the system role; `history` is an
    optional list of prior {"role": "user"|"assistant", "content": ...}
    turns placed between the system prompt and the current user turn
    (capped to the last 20 turns).

    `temperature` overrides the per-task default. It is set explicitly
    for the teaching layer, which is a creative task (0.7) rather than
    a factual one (0.3).

    `db` and `user_id` together make the call cost itself. Every AI
    call the platform pays for should land in the usage log, and a
    call whose cost nobody records is a bill nobody watches. Pass both
    and the call is logged under `endpoint`.

    Returns {"response": str, "provider": str, "model": str,
    "usage": {...}}. Raises HTTPException 503 on any failure —
    callers must call this BEFORE they start streaming a response so
    the error can still reach the client as a real HTTP status.
    """
    import httpx

    api_key = settings.cloudflare_api_token
    account_id = settings.cloudflare_account_id

    if not api_key or not account_id:
        raise HTTPException(
            status_code=503,
            detail="Cloudflare Workers AI not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
        )

    model = resolve_model(model_tier)

    if temperature is None:
        temperature = (
            settings.ai_temperature_chat
            if task_type == "chat"
            else settings.ai_temperature_default
        )

    messages: list[dict] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for turn in (history or [])[-20:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": prompt})

    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{account_id}/ai/run/{model}"
    )

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    # Cloudflare ignores the Anthropic-style
                    # `thinking` param; this is the Workers AI knob.
                    "chat_template_kwargs": {"enable_thinking": False},
                },
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=503,
                    detail=f"Cloudflare AI failed: HTTP {resp.status_code} {resp.text[:200]}",
                )
            data = resp.json()
            if data.get("success") is False or data.get("errors"):
                raise HTTPException(
                    status_code=503,
                    detail=f"Cloudflare AI error: {str(data.get('errors'))[:200]}",
                )
            result = data.get("result") or {}
            # Cloudflare Workers AI text models return result.response
            # directly (not OpenAI-style choices[0].message.content).
            text = result.get("response", "") or ""
            if not text.strip():
                choices = result.get("choices") or [{}]
                message = choices[0].get("message") or {}
                text = message.get("content") or ""
            if not text.strip():
                raise HTTPException(
                    status_code=503,
                    detail="Cloudflare AI returned empty response",
                )
            usage = result.get("usage") or {}

            if db is not None and user_id is not None:
                # Record the spend while it is still in hand. A call
                # whose cost nobody records is a bill nobody watches.
                try:
                    from app.services.ai_cost import log_usage

                    await log_usage(
                        db,
                        user_id=user_id,
                        endpoint=endpoint,
                        model=result.get("model") or model,
                        prompt_tokens=usage.get("prompt_tokens") or 0,
                        completion_tokens=usage.get("completion_tokens") or 0,
                    )
                except Exception as exc:
                    logger.warning("AI usage logging failed: %s", exc)

            return {
                "response": text,
                "provider": "cloudflare",
                "model": result.get("model") or model,
                "usage": {
                    "prompt_tokens": usage.get("prompt_tokens"),
                    "completion_tokens": usage.get("completion_tokens"),
                    "total_tokens": usage.get("total_tokens"),
                },
            }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Cloudflare AI call failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Cloudflare AI unavailable: {exc}",
        ) from exc

