"""Clear test data from database while keeping admin users and config."""
import asyncio
from sqlalchemy import text
from app.database import get_db

async def main():
    async for db in get_db():
        print("\n=== Clearing Test Data ===\n")
        
        # Clear revenue-related tables
        tables_to_clear = [
            "ad_events",
            "reading_sessions",
            "payments",
            "payout_transactions",
            "study_transactions",
            "referrals",
            "community_notes",
            "fraud_flags",
            "task_submissions",
            "tasks",
        ]
        
        for table in tables_to_clear:
            try:
                result = await db.execute(text(f"DELETE FROM {table}"))
                count = result.rowcount
                print(f"✓ Cleared {table}: {count} rows deleted")
            except Exception as e:
                print(f"✗ Error clearing {table}: {e}")
        
        # Reset user data but keep accounts
        try:
            await db.execute(text(
                "UPDATE users SET "
                "points_balance = 0, "
                "subscription_expires_at = NULL, "
                "tier = 'basic', "
                "last_active_at = NULL"
            ))
            print(f"✓ Reset user balances and tiers")
        except Exception as e:
            print(f"✗ Error resetting users: {e}")
        
        await db.commit()
        print("\n=== Database Cleared Successfully ===\n")
        print("You can now test with fresh data.")
        print("Watch a new ad to see the revenue tracking system work!\n")
        
        break

if __name__ == "__main__":
    asyncio.run(main())
