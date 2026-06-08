from app.api.v1.routers.auth import router as auth_router
from app.api.v1.routers.content_style import router as content_style_router
from app.api.v1.routers.dev_seed import router as dev_seed_router
from app.api.v1.routers.health import router as health_router
from app.api.v1.routers.jobs import router as jobs_router
from app.api.v1.routers.me import router as me_router
from app.api.v1.routers.portfolio import router as portfolio_router
from app.api.v1.routers.profile_completion import router as profile_completion_router
from app.api.v1.routers.roles import router as roles_router
from app.api.v1.routers.user_profile import router as user_profile_router
from app.api.v1.routers.users import router as users_router

__all__ = [
    "auth_router",
    "content_style_router",
    "dev_seed_router",
    "health_router",
    "jobs_router",
    "me_router",
    "portfolio_router",
    "profile_completion_router",
    "roles_router",
    "user_profile_router",
    "users_router",
]
