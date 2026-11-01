"""Add StudyFigure table and page_count/figure_count to StudyMaterial.

Revision ID: 044_study_figures_schema
Revises: 027_backfill_missing_indexes
Create Date: 2026-01-11 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '044_study_figures_schema'
down_revision: Union[str, None] = '027_backfill_missing_indexes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Add columns to study_materials if not already present
    if 'study_materials' in existing_tables:
        columns = inspector.get_columns('study_materials')
        column_names = {col['name'] for col in columns}
        
        if 'page_count' not in column_names:
            op.add_column(
                'study_materials',
                sa.Column('page_count', sa.Integer(), nullable=True)
            )
        
        if 'figure_count' not in column_names:
            op.add_column(
                'study_materials',
                sa.Column('figure_count', sa.Integer(), nullable=True)
            )

    # Create study_figures table if not already present
    if 'study_figures' not in existing_tables:
        op.create_table(
            'study_figures',
            sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column('material_id', sa.BigInteger(), nullable=False),
            sa.Column('figure_index', sa.Integer(), nullable=False),
            sa.Column('page_number', sa.Integer(), nullable=False),
            sa.Column('image_data', sa.LargeBinary(), nullable=False),
            sa.Column('image_mime_type', sa.String(length=50), nullable=False, server_default='image/png'),
            sa.Column('width', sa.Integer(), nullable=False),
            sa.Column('height', sa.Integer(), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('caption', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['material_id'], ['study_materials.id'], ondelete='CASCADE'),
            sa.UniqueConstraint('material_id', 'figure_index', name='uq_figure_per_material'),
        )
        op.create_index(
            'ix_study_figures_material_id',
            'study_figures',
            ['material_id'],
            unique=False
        )
        op.create_index(
            'ix_study_figures_page_number',
            'study_figures',
            ['page_number'],
            unique=False
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Drop study_figures table
    if 'study_figures' in existing_tables:
        op.drop_index('ix_study_figures_page_number', table_name='study_figures')
        op.drop_index('ix_study_figures_material_id', table_name='study_figures')
        op.drop_constraint('uq_figure_per_material', 'study_figures', type_='unique')
        op.drop_table('study_figures')

    # Remove columns from study_materials
    if 'study_materials' in existing_tables:
        columns = inspector.get_columns('study_materials')
        column_names = {col['name'] for col in columns}
        
        if 'figure_count' in column_names:
            op.drop_column('study_materials', 'figure_count')
        
        if 'page_count' in column_names:
            op.drop_column('study_materials', 'page_count')
