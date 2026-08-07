from __future__ import annotations

import asyncio
import importlib.util
import ipaddress
import json
import threading
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import TestSessionLocal, active_test_role_id
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
    URL_READ_TIMEOUT_SECONDS,
    URL_TOTAL_TIMEOUT_SECONDS,
    URL_USER_AGENT,
    PublicJobUrlFetcher,
    PublicJobUrlFetchError,
    normalize_public_job_html,
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
                    "title": "Video Editor",
                    "description": "<p>Produce engaging learning videos aligned with our educational objectives.</p><h2>Key Responsibilities:</h2><ul><li>Edit learning videos for a school.</li><li>Enhance video and audio quality.</li></ul><h2>Qualifications Required:</h2><ul><li>Minimum of 1-7 years of experience in video editing.</li><li>Proficiency with video editing software.</li></ul>",
                    "hiringOrganization": {
                      "@type": "Organization",
                      "name": "Vashist Education Studio",
                      "description": "A school-led education studio creating clear learning videos."
                    },
                    "jobLocation": {
                      "@type": "Place",
                      "address": {
                        "@type": "PostalAddress",
                        "addressLocality": "Chennai",
                        "addressRegion": "Tamil Nadu",
                        "addressCountry": "IN"
                      }
                    },
                    "employmentType": ["FULL_TIME", "PERMANENT"],
                    "industry": "Education / Training",
                    "skills": ["Video Editing", ""],
                    "experienceRequirements": {
                      "@type": "OccupationalExperienceRequirements",
                      "monthsOfExperience": 12
                    },
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
                  <h1>Video Editor</h1>
                  <p>School-based creator role using Premiere Pro in Chennai.</p>
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
            "title": "Video Editor",
            "budget_amount": "3000",
        }
        fields = []
        for field_path, value in values.items():
            snippet = (
                value if field_path == "title" else f"Structured compensation: {value} per MONTH"
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
    assert result.title == "Video Editor"
    assert "Edit learning videos for a school." in result.normalized_text
    assert "Structured job title: Video Editor" in result.normalized_text
    assert (
        "Structured role summary: Produce engaging learning videos aligned with our "
        "educational objectives." in result.normalized_text
    )
    assert "Structured responsibility: Edit learning videos for a school." in (
        result.normalized_text
    )
    assert "Structured qualification: Proficiency with video editing software." in (
        result.normalized_text
    )
    assert (
        "Structured employer summary: A school-led education studio creating clear "
        "learning videos." in result.normalized_text
    )
    assert "Structured employer: Vashist Education Studio" in result.normalized_text
    assert "Structured role location: Chennai, Tamil Nadu, IN" in result.normalized_text
    assert "Structured compensation: 3000 per MONTH" in result.normalized_text
    assert "Structured industry: Education / Training" in result.normalized_text
    assert "Structured skills: Video Editing" in result.normalized_text
    assert (
        "Structured experience requirement: 1\u20137 years of experience" in result.normalized_text
    )
    assert "School-based creator role using Premiere Pro in Chennai." in result.normalized_text
    assert "Navigation clutter" not in result.normalized_text
    assert "Accept tracking" not in result.normalized_text
    assert "window.secret" not in result.normalized_text
    assert result.metadata["json_ld_job_posting"] is True
    assert result.metadata["structured_context"] == {
        "job_title": "Video Editor",
        "role_summary": (
            "Produce engaging learning videos aligned with our educational objectives."
        ),
        "responsibilities": [
            "Edit learning videos for a school.",
            "Enhance video and audio quality.",
        ],
        "qualifications": [
            "Minimum of 1-7 years of experience in video editing.",
            "Proficiency with video editing software.",
        ],
        "employer_name": "Vashist Education Studio",
        "about_summary": ("A school-led education studio creating clear learning videos."),
        "role_location": "Chennai, Tamil Nadu, IN",
        "employment_type": "FULL_TIME, PERMANENT",
        "compensation": "3000 per MONTH",
        "industry": "Education / Training",
        "skills": "Video Editing",
        "experience_requirement": "1\u20137 years of experience",
    }
    assert result.metadata["canonical_url"] == f"{public_page_server}/job?canonical=1"
    assert result.metadata["redirect_count"] == 1
    assert len(_FixtureHandler.requests) == 2
    assert all(not item["authorization"] for item in _FixtureHandler.requests)
    assert all(not item["cookie"] for item in _FixtureHandler.requests)
    assert all(item["user_agent"] == URL_USER_AGENT for item in _FixtureHandler.requests)


@pytest.mark.parametrize(
    "boundary_heading",
    [
        "Role",
        "Industry Type",
        "Department",
        "Employment Type",
        "Role Category",
        "Education",
        "Key Skills",
        "Benefits",
        "About Company",
        "How to Apply",
    ],
)
def test_structured_qualification_collection_stops_at_metadata_headings(
    boundary_heading: str,
) -> None:
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Video Editor",
        "description": (
            "<h2>Qualifications Required</h2>"
            "<p>Two years of editing experience.</p>"
            f"<h2>{boundary_heading}</h2>"
            "<p>This metadata must not become a qualification.</p>"
        ),
    }
    html = f'<script type="application/ld+json">{json.dumps(posting)}</script>'

    _normalized, _title, metadata = normalize_public_job_html(
        html,
        final_url="https://jobs.example/video-editor",
    )

    assert metadata["structured_context"]["qualifications"] == [
        "Two years of editing experience."
    ]


