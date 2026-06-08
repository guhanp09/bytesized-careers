from __future__ import annotations

from httpx import AsyncClient


async def test_list_filters_and_pagination(client: AsyncClient) -> None:
    seed_jobs = [
        {
            "title": "Instagram Shorts Editor",
            "category": "Shorts",
            "location": "Remote",
            "platforms": ["instagram"],
            "start_timeframe": "ASAP",
            "status": "published",
        },
        {
            "title": "Instagram Reels Editor",
            "category": "Editing",
            "location": "Bangalore",
            "platforms": ["instagram"],
            "start_timeframe": "<1mo",
            "status": "published",
        },
        {
            "title": "Instagram Thumbnail Designer",
            "category": "Thumbnails",
            "location": "Remote",
            "platforms": ["instagram"],
            "start_timeframe": "ASAP",
            "status": "draft",
        },
    ]

    for payload in seed_jobs:
        response = await client.post("/api/v1/jobs", json=payload)
        assert response.status_code == 201

    filtered = await client.get(
        "/api/v1/jobs",
        params={"platform": "instagram", "location": "remote", "status": "published", "limit": 10, "offset": 0},
    )
    assert filtered.status_code == 200
    filtered_data = filtered.json()
    assert filtered_data["total"] >= 1
    for item in filtered_data["items"]:
        assert "instagram" in item["platforms"]
        assert item["status"] == "published"

    paged = await client.get("/api/v1/jobs", params={"limit": 1, "offset": 0})
    assert paged.status_code == 200
    paged_data = paged.json()
    assert paged_data["limit"] == 1
    assert len(paged_data["items"]) == 1
