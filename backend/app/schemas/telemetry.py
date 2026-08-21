from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ClientErrorFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str = Field(min_length=1, max_length=240)
    line: int = Field(ge=1, le=10_000_000)
    column: int | None = Field(default=None, ge=1, le=10_000_000)
    function: str | None = Field(
        default=None,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9_.$<>:\[\]-]+$",
    )

    @field_validator("file")
    @classmethod
    def validate_static_chunk(cls, value: str) -> str:
        if (
            not value.startswith("/_next/static/chunks/")
            or not value.endswith(".js")
            or ".." in value
            or "//" in value
            or "\\" in value
            or "?" in value
            or "#" in value
        ):
            raise ValueError("file must be a canonical Next.js static chunk path")
        middle = value.removeprefix("/_next/static/chunks/").removesuffix(".js")
        if not middle or any(
            character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./-"
            for character in middle
        ):
            raise ValueError("file contains unsupported characters")
        return value


class ClientErrorReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    boundary: Literal["route", "global", "window", "unhandled_rejection"]
    name: str = Field(
        default="Error",
        min_length=1,
        max_length=120,
        pattern=r"^[A-Za-z][A-Za-z0-9_.$:-]{0,119}$",
    )
    digest: str | None = Field(
        default=None,
        min_length=6,
        max_length=128,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    release: str | None = Field(
        default=None,
        min_length=7,
        max_length=100,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]+$",
    )
    frames: list[ClientErrorFrame] = Field(default_factory=list, max_length=12)
