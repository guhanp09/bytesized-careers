from fastapi import APIRouter

from app.api.v1.routers.admin import router as admin_router
from app.api.v1.routers.auth import router as auth_router
from app.api.v1.routers.content_style import router as content_style_router
from app.api.v1.routers.dev_brand_enrichment import router as dev_brand_enrichment_router
from app.api.v1.routers.dev_emails import router as dev_emails_router
from app.api.v1.routers.dev_personas import router as dev_personas_router
from app.api.v1.routers.dev_seed import router as dev_seed_router
from app.api.v1.routers.dev_workflows import router as dev_workflows_router
from app.api.v1.routers.email_webhooks import router as email_webhooks_router
from app.api.v1.routers.health import router as health_router
from app.api.v1.routers.job_imports import router as job_imports_router
from app.api.v1.routers.jobs import router as jobs_router
from app.api.v1.routers.locations import router as locations_router
from app.api.v1.routers.marketplace import router as marketplace_router
from app.api.v1.routers.me import router as me_router
from app.api.v1.routers.messaging import router as messaging_router
from app.api.v1.routers.portfolio import router as portfolio_router
from app.api.v1.routers.profile_completion import router as profile_completion_router
from app.api.v1.routers.qa_personas import router as qa_personas_router
from app.api.v1.routers.realtime import router as realtime_router
from app.api.v1.routers.reviews import router as reviews_router
from app.api.v1.routers.roles import router as roles_router
from app.api.v1.routers.search import router as search_router
from app.api.v1.routers.support import router as support_router
from app.api.v1.routers.telemetry import router as telemetry_router
from app.api.v1.routers.tools import router as tools_router
from app.api.v1.routers.unsubscribe import router as unsubscribe_router
from app.api.v1.routers.user_profile import router as user_profile_router
from app.api.v1.routers.users import router as users_router

api_router = APIRouter()
api_router.include_router(admin_router)
api_router.include_router(auth_router)
api_router.include_router(content_style_router)
api_router.include_router(email_webhooks_router)
api_router.include_router(health_router)
api_router.include_router(jobs_router)
api_router.include_router(job_imports_router)
api_router.include_router(locations_router)
api_router.include_router(marketplace_router)
api_router.include_router(me_router)
api_router.include_router(messaging_router)
api_router.include_router(portfolio_router)
api_router.include_router(qa_personas_router)
api_router.include_router(profile_completion_router)
api_router.include_router(roles_router)
api_router.include_router(search_router)
api_router.include_router(support_router)
api_router.include_router(telemetry_router)
api_router.include_router(reviews_router)
api_router.include_router(realtime_router)
api_router.include_router(tools_router)
api_router.include_router(user_profile_router)
api_router.include_router(unsubscribe_router)
api_router.include_router(users_router)
api_router.include_router(dev_emails_router)
api_router.include_router(dev_seed_router)
api_router.include_router(dev_personas_router)
api_router.include_router(dev_workflows_router)
api_router.include_router(dev_brand_enrichment_router)
