"""Quick script to check ad_events table data."""
import asyncio
from sqlalchemy import text
from app.database import get_db

async def main():
    async for db in get_db():
        # Check recent ad events
        result = await db.execute(text(
            "SELECT id, revenue_usd, fx_rate_used, impression_revenue_usd, "
            "user_points_credited, created_at "
            "FROM ad_events ORDER BY created_at DESC LIMIT 5"
        ))
        rows = result.fetchall()
        
        print("\n=== Recent Ad Events ===")
        for r in rows:
            print(f"ID: {r[0]}")
            print(f"  revenue_usd: {r[1]}")
            print(f"  fx_rate_used: {r[2]}")
            print(f"  impression_revenue_usd: {r[3]}")
            print(f"  user_points_credited: {r[4]}")
            print(f"  created_at: {r[5]}")
            print()
        
        # Count totals
        count_result = await db.execute(text(
            "SELECT COUNT(*) as total, "
            "COUNT(revenue_usd) as with_revenue_usd, "
            "COUNT(fx_rate_used) as with_fx_rate "
            "FROM ad_events"
        ))
        counts = count_result.fetchone()
        print(f"\n=== Summary ===")
        print(f"Total ad events: {counts[0]}")
        print(f"With revenue_usd: {counts[1]}")
        print(f"With fx_rate_used: {counts[2]}")
        
        break

if __name__ == "__main__":
    asyncio.run(main())
