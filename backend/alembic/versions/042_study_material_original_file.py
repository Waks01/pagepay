"""Replace study_materials.image_url with original_file_data and file_mime_type.

Revision ID: 042_study_material_original_file
Revises: 041_add_study_material_image_url
Create Date: 2026-09-02 23:52:00.000000

Why:
  - Preserve the original uploaded file bytes in Postgres instead of
    relying on Cloudinary URLs. This avoids extra hosting cost and
    guarantees the user sees their exact uploaded document.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "042_study_material_original_file"
down_revision: Union[str, None] = "041_add_study_material_image_url"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "study_materials",
        sa.Column("original_file_data", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "study_materials",
        sa.Column("file_mime_type", sa.String(128), nullable=True),
    )
    op.drop_column("study_materials", "image_url")


def downgrade() -> None:
    op.add_column(
        "study_materials",
        sa.Column("image_url", sa.String(500), nullable=True),
    )
    op.drop_column("study_materials", "file_mime_type")
    op.drop_column("study_materials", "original_file_data")
