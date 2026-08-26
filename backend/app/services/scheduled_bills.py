"""Background job for executing scheduled bill purchases using APScheduler.

APScheduler with SQLAlchemy backend ensures schedules persist across
server restarts and work correctly in multi-instance deployments.
"""

import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.executors.asyncio import AsyncIOExecutor
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import get_db
from app.models import ScheduledBill, User, BillTransaction
from app.config import settings

logger = logging.getLogger("uvicorn.error")

# Global scheduler instance
scheduler: AsyncIOScheduler | None = None


async def execute_scheduled_purchase(schedule_id: int):
    """Execute one scheduled purchase - called by APScheduler."""
    from app.services.money import kobo_to_points
    
    logger.info("APScheduler executing scheduled bill %d", schedule_id)
    
    async for db in get_db():
        try:
            # Fetch schedule
            result = await db.execute(
                select(ScheduledBill).where(ScheduledBill.id == schedule_id)
            )
            schedule = result.scalar_one_or_none()
            
            if not schedule:
                logger.error("Schedule %d not found", schedule_id)
                return
            
            # Get user with lock
            user_result = await db.execute(
                select(User).where(User.id == schedule.user_id).with_for_update()
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                logger.error("User %d not found for schedule %d", schedule.user_id, schedule_id)
                await db.execute(
                    update(ScheduledBill)
                    .where(ScheduledBill.id == schedule_id)
                    .values(
                        status="failed",
                        last_error="User not found",
                        updated_at=datetime.utcnow(),
                    )
                )
                await db.commit()
                return
            
            # Check balance
            amount_kobo = schedule.amount_naira * 100
            if settings.wallet_split_enabled:
                if user.cashable_balance < kobo_to_points(amount_kobo):
                    logger.warning("Insufficient balance for schedule %d", schedule_id)
                    await db.execute(
                        update(ScheduledBill)
                        .where(ScheduledBill.id == schedule_id)
                        .values(
                            last_error="Insufficient balance",
                            updated_at=datetime.utcnow(),
                        )
                    )
                    await db.commit()
                    return
            else:
                if user.points_balance < kobo_to_points(amount_kobo):
                    logger.warning("Insufficient balance for schedule %d", schedule_id)
                    await db.execute(
                        update(ScheduledBill)
                        .where(ScheduledBill.id == schedule_id)
                        .values(
                            last_error="Insufficient balance",
                            updated_at=datetime.utcnow(),
                        )
                    )
                    await db.commit()
                    return
            
            # Debit wallet
            if settings.wallet_split_enabled:
                await db.execute(
                    update(User)
                    .where(User.id == schedule.user_id)
                    .values(cashable_balance=User.cashable_balance - kobo_to_points(amount_kobo))
                )
            else:
                await db.execute(
                    update(User)
                    .where(User.id == schedule.user_id)
                    .values(points_balance=User.points_balance - kobo_to_points(amount_kobo))
                )
            
            # Execute purchase
            from app.services.peyflex import get_client as get_peyflex_client, PeyflexError
            from app.services.bigisub import get_client as get_bigisub_client, BigisubError
            
            if settings.bills_provider == "bigisub":
                vtu_client = get_bigisub_client()
            else:
                vtu_client = get_peyflex_client()
            
            if schedule.service == "airtime":
                result = await vtu_client.buy_airtime(
                    network=schedule.network,
                    mobile_number=schedule.phone,
                    amount=schedule.amount_naira,
                )
            elif schedule.service == "data":
                result = await vtu_client.buy_data(
                    network=schedule.network,
                    mobile_number=schedule.phone,
                    plan_code=schedule.plan_code,
                )
            else:
                raise ValueError(f"Unsupported service: {schedule.service}")
            
            if result.status != "success":
                # Refund on failure
                if settings.wallet_split_enabled:
                    await db.execute(
                        update(User)
                        .where(User.id == schedule.user_id)
                        .values(cashable_balance=User.cashable_balance + kobo_to_points(amount_kobo))
                    )
                else:
                    await db.execute(
                        update(User)
                        .where(User.id == schedule.user_id)
                        .values(points_balance=User.points_balance + kobo_to_points(amount_kobo))
                    )
                await db.execute(
                    update(ScheduledBill)
                    .where(ScheduledBill.id == schedule_id)
                    .values(
                        last_error=result.message,
                        updated_at=datetime.utcnow(),
                    )
                )
                await db.commit()
                return
            
            # Calculate commission and points
            from app.routers.bills import _effective_commission_kobo, _compute_points
            
            commission_kobo = _effective_commission_kobo(
                amount_kobo=amount_kobo,
                service=schedule.service,
                discount=result.discount,
            )
            
            points = _compute_points(commission_kobo, user)
            
            # Record transaction
            from uuid import uuid4
            reference = f"SCHED-{uuid4().hex[:12].upper()}"
            
            tx = BillTransaction(
                user_id=schedule.user_id,
                service=schedule.service,
                provider=settings.bills_provider,
                phone=schedule.phone,
                amount_naira=schedule.amount_naira,
                commission_naira=commission_kobo,
                points_earned=points,
                reference=reference,
                status="success",
                external_ref=result.reference,
            )
            db.add(tx)
            
            # Credit points
            if settings.wallet_split_enabled:
                await db.execute(
                    update(User)
                    .where(User.id == schedule.user_id)
                    .values(cashable_balance=User.cashable_balance + points)
                )
            else:
                await db.execute(
                    update(User)
                    .where(User.id == schedule.user_id)
                    .values(points_balance=User.points_balance + points)
                )
            
            # Update schedule
            if schedule.schedule_type == "once":
                # One-time schedule completed
                await db.execute(
                    update(ScheduledBill)
                    .where(ScheduledBill.id == schedule_id)
                    .values(
                        status="completed",
                        last_run_at=datetime.utcnow(),
                        execution_count=ScheduledBill.execution_count + 1,
                        last_error=None,
                        updated_at=datetime.utcnow(),
                    )
                )
                # Remove the APScheduler job
                if scheduler:
                    scheduler.remove_job(f"schedule_{schedule_id}")
            else:
                # Recurring schedule, update last_run_at
                await db.execute(
                    update(ScheduledBill)
                    .where(ScheduledBill.id == schedule_id)
                    .values(
                        last_run_at=datetime.utcnow(),
                        execution_count=ScheduledBill.execution_count + 1,
                        last_error=None,
                        updated_at=datetime.utcnow(),
                    )
                )
            
            await db.commit()
            
            # Send notification
            import asyncio
            from app.services.notifications import create_notification_background
            from app.services.fcm import send_push_notification_background
            
            asyncio.create_task(create_notification_background(
                user_id=schedule.user_id,
                title=f"Scheduled {schedule.service.title()} Purchase",
                body=f"Your scheduled {schedule.service} purchase for {schedule.phone} completed successfully. Earned {points} points.",
                category="wallet_updates",
                data={"type": "scheduled_bill", "service": schedule.service, "reference": reference},
            ))
            asyncio.create_task(send_push_notification_background(
                user_id=schedule.user_id,
                title=f"Scheduled {schedule.service.title()} Purchase",
                body=f"Your scheduled {schedule.service} purchase completed successfully.",
                data={"type": "scheduled_bill", "service": schedule.service, "reference": reference},
                category="wallet_updates",
            ))
            
            logger.info("Scheduled purchase executed successfully: %s", reference)
            
        except Exception as exc:
            logger.error("Error executing scheduled purchase %d: %s", schedule_id, exc)
            await db.rollback()
            await db.execute(
                update(ScheduledBill)
                .where(ScheduledBill.id == schedule_id)
                .values(
                    last_error=str(exc),
                    updated_at=datetime.utcnow(),
                )
            )
            await db.commit()
        
        finally:
            await db.close()


async def initialize_scheduler():
    """Initialize APScheduler with SQLAlchemy job store."""
    global scheduler
    
    if scheduler is not None:
        return
    
    logger.info("Initializing APScheduler for scheduled bills")
    
    # Use SQLAlchemy job store for persistence
    jobstores = {
        'default': SQLAlchemyJobStore(url=settings.database_url)
    }
    
    executors = {
        'default': AsyncIOExecutor()
    }
    
    job_defaults = {
        'coalesce': True,  # Don't run multiple instances of same job
        'max_instances': 1,
        'misfire_grace_time': 60,  # 60 seconds tolerance
    }
    
    scheduler = AsyncIOScheduler(
        jobstores=jobstores,
        executors=executors,
        job_defaults=job_defaults,
    )
    
    # Load existing schedules from database
    async for db in get_db():
        try:
            result = await db.execute(
                select(ScheduledBill).where(ScheduledBill.status == "active")
            )
            active_schedules = result.scalars().all()
            
            for schedule in active_schedules:
                # Add job to scheduler
                if schedule.schedule_type == "once":
                    scheduler.add_job(
                        execute_scheduled_purchase,
                        'date',
                        run_date=schedule.next_run_at,
                        args=[schedule.id],
                        id=f"schedule_{schedule.id}",
                        replace_existing=True,
                    )
                elif schedule.schedule_type == "daily":
                    scheduler.add_job(
                        execute_scheduled_purchase,
                        'interval',
                        days=1,
                        start_date=schedule.next_run_at,
                        args=[schedule.id],
                        id=f"schedule_{schedule.id}",
                        replace_existing=True,
                    )
                elif schedule.schedule_type == "weekly":
                    scheduler.add_job(
                        execute_scheduled_purchase,
                        'interval',
                        weeks=1,
                        start_date=schedule.next_run_at,
                        args=[schedule.id],
                        id=f"schedule_{schedule.id}",
                        replace_existing=True,
                    )
                elif schedule.schedule_type == "monthly":
                    scheduler.add_job(
                        execute_scheduled_purchase,
                        'interval',
                        days=30,  # Approximate month
                        start_date=schedule.next_run_at,
                        args=[schedule.id],
                        id=f"schedule_{schedule.id}",
                        replace_existing=True,
                    )
            
            logger.info("Loaded %d active schedules into APScheduler", len(active_schedules))
        finally:
            await db.close()
    
    scheduler.start()
    logger.info("APScheduler started")

