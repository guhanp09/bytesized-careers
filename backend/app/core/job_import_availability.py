"""The switch that actually turns AI job import off.

There was already a flag, and it was not this. `ENABLE_JOB_IMPORT` in the
frontend hides the entry point — useful, and not a kill switch: the API stays
open, so anyone holding a session or a saved request can still spend provider
budget. With only that flag, ending an incident means shipping a deploy, which
is the slowest possible response to the fastest kind of problem.

What "off" means here is narrow and deliberate: **no new provider work starts**.
It does not mean the import feature vanishes. A recruiter whose draft is already
prepared can still read it and carry it into Post Job, because that draft exists,
it cost what it cost, and confiscating it helps nobody. The switch exists to stop
spending, not to punish whoever was mid-flow when it was thrown.

Everything that starts provider work asks here. Two places do — the initial
extraction and a conversation continuation — and a third would be a bug, which
is why the check has one home rather than a copy at each site.
"""

from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

#: Shown to a recruiter, so it says what happened and what to do, and mentions
#: neither a provider nor a flag.
DISABLED_MESSAGE = (
    "Preparing job drafts automatically is paused right now. "
    "You can still write your job in the usual way, and anything already "
    "prepared is still here."
)

DISABLED_CODE = "JOB_IMPORT_DISABLED"


def job_import_is_enabled() -> bool:
    """Read at call time, never captured at import time.

    A module-level constant would freeze whatever the value was at boot, and a
    switch you have to restart to use is not a switch.
    """

    return bool(settings.job_import_enabled)


def refuse_if_disabled(*, operation: str) -> None:
    """Raise the ordinary import error when new provider work is not allowed.

    Raising the same error type the rest of the flow raises means the refusal
    travels the existing path to the client instead of arriving as a 500.
    """

    if job_import_is_enabled():
        return

    # Logged for the audit trail: while the switch is off, this is the record of
    # what would have run, which is how anyone judges whether it is safe to
    # switch back on.
    logger.warning("job_import_refused_while_disabled", extra={"operation": operation})

    from app.services.job_import_service import JobImportError

    raise JobImportError(
        DISABLED_CODE,
        DISABLED_MESSAGE,
        status_code=503,
    )
