from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Final

from app.core.job_domain_taxonomy import SKILL_KEYS
from app.core.tool_catalog import TOOL_CATALOG


@dataclass(frozen=True)
class SearchAlias:
    key: str
    label: str
    aliases: tuple[str, ...]


def normalize_search_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"[^\w\s+#₹./-]", " ", normalized)
    return " ".join(normalized.replace("_", " ").split())


ROLE_ALIASES: Final[tuple[SearchAlias, ...]] = (
    SearchAlias("video-editor", "Video Editor", ("video editor", "video editing", "long form editor", "long-form editor", "editor")),
    SearchAlias("shorts-editor", "Shorts Editor", ("shorts editor", "reels editor", "short form editor", "short-form editor", "clip editor")),
    SearchAlias("thumbnail-designer", "Thumbnail Designer", ("thumbnail designer", "thumbnail artist", "thumbnail")),
    SearchAlias("graphic-designer", "Graphic Designer", ("graphic designer", "graphics designer", "brand designer")),
    SearchAlias("motion-designer", "Motion Designer", ("motion designer", "motion graphics artist", "animator", "mograph")),
    SearchAlias("script-writer", "Script Writer", ("script writer", "scriptwriter", "content writer", "copywriter")),
    SearchAlias("researcher", "Researcher", ("researcher", "content researcher", "research assistant")),
    SearchAlias("channel-manager", "Channel Manager", ("channel manager", "youtube manager", "channel operations", "channel ops")),
    SearchAlias("social-media-manager", "Social Media Manager", ("social media manager", "social manager", "community manager", "smm")),
    SearchAlias("content-strategist", "Content Strategist", ("content strategist", "creator strategist", "growth strategist", "content strategy")),
    SearchAlias("voice-over-artist", "Voice Over Artist", ("voice over artist", "voiceover artist", "voice over", "narrator")),
    SearchAlias("producer", "Producer", ("creative producer", "video producer", "podcast producer", "producer")),
    SearchAlias("ugc-creator", "UGC Creator", ("ugc creator", "user generated content creator", "ugc")),
    SearchAlias("podcast-editor", "Podcast Editor", ("podcast editor", "podcast editing", "audio editor")),
)

PLATFORM_ALIASES: Final[tuple[SearchAlias, ...]] = (
    SearchAlias("youtube", "YouTube", ("youtube", "you tube", "yt")),
    SearchAlias("instagram", "Instagram", ("instagram", "insta", "ig")),
    SearchAlias("tiktok", "TikTok", ("tiktok", "tik tok")),
    SearchAlias("podcast", "Podcast", ("podcast", "podcasts")),
    SearchAlias("linkedin", "LinkedIn", ("linkedin",)),
    SearchAlias("x-twitter", "X / Twitter", ("twitter", "x")),
)

FORMAT_ALIASES: Final[tuple[SearchAlias, ...]] = (
    SearchAlias("long-form-video", "Long-form video", ("long form video", "long-form video", "longform video", "long form", "long-form", "longform", "talking head", "talking-head")),
    SearchAlias("shorts-reels", "Shorts/Reels", ("short form", "short-form", "shorts", "reels", "vertical video")),
    SearchAlias("thumbnails", "Thumbnails", ("thumbnail", "thumbnails", "youtube packaging", "packaging")),
    SearchAlias("scripts", "Scripts", ("script", "scripts", "scripting")),
    SearchAlias("podcast-editing", "Podcast editing", ("podcast editing", "podcast editor", "audio podcast")),
    SearchAlias("motion-graphics", "Motion graphics", ("motion graphics", "mograph")),
    SearchAlias("captions", "Captions", ("captions", "subtitles", "subs")),
    SearchAlias("ad-creatives", "Ad creatives", ("ad creative", "ad creatives", "ads")),
    SearchAlias("social-posts", "Social posts", ("social posts", "social media posts")),
)

GENRE_ALIASES: Final[tuple[SearchAlias, ...]] = (
    SearchAlias("explainers", "Explainers", ("explainer", "explainers")),
    SearchAlias("tutorials", "Tutorials", ("tutorial", "tutorials", "how to")),
    SearchAlias("reviews", "Reviews", ("review", "reviews")),
    SearchAlias("commentary", "Commentary", ("commentary", "reaction")),
    SearchAlias("interviews", "Interviews", ("interview", "interviews")),
    SearchAlias("vlogs", "Vlogs", ("vlog", "vlogs")),
    SearchAlias("podcasts", "Podcasts", ("podcast", "podcasts")),
    SearchAlias("documentaries", "Documentaries", ("documentary", "documentaries", "docu")),
    SearchAlias("case-studies", "Case studies", ("case study", "case studies")),
    SearchAlias("product-demos", "Product demos", ("product demo", "product demos")),
)

