"""Whether AI job import can actually work right now, answered before it is tried.

Two things could previously only be discovered by attempting an import and
waiting for it to fail.

A missing API key produced a failure after the recruiter had already pasted a
job and watched a progress bar. And `OPENAI_MODEL` was a free-form string
matching a character pattern, which means a typo failed every import at the
provider — slowly, after paying the latency — while a *valid but unintended*
name succeeded and quietly called a model nobody chose, at whatever that model
costs. A pattern check cannot tell those apart; a list of models the platform
has agreed to call can.

The allowlist defaults to exactly the configured default model. That is
deliberately narrow: a deployment running a different model must name it, and
inventing a list of plausible-looking model identifiers here would be worse than
useless — it would authorise calls to models nobody has actually chosen.

Nothing here refuses to boot. Import has a kill switch; taking the whole API
down over one feature's configuration would trade a small outage for a large
one. Unreadiness is reported, logged at startup, and answered on the probe.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.config import settings

#: The model the platform ships with, and the only one authorised unless a
#: deployment says otherwise.
DEFAULT_ALLOWED_MODEL = "gpt-5.6-luna"


def allowed_models() -> frozenset[str]:
    configured = (settings.openai_model_allowlist or "").strip()
    if not configured:
        return frozenset({DEFAULT_ALLOWED_MODEL})
    return frozenset(name.strip() for name in configured.split(",") if name.strip())


@dataclass(frozen=True)
class ImportReadiness:
    """Ready, or the specific reasons it is not.

    Reasons rather than a bare boolean, because "job import is unavailable" sends
    an operator looking, and every minute of that is a minute the answer was
    already known here.
    """

    ready: bool
    enabled: bool
    problems: list[str] = field(default_factory=list)
    #: Whether anything in this deployment is configured to rescue imports whose
    #: worker went away. Reported separately from `ready` on purpose: an import
    #: can still be started and finished in-request without it. What is missing
    #: is recovery, and an operator should be able to see that distinctly rather
    #: than reading a red light and looking for a broken provider.
    sweeper_configured: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "ready": self.ready,
            "enabled": self.enabled,
            "problems": list(self.problems),
            "sweeper_configured": self.sweeper_configured,
        }


def check_job_import_readiness() -> ImportReadiness:
    """Configuration only. No network call, so a probe cannot spend money.

    A readiness check that asked the provider whether it was reachable would
    bill a request every time a load balancer looked, and would report an
    outage for something no deployment of this application can fix.
    """

    enabled = bool(settings.job_import_enabled)
    problems: list[str] = []

    if settings.openai_api_key is None or not settings.openai_api_key.get_secret_value():
        problems.append("No provider credential is configured.")

    if settings.openai_model not in allowed_models():
        # Named without echoing the configured value: this response is not
        # authenticated, and configuration is not something to hand out.
        problems.append("The configured model is not on the allowlist.")

    # In-process hosting is one way to run the sweep and a separate process is
    # the other, and this cannot see the second. So it reports what it knows —
    # "this API is hosting one" — rather than asserting none exists.
    sweeper = bool(settings.job_import_sweeper_in_process)

    if not enabled:
        # Not a problem — a decision. Kept out of `problems` so a switched-off
        # feature does not read as a broken one on a dashboard.
        return ImportReadiness(
            ready=False, enabled=False, problems=problems, sweeper_configured=sweeper
        )

    return ImportReadiness(
        ready=not problems,
        enabled=True,
        problems=problems,
        sweeper_configured=sweeper,
    )


class UnsupportedModelError(Exception):
    """The configured model is not one the platform has agreed to call."""


def require_allowed_model(model: str) -> str:
    """Checked where the provider is built, so an unlisted model cannot be called.

    Reporting it on the probe is not enough on its own: nothing forces anyone to
    read a probe before a request arrives.
    """

    if model not in allowed_models():
        raise UnsupportedModelError(
            "The configured job-import model is not on the allowlist."
        )
    return model
