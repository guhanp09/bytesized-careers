from __future__ import annotations

import asyncio
import importlib.util
import ipaddress
import threading
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID

import httpx
import pytest
import pytest_asyncio
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import TestSessionLocal
from fastapi import Depends
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_db,
    get_job_import_provider,
    get_job_import_url_service,
)
from app.main import app
from app.models import JobImportSource
from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.schemas.job_import import (
    JobImportExtractionField,
    JobImportExtractionResponse,
    JobImportProviderMetadata,
)
from app.services import job_url_fetcher as job_url_fetcher_module
from app.services.job_import_provider import JobImportProviderResult
from app.services.job_import_service import JobImportService
from app.services.job_import_url_service import JobImportUrlService
from app.services.job_service import JobService
from app.services.job_url_fetcher import (
    MAX_URL_RESPONSE_BYTES,
    URL_USER_AGENT,
    PublicJobUrlFetcher,
    PublicJobUrlFetchError,
)


def _load_url_migration():
    path = Path(__file__).parents[1] / "alembic" / "versions" / "0050_job_import_url_retrieval.py"
    spec = importlib.util.spec_from_file_location("url_import_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FixtureHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, str]] = []

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _send(
        self,
        status: int,
        body: bytes = b"",
        *,
        content_type: str = "text/html; charset=utf-8",
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        type(self).requests.append(
            {
                "path": self.path,
                "authorization": self.headers.get("Authorization", ""),
                "cookie": self.headers.get("Cookie", ""),
                "user_agent": self.headers.get("User-Agent", ""),
            }
        )
        if self.path == "/redirect":
            self._send(302, headers={"Location": "/job"})
            return
        if self.path == "/loop-a":
            self._send(302, headers={"Location": "/loop-b"})
            return
        if self.path == "/loop-b":
            self._send(302, headers={"Location": "/loop-a"})
            return
        if self.path == "/binary":
            self._send(200, b"\x89PNG\r\n", content_type="image/png")
            return
        if self.path == "/large":
            self._send(200, b"x" * (MAX_URL_RESPONSE_BYTES + 1))
            return
        if self.path == "/empty":
            self._send(200, b"<html><script>private()</script><style>x{}</style></html>")
            return
        if self.path == "/auth":
            self._send(401, b"Sign in")
            return
        html = b"""
            <html>
              <head>
                <title>Public creator editor role</title>
                <link rel="canonical" href="/job?canonical=1">
                <script>window.secret = "do not execute";</script>
                <script type="application/ld+json">
                  {
                    "@context": "https://schema.org",
                    "@type": "JobPosting",
                    "title": "YouTube Video Editor",
                    "description": "<p>Edit weekly finance explainers.</p>",
                    "hiringOrganization": {
                      "@type": "Organization",
                      "name": "Creator Finance Studio",
                      "address": {
                        "@type": "PostalAddress",
                        "addressLocality": "Austin",
                        "addressCountry": "US"
                      }
                    },
                    "jobLocation": {
                      "@type": "Place",
                      "address": {
                        "@type": "PostalAddress",
                        "addressLocality": "New York",
                        "addressCountry": "US"
                      }
                    },
                    "jobLocationType": "TELECOMMUTE",
                    "employmentType": "CONTRACTOR",
                    "baseSalary": {
                      "@type": "MonetaryAmount",
                      "value": 3000,
                      "unitText": "MONTH"
                    }
                  }
                </script>
              </head>
              <body>
                <nav>Navigation clutter</nav>
                <main>
                  <h1>YouTube Video Editor</h1>
                  <p>Remote creator role using Premiere Pro.</p>
                  <p>Apply through the public listing.</p>
                </main>
                <div class="cookie-consent">Accept tracking</div>
              </body>
            </html>
        """
        self._send(200, html)


@pytest_asyncio.fixture
async def public_page_server() -> AsyncIterator[str]:
    _FixtureHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


async def _auth(client: AsyncClient, label: str) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/oauth/google",
        json={
            "email": f"{label}@example.com",
            "provider_account_id": f"google-{label}",
            "access_token": f"token-{label}",
            "expires_at": int(datetime.now(UTC).timestamp()) + 3600,
            "scope": "openid email profile",
        },
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class _TitleProvider:
    def __init__(self) -> None:
        self.requests = []

    async def extract(self, request):
        self.requests.append(request)
        source = request.source.original_text or ""
        values = {
            "title": "YouTube Video Editor",
            "location": "New York, US",
            "budget_amount": "3000",
        }
        fields = []
        for field_path, value in values.items():
            snippet = (
                value
                if field_path == "title"
                else f"Structured role location: {value}"
                if field_path == "location"
                else f"Structured compensation: {value} per MONTH"
            )
            start = source.index(snippet)
            fields.append(
                JobImportExtractionField(
                    field_path=field_path,
                    value=value,
                    provenance="extracted_from_source",
                    evidence=[
                        {
                            "snippet": snippet,
                            "location": {
                                "char_start": start,
                                "char_end": start + len(snippet),
                                "source_url": request.source.source_url,
                            },
                        }
                    ],
                )
            )
        return JobImportProviderResult(
            extraction=JobImportExtractionResponse(
                extraction_schema_version=request.extraction_schema_version,
                target_listing_schema_version=request.target_listing_schema_version,
                fields=fields,
            ),
            metadata=JobImportProviderMetadata(provider_name="test_provider"),
        )


async def test_fetcher_normalizes_html_json_ld_and_never_forwards_credentials(
    public_page_server: str,
) -> None:
    fetcher = PublicJobUrlFetcher(allow_test_loopback=True)
    result = await fetcher.fetch(f"{public_page_server}/redirect")

    assert result.final_url == f"{public_page_server}/job"
    assert result.title == "YouTube Video Editor"
    assert "Edit weekly finance explainers." in result.normalized_text
    assert "Structured employer: Creator Finance Studio" in result.normalized_text
    assert "Structured role location: New York, US" in result.normalized_text
    assert "Structured compensation: 3000 per MONTH" in result.normalized_text
    assert "Remote creator role using Premiere Pro." in result.normalized_text
    assert "Navigation clutter" not in result.normalized_text
    assert "Accept tracking" not in result.normalized_text
    assert "window.secret" not in result.normalized_text
    assert result.metadata["json_ld_job_posting"] is True
    assert result.metadata["structured_context"] == {
        "employer_name": "Creator Finance Studio",
        "employer_location": "Austin, US",
        "role_location": "New York, US",
        "location_type": "TELECOMMUTE",
        "employment_type": "CONTRACTOR",
        "compensation": "3000 per MONTH",
    }
    assert result.metadata["canonical_url"] == f"{public_page_server}/job?canonical=1"
    assert result.metadata["redirect_count"] == 1
    assert len(_FixtureHandler.requests) == 2
    assert all(not item["authorization"] for item in _FixtureHandler.requests)
    assert all(not item["cookie"] for item in _FixtureHandler.requests)
    assert all(item["user_agent"] == URL_USER_AGENT for item in _FixtureHandler.requests)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/job",
        "http://user:password@example.com/job",
        "http://localhost/job",
        "http://service.internal/job",
        "http://127.0.0.1/job",
        "http://127.1/job",
        "http://10.0.0.1/job",
        "http://172.16.0.1/job",
        "http://192.168.1.1/job",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/job",
        "http://[fc00::1]/job",
        "http://[fe80::1]/job",
    ],
)
async def test_fetcher_rejects_unsafe_destinations(url: str) -> None:
    with pytest.raises(PublicJobUrlFetchError) as caught:
        await PublicJobUrlFetcher().fetch(url)
    assert caught.value.code in {
        "JOB_IMPORT_URL_INVALID",
        "JOB_IMPORT_URL_SCHEME_UNSUPPORTED",
        "JOB_IMPORT_URL_CREDENTIALS_FORBIDDEN",
        "JOB_IMPORT_URL_UNSAFE_DESTINATION",
    }


