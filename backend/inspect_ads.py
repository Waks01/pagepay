import asyncio, ssl, asyncpg
async def main():
    url='postgresql://neondb_owner:npg_euIZ3a5JxsyV@ep-orange-rice-a6m5onff.us-west-2.aws.neon.tech/neondb?sslmode=require'
    ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
    conn=await asyncpg.connect(url, ssl=ctx)
    for t in ['ad_requests','ad_ssv_logs','ad_fill_rate_events','ad_events','ad_placements']:
        print('==',t)
        rows=await conn.fetch("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", t)
        for r in rows: print(' ', r['column_name'], r['data_type'], r['is_nullable'])
    await conn.close()
asyncio.run(main())
