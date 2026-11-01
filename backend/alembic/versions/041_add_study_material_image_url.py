"""Add image_url to study_materials for preserving original uploads.

Revision ID: 041_add_study_material_image_url
Revises: 3f02971605b1
Create Date: 2026-08-30 12:45:00.000000

Why:
  - Preserve the original uploaded image/document so exports can include
    the actual visual content, not just extracted OCR text.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "041_add_study_material_image_url"
down_revision: Union[str, None] = "040_add_ad_requests_use_case"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "study_materials",
        sa.Column("image_url", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("study_materials", "image_url")
