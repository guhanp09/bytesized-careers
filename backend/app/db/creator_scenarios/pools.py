"""Named pools of realistic creator-economy content.

One canonical spelling per value. `normalizePlatform` in the frontend would
happily turn "Youtube" into "YouTube", but a pool that emitted three spellings
would make every filter offer three options for one platform and make the
coverage tests meaningless. Deliberate variants live only in the edge scenario,
where testing normalisation is the point.

Values match the vocabularies Phase 3's filters and the backend's own taxonomy
expect, so a generated record is filterable the moment it is restored.
"""

from __future__ import annotations

# --- roles ------------------------------------------------------------------

ROLES: tuple[str, ...] = (
    "Shorts editor",
    "Long-form editor",
    "Thumbnail designer",
    "Channel manager",
    "Scriptwriter",
    "Podcast producer",
    "Motion-graphics artist",
    "Colorist",
    "Subtitler / translator",
    "Community manager",
    "UGC creator",
    "Brand-deal manager",
)

# --- platforms and formats --------------------------------------------------
#
# Platform keys are the backend's canonical lowercase values; the frontend
# projection turns them into brand spellings. Formats are already prose in the
# canonical taxonomy, so they are stored as written.

PLATFORMS: tuple[str, ...] = (
    "youtube",
    "youtube_shorts",
    "tiktok",
    "instagram_reels",
    "twitch",
    "podcast",
    "multi_platform",
)

FORMATS: tuple[str, ...] = (
    "Long-form video",
    "Shorts/Reels",
    "Thumbnails",
    "Scripts",
    "Hooks",
    "Voice-over",
    "Motion graphics",
    "Captions",
    "Repurposed clips",
    "Channel research",
    "Content strategy",
    "Podcast editing",
    "Social posts",
    "YouTube packaging",
    "Ad creatives",
)

#: Which formats plausibly belong to which platform, so a generated job does not
#: ask for "Podcast editing" on TikTok. Realism here is not decoration: a
#: nonsense pairing makes the creator filters look broken during QA.
PLATFORM_FORMATS: dict[str, tuple[str, ...]] = {
    "youtube": ("Long-form video", "Thumbnails", "Scripts", "YouTube packaging", "Captions"),
    "youtube_shorts": ("Shorts/Reels", "Hooks", "Repurposed clips", "Captions"),
    "tiktok": ("Shorts/Reels", "Hooks", "Ad creatives", "Repurposed clips"),
    "instagram_reels": ("Shorts/Reels", "Social posts", "Ad creatives", "Motion graphics"),
    "twitch": ("Repurposed clips", "Channel research", "Community management"),
    "podcast": ("Podcast editing", "Voice-over", "Captions", "Scripts"),
    "multi_platform": ("Content strategy", "Channel research", "Social posts"),
}

NICHES: tuple[str, ...] = (
    "Fitness",
    "Finance",
    "Gaming",
    "Beauty",
    "Technology",
    "Food",
    "Travel",
    "Education",
    "Comedy",
    "True crime",
    "Kids",
)

# --- commercial -------------------------------------------------------------
#
# (unit, currency, minimum, maximum). Currencies are never converted anywhere in
# the system, so the pool carries genuinely different ones and the display layer
# has to cope.

COMMERCIAL_STRUCTURES: tuple[tuple[str, str, float, float | None], ...] = (
    ("per video", "INR", 1_500, 4_000),
    ("per video", "INR", 2_500, None),
    ("per project", "INR", 8_000, 25_000),
    ("per project", "EUR", 800, None),
    ("per month", "INR", 35_000, 60_000),
    ("per month", "USD", 900, None),
    ("per hour", "USD", 25, 45),
    ("per short", "INR", 700, 1_200),
    ("per thumbnail", "INR", 900, None),
    ("commission", "INR", 0, None),  # revenue share
)

#: Kept out of the ordinary rotation. Unpaid work is seeded only where a
#: scenario explicitly wants it, so it can never look like an ordinary rate.
UNPAID_STRUCTURE = ("unpaid", "INR", 0, None)

# --- turnaround -------------------------------------------------------------
#
# (value, unit, basis). Spans every bucket the Phase 3 filter offers, including
# the "flexible"/unspecified case represented as a null triple.

