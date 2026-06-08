from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ProfileCapabilities(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

    can_apply_to_jobs: bool = False
    can_post_jobs: bool = False
    has_portfolio: bool = False
    has_public_profile: bool = False
    has_hiring_identity: bool = False
    has_verified_social_or_channel: bool = False
    is_admin: bool = False
    apply_missing_sections: list[str] = Field(default_factory=list)
    post_missing_sections: list[str] = Field(default_factory=list)
    missing_hiring_fields: list[str] = Field(default_factory=list)
