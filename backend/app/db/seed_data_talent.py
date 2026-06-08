from __future__ import annotations

import uuid
from typing import TypedDict

SEED_NAMESPACE = uuid.UUID("58d5dd38-8158-4356-9f66-7d85c646bd8d")


def _stable_uuid(seed_key: str) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, seed_key)


class RawSeedTalent(TypedDict):
    seed_key: str
    display_name: str
    username: str
    title: str
    primary_role: str
    roles: list[str]
    niche: str
    formats: list[str]
    platforms: list[str]
    tools: list[str]
    work_mode: str
    location: str
    timezone: str
    availability_status: str
    experience_level: str
    rate_min: int
    rate_max: int
    rate_currency: str
    rate_note: str
    open_slots: int
    turnaround: str
    description: str
    is_featured: bool


RAW_SEED_TALENT: list[RawSeedTalent] = [
    {
        "seed_key": "talent_01",
        "display_name": "Maya Rivera",
        "username": "maya-rivera",
        "title": "Retention-focused YouTube editor for education channels",
        "primary_role": "Video editor",
        "roles": ["Video editor", "Long-form editor"],
        "niche": "Education",
        "formats": ["Long-form", "Explainers"],
        "platforms": ["YouTube"],
        "tools": ["Premiere Pro", "After Effects", "Frame.io"],
        "work_mode": "remote",
        "location": "Austin, TX",
        "timezone": "CT",
        "availability_status": "available",
        "experience_level": "Senior",
        "rate_min": 20000,
        "rate_max": 60000,
        "rate_currency": "INR",
        "rate_note": "₹20,000 per long-form video",
        "open_slots": 2,
        "turnaround": "5-7 days",
        "description": "Edits scripted creator videos with clean pacing, retention graphs, and calm motion systems.",
        "is_featured": True,
    },
    {
        "seed_key": "talent_02",
        "display_name": "Arjun Mehta",
        "username": "arjun-mehta",
        "title": "Shorts editor for fast creator teams",
        "primary_role": "Shorts editor",
        "roles": ["Shorts editor", "Social media editor"],
        "niche": "Startups",
        "formats": ["Shorts", "Reels", "TikTok"],
        "platforms": ["YouTube", "Instagram", "TikTok"],
        "tools": ["CapCut", "Premiere Pro", "Descript"],
        "work_mode": "remote",
        "location": "Bengaluru, India",
        "timezone": "IST",
        "availability_status": "selective",
        "experience_level": "Mid-level",
        "rate_min": 3000,
        "rate_max": 9000,
        "rate_currency": "INR",
        "rate_note": "₹3,000 per short",
        "open_slots": 3,
        "turnaround": "24-48 hours",
        "description": "Cuts short-form clips with tight hooks, captions, and platform-native pacing.",
        "is_featured": True,
    },
    {
        "seed_key": "talent_03",
        "display_name": "Nora Chen",
        "username": "nora-chen",
        "title": "Thumbnail designer for high-volume YouTube channels",
        "primary_role": "Thumbnail designer",
        "roles": ["Thumbnail designer", "Visual designer"],
        "niche": "Tech",
        "formats": ["Thumbnails", "A/B concepts"],
        "platforms": ["YouTube"],
        "tools": ["Photoshop", "Figma", "Midjourney"],
        "work_mode": "remote",
        "location": "Toronto, Canada",
        "timezone": "ET",
        "availability_status": "available",
        "experience_level": "Senior",
        "rate_min": 1500,
        "rate_max": 5000,
        "rate_currency": "INR",
        "rate_note": "₹1,500 per thumbnail",
        "open_slots": 4,
        "turnaround": "1-2 days",
        "description": "Builds thumbnail concepts with readable composition, creator likenesses, and CTR testing notes.",
        "is_featured": False,
    },
    {
        "seed_key": "talent_04",
        "display_name": "Diego Santos",
        "username": "diego-santos",
        "title": "Scriptwriter for finance and business explainers",
        "primary_role": "Scriptwriter",
        "roles": ["Scriptwriter", "Researcher"],
        "niche": "Finance",
        "formats": ["Long-form", "Explainers"],
        "platforms": ["YouTube", "Newsletter"],
        "tools": ["Notion", "Google Docs", "Perplexity"],
        "work_mode": "remote",
        "location": "Mexico City, Mexico",
        "timezone": "CT",
        "availability_status": "selective",
        "experience_level": "Senior",
        "rate_min": 8000,
        "rate_max": 30000,
        "rate_currency": "INR",
        "rate_note": "₹8,000 per script",
        "open_slots": 1,
        "turnaround": "7-10 days",
        "description": "Turns dense business topics into structured, sourced creator scripts.",
        "is_featured": False,
    },
    {
        "seed_key": "talent_05",
        "display_name": "Aisha Khan",
        "username": "aisha-khan",
        "title": "Motion designer for explainers and launch videos",
        "primary_role": "Motion designer",
        "roles": ["Motion designer", "Animator"],
        "niche": "SaaS",
        "formats": ["Launch videos", "Explainers", "Templates"],
        "platforms": ["YouTube", "LinkedIn"],
        "tools": ["After Effects", "Illustrator", "Lottie"],
        "work_mode": "remote",
        "location": "London, UK",
        "timezone": "GMT",
        "availability_status": "available",
        "experience_level": "Senior",
        "rate_min": 12000,
        "rate_max": 70000,
        "rate_currency": "INR",
        "rate_note": "₹12,000 per project",
        "open_slots": 2,
        "turnaround": "1-3 weeks",
        "description": "Creates restrained motion systems, callouts, and product-story visuals.",
        "is_featured": True,
    },
    {
        "seed_key": "talent_06",
        "display_name": "Luca Rossi",
        "username": "luca-rossi",
        "title": "Podcast producer for creator-led interview shows",
        "primary_role": "Podcast producer",
        "roles": ["Podcast producer", "Audio editor"],
        "niche": "Founder interviews",
        "formats": ["Podcast", "Clips", "Show notes"],
        "platforms": ["Spotify", "YouTube", "Apple Podcasts"],
        "tools": ["Descript", "Audition", "Riverside"],
        "work_mode": "remote",
        "location": "Milan, Italy",
        "timezone": "CET",
        "availability_status": "available",
        "experience_level": "Mid-level",
        "rate_min": 18000,
        "rate_max": 60000,
        "rate_currency": "INR",
        "rate_note": "₹18,000 per episode",
        "open_slots": 3,
        "turnaround": "3-5 days",
        "description": "Handles audio cleanup, episode assembly, clips, and publishing handoff.",
        "is_featured": False,
    },
    {
        "seed_key": "talent_07",
        "display_name": "Zoe Williams",
        "username": "zoe-williams",
        "title": "Community manager for creator memberships",
        "primary_role": "Community manager",
        "roles": ["Community manager", "Moderator"],
        "niche": "Creator communities",
        "formats": ["Discord", "Membership", "Live events"],
        "platforms": ["Discord", "Patreon", "YouTube"],
        "tools": ["Discord", "Circle", "Notion"],
        "work_mode": "remote",
        "location": "Portland, OR",
        "timezone": "PT",
        "availability_status": "selective",
        "experience_level": "Mid-level",
        "rate_min": 50000,
        "rate_max": 120000,
        "rate_currency": "INR",
        "rate_note": "₹80,000 monthly",
        "open_slots": 1,
        "turnaround": "Ongoing",
        "description": "Builds calm community systems, moderation workflows, and member engagement loops.",
        "is_featured": False,
    },
    {
        "seed_key": "talent_08",
        "display_name": "Kenji Mori",
        "username": "kenji-mori",
        "title": "Content strategist for YouTube growth systems",
        "primary_role": "Content strategist",
        "roles": ["Content strategist", "Channel manager"],
        "niche": "YouTube growth",
        "formats": ["Strategy", "Content calendar", "Analytics"],
        "platforms": ["YouTube"],
        "tools": ["YouTube Studio", "Notion", "vidIQ"],
        "work_mode": "remote",
        "location": "Tokyo, Japan",
        "timezone": "JST",
        "availability_status": "available",
        "experience_level": "Senior",
        "rate_min": 1000,
        "rate_max": 3000,
        "rate_currency": "INR",
        "rate_note": "₹1,000/hr",
        "open_slots": 2,
        "turnaround": "Weekly planning",
        "description": "Plans packaging, topic selection, and performance reviews for creator channels.",
        "is_featured": True,
    },
]


