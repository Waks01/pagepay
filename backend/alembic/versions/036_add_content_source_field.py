"""add_content_source_to_catalog

Revision ID: 036_content_source
Revises: 035_add_user_streaks_cols
Create Date: 2026-08-23

Adds content_source field to content_catalog table for premium ad gating logic.
This field determines whether content is ad-free (study materials) or ad-supported (novels).

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '036_content_source'
down_revision = '035_add_user_streaks_cols'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add content_source column to content_catalog table
    op.add_column(
        'content_catalog',
        sa.Column(
            'content_source',
            sa.String(length=50),
            nullable=True,
            comment='Source of content for ad gating logic (gutenberg, openstax, etc.)'
        )
    )
    
    # Add index for faster ad policy lookups
    op.create_index(
        'ix_content_catalog_content_source',
        'content_catalog',
        ['content_source'],
        unique=False
    )


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_content_catalog_content_source', table_name='content_catalog')
    
    # Remove column
    op.drop_column('content_catalog', 'content_source')
