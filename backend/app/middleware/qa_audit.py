from __future__ import annotations

import logging

from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.qa_personas import parse_qa_token_claims, qa_persona_feature_enabled
from app.core.security import TokenError, decode_access_token
from app.db.session import SessionLocal
from app.models import User
from app.services.audit_service import record_admin_action

logger = logging.getLogger(__name__)
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class QaPersonaAuditMiddleware(BaseHTTPMiddleware):
    """Attribute successful QA writes to their real controller.

    The application still authorizes the request in the normal dependencies.
    This middleware records only metadata after a successful response and never
    captures bodies, headers, access tokens, or user-entered content.
    """

    async def dispatch(self, request: Request, call_next):
        claims = None
        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("bearer ") and qa_persona_feature_enabled():
            try:
                payload = decode_access_token(authorization.split(" ", 1)[1])
                claims = parse_qa_token_claims(payload)
            except TokenError:
                claims = None

        response = await call_next(request)
        if claims is None:
            return response

        request_id = getattr(request.state, "request_id", None)
        logger.info(
            "qa_persona_request",
            extra={
                "qa_controller_user_id": str(claims.controller_user_id),
                "qa_persona_user_id": str(claims.persona_user_id),
                "qa_persona_key": claims.persona_key,
                "qa_session_id": str(claims.session_id),
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "request_id": request_id,
            },
        )

        if (
            request.method not in WRITE_METHODS
            or response.status_code >= 400
            or request.url.path.startswith("/api/v1/qa/")
        ):
            return response

        try:
            async with SessionLocal() as session:
                controller = (
                    await session.execute(
                        select(User).where(User.id == claims.controller_user_id)
                    )
                ).scalar_one_or_none()
                if controller is None:
                    return response
                record_admin_action(
                    session,
                    actor=controller,
                    action="qa.persona.write",
                    target_type="qa_session",
                    target_id=claims.session_id,
                    target_label=claims.persona_key,
                    after={
                        "method": request.method,
                        "path": request.url.path,
                        "status_code": response.status_code,
                        "persona_user_id": str(claims.persona_user_id),
                    },
                    request_id=request_id,
                )
                await session.commit()
        except Exception:  # pragma: no cover - audit failure must not alter user response
            logger.exception("qa_persona_audit_write_failed")
        return response
