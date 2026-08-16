FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv

# `uv.lock` is copied because the build must install *that* resolution and no
# other. Without it here, `uv sync` resolves the loose ranges in pyproject.toml
# afresh on every build, so two images built a week apart could ship different
# versions of every transitive dependency — and the committed lock, including
# any security remediation recorded in it, would have no effect on what ships.
COPY pyproject.toml uv.lock README.md ./

# `--locked` fails the build if the lock disagrees with pyproject.toml, which
# turns "someone edited the manifest without relocking" into a build error
# rather than a silent re-resolution. `--no-dev` keeps pytest, ruff and the rest
# of the dev group out of the runtime image; they are build-time tooling and
# every one of them is additional attack surface in production.
RUN uv sync --locked --no-dev

COPY . .

# The environment is baked at build time. `uv run` would otherwise try to sync
# on every invocation and, finding the dev group absent, attempt to install it
# at container start — a network call during boot that must never happen.
ENV PATH="/app/.venv/bin:$PATH" \
    UV_NO_SYNC=1

EXPOSE 8000

CMD ["sh", "scripts/start_render.sh"]
