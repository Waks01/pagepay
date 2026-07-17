import asyncio
from app.database import get_session
from app.models import AdSsvLog, AdEvent, AdFillRateEvent, AppConfig, AdRequest
from sqlalchemy import select, desc, func
import sys

async def check_ad_logs():
    async with get_session() as db:
        # Check recent ad requests
        print('=== Recent Ad Requests (last 20) ===')
        ad_requests = (await db.execute(
            select(AdRequest).order_by(desc(AdRequest.created_at)).limit(20)
        )).scalars().all()
        
        for req in ad_requests:
            print(f'{req.created_at} | User:{req.user_id} | Unit:{req.ad_unit} | Consumed:{req.consumed_at}')
        
        # Check recent SSV logs
        print('\n=== Recent AdMob SSV Logs (last 20) ===')
        ssv_logs = (await db.execute(
            select(AdSsvLog).order_by(desc(AdSsvLog.created_at)).limit(20)
        )).scalars().all()
        
        if ssv_logs:
            for log in ssv_logs:
                print(f'{log.created_at} | User:{log.user_id} | Status:{log.status} | Unit:{log.ad_unit} | Points:{log.points_credited} | Reason:{log.rejection_reason}')
        else:
            print('No SSV logs found')
        
        print('\n=== Recent Ad Events (last 20) ===')
        ad_events = (await db.execute(
            select(AdEvent).order_by(desc(AdEvent.created_at)).limit(20)
        )).scalars().all()
        
        if ad_events:
            for event in ad_events:
                print(f'{event.created_at} | User:{event.user_id} | Type:{event.event_type} | Unit:{event.ad_unit_id}')
        else:
            print('No ad events found')
        
        print('\n=== Recent Fill Rate Events (last 10) ===')
        fill_events = (await db.execute(
            select(AdFillRateEvent).order_by(desc(AdFillRateEvent.created_at)).limit(10)
        )).scalars().all()
        
        if fill_events:
            for event in fill_events:
                print(f'{event.created_at} | Unit:{event.ad_unit_id} | Filled:{event.filled} | Error:{event.error_code}')
        else:
            print('No fill rate events found')

        # Check ad requests per user
        print('\n=== Ad Requests Per User (Top 10) ===')
        user_requests = (await db.execute(
            select(AdRequest.user_id, func.count(AdRequest.id).label('count'))
            .group_by(AdRequest.user_id)
            .order_by(desc('count'))
            .limit(10)
        )).all()
        
        for user_id, count in user_requests:
            print(f'User {user_id}: {count} requests')

if __name__ == "__main__":
    asyncio.run(check_ad_logs())