ROLE_VARIANTS = [
    ("UGC creator", "Beauty", ["UGC", "Reels"], ["Instagram", "TikTok"], ["CapCut", "Canva"]),
    ("Channel manager", "Gaming", ["Long-form", "Livestream clips"], ["YouTube", "Twitch"], ["YouTube Studio", "Notion"]),
    ("Brand partnerships manager", "Lifestyle", ["Sponsorships", "Media kit"], ["Instagram", "YouTube"], ["HubSpot", "Google Sheets"]),
    ("Social media editor", "Fitness", ["Shorts", "Reels"], ["Instagram", "TikTok"], ["CapCut", "Premiere Pro"]),
    ("Researcher", "Science", ["Explainers", "Briefs"], ["YouTube", "Newsletter"], ["Notion", "Google Docs"]),
    ("Newsletter editor", "Creator business", ["Newsletter", "Threads"], ["Substack", "LinkedIn"], ["Substack", "Figma"]),
    ("Producer", "Documentary", ["Pre-production", "Story"], ["YouTube"], ["Airtable", "Frame.io"]),
    ("Designer", "Personal brand", ["Carousels", "Templates"], ["Instagram", "LinkedIn"], ["Figma", "Photoshop"]),
    ("Video editor", "Travel", ["Vlogs", "Shorts"], ["YouTube", "Instagram"], ["Final Cut Pro", "CapCut"]),
    ("Scriptwriter", "History", ["Long-form", "Narrative"], ["YouTube"], ["Google Docs", "Notion"]),
    ("Thumbnail designer", "Gaming", ["Thumbnails", "Packaging"], ["YouTube"], ["Photoshop", "Figma"]),
    ("Podcast producer", "Business", ["Podcast", "Clips"], ["Spotify", "YouTube"], ["Descript", "Riverside"]),
    ("Motion designer", "Education", ["Explainers", "Callouts"], ["YouTube", "LinkedIn"], ["After Effects", "Illustrator"]),
    ("UGC creator", "Food", ["UGC", "Shorts"], ["TikTok", "Instagram"], ["CapCut", "iPhone"]),
    ("Content strategist", "Finance", ["Strategy", "Packaging"], ["YouTube"], ["YouTube Studio", "Notion"]),
    ("Community manager", "Tech communities", ["Discord", "Events"], ["Discord", "YouTube"], ["Discord", "Circle"]),
]

