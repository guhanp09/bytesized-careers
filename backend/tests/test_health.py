from __future__ import annotations

from httpx import AsyncClient


async def test_health_endpoint(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_health_db_endpoint(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/db")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
