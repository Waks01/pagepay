"""Billing and lifecycle for paid audio episodes.

Owns the money side of narration so the router stays thin:

* `quote()` prices a request without charging, for the confirm screen.
* `create_batches()` quotes, checks balance, debits, and queues episodes.
* `charge_once()` debits service credits atomically and is idempotent —
  a duplicate request for the same identity returns the existing batch
  and costs nothing.
* `refund()` returns a debit when generation fails.

The batch row itself is the audit record for a debit and its refund:
`cost_sv` records what was taken, `status` and `refunded_at` record
what was given back. A worker crash leaves a row stuck in `generating`
with the user charged, so `refund_stale()` exists to settle those.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import StudyAudioBatch, User
from app.services import audio_pricing, study_narration

#: Rows stuck in `generating` past this are refunded by the sweeper.
STALE_GENERATION_MINUTES = 20


# ── Balance helpers ────────────────────────────────────────────────


def _balance_field() -> str:
    """The balance SV is debited from.

    `service_credit_balance` is the spendable side of the
    `wallet_split_enabled` split, so bought credits are never cashable.
    """
    return "service_credit_balance" if settings.wallet_split_enabled else "points_balance"


async def _read_balance(db: AsyncSession, user_id: int) -> int:
    field = _balance_field()
    result = await db.execute(select(getattr(User, field)).where(User.id == user_id))
    return int(result.scalar_one_or_none() or 0)


async def read_balance(db: AsyncSession, user_id: int) -> int:
    """Public read of the balance SV is spent from."""
    return await _read_balance(db, user_id)


async def _debit(db: AsyncSession, user_id: int, amount: int) -> None:
    field = _balance_field()
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values({getattr(User, field): getattr(User, field) - amount})
    )


async def _credit(db: AsyncSession, user_id: int, amount: int) -> None:
    field = _balance_field()
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values({getattr(User, field): getattr(User, field) + amount})
    )


# ── Quoting ────────────────────────────────────────────────────────


def quote(*, parsed_structure: object, topic_indexes: list[int], level: str) -> dict:
    """Price a request without charging anything.

    Estimates are computed from source length, and the user is shown
    exactly this number — the same number they are charged — so what was
    quoted is what is paid.
    """
    level = audio_pricing.normalise_level(level)

    topics: list[dict] = []
    total_cost = 0
    total_chars = 0
    total_episodes = 0

    for index in topic_indexes:
        plan = study_narration.topic_episode_plan(parsed_structure, index)
        source_chars = plan["char_count"]
        episodes = plan["episodes"]
        # Bill on what generation will actually produce — `billing_chars`
        # scales with the episode count, because each episode is
        # generated with a fixed word target regardless of source size.
        output_chars = audio_pricing.billing_chars(source_chars, episodes)
        breakdown = audio_pricing.quote_detailed(level, output_chars)

        topics.append(
            {
                "topic_index": index,
                "topic_name": plan["topic_name"],
                "char_count": output_chars,
                "episodes": episodes,
                "estimated_seconds": breakdown["estimated_seconds"],
                "cost_sv": breakdown["cost_sv"],
            }
        )
        total_cost += breakdown["cost_sv"]
        total_chars += output_chars
        total_episodes += episodes

    return {
        "level": level,
        "topics": topics,
        "topic_count": len(topic_indexes),
        "episode_count": total_episodes,
        "total_char_count": total_chars,
        "total_cost_sv": total_cost,
        "estimated_seconds": sum(t["estimated_seconds"] for t in topics),
    }


# ── Creation / billing ─────────────────────────────────────────────


def _split_cost(total: int, episodes: int) -> list[int]:
    """Split a quoted cost across episodes without losing or inventing SV.

    Integer division alone would drop the remainder, so the leftover is
    spread over the first episodes.
    """
    if episodes <= 1:
        return [total]
    base, remainder = divmod(total, episodes)
    return [base + (1 if i < remainder else 0) for i in range(episodes)]


async def create_batches(
    db: AsyncSession,
    *,
    user_id: int,
    material_id: int,
    parsed_structure: object,
    topic_indexes: list[int],
    level: str,
) -> dict:
    """Quote, check balance, debit, and queue the requested episodes.

    Existing episodes for the same identity are returned unbilled, so a
    repeat request is free and never double-charges.
    """
    level = audio_pricing.normalise_level(level)

    already = await _existing_identities(db, user_id, material_id, topic_indexes, level)
    pending = [i for i in topic_indexes if i not in already]

    priced = quote(parsed_structure=parsed_structure, topic_indexes=pending, level=level)
    cost_sv = priced["total_cost_sv"]

    balance = await _read_balance(db, user_id)
    if cost_sv > 0 and balance < cost_sv:
        return {
            "ok": False,
            "error": "insufficient_sv",
            "detail": f"Need {cost_sv} sv to generate. You have {balance}.",
            "cost_sv": cost_sv,
            "balance_sv": balance,
        }

    created: list[dict] = []
    if cost_sv > 0 and pending:
        await _debit(db, user_id, cost_sv)

        for topic in priced["topics"]:
            episodes = max(1, topic["episodes"])
            share = _split_cost(topic["cost_sv"], episodes)
            for episode_index in range(episodes):
                batch = StudyAudioBatch(
                    user_id=user_id,
                    material_id=material_id,
                    topic_index=topic["topic_index"],
                    episode_index=episode_index,
                    total_episodes=episodes,
                    level=level,
                    char_count=topic["char_count"],
                    est_duration_seconds=topic["estimated_seconds"],
                    cost_sv=share[episode_index],
                    status="queued",
                )
                db.add(batch)
                created.append(
                    {
                        "topic_index": topic["topic_index"],
                        "topic_name": topic["topic_name"],
                        "episode_index": episode_index,
                        "episodes": episodes,
                    }
                )

    await db.commit()
    return {
        "ok": True,
        "level": level,
        "cost_sv": cost_sv,
        "balance_sv": balance - cost_sv,
        "created": created,
        "already_ready": sorted(already),
    }


async def _existing_identities(
    db: AsyncSession,
    user_id: int,
    material_id: int,
    topic_indexes: list[int],
    level: str,
) -> set[int]:
    """Topics that already have a billable episode.

    `ready`, `queued` and `generating` all represent work that has been
    paid for or is in flight, so re-requesting them is free. `failed` is
    excluded on purpose — its debit was refunded, so retrying is allowed
    (see `retry_failed`).
    """
    if not topic_indexes:
        return set()
    result = await db.execute(
        select(StudyAudioBatch.topic_index)
        .where(
            StudyAudioBatch.user_id == user_id,
            StudyAudioBatch.material_id == material_id,
            StudyAudioBatch.level == level,
            StudyAudioBatch.status.in_(("ready", "queued", "generating")),
            StudyAudioBatch.topic_index.in_(topic_indexes),
        )
        .distinct()
    )
    return {int(row[0]) for row in result.all()}


# ── Lifecycle ──────────────────────────────────────────────────────


async def mark_generating(db: AsyncSession, batch_id: int) -> None:
    await db.execute(
        update(StudyAudioBatch).where(StudyAudioBatch.id == batch_id).values(status="generating")
    )


async def mark_ready(
    db: AsyncSession,
    batch_id: int,
    *,
    script_text: str,
    char_count: int,
    audio_key: str,
    provider: str,
    duration_seconds: int | None,
) -> None:
    await db.execute(
        update(StudyAudioBatch)
        .where(StudyAudioBatch.id == batch_id)
        .values(
            status="ready",
            script_text=script_text,
            char_count=char_count,
            audio_key=audio_key,
            provider=provider,
            actual_duration_seconds=duration_seconds,
        )
    )


async def mark_failed(db: AsyncSession, batch_id: int, reason: str) -> bool:
    """Fail a batch and refund its debit. Returns True if a refund was issued.

    Idempotent: a batch already in `failed` is not refunded twice.
    """
    result = await db.execute(
        select(StudyAudioBatch).where(StudyAudioBatch.id == batch_id)
    )
    batch = result.scalar_one_or_none()
    if batch is None:
        return False
    if batch.status == "failed":
        return False

    await db.execute(
        update(StudyAudioBatch)
        .where(StudyAudioBatch.id == batch_id)
        .values(status="failed", error_message=reason[:500])
    )

    if batch.cost_sv > 0 and batch.refunded_at is None:
        await _credit(db, batch.user_id, batch.cost_sv)
        await db.execute(
            update(StudyAudioBatch)
            .where(StudyAudioBatch.id == batch_id)
            .values(refunded_at=datetime.utcnow())
        )

    await db.commit()
    return True


async def retry_failed(
    db: AsyncSession,
    *,
    user_id: int,
    material_id: int,
    parsed_structure: object,
    topic_indexes: list[int],
    level: str,
) -> dict:
    """Re-queue episodes whose debit was refunded after a failure.

    The unique identity constraint prevents inserting a second row for
    the same (user, material, topic, episode, level), so a retry
    resurrects the refunded row instead of duplicating it.
    """
    level = audio_pricing.normalise_level(level)
    if not topic_indexes:
        return {"ok": True, "cost_sv": 0, "requeued": 0}

    result = await db.execute(
        select(StudyAudioBatch).where(
            StudyAudioBatch.user_id == user_id,
            StudyAudioBatch.material_id == material_id,
            StudyAudioBatch.level == level,
            StudyAudioBatch.status == "failed",
            StudyAudioBatch.topic_index.in_(topic_indexes),
        )
    )
    failed = result.scalars().all()
    if not failed:
        return {"ok": True, "cost_sv": 0, "requeued": 0}

    cost_sv = sum(b.cost_sv for b in failed)
    balance = await _read_balance(db, user_id)
    if balance < cost_sv:
        return {
            "ok": False,
            "error": "insufficient_sv",
            "detail": f"Need {cost_sv} sv to retry. You have {balance}.",
            "cost_sv": cost_sv,
            "balance_sv": balance,
        }

    await _debit(db, user_id, cost_sv)
    for batch in failed:
        await db.execute(
            update(StudyAudioBatch)
            .where(StudyAudioBatch.id == batch.id)
            .values(
                status="queued",
                refunded_at=None,
                error_message=None,
                script_text=None,
                audio_key=None,
                position_seconds=0.0,
                completed_at=None,
            )
        )

    await db.commit()
    return {
        "ok": True,
        "cost_sv": cost_sv,
        "balance_sv": balance - cost_sv,
        "requeued": len(failed),
    }


async def refund_stale(db: AsyncSession, older_than_minutes: int = STALE_GENERATION_MINUTES) -> int:
    """Refund batches a crashed worker left in `generating`.

    Without this a dead job silently consumes the user's credits.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=older_than_minutes)
    result = await db.execute(
        select(StudyAudioBatch).where(
            StudyAudioBatch.status == "generating",
            StudyAudioBatch.updated_at < cutoff,
        )
    )
    stale = result.scalars().all()
    for batch in stale:
        await mark_failed(db, batch.id, "Generation timed out and was refunded")
    return len(stale)


