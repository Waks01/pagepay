"""Create the base schema for a fresh database.

The existing migration chain (001+) was written assuming the SQLAlchemy
model tables already existed, because the production Neon database was
bootstrapped via out-of-band DDL before the alembic chain was introduced.
On a fresh database this migration creates every table declared in
`Base.metadata` so that 001's `op.add_column('users', ...)` calls have a
table to alter.

The SQLAlchemy call `Base.metadata.create_all(bind, checkfirst=True)`
emits `CREATE TABLE IF NOT EXISTS` for every model, so this migration is
truly idempotent. On Neon (where every model table already exists) it is
a no-op.

The migration is intentionally placed at the chain root (down_revision =
None) so a fresh database running `alembic upgrade head` builds the
entire schema from zero.

Revises: none (this is the chain root)
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# Bring Base + every model into scope so metadata is populated.
from app.models import Base  # noqa: F401


revision: str = '000_create_base_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Emit `CREATE TABLE IF NOT EXISTS` for every table in Base.metadata.

    `checkfirst=True` is SQLAlchemy's default and makes the call a no-op
    when a table already exists, which means this migration is safe to
    run against both fresh databases (where it builds the schema) and
    pre-existing production DBs (where every table is already there).
    """
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    """Drop every table in Base.metadata, in reverse-dependency order.

    SQLAlchemy handles topological ordering via ForeignKey constraints,
    so children are dropped before parents.
    """
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)