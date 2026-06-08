"""creator-native profile phase 1 role/content style + youtube portfolio ingestion

Revision ID: 0005_creator_profile_phase1
Revises: 0004_profile_unified_fields
Create Date: 2026-02-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_creator_profile_phase1"
down_revision: str | None = "0004_profile_unified_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ROLE_VIDEO_EDITOR_ID = "5f2af8b3-7ac8-4a97-a9a9-cf4d48f67f58"
ROLE_SCRIPTWRITER_ID = "0a9524b4-e54e-4f7f-8101-2123f8240f42"
ROLE_THUMBNAIL_DESIGNER_ID = "30d4f7f5-c806-41c3-a37e-b61eac4f4e5d"


def _json_type(is_postgres: bool):
    if is_postgres:
        return postgresql.JSONB(astext_type=sa.Text())
    return sa.JSON()


def _json_empty_array_default(is_postgres: bool):
    if is_postgres:
        return sa.text("'[]'::jsonb")
    return sa.text("'[]'")


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_type = _json_type(is_postgres)

    op.create_table(
        "roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_roles_name", "roles", ["name"], unique=True)
    op.create_index("ix_roles_category", "roles", ["category"])

    op.create_table(
        "role_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("help_text", sa.Text(), nullable=True),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "type IN ('single_select','multi_select','text','number')",
            name="ck_role_questions_type",
        ),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_role_questions_role_id", "role_questions", ["role_id"])

    op.create_table(
        "role_question_options",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["question_id"], ["role_questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_role_question_options_question_id", "role_question_options", ["question_id"])

    op.create_table(
        "user_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),
    )
    op.create_index("ix_user_roles_user_id", "user_roles", ["user_id"])
    op.create_index("ix_user_roles_role_id", "user_roles", ["role_id"])

    op.create_table(
        "user_role_answers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_question_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("answer", json_type, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_question_id"], ["role_questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "role_question_id",
            name="uq_user_role_answers_user_role_question",
        ),
    )
    op.create_index("ix_user_role_answers_user_id", "user_role_answers", ["user_id"])
    op.create_index("ix_user_role_answers_role_question_id", "user_role_answers", ["role_question_id"])

    op.create_table(
        "user_content_styles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("primary_niche", sa.String(length=120), nullable=True),
        sa.Column(
            "format",
            json_type,
            nullable=False,
            server_default=_json_empty_array_default(is_postgres),
        ),
        sa.Column(
            "tone",
            json_type,
            nullable=False,
            server_default=_json_empty_array_default(is_postgres),
        ),
        sa.Column("target_audience", sa.Text(), nullable=True),
        sa.Column("editing_complexity", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_content_styles_user_id"),
    )
    op.create_index("ix_user_content_styles_user_id", "user_content_styles", ["user_id"])
    op.create_index("ix_user_content_styles_primary_niche", "user_content_styles", ["primary_niche"])

    op.add_column("portfolio_items", sa.Column("user_role_in_project", sa.String(length=255), nullable=True))
    op.add_column("portfolio_items", sa.Column("youtube_url", sa.String(length=2048), nullable=True))
    op.add_column("portfolio_items", sa.Column("thumbnail_url", sa.String(length=2048), nullable=True))
    op.add_column("portfolio_items", sa.Column("channel_name", sa.String(length=255), nullable=True))
    op.add_column("portfolio_items", sa.Column("views", sa.BigInteger(), nullable=True))
    op.add_column("portfolio_items", sa.Column("published_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("portfolio_items", sa.Column("duration", sa.String(length=64), nullable=True))
    op.add_column("portfolio_items", sa.Column("retention_percent", sa.Float(), nullable=True))
    op.create_index("ix_portfolio_items_youtube_url", "portfolio_items", ["youtube_url"])

    role_table = sa.table(
        "roles",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String(length=120)),
        sa.column("category", sa.String(length=120)),
        sa.column("description", sa.Text()),
    )
    question_table = sa.table(
        "role_questions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("role_id", postgresql.UUID(as_uuid=True)),
        sa.column("label", sa.String(length=255)),
        sa.column("help_text", sa.Text()),
        sa.column("type", sa.String(length=32)),
        sa.column("required", sa.Boolean()),
    )
    option_table = sa.table(
        "role_question_options",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("question_id", postgresql.UUID(as_uuid=True)),
        sa.column("value", sa.String(length=255)),
    )

    op.bulk_insert(
        role_table,
        [
            {
                "id": ROLE_VIDEO_EDITOR_ID,
                "name": "Video Editor",
                "category": "Production",
                "description": "Edits creator videos across formats with pacing, storytelling, and polish.",
            },
            {
                "id": ROLE_SCRIPTWRITER_ID,
                "name": "Scriptwriter",
                "category": "Writing",
                "description": "Writes hooks, outlines, and full scripts for creator-led video formats.",
            },
            {
                "id": ROLE_THUMBNAIL_DESIGNER_ID,
                "name": "Thumbnail Designer",
                "category": "Design",
                "description": "Designs clickable thumbnails that improve CTR and content packaging.",
            },
        ],
    )

    op.bulk_insert(
        question_table,
        [
            {
                "id": "e9a8628f-b59f-46e2-aad5-95f85b0f40c3",
                "role_id": ROLE_VIDEO_EDITOR_ID,
                "label": "What type of editing do you specialize in?",
                "help_text": "Choose one primary lane for your current services.",
                "type": "single_select",
                "required": True,
            },
            {
                "id": "61d240fa-cf1e-4f40-8f18-964e68f153b8",
                "role_id": ROLE_VIDEO_EDITOR_ID,
                "label": "Which tools do you actively use?",
                "help_text": "Select all tools you can confidently deliver with.",
                "type": "multi_select",
                "required": True,
            },
            {
                "id": "2d35872c-3c8b-4f0c-b263-5461936fbd15",
                "role_id": ROLE_VIDEO_EDITOR_ID,
                "label": "Average turnaround time (days)",
                "help_text": "Enter a realistic average for a standard deliverable.",
                "type": "number",
                "required": True,
            },
            {
                "id": "3c2d5f4c-d4f8-4f6b-b4b7-a6a1bf6f1b0d",
                "role_id": ROLE_SCRIPTWRITER_ID,
                "label": "What scripts do you write most often?",
                "help_text": "Choose your dominant script format.",
                "type": "single_select",
                "required": True,
            },
            {
                "id": "6d4dbf65-6f3c-48ef-ab67-ec22bd708ebf",
                "role_id": ROLE_SCRIPTWRITER_ID,
                "label": "Which niches do you write for?",
                "help_text": "Select all niches where you have strong writing experience.",
                "type": "multi_select",
                "required": True,
            },
            {
                "id": "a50a4702-2d5a-4e77-84df-d12ad7fe4d1e",
                "role_id": ROLE_SCRIPTWRITER_ID,
                "label": "Share one writing strength",
                "help_text": "Example: strong hook creation or clear storytelling arc.",
                "type": "text",
                "required": True,
            },
            {
                "id": "68330757-dfdb-4e3b-8599-644f5f6cb2d9",
                "role_id": ROLE_THUMBNAIL_DESIGNER_ID,
                "label": "Primary thumbnail style",
                "help_text": "Choose the style you can execute consistently.",
                "type": "single_select",
                "required": True,
            },
            {
                "id": "40f33a2a-5f6a-4fd8-9bba-8f5b3f645876",
                "role_id": ROLE_THUMBNAIL_DESIGNER_ID,
                "label": "Preferred design tools",
                "help_text": "Select all tools you use for client work.",
                "type": "multi_select",
                "required": True,
            },
            {
                "id": "7a7f97ca-c7a3-4ef8-8eca-c60750f5da87",
                "role_id": ROLE_THUMBNAIL_DESIGNER_ID,
                "label": "Typical iterations included per thumbnail",
                "help_text": "Enter the usual revision count you offer.",
                "type": "number",
                "required": True,
            },
        ],
    )

    op.bulk_insert(
        option_table,
        [
            # Video Editor
            {"id": "d0869987-f0ab-4c7f-96ab-c59434058b40", "question_id": "e9a8628f-b59f-46e2-aad5-95f85b0f40c3", "value": "Short-form"},
            {"id": "5ad4ec9a-e0f4-4888-a17e-c2d2ce226f8b", "question_id": "e9a8628f-b59f-46e2-aad5-95f85b0f40c3", "value": "Long-form"},
            {"id": "52f03677-8796-4dcc-808c-b0cc57af0686", "question_id": "e9a8628f-b59f-46e2-aad5-95f85b0f40c3", "value": "Podcast"},
            {"id": "8b629f89-18f5-4bc2-a59f-fe80f04f6f6d", "question_id": "e9a8628f-b59f-46e2-aad5-95f85b0f40c3", "value": "Hybrid"},
            {"id": "0d1b153f-67c3-4032-8372-4ca6ddc9cb58", "question_id": "61d240fa-cf1e-4f40-8f18-964e68f153b8", "value": "Premiere Pro"},
            {"id": "70f67376-b1ba-4d46-86c6-2d512f0a9743", "question_id": "61d240fa-cf1e-4f40-8f18-964e68f153b8", "value": "Final Cut Pro"},
            {"id": "446e51ce-a8d5-4456-b194-a1477ea3f0f8", "question_id": "61d240fa-cf1e-4f40-8f18-964e68f153b8", "value": "DaVinci Resolve"},
            {"id": "cc92f576-13e3-4fdd-a53c-c2ea527ab08e", "question_id": "61d240fa-cf1e-4f40-8f18-964e68f153b8", "value": "CapCut"},
            {"id": "d233ebfc-654c-449b-b3fa-f4a6e74274f3", "question_id": "61d240fa-cf1e-4f40-8f18-964e68f153b8", "value": "After Effects"},
            # Scriptwriter
            {"id": "50bc1b22-61e2-46c4-b46f-4ac5d5d1e67e", "question_id": "3c2d5f4c-d4f8-4f6b-b4b7-a6a1bf6f1b0d", "value": "Shorts hooks"},
            {"id": "4b9fe07f-cc77-42f4-ab8c-39718df194f8", "question_id": "3c2d5f4c-d4f8-4f6b-b4b7-a6a1bf6f1b0d", "value": "Long-form explainer"},
            {"id": "4ce7f6d5-84f4-4df7-a2d3-f1c79fb6f5de", "question_id": "3c2d5f4c-d4f8-4f6b-b4b7-a6a1bf6f1b0d", "value": "Podcast outlines"},
            {"id": "9f418c34-f0f0-40b4-8634-3cb3688e1378", "question_id": "3c2d5f4c-d4f8-4f6b-b4b7-a6a1bf6f1b0d", "value": "Documentary"},
            {"id": "f7b35526-3f12-4009-b67d-64f7d8323e15", "question_id": "6d4dbf65-6f3c-48ef-ab67-ec22bd708ebf", "value": "Business"},
            {"id": "0765c666-24ce-4df2-9d00-48f1ca8eedae", "question_id": "6d4dbf65-6f3c-48ef-ab67-ec22bd708ebf", "value": "Education"},
            {"id": "2eb66e83-e0f1-4f9f-9f43-7f2b1554a4f8", "question_id": "6d4dbf65-6f3c-48ef-ab67-ec22bd708ebf", "value": "Entertainment"},
            {"id": "62f95d9e-966d-4399-905a-54ff6f620951", "question_id": "6d4dbf65-6f3c-48ef-ab67-ec22bd708ebf", "value": "Tech"},
            {"id": "a8916828-26dc-46ee-b6af-39d03dac7944", "question_id": "6d4dbf65-6f3c-48ef-ab67-ec22bd708ebf", "value": "Lifestyle"},
            # Thumbnail Designer
            {"id": "a44ce84f-4954-4175-ba67-3250ef04ac53", "question_id": "68330757-dfdb-4e3b-8599-644f5f6cb2d9", "value": "Clean minimal"},
            {"id": "7effeb04-a8f0-42c3-bf13-4bdbad5576fa", "question_id": "68330757-dfdb-4e3b-8599-644f5f6cb2d9", "value": "Bold high-contrast"},
            {"id": "e59413cd-e7cd-4cca-b484-f94f31a89fbc", "question_id": "68330757-dfdb-4e3b-8599-644f5f6cb2d9", "value": "Face-reaction"},
            {"id": "f7007693-cf1d-4038-9f0e-bf6f9d93fdf6", "question_id": "68330757-dfdb-4e3b-8599-644f5f6cb2d9", "value": "Text-heavy"},
            {"id": "ed6f2be5-1617-4af6-a955-adf6dc84bc34", "question_id": "40f33a2a-5f6a-4fd8-9bba-8f5b3f645876", "value": "Photoshop"},
            {"id": "85706f5d-da8e-4573-8ec2-977b05873e6f", "question_id": "40f33a2a-5f6a-4fd8-9bba-8f5b3f645876", "value": "Photopea"},
            {"id": "d4545a78-56a0-4bc4-abd6-7670ad70c7b6", "question_id": "40f33a2a-5f6a-4fd8-9bba-8f5b3f645876", "value": "Canva"},
            {"id": "8d8ef88e-b67f-4689-ad4d-2f8958a870f9", "question_id": "40f33a2a-5f6a-4fd8-9bba-8f5b3f645876", "value": "Illustrator"},
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_portfolio_items_youtube_url", table_name="portfolio_items")
    op.drop_column("portfolio_items", "retention_percent")
    op.drop_column("portfolio_items", "duration")
    op.drop_column("portfolio_items", "published_date")
    op.drop_column("portfolio_items", "views")
    op.drop_column("portfolio_items", "channel_name")
    op.drop_column("portfolio_items", "thumbnail_url")
    op.drop_column("portfolio_items", "youtube_url")
    op.drop_column("portfolio_items", "user_role_in_project")

    op.drop_index("ix_user_content_styles_primary_niche", table_name="user_content_styles")
    op.drop_index("ix_user_content_styles_user_id", table_name="user_content_styles")
    op.drop_table("user_content_styles")

    op.drop_index("ix_user_role_answers_role_question_id", table_name="user_role_answers")
    op.drop_index("ix_user_role_answers_user_id", table_name="user_role_answers")
    op.drop_table("user_role_answers")

    op.drop_index("ix_user_roles_role_id", table_name="user_roles")
    op.drop_index("ix_user_roles_user_id", table_name="user_roles")
    op.drop_table("user_roles")

    op.drop_index("ix_role_question_options_question_id", table_name="role_question_options")
    op.drop_table("role_question_options")

    op.drop_index("ix_role_questions_role_id", table_name="role_questions")
    op.drop_table("role_questions")

    op.drop_index("ix_roles_category", table_name="roles")
    op.drop_index("ix_roles_name", table_name="roles")
    op.drop_table("roles")