# ── Reading ────────────────────────────────────────────────────────


async def list_batches(
    db: AsyncSession,
    *,
    user_id: int,
    material_id: int,
) -> list[StudyAudioBatch]:
    result = await db.execute(
        select(StudyAudioBatch)
        .where(
            StudyAudioBatch.user_id == user_id,
            StudyAudioBatch.material_id == material_id,
        )
        .order_by(StudyAudioBatch.topic_index, StudyAudioBatch.episode_index)
    )
    return list(result.scalars().all())


async def save_position(db: AsyncSession, batch_id: int, user_id: int, seconds: float) -> bool:
    """Persist playback position so a re-open resumes where they stopped.

    Resuming is free and never regenerates audio: the script is frozen at
    generation time, so the wording is always identical to what was paid
    for. A new position is only accepted forward, so a late-arriving
    heartbeat cannot rewind a finished episode.
    """
    if seconds < 0:
        return False
    result = await db.execute(
        update(StudyAudioBatch)
        .where(StudyAudioBatch.id == batch_id, StudyAudioBatch.user_id == user_id)
        .values(position_seconds=seconds)
    )
    return result.rowcount > 0


async def mark_completed(db: AsyncSession, batch_id: int, user_id: int) -> bool:
    now = datetime.utcnow()
    result = await db.execute(
        update(StudyAudioBatch)
        .where(StudyAudioBatch.id == batch_id, StudyAudioBatch.user_id == user_id)
        .values(completed_at=now)
    )
    return result.rowcount > 0