TURNAROUNDS: tuple[tuple[int | None, str | None, str | None], ...] = (
    (8, "hours", "final_delivery"),          # same day
    (24, "hours", "final_delivery"),         # 24 hours
    (2, "calendar_days", "first_draft"),     # 2-3 days
    (3, "business_days", "first_draft"),     # 2-3 days
    (5, "calendar_days", "final_delivery"),  # within a week
    (1, "weeks", "first_draft"),             # within a week
    (2, "weeks", "final_delivery"),          # 1-2 weeks
    (None, None, None),                      # flexible / unspecified
)

# --- places -----------------------------------------------------------------
#
# (label, utc_offset_minutes). The half-hour offsets are the point: a system
# that assumes whole hours is wrong for all of India by thirty minutes, and
# quietly so.

LOCATIONS: tuple[tuple[str, int], ...] = (
    ("Remote", 0),
    ("Mumbai, India", 330),
    ("Bengaluru, India", 330),
    ("Delhi NCR, India", 330),
    ("Hyderabad, India", 330),
    ("Indore, India", 330),
    ("Kochi, India", 330),
    ("Guwahati, India", 330),
    ("Kathmandu, Nepal", 345),   # +05:45 — not even a half hour
    ("London, UK", 0),
    ("Berlin, Germany", 60),
    ("Austin, USA", -300),
    ("Toronto, Canada", -240),
    ("Adelaide, Australia", 570),  # +09:30
)

WORK_MODES: tuple[str, ...] = ("Remote", "Hybrid", "On-site")

# --- identities -------------------------------------------------------------

EMPLOYER_KINDS: tuple[str, ...] = ("creator", "agency", "studio", "brand", "production_house")

#: (handle, display name, kind, subscribers, cadence). Cadence is supplied here
#: because a channel genuinely publishes on a rhythm — it is never inferred from
#: posting history, which would be a guess presented as a fact.
CHANNELS: tuple[tuple[str, str, str, int, str | None], ...] = (
    ("financesimplified", "Finance Simplified", "creator", 412_000, "2 videos/week"),
    ("dailyfit", "Daily Fit", "creator", 96_000, "5 shorts/week"),
    ("techunpacked", "Tech Unpacked", "agency", 1_300_000, "3 videos/week"),
    ("gyaanexpress", "Gyaan Express", "creator", 228_000, "1 video/week"),
    ("moneywiseindia", "Moneywise India", "creator", 54_000, "2 videos/month"),
    ("plateandpan", "Plate & Pan", "studio", 780_000, "4 videos/week"),
    ("routeunknown", "Route Unknown", "creator", 31_000, None),
    ("pixelforge", "Pixelforge Studio", "production_house", 2_400_000, "daily"),
    ("brightbrand", "Bright Brand Co", "brand", 8_900, None),
    ("casefiles", "Case Files Weekly", "creator", 615_000, "1 video/week"),
)

# --- people -----------------------------------------------------------------

FIRST_NAMES: tuple[str, ...] = (
    "Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Meera", "Karan", "Divya",
    "Arjun", "Sneha", "Ishaan", "Nisha", "Rahul", "Kavya", "Dev", "Riya",
    "Aditya", "Tara", "Nikhil", "Pooja", "Sameer", "Anjali", "Varun", "Leela",
    "Imran", "Fatima", "Joseph", "Grace", "Daniel", "Maya",
)

LAST_NAMES: tuple[str, ...] = (
    "Mehta", "Nair", "Sharma", "Iyer", "Bose", "Kapoor", "Verma", "Reddy",
    "Shah", "Patel", "Khan", "Rao", "Menon", "Gupta", "Chopra", "Das",
    "Bhatt", "Joshi", "Pillai", "Sinha",
)