async def test_fetcher_revalidates_redirects_and_bounds_redirect_count() -> None:
    async def public_resolver(_hostname: str, _port: int):
        return [ipaddress.ip_address("93.184.216.34")]

    def unsafe_redirect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302,
            headers={"Location": "http://169.254.169.254/latest/meta-data"},
            request=request,
        )

    fetcher = PublicJobUrlFetcher(
        resolver=public_resolver,
        transport=httpx.MockTransport(unsafe_redirect),
    )
    with pytest.raises(PublicJobUrlFetchError) as caught:
        await fetcher.fetch("https://public.example/jobs/1")
    assert caught.value.code == "JOB_IMPORT_URL_UNSAFE_DESTINATION"

    def loop_redirect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302,
            headers={"Location": "https://public.example/jobs/1"},
            request=request,
        )

    loop_fetcher = PublicJobUrlFetcher(
        resolver=public_resolver,
        transport=httpx.MockTransport(loop_redirect),
    )
    with pytest.raises(PublicJobUrlFetchError) as loop_error:
        await loop_fetcher.fetch("https://public.example/jobs/1")
    assert loop_error.value.code == "JOB_IMPORT_URL_TOO_MANY_REDIRECTS"


async def test_fetcher_rejects_private_dns_answers_and_reports_resolution_failure() -> None:
    async def private_resolver(_hostname: str, _port: int):
        return [ipaddress.ip_address("10.20.30.40")]

    with pytest.raises(PublicJobUrlFetchError) as private_error:
        await PublicJobUrlFetcher(resolver=private_resolver).fetch(
            "https://jobs.public.example/editor"
        )
    assert private_error.value.code == "JOB_IMPORT_URL_UNSAFE_DESTINATION"

    async def failed_resolver(_hostname: str, _port: int):
        raise OSError("local deterministic DNS failure")

    with pytest.raises(PublicJobUrlFetchError) as dns_error:
        await PublicJobUrlFetcher(resolver=failed_resolver).fetch(
            "https://missing.public.example/editor"
        )
    assert dns_error.value.code == "JOB_IMPORT_URL_DNS_FAILED"