def test_structured_inline_section_headings_keep_same_line_fact() -> None:
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Video Editor",
        "description": (
            "<p>Responsibilities: Edit weekly learning videos.</p>"
            "<p>Qualifications: Two years of editing experience.</p>"
            "<p>Role: Video Editor</p>"
        ),
    }
    html = f'<script type="application/ld+json">{json.dumps(posting)}</script>'

    _normalized, _title, metadata = normalize_public_job_html(
        html,
        final_url="https://jobs.example/video-editor",
    )

    context = metadata["structured_context"]
    assert context["responsibilities"] == ["Edit weekly learning videos."]
    assert context["qualifications"] == ["Two years of editing experience."]


def _source_with_structured_context(context: dict[str, object]) -> JobImportSource:
    labels = {
        "job_title": "Structured job title",
        "role_summary": "Structured role summary",
        "about_summary": "Structured employer summary",
        "responsibilities": "Structured responsibility",
        "qualifications": "Structured qualification",
        "employment_type": "Structured employment type",
        "role_location": "Structured role location",
        "industry": "Structured industry",
        "experience_requirement": "Structured experience requirement",
    }
    lines: list[str] = []
    for key, value in context.items():
        label = labels.get(key)
        if label is None:
            continue
        if isinstance(value, str):
            lines.append(f"{label}: {value}")
        elif isinstance(value, list):
            lines.extend(f"{label}: {item}" for item in value if isinstance(item, str))
    original_text = "\n".join(lines)
    return JobImportSource(
        owner_user_id=uuid4(),
        source_type="public_url",
        original_text=original_text,
        retrieval_metadata={"structured_context": context},
        content_fingerprint="0" * 64,
    )


def test_provider_value_wins_while_other_structured_fallbacks_are_added() -> None:
    source = _source_with_structured_context(
        {
            "role_location": "Chennai, Tamil Nadu, IN",
            "industry": "Education / Training",
            "experience_requirement": "1\u20137 years of experience",
        }
    )
    source.original_text = f"Provider location: Mumbai, IN\n{source.original_text}"
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "location",
                    "value": "Mumbai, IN",
                    "provenance": "extracted_from_source",
                    "evidence": [{"snippet": "Provider location: Mumbai, IN"}],
                }
            ],
            "missing_fields": [
                {"field_path": "content_niches"},
                {"field_path": "experience_level"},
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)
    fields = {field.field_path: field for field in augmented.fields}
    assert fields["location"].value == "Mumbai, IN"
    assert fields["content_niches"].value == ["Education"]
    assert fields["experience_level"].value == "1\u20137 years of experience"
    assert {item.field_path for item in augmented.missing_fields}.isdisjoint(
        {"content_niches", "experience_level"}
    )


