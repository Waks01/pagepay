import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_content_catalog_empty(client: AsyncClient):
    resp = await client.get("/api/v1/content/catalog")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_content_catalog_filter(client: AsyncClient):
    resp = await client.get("/api/v1/content/catalog?category=fiction")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
