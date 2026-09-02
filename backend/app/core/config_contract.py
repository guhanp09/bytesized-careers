"""What every setting means in production, and who enforces it.

A settings class grows one field at a time, and each new field arrives with a
default chosen so that local development keeps working. That is the right default
for the person adding it and the wrong one for production, where the same default
quietly decides something nobody chose. The failure is never a crash — it is a
deployment that boots, serves traffic, and is subtly wrong in a way that shows up
as "messaging is flaky" or as credentials in a log file.

So every field on `Settings` is classified here, and the classification is
checked by a test that fails when a field is added without one. The registry is
not documentation that happens to sit near the code; it is the thing that makes
"we forgot to think about this in production" a test failure.

The load-bearing rule is the implication in `CORE_REQUIRED`: a field cannot be
declared as required in production unless something actually refuses to boot
without it. Writing a comment that says production must set X, and then not
checking X, is the exact failure this module exists to make impossible — and it
had already happened twice when this registry was first written. `REALTIME_BUS`
carried a docstring saying "refusing at startup is the point" while nothing
called the refusal, and `SMTP_USE_TLS` could be turned off in production, sending
the mail password over the wire in the clear.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Requirement(str, Enum):
    """Whether a production deployment has to supply this."""

    #: Production must not boot unless this is present and sane. Something
    #: refuses. Not "important" — refused.
    CORE_REQUIRED = "core_required"

    #: Needed only when the feature it belongs to is switched on. Absent means
    #: the feature is off, and off must be a complete, safe state rather than a
    #: half-configured one.
    FEATURE_CONDITIONAL = "feature_conditional"

    #: A knob with a default that is safe in production as it stands. Tuning,
    #: topology, or cosmetics — never a security or correctness decision.
    OPTIONAL_DEVELOPMENT = "optional_development"

    #: Exists for development and QA. Must be incapable of taking effect in
    #: production, rather than merely expected not to be set there.
    TEST_ONLY = "test_only"


class Enforcement(str, Enum):
    """What actually stops the wrong value, which is the part that matters."""

    #: `validate_production_settings()` raises. Requires `unsafe_production_value`
    #: so the refusal can be proven by mutation rather than believed.
    BOOT = "boot_validation"

    #: `Settings(...)` itself rejects the value. Stronger than a boot check: the
    #: unsafe state cannot be represented, so it cannot be reintroduced by a
    #: later code path that skips the boot gate.
    SCHEMA = "schema_rejected"

    #: An explicit opt-in to a documented risk, unblocking some other field's
    #: refusal. Must default to false — an acknowledgement that is on by default
    #: acknowledges nothing.
    ACKNOWLEDGEMENT = "explicit_acknowledgement"

    #: Absent means the feature refuses to act. Fails closed: no fallback, no
    #: "well, without a secret we'll accept anything".
    FEATURE_GATE = "feature_gate"

    #: Safe default plus schema bounds. Nothing to require, but the range is not
    #: open — an operator cannot set a timeout of zero or a pool of ten thousand.
    BOUNDED = "bounded_default"

    #: Structurally unable to take effect in production. The guard is an
    #: environment check in the feature itself, not a convention.
    INERT_IN_PRODUCTION = "inert_in_production"

    #: Genuinely a choice with no safe/unsafe axis: process topology, a name, a
    #: path prefix. Must have a default, so absence is never a boot failure.
    DEPLOYMENT_CHOICE = "deployment_choice"


@dataclass(frozen=True)
class ConfigContract:
    requirement: Requirement
    enforcement: Enforcement
    #: Why this classification, in terms of what goes wrong otherwise. Written
    #: for whoever is deciding, at 2am, whether they may change it.
    why: str
    #: A value that must be refused. Required for BOOT and SCHEMA, and it is what
    #: makes their tests non-vacuous.
    unsafe_production_value: object | None = None
    #: For ACKNOWLEDGEMENT: the field whose refusal this unblocks.
    unblocks: str | None = None
    #: Companions to set alongside `unsafe_production_value`, by env alias, for
    #: the handful of rules that are relational rather than about one value. A
    #: refresh lifetime is not unsafe on its own — it is unsafe relative to the
    #: access lifetime — and a mutation that ignores that proves nothing.
    also_set: dict[str, object] | None = None


#: Every field on `Settings`, classified. Ordered as the settings class is, so a
#: reader can hold the two side by side.
CONFIG_CONTRACT: dict[str, ConfigContract] = {
    "app_name": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.DEPLOYMENT_CHOICE,
        "A label in the OpenAPI document. Nothing behaves differently.",
    ),
    "app_env": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.SCHEMA,
        "The selector every other rule reads. A typo must not resolve to a "
        "permissive environment, so the set is closed at parse time: "
        "APP_ENV=prod is a boot failure rather than a deployment that thinks "
        "it is in development.",
        unsafe_production_value="prod",
    ),
    "email_mode": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "'log' writes verification and reset mail to stdout instead of sending "
        "it. In production that is an account-recovery outage, and a log file "
        "holding live password-reset links.",
        unsafe_production_value="log",
    ),
    "smtp_host": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "No host means no mail, and mail is how anyone verifies an address or "
        "recovers an account.",
        unsafe_production_value=None,
    ),
    "smtp_port": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Checked positive at boot because a zero or negative port fails at the "
        "moment somebody needs a password reset, not at deploy.",
        unsafe_production_value=0,
    ),
    "smtp_username": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Unauthenticated relays either refuse the mail or are open relays. "
        "Neither is a production mail path.",
        unsafe_production_value=None,
    ),
    "smtp_password": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Paired with the username; a credential half-supplied is a login that "
        "fails once real mail is queued.",
        unsafe_production_value=None,
    ),
    "smtp_from_email": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "The envelope sender providers check against SPF and DKIM. Wrong or "
        "absent, mail is accepted by us and dropped by them.",
        unsafe_production_value=None,
    ),
    "smtp_use_tls": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "False sends STARTTLS-less SMTP and then calls login() with the mail "
        "password on that plaintext connection. Every reset link in the body "
        "travels in the clear as well. There is no production case for it, so "
        "production refuses it rather than trusting it stays true.",
        unsafe_production_value=False,
    ),
    "email_delivery_enabled": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "The master switch for real delivery from the shared email outbox. Off "
        "keeps both authentication and notification intent durable while the "
        "worker uses its mock provider. The provider is selected when the "
        "worker starts, so a change takes effect only after worker restart.",
    ),
    "debug": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Debug responses carry stack traces and local variables to whoever "
        "provoked the error.",
        unsafe_production_value=True,
    ),
    "log_level": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "DEBUG on the root logger turns SQLAlchemy's engine logger on, and it "
        "logs statements together with their bound parameters — email "
        "addresses, tokens and password hashes, into stdout, forever, at "
        "whatever retention the log sink has. Production refuses DEBUG; the "
        "name itself is validated so a typo is a boot failure instead of "
        "silently resolving to INFO.",
        unsafe_production_value="DEBUG",
    ),
    "rate_limit_backend": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "An in-memory limiter counts per process, so N instances multiply every "
        "limit by N. Refused unless a single-instance deployment says so.",
        unsafe_production_value="memory",
    ),
    "redis_url": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.BOOT,
        "Required exactly when RATE_LIMIT_BACKEND is redis. Naming the redis "
        "backend without a URL is the misconfiguration that would otherwise "
        "silently fall back to counting in memory.",
        unsafe_production_value=None,
    ),
    "allow_memory_rate_limit_in_production": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.ACKNOWLEDGEMENT,
        "A single-instance deployment may legitimately count in memory. It has "
        "to say so, because the same value is wrong the moment a second "
        "instance starts and nothing about that moment produces an error.",
        unblocks="rate_limit_backend",
    ),
    "max_request_body_bytes": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Bounds what one request may hold in memory before parsing. The default "
        "clears the largest non-media payload by a wide margin, and the floor "
        "stops a deployment configuring a limit that rejects ordinary JSON.",
    ),
    "max_media_request_body_bytes": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "The same bound for the two endpoints taking a base64 data URL, where "
        "encoding costs a third on top of the decoded ceiling.",
    ),
    "invite_only_beta": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "Whether the beta is closed is a product decision, and both answers are "
        "safe: on, every signup path checks an invitation server-side; off, "
        "registration is open as it always was.",
    ),
    "email_webhook_secret": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "Unset means the delivery webhook refuses every request rather than "
        "accepting unsigned ones. Failing closed matters here specifically: the "
        "webhook writes the suppression list, so an open door lets anyone "
        "suppress anyone's mail. Production also rejects short/placeholders "
        "when the feature is configured.",
    ),
    "email_webhook_previous_secret": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "A bounded planned-rotation overlap accepted only by webhook "
        "verification. It is removed after the provider switches and one "
        "freshness window passes; it must be strong and distinct from current, "
        "and compromise rotation must not retain it.",
    ),
    "unsubscribe_token_secret": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "Unset, token issuing and reading both refuse — never 'no secret, so "
        "accept anything', which would unsubscribe whoever the URL named. Not "
        "required at boot today because no outbound template embeds a link "
        "yet; production rejects a weak configured value, and it becomes "
        "CORE_REQUIRED the moment one is emitted.",
    ),
    "email_worker_in_process": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.DEPLOYMENT_CHOICE,
        "Topology. Hosting the outbox drain inside the API is convenient "
        "locally; its own process is better in production because a worker "
        "sharing a lifetime with the web server shares its restarts.",
    ),
    "email_worker_interval_seconds": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Poll interval. Bounded above zero so a misconfiguration cannot become "
        "a hot loop against the database.",
    ),
    "trusted_proxy_ips": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Empty means forwarded headers are ignored entirely. Behind a proxy "
        "that is every caller sharing one rate-limit bucket; the alternative "
        "error, trusting the header from anywhere, lets a caller forge their "
        "own address. Both are silent, so production must state which shape it "
        "is.",
        unsafe_production_value=None,
    ),
    "allow_direct_client_ips_in_production": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.ACKNOWLEDGEMENT,
        "Deploying with nothing in front is legitimate and has to be said out "
        "loud, because it is indistinguishable from having forgotten to list "
        "the proxy.",
        unblocks="trusted_proxy_ips",
    ),
    "api_v1_prefix": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.DEPLOYMENT_CHOICE,
        "A mount path. Changing it is a routing decision with no safety axis.",
    ),
    "cors_origins": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Empty blocks the real frontend; localhost in the list lets a page on a "
        "developer's machine read authenticated responses from production.",
        unsafe_production_value=[],
    ),
    "frontend_base_url": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Every emailed link is built from it. Left at localhost, production "
        "sends verification and reset links that only work on the machine that "
        "sent them.",
        unsafe_production_value="http://localhost:3000",
    ),
    "database_url": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "A SQLite or localhost URL in production is a deployment writing to a "
        "file inside a container that is about to be replaced.",
        unsafe_production_value="sqlite+aiosqlite:///./dev.db",
    ),
    "db_pool_size": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Deliberately has no production default. A plausible number is the "
        "dangerous kind: fine for one process, and it exhausts a small managed "
        "plan once eight of them share it, presenting as latency rather than an "
        "error. The code guarantees boundedness; the deployment supplies the "
        "capacity it actually bought.",
        unsafe_production_value=None,
    ),
    "db_max_overflow": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Bounds how far the pool may burst past DB_POOL_SIZE. An unbounded "
        "burst is one instance taking every connection the database has.",
        unsafe_production_value=None,
    ),
    "db_pool_timeout_seconds": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "How long a request waits for a connection before failing. Bounded so "
        "exhaustion surfaces as errors instead of requests hanging until their "
        "clients give up, which reads as an outage with nothing logged.",
    ),
    "db_pool_recycle_seconds": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Replaces connections before common proxy and managed-database idle "
        "timeouts, so a dead connection is retired by us rather than "
        "discovered by a request.",
    ),
    "jwt_secret": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "The signing key for every session. A placeholder value means anyone "
        "who has read this repository can mint a token for any account.",
        unsafe_production_value="change-me",
    ),
    "jwt_algorithm": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.SCHEMA,
        "Narrowed to the HMAC family at parse time. Tokens are signed with a "
        "shared secret, so an asymmetric family here is a misconfiguration "
        "rather than a choice — and closing it keeps the `ecdsa` package, "
        "which carries an unpatchable timing attack, structurally unreachable "
        "instead of merely unused.",
        unsafe_production_value="ES256",
    ),
    "jwt_access_token_expires_minutes": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "The historical fourteen-day default suits local development and means "
        "a stolen production token stays valid for a fortnight. Capped at an "
        "hour, with refresh rotation carrying the session.",
        unsafe_production_value=60 * 24 * 14,
    ),
    "jwt_refresh_token_expires_minutes": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Must outlive the access token. Inverted, every refresh hands back a "
        "token that expires before the one it replaced.",
        unsafe_production_value=60,
        # Relational, so the companion moves too: sixty minutes of refresh is
        # perfectly fine next to fifteen minutes of access, and the schema floor
        # on this field is sixty, so the collision has to be met from both sides.
        also_set={"JWT_ACCESS_TOKEN_EXPIRES_MINUTES": 60},
    ),
    "auth_session_mode": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "'legacy' has no server-side session record, so nothing can revoke a "
        "token — which makes suspension, deletion and logout advisory.",
        unsafe_production_value="legacy",
    ),
    "allow_legacy_refresh_compatibility_in_production": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.ACKNOWLEDGEMENT,
        "A migration window where legacy refresh still works has to be "
        "declared temporary by somebody, rather than becoming the steady state "
        "because nobody noticed it was still on.",
        unblocks="auth_session_mode",
    ),
    "refresh_reuse_grace_seconds": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Absorbs the genuine race of two tabs refreshing at once. Capped hard, "
        "because the window is also how long a stolen refresh token can be "
        "replayed alongside the real one.",
    ),
    "admin_strong_auth_required": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Administrator actions suspend accounts and read reports. Without a "
        "second factor those powers rest on one password.",
        unsafe_production_value=False,
    ),
    "admin_strong_auth_max_age_minutes": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "How long a reauthentication counts for. Bounded both ways: too short "
        "and administrators are prompted constantly, too long and the second "
        "factor stops being one.",
    ),
    "strong_auth_secret_keys": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "TOTP secrets are encrypted at rest with this keyring. Absent, the "
        "second factor either cannot be enrolled or would be stored in the "
        "clear, which is worse than not having it.",
        unsafe_production_value=None,
    ),
    "strong_auth_secret_active_key_id": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Names which key in the ring encrypts new secrets. Rotation needs the "
        "old keys present and the current one named; a keyring without a "
        "pointer cannot write.",
        unsafe_production_value=None,
    ),
    "google_client_id": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Google sign-in is a primary authentication path, and its id-token "
        "audience check is only meaningful against the real client id.",
        unsafe_production_value=None,
    ),
    "google_client_secret": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Needed for the server-owned refresh exchange. Without it a connected "
        "account works until its first token expiry and then stops.",
        unsafe_production_value=None,
    ),
    "google_oauth_exchange_secret": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "The shared secret on the boundary between the NextAuth server and this "
        "one. It is what stops a browser asking the backend to treat it as the "
        "credential authority.",
        unsafe_production_value=None,
    ),
    "google_oauth_exchange_previous_secret": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "Temporary planned-rotation overlap for independently deployed "
        "NextAuth and backend services. Only the backend accepts it; the "
        "frontend always sends the current secret. Production requires it to "
        "be strong and distinct. Never retain a compromised value here.",
    ),
    "oauth_credential_keys": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Encrypts stored Google refresh tokens. A refresh token in plaintext is "
        "durable access to somebody's YouTube account.",
        unsafe_production_value=None,
    ),
    "oauth_credential_active_key_id": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Names the key that encrypts new credentials, so rotation can keep "
        "older keys readable without guessing which is current.",
        unsafe_production_value=None,
    ),
    "oauth_credential_write_mode": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "'plaintext' writes refresh tokens unencrypted. Refused outright; "
        "'dual' is a migration state and needs the acknowledgement below.",
        unsafe_production_value="plaintext",
    ),
    "allow_oauth_plaintext_compatibility_in_production": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.ACKNOWLEDGEMENT,
        "Dual writes keep a plaintext column populated for rollback during a "
        "controlled window. Someone has to own that window.",
        unblocks="oauth_credential_write_mode",
    ),
    "youtube_api_key": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "Only channel enrichment reads it. Absent, enrichment is skipped and "
        "the profile keeps what the creator entered.",
    ),
    "youtube_data_api_key": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "The same, for the Data API surface. Absent means that lookup does not "
        "happen, not that it happens unauthenticated.",
    ),
    "google_places_api_key": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "Only authenticated city autocomplete and details use this credential. "
        "Absent, the backend refuses provider work and the frontend uses its "
        "bounded local location catalogue without exposing a provider secret.",
    ),
    "openai_api_key": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "AI job import needs it and nothing else does. Absent, the readiness "
        "probe reports the feature unconfigured and no import starts — it does "
        "not begin work that cannot finish.",
    ),
    "openai_model": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.BOUNDED,
        "Pattern-bounded, and additionally checked against the allowlist "
        "below, because a pattern cannot tell a typo from a valid name for a "
        "model nobody chose to pay for.",
    ),
    "openai_request_timeout_seconds": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Measured rather than guessed: a real job page takes this provider "
        "about thirty-three seconds, and the deployment's former thirty-second "
        "timeout threw away every successful extraction three seconds before "
        "it arrived.",
    ),
    "openai_max_retries": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "One by default and capped low. A retry exists to survive a blip; at "
        "the timeout ceiling, two of them is four and a half minutes in front "
        "of somebody watching a progress bar.",
    ),
    "job_import_enabled": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "The kill switch that actually stops provider work, as opposed to the "
        "frontend flag which only hides the entry point. Off, an incident ends "
        "without a deploy; drafts already finished stay readable, because "
        "confiscating them helps nobody.",
    ),
    "openai_model_allowlist": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.FEATURE_GATE,
        "Empty means the single shipped default is the only callable model, "
        "which is the safe reading of 'unset' — not 'any model is fine'.",
    ),
    "job_import_daily_quota": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Bounds provider spend per person per window. Per user rather than per "
        "draft, because one person with fifty drafts is the case a per-draft "
        "limit misses.",
    ),
    "job_import_quota_window_hours": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "The window the quota counts over, capped at a week so it stays a rate "
        "limit rather than a lifetime allowance.",
    ),
    "job_import_sweeper_in_process": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.DEPLOYMENT_CHOICE,
        "Topology, as with the email worker — and more pointedly, since the "
        "stranded rows this sweep rescues are created by the very restarts an "
        "in-process sweeper shares.",
    ),
    "job_import_sweeper_interval_seconds": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Sweep cadence, bounded above zero. The sweep never calls the provider, "
        "so frequency costs database reads and nothing else.",
    ),
    "job_import_prompt_version": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.BOUNDED,
        "Recorded on every extraction so a change in output quality can be "
        "attributed. Pattern-bounded because it is stored and reported.",
    ),
    "realtime_bus": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "'memory' delivers only to connections held by this process — correct "
        "for one instance, silently wrong for two, where each serves half a "
        "conversation and nothing errors anywhere. Naming an unimplemented "
        "broker must not fall back to process-local delivery either. Both are "
        "refused at boot, which is what the acknowledgement below exists to "
        "override deliberately.",
        unsafe_production_value="memory",
    ),
    "allow_process_local_realtime_in_production": ConfigContract(
        Requirement.FEATURE_CONDITIONAL,
        Enforcement.ACKNOWLEDGEMENT,
        "A single-instance production deployment can use process-local "
        "delivery and must say so, because the value only becomes wrong at the "
        "moment a second instance starts — and that moment produces no error.",
        unblocks="realtime_bus",
    ),
    "media_public_base_url": ConfigContract(
        Requirement.CORE_REQUIRED,
        Enforcement.BOOT,
        "Unset, stored media URLs are built from the request Host, so a request "
        "carrying `Host: evil.example` writes that origin into an avatar URL "
        "permanently, and it is then served to everyone who views the profile.",
        unsafe_production_value=None,
    ),
    "media_root": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.DEPLOYMENT_CHOICE,
        "Where uploads land. The default is a local path and the production "
        "answer is a mounted volume or an object store — the latter is "
        "MEDIA-001 and is not a configuration decision.",
    ),
    "media_base_path": ConfigContract(
        Requirement.OPTIONAL_DEVELOPMENT,
        Enforcement.DEPLOYMENT_CHOICE,
        "The URL prefix media is served under. Routing, not safety.",
    ),
    "enable_qa_persona_switcher": ConfigContract(
        Requirement.TEST_ONLY,
        Enforcement.INERT_IN_PRODUCTION,
        "Deterministic persona impersonation for QA. Production is excluded by "
        "the feature's own environment check rather than by expecting the flag "
        "to stay off, because setting it there would otherwise be an "
        "impersonation endpoint.",
        unsafe_production_value=True,
    ),
    "qa_persona_controller_emails": ConfigContract(
        Requirement.TEST_ONLY,
        Enforcement.INERT_IN_PRODUCTION,
        "Who may impersonate. Inert in production for the same reason, and by "
        "the same check.",
        unsafe_production_value="somebody@example.com",
    ),
    "qa_persona_access_token_minutes": ConfigContract(
        Requirement.TEST_ONLY,
        Enforcement.BOUNDED,
        "Lifetime of a QA persona token, bounded so a forgotten session in a "
        "staging environment expires on its own.",
    ),
}


def unclassified_settings_fields(field_names: object) -> list[str]:
    """Fields present on `Settings` with no entry here.

    Takes the names rather than importing `Settings`, so the registry stays free
    of an import cycle with the module it describes.
    """

    assert hasattr(field_names, "__iter__")
    return sorted(str(name) for name in field_names if str(name) not in CONFIG_CONTRACT)


def contract_entries_naming_unknown_fields(field_names: object) -> list[str]:
    """Entries here that no longer correspond to a real field.

    The other half of completeness. A stale entry is worse than a missing one: it
    reads as a decision that was made about something that no longer exists.
    """

    known = {str(name) for name in field_names}  # type: ignore[union-attr]
    return sorted(name for name in CONFIG_CONTRACT if name not in known)


def fields_with_requirement(requirement: Requirement) -> list[str]:
    return sorted(
        name for name, entry in CONFIG_CONTRACT.items() if entry.requirement is requirement
    )


def fields_with_enforcement(enforcement: Enforcement) -> list[str]:
    return sorted(
        name for name, entry in CONFIG_CONTRACT.items() if entry.enforcement is enforcement
    )