LOCATIONS = [
    ("Los Angeles, CA", "PT"),
    ("New York, NY", "ET"),
    ("Delhi, India", "IST"),
    ("Berlin, Germany", "CET"),
    ("Singapore", "SGT"),
    ("Sydney, Australia", "AET"),
]


def _inr_rate_for_role(role: str) -> tuple[int, int, str]:
    role_lower = role.lower()
    if "thumbnail" in role_lower:
        return 1500, 5000, "₹1,500 per thumbnail"
    if "short" in role_lower or "social media editor" in role_lower:
        return 3000, 12000, "₹3,000 per short"
    if "script" in role_lower or "newsletter" in role_lower or "researcher" in role_lower:
        return 8000, 30000, "₹8,000 per script"
    if "motion" in role_lower or "designer" in role_lower:
        return 12000, 70000, "₹12,000 per project"
    if "podcast" in role_lower:
        return 18000, 60000, "₹18,000 per episode"
    if "channel manager" in role_lower or "community manager" in role_lower:
        return 50000, 120000, "₹80,000 monthly"
    if "strategist" in role_lower or "partnerships" in role_lower or "producer" in role_lower:
        return 1000, 3000, "₹1,000/hr"
    if "ugc" in role_lower:
        return 15000, 45000, "₹15,000 per video"
    if "editor" in role_lower:
        return 20000, 60000, "₹20,000 per long-form video"
    return 12000, 50000, "₹20,000 per project"


def generated_seed_talent() -> list[RawSeedTalent]:
    records = list(RAW_SEED_TALENT)
    for index, (role, niche, formats, platforms, tools) in enumerate(ROLE_VARIANTS, start=9):
        location, timezone = LOCATIONS[index % len(LOCATIONS)]
        rate_min, rate_max, rate_note = _inr_rate_for_role(role)
        records.append(
            {
                "seed_key": f"talent_{index:02d}",
                "display_name": f"Creator Talent {index:02d}",
                "username": f"creator-talent-{index:02d}",
                "title": f"{role} for {niche.lower()} creators",
                "primary_role": role,
                "roles": [role],
                "niche": niche,
                "formats": formats,
                "platforms": platforms,
                "tools": tools,
                "work_mode": "remote",
                "location": location,
                "timezone": timezone,
                "availability_status": "available" if index % 3 else "selective",
                "experience_level": "Mid-level" if index % 2 else "Senior",
                "rate_min": rate_min,
                "rate_max": rate_max,
                "rate_currency": "INR",
                "rate_note": rate_note,
                "open_slots": 1 + (index % 3),
                "turnaround": "3-7 days",
                "description": f"Available for focused {niche.lower()} creator work with clear process and async collaboration.",
                "is_featured": index % 5 == 0,
            }
        )
    return records


SEEDED_TALENT_USERS = [
    {
        "id": _stable_uuid(f"user_{item['seed_key']}"),
        "email": f"{item['username']}@seed.creatorjobs.local",
        "username": item["username"],
        "display_name": item["display_name"],
        "headline": item["title"],
        "availability_status": item["availability_status"],
        "location": item["location"],
        "timezone": item["timezone"],
        "skills": item["roles"],
        "account_type": "TALENT",
        "onboarding_intent": "LOOKING_FOR_WORK",
    }
    for item in generated_seed_talent()
]

SEEDED_TALENT_LISTINGS = [
    {
        "id": _stable_uuid(item["seed_key"]),
        "owner_user_id": _stable_uuid(f"user_{item['seed_key']}"),
        "title": item["title"],
        "primary_role": item["primary_role"],
        "experience_level": item["experience_level"],
        "roles": item["roles"],
        "niche": item["niche"],
        "formats": item["formats"],
        "platforms": item["platforms"],
        "tools": item["tools"],
        "work_mode": item["work_mode"],
        "location": item["location"],
        "timezone": item["timezone"],
        "availability_status": item["availability_status"],
        "rate_min": item["rate_min"],
        "rate_max": item["rate_max"],
        "rate_currency": item["rate_currency"],
        "rate_note": item["rate_note"],
        "open_slots": item["open_slots"],
        "turnaround": item["turnaround"],
        "description": item["description"],
        "portfolio_item_ids": [],
        "status": "published",
        "is_featured": item["is_featured"],
    }
    for item in generated_seed_talent()
]
