"""Add education_level column to study_materials table.

Revision ID: 001
Revises:
Create Date: 2025-01-11 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add education_level column as nullable String(50) to study_materials table
    op.add_column('study_materials', sa.Column('education_level', sa.String(50), nullable=True))


def downgrade() -> None:
    # Remove education_level column
    op.drop_column('study_materials', 'education_level')
