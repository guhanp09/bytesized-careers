"""Every setting is classified for production, and every claim is proven.

Two failures are being guarded, and they are opposites.

The first is a field added without anyone deciding what it means in production.
Its default was chosen to keep local development working, which is right for the
author and wrong for the deployment, and nothing anywhere notices. The
completeness tests turn that into a failure at the moment the field is added.

The second is subtler and is what most of this file is about: a field declared
required in production that nothing actually refuses. That is worse than an
unclassified field, because it reads as a decision. Every `CORE_REQUIRED` entry
therefore names a value that must be rejected, and the test *sets that value* and
demands the refusal. Writing the classification is not enough to make the test
pass; the enforcement has to exist.

That mechanism is not hypothetical. Applying it to the existing settings surface
found three fields whose documented production requirement was not enforced
anywhere:

  - REALTIME_BUS carried a docstring reading "refusing at startup is the point",
    and `build_realtime_bus()` had one caller — the health probe, which catches
    the refusal and reports it. The delivery path constructs the process-local
    bus directly, so a multi-instance production deployment silently served half
    of every conversation from each instance.
  - SMTP_USE_TLS could be false in production, and the line after the STARTTLS
    check calls login() with the mail password on that plaintext connection.
  - LOG_LEVEL could be DEBUG, which enables SQLAlchemy's engine logger and writes
    statements with their bound parameters — addresses, tokens, password hashes —
    to stdout.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core import config
from app.core.config import Settings
from app.core.config_contract import (
    CONFIG_CONTRACT,
    ConfigContract,
    Enforcement,
    Requirement,
    contract_entries_naming_unknown_fields,
    fields_with_enforcement,
    unclassified_settings_fields,
)
from tests.test_config import _safe_production_settings

FIELD_NAMES = tuple(Settings.model_fields)


def _alias(field_name: str) -> str:
    alias = Settings.model_fields[field_name].alias
    assert alias is not None, field_name
    return alias


def _entries(enforcement: Enforcement) -> list[tuple[str, ConfigContract]]:
    return [(name, CONFIG_CONTRACT[name]) for name in fields_with_enforcement(enforcement)]


#: Which acknowledgement, if any, would let each refused field through. Derived
#: from the registry rather than restated, so the pairing has one home.
_ACKNOWLEDGEMENT_FOR = {
    entry.unblocks: name
    for name, entry in CONFIG_CONTRACT.items()
    if entry.enforcement is Enforcement.ACKNOWLEDGEMENT and entry.unblocks
}


def _unsafe_overrides(field_name: str, entry: ConfigContract) -> dict[str, object]:
    """The mutation that must be refused, as env aliases.

    Two adjustments, both because "unsafe" is sometimes a relationship rather
    than a value:

    An acknowledged field is only unsafe while unacknowledged. The safe baseline
    carries ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION because the process-local
    bus is the only one implemented, so setting REALTIME_BUS=memory on top of it
    changes nothing — the mutation has to withdraw the acknowledgement too, or it
    would quietly assert that no refusal is needed.

    And a relational rule needs its companion moved, which `also_set` carries.
    """

    overrides: dict[str, object] = {_alias(field_name): entry.unsafe_production_value}
    acknowledgement = _ACKNOWLEDGEMENT_FOR.get(field_name)
    if acknowledgement is not None:
        overrides[_alias(acknowledgement)] = False
    if entry.also_set:
        overrides.update(entry.also_set)
    return overrides


def _ids(entries: list[tuple[str, ConfigContract]]) -> list[str]:
    return [name for name, _ in entries]


class TestTheRegistryCoversTheSettingsSurface:
    def test_every_field_is_classified(self) -> None:
        """A new setting arrives with a development-friendly default and no
        thought about production. This is where that gets noticed."""

        missing = unclassified_settings_fields(FIELD_NAMES)

        assert missing == [], (
            "these settings have no production classification — add them to "
            f"CONFIG_CONTRACT and say what happens if they are wrong: {missing}"
        )

    def test_no_entry_describes_a_field_that_no_longer_exists(self) -> None:
        """A stale entry is worse than a missing one: it reads as a decision
        someone made about something that is gone."""

        stale = contract_entries_naming_unknown_fields(FIELD_NAMES)

        assert stale == [], f"these entries name no real setting: {stale}"

    def test_every_entry_explains_itself(self) -> None:
        """The classification is the cheap half. The reason is what someone
        needs at 2am when they are deciding whether they may change it."""

        thin = [
            name
            for name, entry in CONFIG_CONTRACT.items()
            if len(entry.why.split()) < 8
        ]

        assert thin == [], f"these say what but not why: {thin}"


class TestARequiredSettingIsActuallyRefused:
    """The part that cannot be satisfied by writing a classification."""

    def test_core_required_is_never_merely_documented(self) -> None:
        """`CORE_REQUIRED` means something refuses. Anything else — a comment, a
        runbook, an intention — is not enforcement, and this is the implication
        that made the three real gaps visible."""

        unenforced = sorted(
            name
            for name, entry in CONFIG_CONTRACT.items()
            if entry.requirement is Requirement.CORE_REQUIRED
            and entry.enforcement not in (Enforcement.BOOT, Enforcement.SCHEMA)
        )

        assert unenforced == [], (
            "declared required in production but nothing rejects a bad value: "
            f"{unenforced}"
        )

    def test_every_boot_enforced_entry_names_a_value_to_reject(self) -> None:
        """Without a value to try, the test below would assert nothing."""

        for name, entry in _entries(Enforcement.BOOT):
            if entry.unsafe_production_value is None:
                # None is itself the unsafe value for the "must be supplied"
                # fields, so its presence cannot be distinguished from absence.
                # Assert the field can actually hold it, which is the same claim.
                assert Settings.model_fields[name].default is None or name in {
                    "smtp_host",
                    "smtp_username",
                    "smtp_password",
                    "smtp_from_email",
                    "trusted_proxy_ips",
                    "redis_url",
                    "db_pool_size",
                    "db_max_overflow",
                    "media_public_base_url",
                    "strong_auth_secret_keys",
                    "strong_auth_secret_active_key_id",
                    "google_client_id",
                    "google_client_secret",
                    "google_oauth_exchange_secret",
                    "oauth_credential_keys",
                    "oauth_credential_active_key_id",
                }, name

    @pytest.mark.parametrize(
        ("field_name", "entry"),
        _entries(Enforcement.BOOT),
        ids=_ids(_entries(Enforcement.BOOT)),
    )
    def test_production_boot_rejects_the_unsafe_value(
        self,
        field_name: str,
        entry: ConfigContract,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Start from a configuration that boots, break exactly one thing, and
        require the failure to name it.

        Starting from a safe baseline is what makes this a test of the field
        rather than of the validator in general — an all-defaults settings object
        fails for thirty reasons and would pass this assertion by accident.
        """

        alias = _alias(field_name)
        broken = _safe_production_settings(**_unsafe_overrides(field_name, entry))
        monkeypatch.setattr(config, "settings", broken)

        with pytest.raises(RuntimeError) as raised:
            config.validate_production_settings()

        message = str(raised.value)
        assert alias in message, (
            f"production refuses to boot, but the message does not mention "
            f"{alias}, so an operator cannot tell what to fix: {message}"
        )

    @pytest.mark.parametrize(
        ("field_name", "entry"),
        _entries(Enforcement.SCHEMA),
        ids=_ids(_entries(Enforcement.SCHEMA)),
    )
    def test_the_schema_refuses_to_hold_the_unsafe_value(
        self, field_name: str, entry: ConfigContract
    ) -> None:
        """Stronger than a boot check, and worth distinguishing: a value the
        schema cannot represent cannot be reintroduced later by a code path that
        never reaches the boot gate."""

        with pytest.raises(ValidationError):
            _safe_production_settings(**{_alias(field_name): entry.unsafe_production_value})


