"""What the production image must and must not contain.

Docker is unavailable here, so the image cannot be built or scanned — that proof
is recorded as blocked. What can be checked exactly is the source: these are the
properties whose absence is invisible until an incident, and none of them can be
verified by looking at a running container after the fact either.

Two matter most.

Running as root means a remote-code-execution bug becomes root inside the
container, and from there the distance to the host is one runtime vulnerability.
Nothing the API does needs root.

And `COPY . .` copies a developer's working directory. Without a .dockerignore
the image ships the test suite, the local SQLite databases, and any .env holding
real credentials — and a secret baked into a layer stays in the image even if a
later layer deletes the file.
"""

from __future__ import annotations

from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
DOCKERFILE = BACKEND / "Dockerfile"
DOCKERIGNORE = BACKEND / ".dockerignore"


@pytest.fixture(scope="module")
def dockerfile() -> str:
    return DOCKERFILE.read_text(encoding="utf8")


@pytest.fixture(scope="module")
def dockerignore() -> str:
    return DOCKERIGNORE.read_text(encoding="utf8")


class TestItDoesNotRunAsRoot:
    def test_a_user_is_created(self, dockerfile: str) -> None:
        assert "useradd" in dockerfile

    def test_the_process_drops_to_it(self, dockerfile: str) -> None:
        """Creating a user and never switching to it is the common half-measure:
        it looks hardened and runs as root."""

        assert "USER creatorjobs" in dockerfile

    def test_the_switch_happens_before_the_command(self, dockerfile: str) -> None:
        """USER after CMD would be ignored — CMD is the last word."""

        assert dockerfile.index("USER creatorjobs") < dockerfile.index("CMD [")

    def test_the_user_cannot_log_in(self, dockerfile: str) -> None:
        assert "nologin" in dockerfile


class TestItShipsOnlyWhatItNeeds:
    def test_a_dockerignore_exists(self) -> None:
        """Without it, COPY . . ships the build context — which is somebody's
        working directory."""

        assert DOCKERIGNORE.exists()

    @pytest.mark.parametrize(
        "pattern", [".env", "*.db", "tests/", ".venv/", ".git/", "*.pem"]
    )
    def test_the_dangerous_paths_are_excluded(
        self, dockerignore: str, pattern: str
    ) -> None:
        assert pattern in dockerignore

    def test_secrets_are_excluded_before_anything_else(self, dockerignore: str) -> None:
        """Ordering is not functional here, but a reader should meet the reason
        first: a secret in a layer survives its own deletion."""

        body = dockerignore.split("\n")
        secret_line = next(index for index, line in enumerate(body) if line == ".env")
        tests_line = next(index for index, line in enumerate(body) if line == "tests/")

        assert secret_line < tests_line

    def test_the_local_virtualenv_is_excluded(self, dockerignore: str) -> None:
        """Copying it would overwrite the image's own locked environment with a
        developer's machine, dev dependencies included."""

        assert ".venv/" in dockerignore


class TestDependenciesAreTheLockedProductionSet:
    def test_the_lockfile_is_copied(self, dockerfile: str) -> None:
        """Without it, uv re-resolves the loose ranges on every build and two
        images a week apart ship different transitive versions — including
        undoing any security remediation recorded in the lock."""

        assert "uv.lock" in dockerfile

    def test_the_install_is_locked(self, dockerfile: str) -> None:
        assert "--locked" in dockerfile

    def test_development_dependencies_are_excluded(self, dockerfile: str) -> None:
        """pytest and ruff are build-time tooling. In a runtime image they are
        attack surface that cannot be used for anything legitimate."""

        assert "--no-dev" in dockerfile

    def test_nothing_syncs_at_container_start(self, dockerfile: str) -> None:
        """A sync during boot is a network call during boot, which fails exactly
        when the network is why you are restarting."""

        assert "UV_NO_SYNC=1" in dockerfile


class TestTheHealthcheckIsLivenessNotReadiness:
    def test_a_healthcheck_exists(self, dockerfile: str) -> None:
        assert "HEALTHCHECK" in dockerfile

    def test_it_asks_the_liveness_endpoint(self, dockerfile: str) -> None:
        """Deliberately not readiness. A healthcheck that consulted the database
        would restart a healthy container during a blip and turn a partial
        outage into a crash loop."""

        assert "/api/v1/health" in dockerfile
        assert "/health/db" not in dockerfile
        assert "/health/realtime" not in dockerfile

    def test_it_is_bounded(self, dockerfile: str) -> None:
        """An unbounded check hangs forever against a wedged process, which is
        the case it exists to detect."""

        assert "--timeout=" in dockerfile
        assert "--retries=" in dockerfile

    def test_it_allows_a_start_period(self, dockerfile: str) -> None:
        """Without one, a container that takes ten seconds to boot is killed for
        failing a check during boot."""

        assert "--start-period=" in dockerfile


def test_no_secret_is_copied_explicitly(dockerfile: str) -> None:
    """The other way secrets get in: a deliberate COPY rather than a wide one."""

    for forbidden in ("COPY .env", "COPY *.pem", "COPY *.key"):
        assert forbidden not in dockerfile