def test_shine_structured_context_recovers_core_fields_without_provider_values() -> None:
    context: dict[str, object] = {
        "job_title": "Video Editor",
        "role_summary": "Edit and enhance learning videos for a school audience.",
        "about_summary": ("A school-led education studio creating clear learning videos."),
        "responsibilities": [
            "Edit videos to ensure a high-quality final product",
            "Enhance video and audio quality using editing software",
        ],
        "qualifications": [
            "Minimum of 1-7 years of experience in video editing",
            "Proficiency in video editing software and tools",
        ],
        "employment_type": "FULL_TIME",
        "role_location": "Chennai, Tamil Nadu, IN",
        "industry": "Education / Training",
        "experience_requirement": "1\u20137 years of experience",
    }
    source = _source_with_structured_context(context)
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "missing_fields": [
                {"field_path": field_path}
                for field_path in (
                    "title",
                    "primary_role_key",
                    "engagement_type",
                    "about_channel",
                    "responsibilities",
                    "requirements",
                    "location",
                    "content_niches",
                    "experience_level",
                )
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)
    fields = {field.field_path: field for field in augmented.fields}

    assert fields["title"].value == "Video Editor"
    assert fields["primary_role_key"].value == "video-editor"
    assert fields["primary_role_key"].provenance == "suggested_inference"
    assert fields["primary_role_key"].provider_confidence is not None
    assert fields["primary_role_key"].provider_confidence.label == "high"
    assert fields["engagement_type"].value == "full_time"
    assert fields["about_channel"].value == context["about_summary"]
    assert fields["responsibilities"].value == context["responsibilities"]
    assert fields["requirements"].value == context["qualifications"]
    assert fields["location"].value == "Chennai, Tamil Nadu, IN"
    assert fields["content_niches"].value == ["Education"]
    assert fields["content_niches"].provider_confidence is not None
    assert fields["content_niches"].provider_confidence.label == "high"
    assert fields["experience_level"].value == "1\u20137 years of experience"
    assert augmented.missing_fields == []

    for field_path in (
        "title",
        "primary_role_key",
        "engagement_type",
        "about_channel",
        "responsibilities",
        "requirements",
    ):
        assert fields[field_path].evidence
        for evidence in fields[field_path].evidence:
            assert evidence.location is not None
            assert evidence.location.char_start is not None
            assert source.original_text is not None
            assert (
                source.original_text[evidence.location.char_start : evidence.location.char_end]
                == evidence.snippet
            )


@pytest.mark.parametrize(
    ("employment_type", "expected_engagement"),
    [
        ("FULL_TIME, PERMANENT", "full_time"),
        (["FULL_TIME", "PERMANENT"], "full_time"),
        ("PART_TIME | PERMANENT", "part_time"),
        ("FULL_TIME, PART_TIME", None),
        (["FULL_TIME", "INTERN"], None),
    ],
)
def test_structured_employment_maps_only_an_unambiguous_supported_token(
    employment_type: object,
    expected_engagement: str | None,
) -> None:
    source = _source_with_structured_context({"employment_type": employment_type})
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "missing_fields": [{"field_path": "engagement_type"}],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)
    engagement = next(
        (field for field in augmented.fields if field.field_path == "engagement_type"),
        None,
    )
    if expected_engagement is None:
        assert engagement is None
        assert [item.field_path for item in augmented.missing_fields] == ["engagement_type"]
    else:
        assert engagement is not None
        assert engagement.value == expected_engagement
        assert engagement.provider_confidence is not None
        assert engagement.provider_confidence.label == "high"


