from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

#: Injectable so a test can point the probe at the test database. Not a
#: convenience: `settings.database_url` is the developer's database during the
#: test run, and a probe that opens its own session would otherwise connect to it
#: from inside the suite. Reaching the wrong database from a test has already
#: happened once in this codebase, through a router that imported the wrong
#: `get_db`, and it is not detectable from a passing test.
SessionFactory = Callable[[], AsyncSession]


async def check_db(session: AsyncSession) -> bool:
    result = await session.execute(text("SELECT 1"))
    return result.scalar_one() == 1


@dataclass(frozen=True)
class Readiness:
    """Whether this instance should be sent traffic.

    Distinct from liveness on purpose, and the distinction is not pedantry.
    Liveness answers "is this process alive", and a liveness probe that consults
    the database restarts every container during a database blip — turning a
    recoverable dependency outage into a total one, with the restarts themselves
    adding load to the thing that was already struggling. Readiness answers
    "would a request succeed", and its correct response to the same blip is to
    stop receiving traffic and stay up.

    Only dependencies that EVERY request needs belong here. An optional feature
    must never appear: taking an instance out of rotation because AI job import
    is unconfigured would be an outage caused entirely by the monitoring.
    """

    ready: bool
    #: A stable, non-specific label per dependency. Deliberately never an
    #: exception message, host, DSN or credential — this endpoint is
    #: unauthenticated, and an operator can read the real error in the logs.
    dependencies: dict[str, str]

    def as_dict(self) -> dict[str, object]:
        return {"ready": self.ready, "dependencies": dict(self.dependencies)}


async def check_readiness(session_factory: SessionFactory | None = None) -> Readiness:
    """Ask the database, and nothing else.

    Opens its own short-lived session rather than taking the request-scoped
    dependency, because a failure during dependency resolution never reaches the
    handler: the probe would answer 500 "internal server error" when the true
    answer is 503 "not ready". A load balancer distinguishes those, and so does
    whoever is paged.
    """

    from app.db.session import SessionLocal

    factory = session_factory or SessionLocal

    try:
        async with factory() as session:
            healthy = await check_db(session)
    except Exception:  # noqa: BLE001 - any failure to reach the database is "not ready"
        # Logged in full, reported as one word. The detail belongs in the log
        # stream, which is authenticated; the response body is not.
        logger.exception("readiness_database_check_failed")
        return Readiness(ready=False, dependencies={"database": "unavailable"})

    if not healthy:
        return Readiness(ready=False, dependencies={"database": "unexpected_response"})

    return Readiness(ready=True, dependencies={"database": "ok"})