#: Names that break naive layout and identity handling. Only the edge scenario
#: uses these, and each is here for a specific failure it provokes.
EDGE_NAMES: tuple[tuple[str, str], ...] = (
    ("Prince", "single-word display name"),
    (
        "Bartholomew Maximilian Featherstonehaugh-Wetherby III",
        "very long name, tests truncation everywhere it appears",
    ),
    ("Zoë Ångström-Muñoz", "diacritics"),
    ("张伟", "non-Latin script"),
    ("مروة الأحمد", "right-to-left script"),
    ("Ravi 🎬 Kumar", "emoji inside a display name"),
    ("Priya Nair", "deliberate duplicate of a common name, twice in one pipeline"),
)

#: Messages chosen to break message rendering rather than to read naturally.
EDGE_MESSAGES: tuple[tuple[str, str], ...] = (
    ("Ok", "one-word reply"),
    ("🎬🔥💯", "emoji-only message"),
    (
        "Here's the full breakdown of what I'd change: " + ("the pacing in the first ninety seconds is the "
        "single biggest lever — the hook currently lands at 0:14 and the payoff at 1:50, which is where the "
        "retention graph falls off a cliff. I'd cut the channel intro entirely, move the strongest visual to "
        "the cold open, and compress the setup by about forty seconds. ") * 6,
        "very long message, tests wrapping and clamping",
    ),
    (
        "Reference for the pacing I mean: https://www.youtube.com/watch?v=dQw4w9WgXcQ and the caption style "
        "from https://www.youtube.com/watch?v=9bZkp7q19f0",
        "message carrying links",
    ),
)

# --- copy -------------------------------------------------------------------
#
# Bulk-generated conversations still have to read like people talking. These are
# fragments the generator assembles; the ten hero journeys in heroes.py are
# hand-authored end to end.

APPLICANT_OPENERS: tuple[str, ...] = (
    "Hi — I edit in this niche already, so I can match your pacing from the first video.",
    "I've attached two recent edits that are closest to what you're describing.",
    "Happy to start with a paid test edit on last week's upload if that's easier to judge.",
    "I work with two other creator-led channels on a weekly cadence, so the turnaround is realistic for me.",
    "Your retention drop-off looks like a hook problem more than a pacing one — I'd start there.",
    "I can take the whole workflow from raw files to upload-ready, including captions and thumbnails.",
)

RECRUITER_OPENERS: tuple[str, ...] = (
    "Hi — I came across your work and think you'd fit a series we're planning.",
    "We're expanding to two uploads a week and need someone reliable on the edit.",
    "Your thumbnail work is close to the direction we're moving in. Are you taking new clients?",
    "We have a backlog of raw footage and need help getting it upload-ready.",
)

RECRUITER_FOLLOWUPS: tuple[str, ...] = (
    "Could you share one example where you rebuilt the structure rather than just trimming?",
    "What does your turnaround look like if we send files on a Monday?",
    "Do you handle captions and thumbnails as well, or edit only?",
    "What would you charge for a four-video batch?",
)

TALENT_FOLLOWUPS: tuple[str, ...] = (
    "Yes — the second link is exactly that, the original was twelve minutes and we cut it to eight.",
    "Monday files means first draft by Thursday, final by Friday.",
    "I do both, though thumbnails are usually a separate line item.",
    "For a batch of four I'd do a slightly lower per-video rate.",
)

PORTFOLIO_TITLES: tuple[str, ...] = (
    "Retention rebuild — market explainer",
    "Series packaging — education channel",
    "Cold open reshoot — fitness channel",
    "Thumbnail A/B set — finance",
    "Hook pass — 12 shorts",
    "Documentary-style deep dive",
    "Sponsor integration cutdown",
    "Podcast highlight reel",
    "Motion titles system",
    "Caption + sound design pass",
    "Channel trailer",
    "Weekly recap format",
    "Gaming montage — 8 minute",
    "Recipe short — vertical",
    "Travel vlog restructure",
    "Brand spot — 30s cutdown",
    "Explainer with data callouts",
    "Interview multicam edit",
    "Shorts batch — 15 clips",
    "Colour grade — travel series",
    "Translation + subtitle pass",
    "Community update video",
)

PORTFOLIO_ROLES: tuple[str, ...] = (
    "Lead editor",
    "Edit rebuild, hook rewrite",
    "Motion graphics, template system",
    "Colour and sound",
    "Thumbnail concepting and design",
    "Script and structure",
    "Captions and localisation",
)