def test_exact_structured_facts_upgrade_matching_medium_provider_suggestions() -> None:
    context = {
        "job_title": "Video Editor",
        "employment_type": "FULL_TIME, PERMANENT",
        "industry": "Education / Training",
    }
    source = _source_with_structured_context(context)
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "primary_role_key",
                    "value": "video-editor",
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Structured job title: Video Editor"}],
                    "explanation": "The title suggests this role.",
                    "provider_confidence": {"score": 0.7, "label": "medium"},
                },
                {
                    "field_path": "engagement_type",
                    "value": "full_time",
                    "provenance": "suggested_inference",
                    "evidence": [
                        {"snippet": "Structured employment type: FULL_TIME, PERMANENT"}
                    ],
                    "explanation": "The employment metadata suggests full-time.",
                    "provider_confidence": {"score": 0.7, "label": "medium"},
                },
                {
                    "field_path": "content_niches",
                    "value": ["Education"],
                    "provenance": "suggested_inference",
                    "evidence": [
                        {"snippet": "Structured industry: Education / Training"}
                    ],
                    "explanation": "The industry suggests Education.",
                    "provider_confidence": {"score": 0.7, "label": "medium"},
                },
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)
    fields = {field.field_path: field for field in augmented.fields}
    for field_path in ("primary_role_key", "engagement_type", "content_niches"):
        field = fields[field_path]
        assert field.provider_confidence is not None
        assert field.provider_confidence.label == "high"
        assert field.provider_confidence.metadata["server_grounded_match"] is True
        assert field.evidence


def test_distinct_valid_provider_suggestions_are_never_upgraded_or_replaced() -> None:
    context = {
        "job_title": "Video Editor",
        "employment_type": "FULL_TIME",
        "industry": "Education",
    }
    source = _source_with_structured_context(context)
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "primary_role_key",
                    "value": "animator",
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Structured job title: Video Editor"}],
                    "explanation": "Provider chose another role.",
                    "provider_confidence": {"score": 0.7, "label": "medium"},
                },
                {
                    "field_path": "engagement_type",
                    "value": "part_time",
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Structured employment type: FULL_TIME"}],
                    "explanation": "Provider chose another engagement.",
                    "provider_confidence": {"score": 0.7, "label": "medium"},
                },
                {
                    "field_path": "content_niches",
                    "value": ["Gaming"],
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Structured industry: Education"}],
                    "explanation": "Provider chose another niche.",
                    "provider_confidence": {"score": 0.7, "label": "medium"},
                },
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(
        response,
        source,
        allowed_role_keys={"video-editor", "animator"},
    )
    fields = {field.field_path: field for field in augmented.fields}
    assert fields["primary_role_key"].value == "animator"
    assert fields["engagement_type"].value == "part_time"
    assert fields["content_niches"].value == ["Gaming"]
    for field_path in ("primary_role_key", "engagement_type", "content_niches"):
        assert fields[field_path].provider_confidence is not None
        assert fields[field_path].provider_confidence.label == "medium"
    assert all(
        warning.code != "structured_context_provider_value_repaired"
        for warning in augmented.warnings
    )


def test_unknown_provider_role_cannot_block_an_exact_catalog_title_role() -> None:
    source = _source_with_structured_context({"job_title": "Video Editor"})
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "primary_role_key",
                    "value": "editor",
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Structured job title: Video Editor"}],
                    "explanation": "Provider returned a role outside the active catalog.",
                    "provider_confidence": {"score": 0.8, "label": "high"},
                }
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(
        response,
        source,
        allowed_role_keys={"video-editor", "animator"},
    )

    role = next(
        field for field in augmented.fields if field.field_path == "primary_role_key"
    )
    assert role.value == "video-editor"
    assert any(
        warning.code == "structured_context_provider_value_repaired"
        and warning.field_path == "primary_role_key"
        for warning in augmented.warnings
    )


