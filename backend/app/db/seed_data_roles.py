from __future__ import annotations

import uuid

# Stable namespace so generated role ids never change across restarts/deploys.
ROLE_SEED_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "creatorjobs.role-catalog")


def role_seed_id(name: str) -> uuid.UUID:
    """Deterministic id for a catalog role, derived from its name.

    Seeding matches existing rows by name, so the generated id is only used when a
    role is first inserted. Reusing uuid5 keeps the id stable without hardcoding.
    """

    return uuid.uuid5(ROLE_SEED_NAMESPACE, name.strip().lower())


# Canonical creator-economy role catalog used to power the "Specialization" picker
# on /you. Seeding is insert-only and matches on name, so rows here are never
# modified or duplicated — including the three roles also created by migration
# 0005 (Video Editor / Scriptwriter / Thumbnail Designer).
ROLE_CATALOG: list[dict[str, str]] = [
    # Editing / production
    {"name": "Video Editor", "category": "Production", "description": "Edits creator videos across formats with pacing, storytelling, and polish."},
    {"name": "Long-form Editor", "category": "Production", "description": "Cuts 10–30 min+ videos with retention-focused pacing and narrative structure."},
    {"name": "Shorts Editor", "category": "Production", "description": "Edits punchy vertical Shorts, Reels, and TikToks built for the first three seconds."},
    {"name": "Podcast Producer", "category": "Production", "description": "Produces and edits podcast episodes, clips, and show notes end to end."},
    {"name": "Audio Engineer", "category": "Production", "description": "Cleans, mixes, and masters dialogue, music, and sound for video and audio."},
    {"name": "Videographer", "category": "Production", "description": "Shoots and directs on-camera footage for creators and brands."},
    # Design
    {"name": "Thumbnail Designer", "category": "Design", "description": "Designs clickable thumbnails that improve CTR and content packaging."},
    {"name": "Graphic Designer", "category": "Design", "description": "Creates channel art, overlays, and visual assets across a creator's brand."},
    {"name": "Motion Designer", "category": "Design", "description": "Builds animated graphics, lower-thirds, and motion sequences."},
    {"name": "Brand Designer", "category": "Design", "description": "Shapes logos, color, and visual identity for creators and small brands."},
    {"name": "Illustrator", "category": "Design", "description": "Draws custom illustrations, characters, and assets for content."},
    # Writing
    {"name": "Scriptwriter", "category": "Writing", "description": "Writes hooks, outlines, and full scripts for creator-led video formats."},
    {"name": "Copywriter", "category": "Writing", "description": "Writes titles, descriptions, captions, and sales copy that converts."},
    {"name": "Newsletter Writer", "category": "Writing", "description": "Writes and ships recurring newsletters that grow and retain an audience."},
    # Strategy / growth
    {"name": "Content Strategist", "category": "Strategy", "description": "Plans content calendars, formats, and positioning around audience goals."},
    {"name": "SEO Specialist", "category": "Growth", "description": "Optimizes titles, tags, and metadata to grow discovery and search traffic."},
    {"name": "Social Media Manager", "category": "Growth", "description": "Runs day-to-day posting, repurposing, and community across platforms."},
    {"name": "Paid Ads Specialist", "category": "Growth", "description": "Plans and runs paid campaigns to grow reach, leads, and revenue."},
    # Management
    {"name": "Channel Manager", "category": "Management", "description": "Owns the operating cadence of a channel: pipeline, scheduling, and QA."},
    {"name": "Community Manager", "category": "Management", "description": "Builds and moderates community across comments, Discord, and DMs."},
    {"name": "Project Manager", "category": "Management", "description": "Coordinates creators, freelancers, and deadlines to ship on time."},
    # Other creator-native roles
    {"name": "UGC Creator", "category": "Production", "description": "Creates authentic user-generated content and product videos for brands."},
    {"name": "Animator", "category": "Production", "description": "Produces 2D/3D animation and explainer sequences for content."},
    {"name": "Researcher", "category": "Strategy", "description": "Researches topics, sources, and evidence for creator-led content."},
    {"name": "Voice Over Artist", "category": "Production", "description": "Records polished narration and character voice work for creator content."},
    {"name": "Other Creator Role", "category": "Other", "description": "A creator-economy role not yet represented in the catalog."},
]


def seeded_roles() -> list[dict[str, object]]:
    return [{"id": role_seed_id(item["name"]), **item} for item in ROLE_CATALOG]
