"""Fix points conversion rate - divide by 100 to correct migration 009 error

Migration 009 incorrectly multiplied points by 10, when it should have divided by 10.
This migration fixes the error by dividing all existing balances by 100:
- Divide by 10 to undo the incorrect multiplication from migration 009
- Divide by 10 again to apply the correct conversion (100:1 → 10:1)
- Net effect: points_balance / 100

Example:
- User originally had: 1,000 points (= ₦10 in old 100:1 system)
- After migration 009: 10,000 points (incorrectly = ₦1,000 in new 10:1 system)
- After this migration: 100 points (correctly = ₦10 in new 10:1 system)

WARNING: If users have earned/spent points after migration 009, those transactions
were already using the 10:1 rate. This migration may incorrectly reduce their balance.
Review your transaction history to determine if a more complex migration is needed.

Revision ID: 011_fix_points_conversion_rate
Revises: 010_add_user_auth_columns
Create Date: 2026-07-09 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '011_fix_points_conversion_rate'
down_revision: Union[str, None] = '010_add_user_auth_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Fix the points conversion error from migration 009.
    
    Divide all points balances by 100 to correct:
    1. The incorrect multiplication by 10 in migration 009
    2. The actual conversion from 100:1 to 10:1 ratio
    
    IMPORTANT: This assumes no significant transactions occurred after migration 009.
    If transactions occurred using the 10:1 rate after migration 009, you may need
    a more sophisticated migration that:
    - Tracks which transactions happened before vs after migration 009
    - Only adjusts the pre-migration balance portion
    """
    # Use FLOOR to ensure we don't create fractional points
    op.execute("UPDATE users SET points_balance = FLOOR(points_balance / 100)")


def downgrade() -> None:
    """
    Reverse the fix by multiplying by 100.
    
    This brings balances back to the post-migration-009 state
    (which was incorrect, but maintains consistency for rollback).
    """
    op.execute("UPDATE users SET points_balance = points_balance * 100")
