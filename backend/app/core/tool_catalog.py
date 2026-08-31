from __future__ import annotations

import re
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ToolCatalogEntry:
    key: str
    name: str
    aliases: tuple[str, ...]
    logo_key: str
    category: str

    def as_response(self) -> dict:
        data = asdict(self)
        data["aliases"] = list(self.aliases)
        return data


def tool(
    name: str,
    category: str,
    logo_key: str,
    *aliases: str,
) -> ToolCatalogEntry:
    return ToolCatalogEntry(
        key=logo_key,
        name=name,
        aliases=tuple(aliases),
        logo_key=logo_key,
        category=category,
    )


TOOL_CATALOG: tuple[ToolCatalogEntry, ...] = (
    tool("Adobe Premiere Pro", "Video editing", "premiere-pro", "Premiere", "Premiere Pro", "Adobe Premiere"),
    tool("Final Cut Pro", "Video editing", "final-cut-pro", "FCP", "Final Cut"),
    tool("DaVinci Resolve", "Video editing", "davinci-resolve", "DaVinci", "Resolve"),
    tool("CapCut", "Video editing", "capcut", "Cap Cut"),
    tool("iMovie", "Video editing", "imovie"),
    tool("Vegas Pro", "Video editing", "vegas-pro", "Sony Vegas", "Vegas"),
    tool("Adobe After Effects", "Motion / VFX", "after-effects", "After Effects", "AE", "Adobe AE"),
    tool("Blender", "Motion / VFX", "blender"),
    tool("Cinema 4D", "Motion / VFX", "cinema-4d"),
    tool("Unreal Engine", "Motion / VFX", "unreal-engine", "Unreal"),
    tool("Motion", "Motion / VFX", "motion", "Apple Motion"),
    tool("Adobe Photoshop", "Design / thumbnails", "photoshop", "Photoshop", "Adobe PS", "PS"),
    tool("Adobe Illustrator", "Design / thumbnails", "illustrator", "Illustrator", "Adobe AI", "AI"),
    tool("Adobe Lightroom", "Design / thumbnails", "lightroom", "Lightroom"),
    tool("Canva", "Design / thumbnails", "canva"),
    tool("Figma", "Design / thumbnails", "figma"),
    tool("Sketch", "Design / thumbnails", "sketch"),
    tool("Photopea", "Design / thumbnails", "photopea"),
    tool("Adobe Audition", "Audio / podcast", "audition", "Audition"),
    tool("Audacity", "Audio / podcast", "audacity"),
    tool("Descript", "Audio / podcast", "descript"),
    tool("GarageBand", "Audio / podcast", "garageband", "Garage Band"),
    tool("Logic Pro", "Audio / podcast", "logic-pro"),
    tool("Riverside", "Audio / podcast", "riverside"),
    tool("Podcastle", "Audio / podcast", "podcastle"),
    tool("YouTube Studio", "Creator/platform tools", "youtube-studio", "YT Studio", "YouTube Creator Studio"),
    tool("Instagram", "Creator/platform tools", "instagram", "IG"),
    tool("TikTok", "Creator/platform tools", "tiktok", "Tik Tok"),
    tool("Twitch", "Creator/platform tools", "twitch"),
    tool("LinkedIn", "Creator/platform tools", "linkedin"),
    tool("X / Twitter", "Creator/platform tools", "x-twitter", "X", "Twitter"),
    tool("Meta Business Suite", "Creator/platform tools", "meta-business-suite", "Meta Suite", "Facebook Business Suite"),
    tool("Creator Studio", "Creator/platform tools", "creator-studio"),
    tool("Notion", "Content/research/planning", "notion"),
    tool("Google Docs", "Content/research/planning", "google-docs", "Docs"),
    tool("Google Sheets", "Content/research/planning", "google-sheets", "Sheets"),
    tool("Google Drive", "Content/research/planning", "google-drive", "Drive"),
    tool("Airtable", "Content/research/planning", "airtable"),
    tool("Trello", "Content/research/planning", "trello"),
    tool("Asana", "Content/research/planning", "asana"),
    tool("Monday.com", "Content/research/planning", "monday", "Monday"),
    tool("ClickUp", "Content/research/planning", "clickup", "Click Up"),
    tool("Buffer", "Social scheduling/analytics", "buffer"),
    tool("Hootsuite", "Social scheduling/analytics", "hootsuite"),
    tool("Later", "Social scheduling/analytics", "later"),
    tool("Sprout Social", "Social scheduling/analytics", "sprout-social"),
    tool("Metricool", "Social scheduling/analytics", "metricool"),
    tool("TubeBuddy", "Social scheduling/analytics", "tubebuddy", "Tube Buddy"),
    tool("VidIQ", "Social scheduling/analytics", "vidiq", "vidIQ"),
    tool("Google Analytics", "Social scheduling/analytics", "google-analytics", "GA4", "Analytics"),
    tool("Frame.io", "Collaboration/review", "frame-io", "Frameio", "Frame IO"),
    tool("Slack", "Collaboration/review", "slack"),
    tool("Discord", "Collaboration/review", "discord"),
    tool("Zoom", "Collaboration/review", "zoom"),
    tool("Loom", "Collaboration/review", "loom"),
    tool("Midjourney", "AI / automation", "midjourney"),
    tool("Perplexity", "AI / automation", "perplexity"),
    tool("Runway", "AI / automation", "runway"),
    tool("ElevenLabs", "AI / automation", "elevenlabs", "Eleven Labs"),
    tool("ChatGPT", "AI / automation", "chatgpt", "GPT", "OpenAI"),
    tool("Claude", "AI / automation", "claude"),
)

_TOOLS_BY_KEY = {entry.key: entry for entry in TOOL_CATALOG}
if len(_TOOLS_BY_KEY) != len(TOOL_CATALOG):
    raise RuntimeError("Tool catalog keys must be unique")


def _normalize_lookup(value: str) -> str:
    normalized = value.strip().lower().replace("&", "and").replace("+", " plus ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", normalized).split())


_TOOLS_BY_LOOKUP: dict[str, ToolCatalogEntry] = {}
for _entry in TOOL_CATALOG:
    for _value in (_entry.key, _entry.name, *_entry.aliases):
        _TOOLS_BY_LOOKUP[_normalize_lookup(_value)] = _entry


def find_tool(value: str) -> ToolCatalogEntry | None:
    return _TOOLS_BY_LOOKUP.get(_normalize_lookup(value))


def find_tool_by_key(key: str) -> ToolCatalogEntry | None:
    return _TOOLS_BY_KEY.get(key.strip().lower())


def tool_display_names(keys: list[str] | None) -> list[str] | None:
    if keys is None:
        return None
    return [(entry.name if (entry := find_tool_by_key(key)) else key) for key in keys]


def list_tool_catalog() -> list[dict]:
    return [entry.as_response() for entry in TOOL_CATALOG]
