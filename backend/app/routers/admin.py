"""Admin API router aggregator.

Combines all admin sub-routers into a single router. Each sub-module
handles a specific admin domain (auth, users, finance, etc.).

All endpoints require Bearer JWT authentication via admin_auth.
Routes are organized by domain for maintainability and clarity.
"""

from fastapi import APIRouter

# Import all sub-routers
from app.routers import (
    admin_auth,
    admin_users,
    admin_dashboard,
    admin_users_management,
    admin_finance,
    admin_payouts,
    admin_content,
    admin_fraud,
    admin_community,
    admin_ai,
    admin_config,
    admin_logs,
    admin_payments,
    admin_tasks,
)
from app.routers.analytics import router as analytics_router

# Create main router
router = APIRouter(prefix="/admin", tags=["admin"])

# Include all sub-routers
router.include_router(admin_auth.router)
router.include_router(admin_users.router)
router.include_router(admin_dashboard.router)
router.include_router(admin_users_management.router)
router.include_router(admin_finance.router)
router.include_router(admin_payouts.router)
router.include_router(admin_content.router)
router.include_router(admin_fraud.router)
router.include_router(admin_community.router)
router.include_router(admin_ai.router)
router.include_router(admin_config.router)
router.include_router(admin_logs.router)
router.include_router(admin_payments.router)
router.include_router(admin_tasks.router)
router.include_router(analytics_router)