NICHE_ALIASES: Final[tuple[SearchAlias, ...]] = tuple(
    SearchAlias(key, label, aliases)
    for key, label, aliases in (
        ("finance", "Finance", ("finance", "fintech", "money", "investing")),
        ("technology", "Tech", ("tech", "technology")),
        ("gaming", "Gaming", ("gaming", "games")),
        ("education", "Education", ("education", "educational", "learning")),
        ("beauty", "Beauty", ("beauty", "skincare", "makeup")),
        ("fashion", "Fashion", ("fashion",)),
        ("fitness", "Fitness", ("fitness", "workout")),
        ("health", "Health", ("health", "wellness")),
        ("food", "Food", ("food", "cooking")),
        ("travel", "Travel", ("travel",)),
        ("business", "Business", ("business", "startup", "startups")),
        ("sports", "Sports", ("sports",)),
        ("entertainment", "Entertainment", ("entertainment",)),
    )
)

WORK_MODE_ALIASES: Final[tuple[SearchAlias, ...]] = (
    SearchAlias("remote", "Remote", ("remote", "work from home", "wfh", "anywhere")),
    SearchAlias("hybrid", "Hybrid", ("hybrid",)),
    SearchAlias("onsite", "On-site", ("onsite", "on-site", "on site", "in office", "in-office")),
)

ENGAGEMENT_ALIASES: Final[tuple[SearchAlias, ...]] = (
    SearchAlias("one_time_project", "One-time project", ("one time project", "one-time project", "project based")),
    SearchAlias("ongoing_freelance", "Ongoing freelance", ("ongoing freelance", "freelance", "contractor")),
    SearchAlias("retainer", "Retainer", ("retainer", "monthly retainer")),
    SearchAlias("part_time", "Part-time", ("part time", "part-time", "parttime")),
    SearchAlias("full_time", "Full-time", ("full time", "full-time", "fulltime")),
    SearchAlias("fixed_term", "Fixed-term", ("fixed term", "fixed-term")),
    SearchAlias("internship", "Internship", ("internship", "intern")),
)

AVAILABILITY_ALIASES: Final[tuple[SearchAlias, ...]] = (
    SearchAlias("available", "Available now", ("available now", "available", "open for work")),
    SearchAlias("selective", "Selectively available", ("selectively available", "selective")),
)

LOCATION_ALIASES: Final[dict[str, str]] = {
    "bangalore": "Bengaluru",
    "bengaluru": "Bengaluru",
    "blr": "Bengaluru",
    "gurgaon": "Gurugram",
    "gurugram": "Gurugram",
    "bombay": "Mumbai",
    "mumbai": "Mumbai",
    "madras": "Chennai",
    "chennai": "Chennai",
    "delhi": "Delhi",
    "noida": "Noida",
    "hyderabad": "Hyderabad",
    "pune": "Pune",
    "kolkata": "Kolkata",
    "kochi": "Kochi",
    "india": "India",
}

TOOL_ALIASES: Final[tuple[SearchAlias, ...]] = tuple(
    SearchAlias(
        entry.key,
        entry.name,
        tuple(
            dict.fromkeys(
                normalize_search_text(value)
                for value in (entry.name, entry.key, *entry.aliases)
                if normalize_search_text(value)
            )
        ),
    )
    for entry in TOOL_CATALOG
)

_SKILL_LABELS: Final[dict[str, str]] = {
    key: key.replace("_", " ").title() for key in SKILL_KEYS
}
SKILL_ALIASES: Final[tuple[SearchAlias, ...]] = tuple(
    SearchAlias(
        key,
        _SKILL_LABELS[key],
        tuple(
            dict.fromkeys(
                (
                    key.replace("_", " "),
                    _SKILL_LABELS[key].casefold(),
                    *(
                        ("retention editing", "retention")
                        if key == "storytelling"
                        else ("search engine optimization",)
                        if key == "seo"
                        else ()
                    ),
                )
            )
        ),
    )
    for key in SKILL_KEYS
)

STOP_WORDS: Final[frozenset[str]] = frozenset(
    {
        "a",
        "an",
        "and",
        "for",
        "in",
        "of",
        "on",
        "or",
        "the",
        "to",
        "who",
        "with",
        "uses",
        "use",
        "experienced",
        "experience",
        "creator",
        "job",
        "talent",
        "looking",
        "need",
        "wanted",
    }
)
