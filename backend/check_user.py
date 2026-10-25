import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DATABASE_URL = 'postgresql+asyncpg://neondb_owner:npg_euIZ3a5JxsyV@ep-orange-rice-a6m5onff.us-west-2.aws.neon.tech/neondb?sslmode=require'

async def check_user():
    engine = create_async_engine(DATABASE_URL)
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT id, email, points_balance, cashable_balance, service_credit_balance FROM users WHERE email = 'princechaawa@gmail.com'"))
        row = result.fetchone()
        if row:
            print(f'User ID: {row[0]}')
            print(f'Email: {row[1]}')
            print(f'points_balance: {row[2]}')
            print(f'cashable_balance: {row[3]}')
            print(f'service_credit_balance: {row[4]}')
        else:
            print('User not found')
    await engine.dispose()

asyncio.run(check_user())