from __future__ import annotations

from fastapi import APIRouter

from app.core.tool_catalog import list_tool_catalog

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get(
    "/catalog",
    summary="List supported creator tool catalog entries",
)
async def get_tool_catalog() -> list[dict]:
    return list_tool_catalog()
