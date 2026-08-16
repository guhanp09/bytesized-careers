"""What a production image is allowed to install.

This exists because the answer used to be "whatever resolves today". The
Dockerfile copied `pyproject.toml` without `uv.lock` and ran a plain `uv sync`,
so every build re-resolved the loose version ranges from scratch. Two images
built a week apart could ship different versions of every transitive dependency,
and the committed lock — the artifact that records which versions were actually
reviewed and tested — had no bearing on what shipped. Pinning a vulnerable
package's fix in the lock would have changed nothing.

The image also installed the dev group, so pytest and ruff rode into production.

These are asserted against the Dockerfile text rather than by building an image,
because building requires a Docker daemon that is not available in every
environment this suite runs in. That is a real limitation: it means these tests
prove the build *instructions* are right, not that the build succeeds. The
instructions were separately verified by running the equivalent
`uv sync --locked --no-dev` against a scratch environment.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
DOCKERFILE = (BACKEND / "Dockerfile").read_text(encoding="utf8")

#: Comment lines explain the rules; they must not be mistaken for the rules.
INSTRUCTIONS = "\n".join(
    line for line in DOCKERFILE.splitlines() if not line.lstrip().startswith("#")
)


def _sync_command() -> str:
    match = re.search(r"^RUN\s+uv\s+sync\b.*$", INSTRUCTIONS, re.MULTILINE)
    assert match, "the image no longer installs dependencies with `uv sync`"
    return match.group(0)


class TestTheLockIsAuthoritative:
    def test_the_lock_is_copied_before_dependencies_are_installed(self) -> None:
        copy_line = re.search(r"^COPY\s+[^\n]*uv\.lock[^\n]*$", INSTRUCTIONS, re.MULTILINE)
        assert copy_line, "uv.lock is not copied into the image, so the build re-resolves"

        assert INSTRUCTIONS.index(copy_line.group(0)) < INSTRUCTIONS.index(_sync_command()), (
            "uv.lock must be copied before `uv sync`, or the sync cannot use it"
        )

    def test_the_build_refuses_a_lock_that_disagrees_with_the_manifest(self) -> None:
        # `--locked` turns "edited pyproject without relocking" into a build
        # failure. `--frozen` would use the lock but stay quiet about the drift.
        assert "--locked" in _sync_command(), (
            "`uv sync` must run with --locked so a stale lock fails the build"
        )


class TestTheRuntimeImageIsProductionOnly:
    def test_development_tooling_is_not_installed(self) -> None:
        command = _sync_command()

        assert "--no-dev" in command, "the production image must not install the dev group"
        assert "--all-groups" not in command, (
            "--all-groups puts pytest and ruff in the runtime image"
        )

    def test_the_runtime_does_not_resync_on_start(self) -> None:
        # Without this, `uv run` in the entrypoint tries to reconcile the
        # environment on every boot, finds the dev group missing because of
        # --no-dev, and reaches for the network while starting.
        assert re.search(r"UV_NO_SYNC=1", INSTRUCTIONS), (
            "UV_NO_SYNC=1 must be set so the baked environment is used as-is"
        )


class TestTheManifestAndLockAgree:
    def test_every_declared_dependency_is_present_in_the_lock(self) -> None:
        # A cheap structural check. The authoritative verification is
        # `uv lock --check`, which needs the uv binary; this catches the case
        # where someone adds a dependency to pyproject.toml and never relocks.
        manifest = (BACKEND / "pyproject.toml").read_text(encoding="utf8")
        lock = (BACKEND / "uv.lock").read_text(encoding="utf8")

        block = re.search(r"^dependencies = \[(.*?)^\]", manifest, re.MULTILINE | re.DOTALL)
        assert block, "pyproject.toml no longer declares a dependencies list"

        declared = re.findall(r'"([A-Za-z0-9._-]+)', block.group(1))
        assert declared, "no dependencies parsed out of pyproject.toml"

        missing = [
            name
            for name in declared
            if not re.search(rf'^name = "{re.escape(name)}"', lock, re.MULTILINE | re.IGNORECASE)
        ]
        assert not missing, f"declared but absent from uv.lock, so it was never relocked: {missing}"


class TestSecurityFloorsHold:
    """Some version floors are security boundaries, not preferences.

    Both of these were raised deliberately to escape advisories, and both are
    easy to lower again by someone widening a range to resolve an unrelated
    conflict. Lowering either silently reintroduces a known vulnerable package,
    so the floor is asserted rather than trusted.
    """

    @staticmethod
    def _floor(package: str) -> tuple[int, ...]:
        manifest = (BACKEND / "pyproject.toml").read_text(encoding="utf8")
        match = re.search(rf'"{re.escape(package)}>=([0-9.]+)', manifest)
        assert match, f"{package} no longer declares a lower bound"
        return tuple(int(part) for part in match.group(1).split("."))

    def test_fastapi_stays_high_enough_to_permit_a_patched_starlette(self) -> None:
        # FastAPI below 0.141 pins `starlette<1.0.0`, and every Starlette before
        # 1.x is missing Host-header validation — which poisons
        # `request.url.path` — and is vulnerable to UNC-path traversal in
        # StaticFiles. This service mounts StaticFiles, so that one is reachable.
        assert self._floor("fastapi") >= (0, 141, 1)

    def test_cryptography_stays_past_the_pkcs7_oracle(self) -> None:
        # 50.0.0 is the first release without the PKCS#7 EnvelopedData
        # Bleichenbacher oracle. This library encrypts OAuth credentials and
        # TOTP secrets.
        assert self._floor("cryptography") >= (50, 0, 0)

    def test_the_lock_agrees_with_those_floors(self) -> None:
        lock = (BACKEND / "uv.lock").read_text(encoding="utf8")

        for package, minimum in (("fastapi", (0, 141, 1)), ("starlette", (1, 0, 0)), ("cryptography", (50, 0, 0))):
            match = re.search(
                rf'^\[\[package\]\]\nname = "{package}"\nversion = "([^"]+)"', lock, re.MULTILINE
            )
            assert match, f"{package} is missing from the lock"
            resolved = tuple(int(p) for p in match.group(1).split(".") if p.isdigit())
            assert resolved >= minimum, f"{package} resolved to {match.group(1)}, below its security floor"


@pytest.mark.parametrize("path", ["pyproject.toml", "uv.lock"])
def test_the_canonical_artifacts_exist(path: str) -> None:
    assert (BACKEND / path).is_file(), f"{path} is part of the dependency contract"