async def test_fetcher_reports_content_size_empty_auth_and_timeout_failures(
    public_page_server: str,
) -> None:
    fetcher = PublicJobUrlFetcher(allow_test_loopback=True)
    expected = {
        "/binary": "JOB_IMPORT_URL_CONTENT_TYPE_UNSUPPORTED",
        "/large": "JOB_IMPORT_URL_RESPONSE_TOO_LARGE",
        "/empty": "JOB_IMPORT_URL_EMPTY_CONTENT",
        "/auth": "JOB_IMPORT_URL_AUTH_REQUIRED",
        "/loop-a": "JOB_IMPORT_URL_TOO_MANY_REDIRECTS",
    }
    for path, code in expected.items():
        with pytest.raises(PublicJobUrlFetchError) as caught:
            await fetcher.fetch(f"{public_page_server}{path}")
        assert caught.value.code == code

    async def public_resolver(_hostname: str, _port: int):
        return [ipaddress.ip_address("93.184.216.34")]

    def timeout(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("fixture timeout")

    timeout_fetcher = PublicJobUrlFetcher(
        resolver=public_resolver,
        transport=httpx.MockTransport(timeout),
    )
    with pytest.raises(PublicJobUrlFetchError) as timeout_error:
        await timeout_fetcher.fetch("https://public.example/jobs/1")
    assert timeout_error.value.code == "JOB_IMPORT_URL_TIMEOUT"


async def test_fetcher_enforces_one_total_deadline_across_the_retrieval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def public_resolver(_hostname: str, _port: int):
        return [ipaddress.ip_address("93.184.216.34")]

    async def slow_response(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.05)
        return httpx.Response(
            200,
            text="A public creator job listing with enough readable content to import safely.",
            headers={"Content-Type": "text/plain"},
            request=request,
        )

    monkeypatch.setattr(
        job_url_fetcher_module,
        "URL_TOTAL_TIMEOUT_SECONDS",
        0.01,
    )
    fetcher = PublicJobUrlFetcher(
        resolver=public_resolver,
        transport=httpx.MockTransport(slow_response),
    )
    with pytest.raises(PublicJobUrlFetchError) as caught:
        await fetcher.fetch("https://public.example/jobs/slow")
    assert caught.value.code == "JOB_IMPORT_URL_TIMEOUT"
    assert caught.value.status_code == 504


async def test_url_source_uses_same_private_review_and_native_draft_pipeline(
    client: AsyncClient,
    public_page_server: str,
) -> None:
    owner = await _auth(client, "url-import-owner")
    other = await _auth(client, "url-import-other")

    original_url_dependency = app.dependency_overrides.get(get_job_import_url_service)
    original_provider_dependency = app.dependency_overrides.get(get_job_import_provider)

    async def test_url_service(
        session: AsyncSession = Depends(get_db),
    ) -> JobImportUrlService:
        import_service = JobImportService(
            JobImportRepository(session),
            JobService(JobRepository(session)),
        )
        return JobImportUrlService(
            import_service,
            PublicJobUrlFetcher(allow_test_loopback=True),
        )

    app.dependency_overrides[get_job_import_url_service] = test_url_service
    provider = _TitleProvider()
    app.dependency_overrides[get_job_import_provider] = lambda: provider
    try:
        payload = {
            "source_url": f"{public_page_server}/redirect",
            "idempotency_key": "url-import-integration-1",
        }
        source_response = await client.post(
            "/api/v1/job-imports/url-sources",
            headers=owner,
            json=payload,
        )
        assert source_response.status_code == 201, source_response.text
        source = source_response.json()
        assert source["source_type"] == "public_url"
        assert source["source_url"] == f"{public_page_server}/redirect"
        assert source["final_source_url"] == f"{public_page_server}/job"
        assert source["retrieved_at"] is not None
        assert source["retrieval_metadata"]["json_ld_job_posting"] is True
        assert "Remote creator role" in source["original_text"]

        request_count = len(_FixtureHandler.requests)
        duplicate = await client.post(
            "/api/v1/job-imports/url-sources",
            headers=owner,
            json=payload,
        )
        assert duplicate.status_code == 201
        assert duplicate.json()["id"] == source["id"]
        assert len(_FixtureHandler.requests) == request_count

        draft_response = await client.post(
            f"/api/v1/job-imports/sources/{source['id']}/drafts",
            headers=owner,
            json={"idempotency_key": "url-import-draft-1"},
        )
        assert draft_response.status_code == 201, draft_response.text
        draft = draft_response.json()

        processed = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/process",
            headers=owner,
            json={},
        )
        assert processed.status_code == 200, processed.text
        processed_draft = processed.json()["draft"]
        assert processed_draft["processing_status"] == "ready_to_apply"
        currency = next(
            field for field in processed_draft["fields"] if field["field_path"] == "budget_currency"
        )
        assert currency["effective_value"] == "USD"
        assert currency["authority_state"] == "prefilled_by_import"
        assert currency["decision_origin"] == "contextual_inference"
        assert currency["decision_confidence"] == "high"
        assert currency["rationale_code"] == "currency_from_role_country"
        assert currency["evidence"][0]["snippet"] == ("Structured role location: New York, US")
        assert len(provider.requests) == 1
        assert provider.requests[0].source.source_type == "external_listing_text"
        assert provider.requests[0].source.original_text == source["original_text"]

        cross_account = await client.get(
            f"/api/v1/job-imports/sources/{source['id']}",
            headers=other,
        )
        assert cross_account.status_code == 404

        reviewed = await client.patch(
            f"/api/v1/job-imports/drafts/{draft['id']}/fields/title",
            headers=owner,
            json={"action": "accept"},
        )
        assert reviewed.status_code == 200, reviewed.text
        assert reviewed.json()["can_apply_to_native_draft"] is True

        applied = await client.post(
            f"/api/v1/job-imports/drafts/{draft['id']}/apply",
            headers=owner,
            json={"mode": "create_new"},
        )
        assert applied.status_code == 200, applied.text
        assert applied.json()["job"]["status"] == "draft"
        assert applied.json()["job"]["budget_currency"] == "USD"
        context = await client.get(
            f"/api/v1/job-imports/native-jobs/{applied.json()['job']['id']}/context",
            headers=owner,
        )
        assert context.status_code == 200, context.text
        assert context.json()["draft"]["id"] == draft["id"]
        assert context.json()["source_type"] == "public_url"
        assert context.json()["source_label"] == "YouTube Video Editor"
        other_context = await client.get(
            f"/api/v1/job-imports/native-jobs/{applied.json()['job']['id']}/context",
            headers=other,
        )
        assert other_context.status_code == 404
        public_job = await client.get(f"/api/v1/jobs/{applied.json()['job']['id']}")
        assert public_job.status_code == 404
        assert source["original_text"] not in (await client.get("/api/v1/jobs")).text

        redacted = await client.delete(
            f"/api/v1/job-imports/sources/{source['id']}",
            headers=owner,
        )
        assert redacted.status_code == 204
        deleted_read = await client.get(
            f"/api/v1/job-imports/sources/{source['id']}",
            headers=owner,
        )
        assert deleted_read.status_code == 404
        async with TestSessionLocal() as session:
            stored_source = await session.get(JobImportSource, UUID(source["id"]))
            assert stored_source is not None
            assert stored_source.original_text is None
            assert stored_source.source_url is None
            assert stored_source.final_source_url is None
            assert stored_source.retrieved_at is None
            assert stored_source.retrieval_metadata is None
    finally:
        if original_url_dependency is None:
            app.dependency_overrides.pop(get_job_import_url_service, None)
        else:
            app.dependency_overrides[get_job_import_url_service] = original_url_dependency
        if original_provider_dependency is None:
            app.dependency_overrides.pop(get_job_import_provider, None)
        else:
            app.dependency_overrides[get_job_import_provider] = original_provider_dependency


def test_url_retrieval_migration_is_additive_and_reversible(tmp_path: Path) -> None:
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'url-import.db'}")
    metadata = sa.MetaData()
    sources = sa.Table(
        "job_import_sources",
        metadata,
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_url", sa.String(2048), nullable=True),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            sources.insert().values(id="preserved", source_url="https://example.com/job")
        )

    migration = _load_url_migration()
    assert migration.down_revision == "0049_engagement_payment_state"
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        migration.op = Operations(context)
        migration.upgrade()
    columns = {column["name"] for column in sa.inspect(engine).get_columns("job_import_sources")}
    assert {"final_source_url", "retrieved_at", "retrieval_metadata"} <= columns
    with engine.connect() as connection:
        assert connection.execute(sa.select(sources.c.source_url)).scalar_one() == (
            "https://example.com/job"
        )

    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        migration.op = Operations(context)
        migration.downgrade()
    columns = {column["name"] for column in sa.inspect(engine).get_columns("job_import_sources")}
    assert "final_source_url" not in columns
    assert "retrieved_at" not in columns
    assert "retrieval_metadata" not in columns
