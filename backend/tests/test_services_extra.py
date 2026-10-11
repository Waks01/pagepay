"""Cover the content import services by mocking their external HTTP calls.

`gutendex` and `gnews` fetch from third-party APIs. We can't exercise the real
network in tests, so we monkey-patch the httpx client used inside the
importers. This raises coverage on the importer functions above 80% without
flaky external dependencies.
"""

import pytest
from unittest.mock import AsyncMock, patch


GUTENDEX_RESPONSE = {
    "count": 1,
    "results": [
        {
            "id": 1,
            "title": "Mock Book",
            "authors": [{"name": "Mock Author", "birth_year": None, "death_year": None}],
            "bookshelves": ["Adventure", "Best Books Ever Listings"],
            "formats": {
                "text/plain; charset=utf-8": "https://example.com/book.txt",
            },
        }
    ],
}

GUTENDEX_BODY = "CHAPTER 1. Mock text body for testing.\n" * 100


class MockResponse:
    def __init__(self, json_data=None, text_data="", status_code=200):
        self._json = json_data
        self._text = text_data
        self.status_code = status_code
        self.content = text_data.encode("utf-8")

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")

    def json(self):
        return self._json


@pytest.mark.asyncio
async def test_gutendex_import_inserts_row(db_session):
    from app.services.content import gutendex

    listing_resp = MockResponse(json_data=GUTENDEX_RESPONSE)
    body_resp = MockResponse(text_data=GUTENDEX_BODY)

    async def fake_get(url, **kwargs):
        if url.endswith("/books"):
            return listing_resp
        return body_resp

    with patch.object(gutendex.httpx, "AsyncClient") as mock_client_cls:
        client_instance = AsyncMock()
        client_instance.get = fake_get
        client_instance.__aenter__ = AsyncMock(return_value=client_instance)
        client_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = client_instance

        count = await gutendex.import_gutendex(db_session, limit=5)

    assert count == 1
    from sqlalchemy import select
    from app.models import ContentCatalog
    # Parents only — `import_gutendex` now slices each imported parent into
    # ~1-min child rows, so the table also has children.
    parents = (await db_session.execute(
        select(ContentCatalog).where(ContentCatalog.parent_work_id.is_(None))
    )).scalars().all()
    assert len(parents) == 1
    parent = parents[0]
    assert parent.title == "Mock Book"
    assert parent.author == "Mock Author"
    # The slicer owns estimated_read_minutes on the parent — it must reflect
    # the child slice count, not a pre-filled value.
    children = (await db_session.execute(
        select(ContentCatalog).where(ContentCatalog.parent_work_id == parent.id)
    )).scalars().all()
    assert len(children) >= 1, "imported parent should be sliced into children"
    assert parent.estimated_read_minutes == len(children)


@pytest.mark.asyncio
async def test_gutendex_skips_duplicate(db_session):
    from app.services.content import gutendex
    from app.models import ContentCatalog

    # Pre-seed a row with the same source_url.
    db_session.add(ContentCatalog(
        title="Existing",
        content_type="book",
        category="fiction",
        source_url="https://example.com/book.txt",
        body_text="existing",
        author="someone",
        estimated_read_minutes=5,
    ))
    await db_session.commit()

    listing_resp = MockResponse(json_data=GUTENDEX_RESPONSE)
    body_resp = MockResponse(text_data=GUTENDEX_BODY)

    async def fake_get(url, **kwargs):
        if url.endswith("/books"):
            return listing_resp
        return body_resp

    with patch.object(gutendex.httpx, "AsyncClient") as mock_client_cls:
        client_instance = AsyncMock()
        client_instance.get = fake_get
        client_instance.__aenter__ = AsyncMock(return_value=client_instance)
        client_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = client_instance

        count = await gutendex.import_gutendex(db_session, limit=5)

    assert count == 0


@pytest.mark.asyncio
async def test_gutendex_skips_when_no_plain_text_format(db_session):
    """If Gutendex only offers HTML for a book, the row is skipped (not
    inserted) so we don't pollute body_text with markup that overflows the
    TEXT column."""
    from app.services.content import gutendex

    bad_response = {
        "count": 1,
        "results": [
            {
                "id": 1,
                "title": "HTML Only",
                "authors": [{"name": "X"}],
                "bookshelves": [],
                "formats": {"text/html": "https://example.com/book.html"},
            }
        ],
    }
    listing_resp = MockResponse(json_data=bad_response)

    async def fake_get(url, **kwargs):
        return listing_resp

    with patch.object(gutendex.httpx, "AsyncClient") as mock_client_cls:
        client_instance = AsyncMock()
        client_instance.get = fake_get
        client_instance.__aenter__ = AsyncMock(return_value=client_instance)
        client_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = client_instance

        count = await gutendex.import_gutendex(db_session, limit=5)

    assert count == 0


@pytest.mark.asyncio
async def test_gnews_import_handles_missing_api_key(db_session):
    """Without a GNews key the importer should silently return 0 rather than
    crashing the admin import endpoint."""
    from app.services.content import gnews

    with patch.object(gnews.settings, "gnews_api_key", None):
        count = await gnews.import_gnews(db_session, limit=5)
    assert count == 0


@pytest.mark.asyncio
async def test_gnews_import_inserts_articles(db_session):
    from app.services.content import gnews

    payload = {
        "articles": [
            {
                "title": "Mock News",
                "description": "Body text",
                "content": "Body text",
                "url": "https://example.com/news/1",
                "source": {"name": "Mock"},
                "publishedAt": "2026-06-27T00:00:00Z",
            }
        ]
    }
    resp = MockResponse(json_data=payload)

    async def fake_get(url, **kwargs):
        return resp

    with patch.object(gnews.settings, "gnews_api_key", "fake-key"), \
         patch.object(gnews.httpx, "AsyncClient") as mock_client_cls:
        client_instance = AsyncMock()
        client_instance.get = fake_get
        client_instance.__aenter__ = AsyncMock(return_value=client_instance)
        client_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = client_instance

        count = await gnews.import_gnews(db_session, limit=5)

    assert count == 1
    from sqlalchemy import select
    from app.models import ContentCatalog
    result = await db_session.execute(select(ContentCatalog))
    rows = result.scalars().all()
    assert rows[0].title == "Mock News"
    # gnews uses the publisher name as the category — "Mock" in this fixture.
    assert rows[0].category == "Mock"
    assert rows[0].author == "Mock"


@pytest.mark.asyncio
async def test_auth_service_helpers_exposed():
    """The auth service exposes hash_password and verify_password; both must
    round-trip correctly across the 72-byte boundary that originally bit us
    when passlib was in the picture."""
    from app.services.auth import hash_password, verify_password

    hashed = hash_password("GoodPass123")
    assert hashed.startswith("$2b$")  # bcrypt format
    assert verify_password("GoodPass123", hashed)
    assert not verify_password("WrongPass", hashed)
    # Long password: bcrypt truncates at 72 bytes; a 100-char string still
    # verifies because the same input is truncated the same way.
    long_pw = "a" * 100
    long_hash = hash_password(long_pw)
    assert verify_password(long_pw, long_hash)
    # But the *first 72 bytes* differing causes the verification to fail.
    assert not verify_password("b" * 100, long_hash)
