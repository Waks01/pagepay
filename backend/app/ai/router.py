"""AI provider router — Cloudflare Workers AI only.

Uses Cloudflare Workers AI text generation models.
No other providers are configured.
"""

from fastapi import HTTPException

from app.config import settings


async def route_ai(
    prompt: str,
    task_type: str = "fast",
    max_tokens: int = settings.ai_default_max_tokens,
    db=None,
    prefer_vision: bool = True,
) -> dict:
    """Route an AI prompt through Cloudflare Workers AI.

    Uses the OpenAI-compatible chat completions endpoint.
    Returns {"response": text, "provider": "cloudflare", "model": model_id}.
    Raises HTTPException 503 if Cloudflare is unavailable.
    """
    import httpx

    api_key = settings.cloudflare_api_token
    account_id = settings.cloudflare_account_id

    if not api_key or not account_id:
        raise HTTPException(
            status_code=503,
            detail="Cloudflare Workers AI not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
        )

    model = "@cf/zai-org/glm-4.7-flash"
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
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": 0.3,
                    "thinking": {"type": "disabled"},
                },
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=503,
                    detail=f"Cloudflare AI failed: HTTP {resp.status_code} {resp.text[:200]}",
                )
            data = resp.json()
            text = (
                data.get("result", {})
                .get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            if not text:
                raise HTTPException(
                    status_code=503,
                    detail="Cloudflare AI returned empty response",
                )
            return {"response": text, "provider": "cloudflare", "model": model}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Cloudflare AI unavailable: {exc}",
        )