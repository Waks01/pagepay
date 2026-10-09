"""Dynamic free model selector for Kilo Gateway.

Queries the Kilo Gateway /models endpoint, filters to free models,
detects vision-capable ones, and rotates through the pool to avoid
rate limits and model-rotation failures.
"""

import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("uvicorn.error")

# Known vision-capable free model IDs from Kilo Gateway.
# Updated manually as the free catalog changes.
KNOWN_VISION_FREE_MODELS = [
    "stepfun/step-3.7-flash:free",
    "nvidia/nemotron-3-5-lightning:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "liquid/lfm-2.5-2.6b:free",
    "qwen/qwen3.8-27b:free",
    "poolside/laguna-s-2.1:free",
    "poolside/laguna-xs-2.1:free",
]

# Keywords in model IDs that suggest vision/multimodal capability
VISION_KEYWORDS = [
    "vision", "vl", "omni", "multimodal", "pro", "flash",
    "nemotron", "step", "gemini", "gpt", "claude",
]


@dataclass
class FreeModelSelector:
    base_url: str = "https://api.kilo.ai/api/gateway"
    api_key: str | None = None
    models: list[dict[str, Any]] = field(default_factory=list)
    free_models: list[str] = field(default_factory=list)
    vision_free_models: list[str] = field(default_factory=list)
    current_index: int = 0
    refresh_interval_seconds: int = 3600  # Refresh model list every hour
    _last_refresh: float = 0.0

    async def initialize(self) -> None:
        """Fetch models from Kilo Gateway and build the free model pool."""
        await self.refresh_models()

    async def refresh_models(self) -> None:
        """Re-fetch the model list from Kilo Gateway."""
        if not self.api_key:
            logger.warning("KILO_API_KEY not configured; cannot refresh models")
            return

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                if resp.status_code != 200:
                    logger.error("Failed to fetch Kilo models: HTTP %s", resp.status_code)
                    return

                data = resp.json()
                self.models = data.get("data", [])
                self.free_models = [
                    m["id"] for m in self.models if ":free" in m.get("id", "")
                ]
                self.vision_free_models = self._detect_vision_models(self.free_models)
                self._last_refresh = asyncio.get_event_loop().time()

                logger.info(
                    "Kilo models refreshed: %d total, %d free, %d vision-capable free",
                    len(self.models),
                    len(self.free_models),
                    len(self.vision_free_models),
                )
        except Exception as exc:
            logger.error("Failed to refresh Kilo models: %s", exc)

    def _detect_vision_models(self, free_models: list[str]) -> list[str]:
        """Detect which free models likely support vision/multimodal input."""
        vision_models = []

        # First, check against known vision models
        for model_id in free_models:
            if model_id in KNOWN_VISION_FREE_MODELS:
                vision_models.append(model_id)

        # Then, detect by name patterns for newly added models
        for model_id in free_models:
            if model_id in vision_models:
                continue
            lower = model_id.lower()
            if any(kw in lower for kw in VISION_KEYWORDS):
                vision_models.append(model_id)

        return vision_models

    def _should_refresh(self) -> bool:
        """Check if model list should be refreshed based on age."""
        current = asyncio.get_event_loop().time()
        return (current - self._last_refresh) > self.refresh_interval_seconds

    async def get_next_model(self, prefer_vision: bool = True, pin_model: str | None = None) -> str:
        """Get the next model to use, rotating through the pool.

        Args:
            prefer_vision: If True, prefer vision-capable free models.
                          If no vision models available, fall back to any free model.
            pin_model: If provided, always return this model instead of rotating.

        Returns:
            Model ID string to use for the request.
        """
        if pin_model:
            return pin_model

        # Refresh if stale
        if self._should_refresh() or not self.free_models:
            await self.refresh_models()

        if not self.free_models:
            logger.warning("No free models available, falling back to kilo-auto/free")
            return "kilo-auto/free"

        if prefer_vision and self.vision_free_models:
            pool = self.vision_free_models
        else:
            pool = self.free_models

        model = pool[self.current_index % len(pool)]
        self.current_index += 1

        logger.debug("Selected free model: %s (from pool of %d)", model, len(pool))
        return model

    def get_current_model(self) -> str | None:
        """Get the current model without rotating."""
        if self.vision_free_models:
            return self.vision_free_models[self.current_index % len(self.vision_free_models)]
        if self.free_models:
            return self.free_models[self.current_index % len(self.free_models)]
        return None


# Module-level singleton used by the router and migration script.
free_model_selector = FreeModelSelector()
