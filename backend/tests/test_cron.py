"""Cover the cron entrypoint.

The cron module's job is to run imports + slicing + maintenance on a
schedule. We mock the importers (they hit the network) and verify the
orchestrator sequences them correctly.
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.models import ContentCatalog


@pytest.mark.asyncio
async def test_run_once_calls_importers_then_slicer(db_session):
    """run_once must invoke gutendex → gnews → slice_all_books in order."""
    from app.services.cron import run_once

    with patch("app.services.cron.import_gutendex", new=AsyncMock(return_value=3)) as g, \
         patch("app.services.cron.import_gnews", new=AsyncMock(return_value=2)) as n, \
         patch("app.services.cron.slice_all_books", new=AsyncMock(return_value={
             "sliced": 3, "children_added": 9, "skipped_existing": 0,
         })) as s:
        summary = await run_once()

    g.assert_awaited_once()
    n.assert_awaited_once()
    s.assert_awaited_once()
    assert summary["gutendex_imported"] == 3
    assert summary["gnews_imported"] == 2
    assert summary["sliced"] == 3
    assert summary["children_added"] == 9


@pytest.mark.asyncio
async def test_run_once_swallows_importer_errors(db_session):
    """A network blip on one importer must not abort the rest of the run."""
    from app.services.cron import run_once

    async def boom(*a, **kw):
        raise ConnectionError("network down")

    with patch("app.services.cron.import_gutendex", new=boom), \
         patch("app.services.cron.import_gnews", new=AsyncMock(return_value=1)), \
         patch("app.services.cron.slice_all_books", new=AsyncMock(return_value={
             "sliced": 0, "children_added": 0, "skipped_existing": 0,
         })):
        summary = await run_once()

    assert summary["gutendex_imported"] == 0  # default since we swallowed the error
    assert summary["gnews_imported"] == 1
    assert summary["sliced"] == 0


@pytest.mark.asyncio
async def test_run_once_summary_has_all_keys(db_session):
    """The summary dict shape must stay stable for ops dashboards."""
    from app.services.cron import run_once

    with patch("app.services.cron.import_gutendex", new=AsyncMock(return_value=0)), \
         patch("app.services.cron.import_gnews", new=AsyncMock(return_value=0)), \
         patch("app.services.cron.slice_all_books", new=AsyncMock(return_value={
             "sliced": 0, "children_added": 0, "skipped_existing": 0,
         })), \
         patch("app.services.cron.sync_hive_posts", new=AsyncMock(return_value=0)), \
         patch("app.services.cron.reset_daily_referral_caps", new=AsyncMock(return_value=0)):
        summary = await run_once()

    assert set(summary.keys()) == {
        "gutendex_imported", "gnews_imported", "hive_imported",
        "sliced", "children_added", "skipped_existing",
        "subscriptions_expired", "referral_caps_reset",
    }