def test_structured_title_never_repairs_to_an_inactive_catalog_role() -> None:
    source = _source_with_structured_context({"job_title": "Video Editor"})
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "primary_role_key",
                    "value": "editor",
                    "provenance": "suggested_inference",
                    "evidence": [{"snippet": "Structured job title: Video Editor"}],
                    "explanation": "Provider returned a role outside the active catalog.",
                    "provider_confidence": {"score": 0.8, "label": "high"},
                }
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(
        response,
        source,
        allowed_role_keys={"animator"},
    )

    role = next(
        field for field in augmented.fields if field.field_path == "primary_role_key"
    )
    assert role.value == "editor"
    assert all(
        warning.field_path != "primary_role_key"
        or warning.code != "structured_context_provider_value_repaired"
        for warning in augmented.warnings
    )


def test_malformed_provider_values_cannot_block_grounded_structured_fallbacks() -> None:
    context: dict[str, object] = {
        "job_title": "Video Editor",
        "about_summary": "An education studio creating clear weekly learning videos.",
        "responsibilities": ["Edit weekly learning videos."],
        "qualifications": ["Two years of video editing experience."],
        "employment_type": "FULL_TIME, PERMANENT",
        "role_location": "Chennai, Tamil Nadu, IN",
        "industry": "Education",
        "experience_requirement": "1–7 years of experience",
    }
    source = _source_with_structured_context(context)
    evidence = [{"snippet": "Structured job title: Video Editor"}]
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "fields": [
                {
                    "field_path": "title",
                    "value": "x",
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
                {
                    "field_path": "primary_role_key",
                    "value": "Video Editor",
                    "provenance": "suggested_inference",
                    "evidence": evidence,
                    "explanation": "Provider returned a display label.",
                },
                {
                    "field_path": "engagement_type",
                    "value": "PERMANENT",
                    "provenance": "suggested_inference",
                    "evidence": evidence,
                    "explanation": "Provider returned an unsupported label.",
                },
                {
                    "field_path": "responsibilities",
                    "value": "Edit weekly learning videos.",
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
                {
                    "field_path": "requirements",
                    "value": {"qualification": "Two years"},
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
                {
                    "field_path": "about_channel",
                    "value": "too short",
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
                {
                    "field_path": "location",
                    "value": ["Chennai"],
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
                {
                    "field_path": "content_niches",
                    "value": "Education",
                    "provenance": "suggested_inference",
                    "evidence": evidence,
                    "explanation": "Provider returned a scalar niche.",
                },
                {
                    "field_path": "experience_level",
                    "value": ["1-7 years"],
                    "provenance": "extracted_from_source",
                    "evidence": evidence,
                },
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)
    fields = {field.field_path: field for field in augmented.fields}
    assert fields["title"].value == context["job_title"]
    assert fields["primary_role_key"].value == "video-editor"
    assert fields["engagement_type"].value == "full_time"
    assert fields["responsibilities"].value == context["responsibilities"]
    assert fields["requirements"].value == context["qualifications"]
    assert fields["about_channel"].value == context["about_summary"]
    assert fields["location"].value == context["role_location"]
    assert fields["content_niches"].value == ["Education"]
    assert fields["experience_level"].value == context["experience_requirement"]
    repaired_paths = {
        warning.field_path
        for warning in augmented.warnings
        if warning.code == "structured_context_provider_value_repaired"
    }
    assert repaired_paths == {
        "title",
        "primary_role_key",
        "engagement_type",
        "responsibilities",
        "requirements",
        "about_channel",
        "location",
        "content_niches",
        "experience_level",
    }


def test_provider_conflict_is_preserved_instead_of_structured_fallback_override() -> None:
    source = _source_with_structured_context({"job_title": "Video Editor"})
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "conflicts": [
                {
                    "field_path": "primary_role_key",
                    "values": [
                        {
                            "value": "video-editor",
                            "evidence": [{"snippet": "Video Editor"}],
                        },
                        {
                            "value": "graphic-designer",
                            "evidence": [{"snippet": "Video Editor"}],
                        },
                    ],
                }
            ],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)

    assert [conflict.field_path for conflict in augmented.conflicts] == ["primary_role_key"]
    assert all(field.field_path != "primary_role_key" for field in augmented.fields)


def test_unsupported_months_stay_unresolved_without_guessing_a_band() -> None:
    html = """
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "Video Editor",
          "description": "Edit classroom videos.",
          "experienceRequirements": {
            "@type": "OccupationalExperienceRequirements",
            "monthsOfExperience": 120
          }
        }
      </script>
      <main>Video editor for classroom lessons.</main>
    """
    normalized, _, metadata = normalize_public_job_html(
        html,
        final_url="https://jobs.example/video-editor",
    )
    assert "Structured experience requirement: At least 120 months of experience" in normalized
    source = _source_with_structured_context(metadata["structured_context"])
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "missing_fields": [{"field_path": "experience_level"}],
        }
    )
    augmented = JobImportService._with_deterministic_context(response, source)
    assert all(field.field_path != "experience_level" for field in augmented.fields)
    assert {item.field_path for item in augmented.missing_fields} == {"experience_level"}


def test_supported_months_become_a_recruiter_confirmed_band_suggestion() -> None:
    context = {"experience_requirement": "At least 12 months of experience"}
    source = _source_with_structured_context(context)
    response = JobImportExtractionResponse.model_validate(
        {
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "missing_fields": [{"field_path": "experience_level"}],
        }
    )

    augmented = JobImportService._with_deterministic_context(response, source)
    experience = next(field for field in augmented.fields if field.field_path == "experience_level")
    assert experience.value == "1\u20133 years"
    assert experience.provenance == "suggested_inference"
    assert experience.provider_confidence is not None
    assert experience.provider_confidence.label == "medium"
    assert experience.evidence[0].snippet == (
        "Structured experience requirement: At least 12 months of experience"
    )


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
    await active_test_role_id()
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
        assert "School-based creator role" in source["original_text"]

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
        assert currency["effective_value"] == "INR"
        assert currency["authority_state"] == "prefilled_by_import"
        assert currency["decision_origin"] == "contextual_inference"
        assert currency["decision_confidence"] == "high"
        assert currency["rationale_code"] == "currency_from_role_country"
        assert currency["evidence"][0]["snippet"] == (
            "Structured role location: Chennai, Tamil Nadu, IN"
        )
        extracted = {field["field_path"]: field for field in processed_draft["fields"]}
        assert extracted["location"]["effective_value"] == "Chennai, Tamil Nadu, IN"
        assert extracted["location"]["decision_origin"] == "explicit"
        assert extracted["primary_role_key"]["effective_value"] == "video-editor"
        assert extracted["engagement_type"]["effective_value"] == "full_time"
        assert extracted["about_channel"]["effective_value"] == (
            "A school-led education studio creating clear learning videos."
        )
        assert extracted["responsibilities"]["effective_value"] == [
            "Edit learning videos for a school.",
            "Enhance video and audio quality.",
        ]
        assert extracted["requirements"]["effective_value"] == [
            "Minimum of 1-7 years of experience in video editing.",
            "Proficiency with video editing software.",
        ]
        assert extracted["content_niches"]["effective_value"] == ["Education"]
        assert extracted["content_niches"]["requires_confirmation"] is False
        assert extracted["experience_level"]["effective_value"] == "1\u20137 years of experience"
        for field_path in (
            "primary_role_key",
            "engagement_type",
            "about_channel",
            "responsibilities",
            "requirements",
            "location",
            "content_niches",
            "experience_level",
        ):
            evidence = extracted[field_path]["evidence"][0]
            snippet = evidence["snippet"]
            assert (
                source["original_text"][
                    evidence["location"]["char_start"] : evidence["location"]["char_end"]
                ]
                == snippet
            )
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
        assert applied.json()["job"]["budget_currency"] == "INR"
        context = await client.get(
            f"/api/v1/job-imports/native-jobs/{applied.json()['job']['id']}/context",
            headers=owner,
        )
        assert context.status_code == 200, context.text
        assert context.json()["draft"]["id"] == draft["id"]
        assert context.json()["source_type"] == "public_url"
        assert context.json()["source_label"] == "Video Editor"
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


class TestATransientTimeoutIsRetriedOnceAndNoMore:
    """A timeout says nothing about the page; a refusal says everything.

    A live import of a page that normally answers in under a second failed
    outright on a momentary stall, and the recruiter was shown a failure for
    something that would have worked if asked twice. So a timeout — and only a
    timeout — gets one more attempt.
    """

    @staticmethod
    async def _public_resolver(_hostname: str, _port: int):
        return [ipaddress.ip_address("93.184.216.34")]

    async def test_a_first_timeout_recovers_on_the_retry(self) -> None:
        attempts: list[int] = []

        def flaky(request: httpx.Request) -> httpx.Response:
            attempts.append(1)
            if len(attempts) == 1:
                raise httpx.ReadTimeout("first attempt stalls")
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                # A page thin enough to look like a shell is now refused, so the
                # fixture has to read like the posting it claims to be.
                content=b"<html><head><title>Video Editor</title></head><body>"
                b"<h1>Video Editor</h1>"
                b"<h2>About the role</h2><p>Edit weekly explainer videos.</p>"
                b"<h2>Responsibilities</h2><p>Cut long-form episodes and shorts.</p>"
                b"<h2>Qualifications</h2><p>3+ years of experience with Premiere Pro.</p>"
                b"<h2>Benefits</h2><p>Paid time off and equipment budget.</p>"
                b"</body></html>",
            )

        fetcher = PublicJobUrlFetcher(
            resolver=self._public_resolver, transport=httpx.MockTransport(flaky)
        )
        retrieval = await fetcher.fetch("https://public.example/jobs/1")

        assert len(attempts) == 2
        assert "Video Editor" in retrieval.normalized_text

    async def test_a_second_timeout_is_a_truthful_failure(self) -> None:
        attempts: list[int] = []

        def always_stalls(_request: httpx.Request) -> httpx.Response:
            attempts.append(1)
            raise httpx.ReadTimeout("still stalling")

        fetcher = PublicJobUrlFetcher(
            resolver=self._public_resolver,
            transport=httpx.MockTransport(always_stalls),
        )
        with pytest.raises(PublicJobUrlFetchError) as caught:
            await fetcher.fetch("https://public.example/jobs/1")

        # Bounded: tried twice, then stopped. Never an empty successful import.
        assert len(attempts) == 2
        assert caught.value.code == "JOB_IMPORT_URL_TIMEOUT"

    async def test_a_refusal_is_an_answer_and_is_not_repeated(self) -> None:
        attempts: list[int] = []

        def refused(_request: httpx.Request) -> httpx.Response:
            attempts.append(1)
            return httpx.Response(404, headers={"content-type": "text/html"})

        fetcher = PublicJobUrlFetcher(
            resolver=self._public_resolver, transport=httpx.MockTransport(refused)
        )
        with pytest.raises(PublicJobUrlFetchError):
            await fetcher.fetch("https://public.example/jobs/1")

        assert len(attempts) == 1

    async def test_a_blocked_destination_is_not_reattempted(self) -> None:
        async def private_resolver(_hostname: str, _port: int):
            return [ipaddress.ip_address("127.0.0.1")]

        attempts: list[int] = []

        def never_reached(_request: httpx.Request) -> httpx.Response:
            attempts.append(1)
            return httpx.Response(200)

        fetcher = PublicJobUrlFetcher(
            resolver=private_resolver, transport=httpx.MockTransport(never_reached)
        )
        with pytest.raises(PublicJobUrlFetchError):
            await fetcher.fetch("https://public.example/jobs/1")

        # The retry must never become a second chance at the SSRF checks.
        assert attempts == []

    def test_one_operation_may_not_consume_the_whole_attempt(self) -> None:
        # These were the same number, so a redirect chain this fetcher is willing
        # to follow could not fit inside the budget allowed for it.
        assert URL_READ_TIMEOUT_SECONDS < URL_TOTAL_TIMEOUT_SECONDS