class TestTheBaselineItselfBoots:
    def test_a_safe_production_configuration_is_accepted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Guards every parametrised case above. If the baseline did not boot,
        each of them would pass for the wrong reason — the RuntimeError would be
        there, and the alias would appear in it only by coincidence."""

        monkeypatch.setattr(config, "settings", _safe_production_settings())

        config.validate_production_settings()


class TestAcknowledgementsAreDeliberate:
    @pytest.mark.parametrize(
        ("field_name", "entry"),
        _entries(Enforcement.ACKNOWLEDGEMENT),
        ids=_ids(_entries(Enforcement.ACKNOWLEDGEMENT)),
    )
    def test_an_acknowledgement_is_off_until_someone_turns_it_on(
        self, field_name: str, entry: ConfigContract
    ) -> None:
        """An acknowledgement that defaults to true acknowledges nothing. It is
        just the unsafe behaviour with a longer name."""

        assert Settings.model_fields[field_name].default is False, field_name

    @pytest.mark.parametrize(
        ("field_name", "entry"),
        _entries(Enforcement.ACKNOWLEDGEMENT),
        ids=_ids(_entries(Enforcement.ACKNOWLEDGEMENT)),
    )
    def test_an_acknowledgement_names_what_it_unblocks(
        self, field_name: str, entry: ConfigContract
    ) -> None:
        """An acknowledgement pointing at nothing is a flag nobody can trace
        back to the risk it accepts."""

        assert entry.unblocks in CONFIG_CONTRACT, field_name
        assert (
            CONFIG_CONTRACT[entry.unblocks].requirement is Requirement.CORE_REQUIRED
        ), f"{field_name} unblocks {entry.unblocks}, which is not itself required"


class TestOptionalSettingsAreBoundedRatherThanTrusted:
    @pytest.mark.parametrize(
        "field_name",
        fields_with_enforcement(Enforcement.BOUNDED),
    )
    def test_a_bounded_setting_has_a_default_and_a_limit(self, field_name: str) -> None:
        """"Optional" has to mean "safe as it stands", which needs both halves: a
        usable default, and a range that stops a deployment setting a timeout of
        zero or a quota of two billion."""

        field = Settings.model_fields[field_name]

        assert field.default is not None, f"{field_name} has no usable default"

        constrained = bool(field.metadata) or "Literal" in str(field.annotation)
        assert constrained, (
            f"{field_name} is classified as bounded but accepts any value of its "
            "type; either add bounds or reclassify it"
        )

    @pytest.mark.parametrize(
        "field_name",
        fields_with_enforcement(Enforcement.DEPLOYMENT_CHOICE),
    )
    def test_a_deployment_choice_never_blocks_a_boot(self, field_name: str) -> None:
        """These are topology and naming. Absence must be a working default, not
        a startup failure."""

        assert Settings.model_fields[field_name].is_required() is False, field_name


class TestFeatureSettingsFailClosed:
    @pytest.mark.parametrize(
        "field_name",
        fields_with_enforcement(Enforcement.FEATURE_GATE),
    )
    def test_a_feature_setting_is_absent_or_off_by_default(
        self, field_name: str
    ) -> None:
        """A feature requiring configuration must not be on before it has any.
        Half-configured is the state that produces work which cannot finish.

        `job_import_enabled` is the deliberate exception and is asserted
        separately below: it is a kill switch for a shipped feature, so its
        default is on and turning it off is the action.
        """

        if field_name == "job_import_enabled":
            pytest.skip("a kill switch defaults on by design; see the test below")

        default = Settings.model_fields[field_name].default
        assert default in (None, False, ""), f"{field_name} defaults to {default!r}"

    def test_the_job_import_kill_switch_defaults_on_because_it_is_a_kill_switch(
        self,
    ) -> None:
        """Stated rather than skipped past. Off would disable a working feature
        for every existing deployment the moment this code arrived."""

        assert Settings.model_fields["job_import_enabled"].default is True

    def test_an_unconfigured_provider_stops_import_rather_than_starting_it(self) -> None:
        """The specific fail-closed claim behind OPENAI_API_KEY: absent, the
        readiness check reports the feature unavailable, so no draft is put into
        a state that needs a provider call that cannot happen."""

        from app.core.job_import_readiness_check import check_job_import_readiness

        original = config.settings.openai_api_key
        try:
            config.settings.openai_api_key = None  # type: ignore[assignment]
            readiness = check_job_import_readiness()
        finally:
            config.settings.openai_api_key = original  # type: ignore[assignment]

        assert readiness.as_dict()["ready"] is False


class TestQaSettingsCannotTakeEffectInProduction:
    """TEST_ONLY has to mean incapable, not unexpected."""

    @pytest.mark.parametrize(
        "field_name",
        fields_with_enforcement(Enforcement.INERT_IN_PRODUCTION),
    )
    def test_setting_it_in_production_still_does_nothing(
        self, field_name: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Configured as an attacker would want it — switched on, with a
        controller address listed — and production must still refuse."""

        from app.core import qa_personas

        enabled_in_production = _safe_production_settings(
            ENABLE_QA_PERSONA_SWITCHER=True,
            QA_PERSONA_CONTROLLER_EMAILS="somebody@example.com",
        )
        monkeypatch.setattr(qa_personas, "settings", enabled_in_production)

        assert qa_personas.qa_persona_feature_enabled() is False

    def test_the_guard_is_not_vacuous(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The same configuration in staging must work, or the test above would
        pass on a feature that is simply broken everywhere."""

        from app.core import qa_personas

        enabled_in_staging = _safe_production_settings(
            APP_ENV="staging",
            ENABLE_QA_PERSONA_SWITCHER=True,
            QA_PERSONA_CONTROLLER_EMAILS="somebody@example.com",
        )
        monkeypatch.setattr(qa_personas, "settings", enabled_in_staging)

        assert qa_personas.qa_persona_feature_enabled() is True


class TestTheOperatorChecklistIsGeneratedNotWritten:
    """The checklist someone fills in before a release.

    Generated from the registry on every run, so it cannot fall behind the code
    the way a hand-written list of environment variables always does.
    """

    def test_it_lists_every_required_variable(self) -> None:
        from scripts.print_config_contract import render

        rendered = render()

        missing = [
            _alias(name)
            for name, entry in CONFIG_CONTRACT.items()
            if entry.requirement is Requirement.CORE_REQUIRED
            and _alias(name) not in rendered
        ]
        assert missing == [], missing

    def test_it_reads_no_values(self) -> None:
        """It exists to be run and pasted, including by someone holding real
        production configuration. Names and reasons only — a checklist that
        echoed the secret it was asking about would be the wrong tool entirely."""

        import inspect

        from scripts import print_config_contract

        source = inspect.getsource(print_config_contract)

        # `Settings.model_fields` is metadata about the class; `settings` would be
        # the loaded values. Only the former may appear.
        assert "model_fields" in source
        assert "from app.core.config import settings" not in source
        assert "get_secret_value" not in source
        assert "os.environ" not in source


class TestTheRealtimeRefusalIsOnTheBootPath:
    """Kept as its own test because it is the gap that motivated the registry.

    The parametrised BOOT case above already covers it. This one records what
    was wrong: the refusal existed, was well written, was tested, and was never
    called by anything that could stop a deployment.
    """

    def test_production_refuses_process_local_delivery_without_acknowledgement(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            config,
            "settings",
            _safe_production_settings(ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION=False),
        )

        with pytest.raises(RuntimeError) as raised:
            config.validate_production_settings()

        assert "REALTIME_BUS" in str(raised.value)

    def test_a_single_instance_deployment_may_still_say_yes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The refusal must be an acknowledgeable one. A gate with no way
        through would make every production boot impossible, and the honest
        single-instance case is real."""

        monkeypatch.setattr(
            config,
            "settings",
            _safe_production_settings(ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION=True),
        )

        config.validate_production_settings()
