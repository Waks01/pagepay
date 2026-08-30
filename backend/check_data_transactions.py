import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, text
import json

DATABASE_URL = "postgresql+asyncpg://neondb_owner:npg_euIZ3a5JxsyV@ep-orange-rice-a6m5onff.us-west-2.aws.neon.tech/neondb?ssl=require"

async def check_data_transactions():
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        # Query latest data transactions
        result = await session.execute(
            text("""
                SELECT 
                    id, 
                    service, 
                    phone, 
                    amount_naira, 
                    commission_naira, 
                    points_earned, 
                    reference, 
                    external_ref,
                    details,
                    created_at
                FROM bill_transactions 
                WHERE service = 'data' 
                ORDER BY created_at DESC 
                LIMIT 3
            """)
        )
        
        rows = result.fetchall()
        
        print("\n" + "="*80)
        print("LATEST DATA TRANSACTIONS IN DATABASE")
        print("="*80 + "\n")
        
        for row in rows:
            print(f"ID: {row[0]}")
            print(f"Service: {row[1]}")
            print(f"Phone: {row[2]}")
            print(f"Amount (Naira): {row[3]}")
            print(f"Commission (Kobo): {row[4]}")
            print(f"Points Earned: {row[5]}")
            print(f"Reference: {row[6]}")
            print(f"External Ref: {row[7]}")
            print(f"Details: {json.dumps(row[8], indent=2) if row[8] else 'NULL'}")
            print(f"Created At: {row[9]}")
            print("-" * 80 + "\n")
    
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(check_data_transactions())
