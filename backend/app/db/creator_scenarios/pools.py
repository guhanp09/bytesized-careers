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
# (handle, name, kind, subscribers, cadence, niche).
#
# The niche belongs to the channel rather than being drawn alongside it. Pulling
# it from a parallel index made every hiring account contradict its own name —
# "Finance Simplified · Fitness" — which is the first thing a reader notices and
# the fastest way to make a whole corpus look fake.
CHANNELS: tuple[tuple[str, str, str, int, str | None, str], ...] = (
    ("financesimplified", "Finance Simplified", "creator", 412_000, "2 videos/week", "Finance"),
    ("dailyfit", "Daily Fit", "creator", 96_000, "5 shorts/week", "Fitness"),
    ("techunpacked", "Tech Unpacked", "agency", 1_300_000, "3 videos/week", "Technology"),
    ("gyaanexpress", "Gyaan Express", "creator", 228_000, "1 video/week", "Education"),
    ("moneywiseindia", "Moneywise India", "creator", 54_000, "2 videos/month", "Finance"),
    ("plateandpan", "Plate & Pan", "studio", 780_000, "4 videos/week", "Food"),
    ("routeunknown", "Route Unknown", "creator", 31_000, None, "Travel"),
    ("pixelforge", "Pixelforge Studio", "production_house", 2_400_000, "daily", "Gaming"),
    ("brightbrand", "Bright Brand Co", "brand", 8_900, None, "Beauty"),
    ("casefiles", "Case Files Weekly", "creator", 615_000, "1 video/week", "True crime"),
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
    "I've been editing long-form for three years and shorts for two — the reel covers both.",
    "The last channel I worked with went from 4k to 30k average views over eight months.",
    "I'd want to see one full raw file before committing to a weekly turnaround, if that's alright.",
    "I read the brief properly — the two-day revision window is the part I want to check with you.",
    "Most of my work is in this format, though the subject matter is new to me.",
    "I can start next week. My current retainer ends on Friday.",
    "I keep a shared folder per project so you can see progress rather than waiting for a cut.",
    "Not the fastest editor you'll talk to, but I'll ask about the argument before I touch the timeline.",
    "I've done exactly this on a smaller channel and would like a go at it at this scale.",
    "Sound is where I'd start with your back catalogue — the picture is already good.",
    "Rates are on my profile; happy to work to a fixed per-video figure instead if that's simpler.",
    "I write my own captions rather than auto-generating them, which is slower and reads better.",
    "I've subtitled in three languages before, if that's ever useful to you.",
    "I'd rather do one video well as a trial than promise a schedule I haven't tested.",
    "Colour is the thing I'm strongest at — the second link shows a before and after.",
    "I've worked with a producer in your timezone before, so the overlap is familiar.",
    "Happy to be a second pair of hands during a busy stretch rather than the only editor.",
    "I've had a look at your last four uploads and have notes if you want them.",
)

RECRUITER_OPENERS: tuple[str, ...] = (
    "Hi — I came across your work and think you'd fit a series we're planning.",
    "We're expanding to two uploads a week and need someone reliable on the edit.",
    "Your thumbnail work is close to the direction we're moving in. Are you taking new clients?",
    "We have a backlog of raw footage and need help getting it upload-ready.",
)

# --- structured first-message answers ---------------------------------------
#
# What the requester actually filled in, in the shape the requirement registry
# stores. Every key each context offers is represented, because these drive the
# opening message the recipient reads — a corpus that only answered "portfolio"
# would leave the rest of that surface untested once the hand-written fixture is
# gone. Values are content, not display strings: the product formats them.

JOB_ANSWER_SETS: tuple[dict[str, object], ...] = (
    {
        "expected_rate": {"amount": "2,500", "unit": "per video"},
        "resume": "https://resume.scenario.invalid/finance-editor",
        "cover_letter": (
            "I edit creator-led finance and education videos, and I can bring "
            "that same retention judgement to this channel."
        ),
        "turnaround": {"value": "4", "unit": "days"},
        "working_hours": "Evenings IST",
        "relevant_experience": "Finance and education channels, mostly long-form",
        "tools_workflow": "Premiere Pro, After Effects, Frame.io for review",
        "start_availability": "Next week",
        "fit_note": "Your last three uploads drop at the same point — that is a hook problem I have fixed before.",
        "custom_instruction": "Yes, I can work to a Monday-to-Thursday cycle.",
    },
    {
        "expected_rate": {"amount": "18,000", "unit": "per month"},
        "turnaround": {"value": "2", "unit": "days"},
        "working_hours": "Mornings, overlapping with EU",
        "relevant_experience": "Two years on a weekly gaming channel",
        "tools_workflow": "DaVinci Resolve, Notion for tracking",
        "start_availability": "Immediately",
        "fit_note": "I already edit in this niche, so pacing needs no calibration.",
        "custom_instruction": "Happy to start with one paid test edit.",
    },
)

TALENT_ANSWER_SETS: tuple[dict[str, object], ...] = (
    {
        "project_budget": {"amount": "25,000", "unit": "per month"},
        "project_brief": "15 Shorts a month, retention-focused, from existing long-form",
        "turnaround": {"value": "1", "unit": "weeks"},
        "working_hours": "Flexible, IST preferred",
        "channel_or_brand_link": "https://youtube.scenario.invalid/@casefiles",
        "reference_links": [
            "https://youtube.scenario.invalid/@one",
            "https://youtube.scenario.invalid/@two",
        ],
        "start_availability": "Start of next month",
        "fit_note": "Your cutting style is the closest to what we are moving towards.",
        "custom_instruction": "We can share raw files the same day.",
    },
)

# Paired by position: `TALENT_FOLLOWUPS[i]` answers `RECRUITER_FOLLOWUPS[i]`, and
# the generator draws both with the same index so a thread reads as a
# conversation rather than two unrelated sentences. Any addition here has to be
# an addition to both, in the same place.
#
# The length matters as much as the content. Four pairs across two hundred
# records put the same answer in five of the eight rows a phone can show, which
# reads as broken data — the list looked duplicated rather than busy.
RECRUITER_FOLLOWUPS: tuple[str, ...] = (
    "Could you share one example where you rebuilt the structure rather than just trimming?",
    "What does your turnaround look like if we send files on a Monday?",
    "Do you handle captions and thumbnails as well, or edit only?",
    "What would you charge for a four-video batch?",
    "How much direction do you want on the first cut?",
    "Have you worked on anything at this length before?",
    "Which part of the process do you want us to be involved in?",
    "Are you comfortable working from a script, or do you prefer the raw footage first?",
    "What happens if we need a change after the final cut is delivered?",
    "Do you have capacity for a weekly slot, or is this a one-off for you?",
    "What software do you work in, and can you hand over project files?",
    "How do you usually handle music and licensing?",
)

TALENT_FOLLOWUPS: tuple[str, ...] = (
    "Yes — the second link is exactly that, the original was twelve minutes and we cut it to eight.",
    "Monday files means first draft by Thursday, final by Friday.",
    "I do both, though thumbnails are usually a separate line item.",
    "For a batch of four I'd do a slightly lower per-video rate.",
    "As much as you can give me on the first one, then less as I learn the channel.",
    "The longest I've cut is about forty minutes, an interview piece rather than an essay.",
    "The structure decision, mostly. After that I'd rather just get it to you.",
    "Script first if there is one — it saves me guessing at what the footage is for.",
    "One round is included; past that I'd charge by the hour so it stays fair both ways.",
    "A weekly slot suits me better than one-offs, if the schedule is real.",
    "Resolve, and yes — I hand over the project file and the media at the end.",
    "I stick to licensed libraries and keep the receipts with the project file.",
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


# --- profiles ---------------------------------------------------------------
#
# What a credible creator-economy professional looks like, keyed by the role
# they lead with.
#
# Coherence is the whole point. A podcast producer whose only evidence is
# thumbnail design tells a reviewer nothing, and a subtitle specialist with no
# language on their profile is a data shape rather than a person. Each archetype
# therefore carries a matched set: the skills, the stack those skills are
# actually used in, the surfaces the work ships on, and — critically — the
# *kind* of evidence that role produces, because for a scriptwriter or a channel
# manager a video reel is not the artefact.

#: role -> (bio, skills, tools, platforms, formats, languages, evidence_kind)
PROFILE_ARCHETYPES: dict[str, dict[str, object]] = {
    "Shorts editor": {
        "bio": "I cut vertical for retention, not for polish. Most of my work is finding the four seconds that hold someone and building the rest of the clip around it — hook first, then pacing, then everything else.",
        "skills": ["Short-form editing", "Hook writing", "Pacing", "Sound design", "Captioning"],
        "tools": ["Premiere Pro", "CapCut", "After Effects", "Descript"],
        "platforms": ["youtube_shorts", "tiktok", "instagram_reels"],
        "formats": ["Shorts/Reels", "Hooks", "Repurposed clips", "Captions"],
        "languages": ["English", "Hindi"],
        "evidence": "video",
    },
    "Long-form editor": {
        "bio": "Long-form is a structure problem before it is an edit problem. I spend the first pass on the shape of the argument and only then start cutting — which is usually where the retention graph stops sagging in the middle.",
        "skills": ["Narrative structure", "Retention editing", "Colour", "Sound mix", "B-roll direction"],
        "tools": ["Premiere Pro", "DaVinci Resolve", "After Effects", "Frame.io"],
        "platforms": ["youtube", "multi_platform"],
        "formats": ["Long-form video", "YouTube packaging", "Captions"],
        "languages": ["English"],
        "evidence": "video",
    },
    "Thumbnail designer": {
        "bio": "Thumbnails are a legibility problem at 120 pixels wide. I design in sets and test against the rest of the channel's grid, because a thumbnail that wins alone and loses in context has not won.",
        "skills": ["Thumbnail design", "Typography", "Compositing", "A/B testing", "Colour theory"],
        "tools": ["Photoshop", "Figma", "Lightroom"],
        "platforms": ["youtube", "youtube_shorts"],
        "formats": ["Thumbnails", "YouTube packaging"],
        "languages": ["English"],
        "evidence": "design",
    },
    "Channel manager": {
        "bio": "I run the parts of a channel that are not the video: the calendar, the packaging decisions, the analytics read, and the awkward conversation about what to stop making. Most of my value shows up as things that did not get published.",
        "skills": ["Channel strategy", "Analytics", "Content planning", "Team coordination", "Packaging"],
        "tools": ["YouTube Studio", "Notion", "Airtable", "TubeBuddy"],
        "platforms": ["youtube", "multi_platform"],
        "formats": ["Content strategy", "Channel research", "YouTube packaging"],
        "languages": ["English"],
        "evidence": "strategy",
    },
    "Scriptwriter": {
        "bio": "I write for the ear and the retention graph at once. Research first, structure second, and a hook that pays off what it promised — I would rather cut a good line than keep one that stalls the middle.",
        "skills": ["Scriptwriting", "Research", "Story structure", "Hook writing", "Interviewing"],
        "tools": ["Google Docs", "Notion", "Scrivener"],
        "platforms": ["youtube", "podcast", "multi_platform"],
        "formats": ["Scripts", "Hooks", "Content strategy"],
        "languages": ["English"],
        "evidence": "writing",
    },
    "Podcast producer": {
        "bio": "I produce interview shows end to end — booking, run of show, edit, and the clips that actually travel. The edit is where most shows lose their audience, so that is where I spend the time.",
        "skills": ["Podcast production", "Audio editing", "Guest booking", "Run-of-show", "Clip strategy"],
        "tools": ["Descript", "Adobe Audition", "Riverside", "Hindenburg"],
        "platforms": ["podcast", "youtube", "multi_platform"],
        "formats": ["Podcast editing", "Voice-over", "Repurposed clips"],
        "languages": ["English"],
        "evidence": "audio",
    },
    "Motion-graphics artist": {
        "bio": "I build systems rather than one-off animations — a title set, a lower-third kit, a data-callout template a team can actually use without me. The goal is that episode forty looks like episode one.",
        "skills": ["Motion graphics", "Template systems", "Data visualisation", "Rigging", "Brand animation"],
        "tools": ["After Effects", "Cinema 4D", "Illustrator", "Figma"],
        "platforms": ["youtube", "instagram_reels", "multi_platform"],
        "formats": ["Motion graphics", "YouTube packaging", "Ad creatives"],
        "languages": ["English"],
        "evidence": "video",
    },
    "Colorist": {
        "bio": "Grading is continuity work as much as look development. I match across shoot days first, then build the look — a beautiful grade that flickers between cuts is a problem, not a style.",
        "skills": ["Colour grading", "Look development", "Shot matching", "LUT design", "Delivery specs"],
        "tools": ["DaVinci Resolve", "Baselight", "Premiere Pro"],
        "platforms": ["youtube", "multi_platform"],
        "formats": ["Long-form video", "Ad creatives"],
        "languages": ["English"],
        "evidence": "video",
    },
    "Subtitler / translator": {
        "bio": "I localise rather than transcribe. Timing, reading speed and idiom all matter — a caption that is technically correct and unreadable at pace has failed the person it was for.",
        "skills": ["Subtitling", "Localisation", "Transcription", "Reading-speed timing", "QC"],
        "tools": ["Aegisub", "Subtitle Edit", "Descript", "YouTube Studio"],
        "platforms": ["youtube", "youtube_shorts", "multi_platform"],
        "formats": ["Captions", "Voice-over"],
        "languages": ["English", "Hindi", "Spanish", "Tamil"],
        "evidence": "writing",
    },
    "Community manager": {
        "bio": "I look after the parts of an audience that never comment. Moderation, tone, and knowing which threads to leave alone — most of the job is judgement rather than volume.",
        "skills": ["Community moderation", "Tone of voice", "Escalation handling", "Event running", "Reporting"],
        "tools": ["Discord", "Notion", "YouTube Studio", "Zapier"],
        "platforms": ["twitch", "multi_platform", "instagram_reels"],
        "formats": ["Social posts", "Channel research"],
        "languages": ["English"],
        "evidence": "strategy",
    },
    "UGC creator": {
        "bio": "I shoot and cut creator-style ads that do not feel like ads. Usually three to five variants per brief so there is something real to test rather than one hero cut.",
        "skills": ["UGC production", "On-camera delivery", "Ad variants", "Lighting", "Direct response"],
        "tools": ["CapCut", "Premiere Pro", "Lightroom", "Canva"],
        "platforms": ["tiktok", "instagram_reels", "youtube_shorts"],
        "formats": ["Ad creatives", "Shorts/Reels", "Social posts"],
        "languages": ["English"],
        "evidence": "video",
    },
    "Brand-deal manager": {
        "bio": "I handle the commercial side of a channel — inbound sorting, rate cards, deliverables that do not quietly expand, and the follow-up nobody enjoys. I would rather lose a deal than agree to terms that hurt the channel.",
        "skills": ["Sponsorship sales", "Rate negotiation", "Deliverable scoping", "Reporting", "Brand safety"],
        "tools": ["Notion", "HubSpot", "Google Sheets", "DocuSign"],
        "platforms": ["multi_platform", "youtube"],
        "formats": ["Content strategy", "Ad creatives"],
        "languages": ["English"],
        "evidence": "strategy",
    },
}

#: Evidence a role actually produces. A scriptwriter's portfolio is scripts; a
#: channel manager's is an audit or a growth plan. Satisfying a portfolio floor
#: with irrelevant video for either would be the corpus lying about the person.
EVIDENCE_TEMPLATES: dict[str, tuple[tuple[str, str, str, str], ...]] = {
    # (title, description, contribution, media)
    "video": (
        ("Retention rebuild — market explainer", "A twelve-minute explainer recut to eight after the retention graph flattened at 0:40. Restructured the cold open around the strongest visual and moved the thesis forward by ninety seconds.", "Edit rebuild, hook rewrite", "video"),
        ("Series packaging — education channel", "Six episodes given one visual grammar: consistent titles, chapter cards and a recurring data treatment, so the series reads as a series in the sidebar.", "Lead editor, packaging", "video"),
        ("Cold open reshoot — fitness channel", "Reshot and recut the first twenty seconds of an underperforming upload. Same footage otherwise; the change was entirely in what the viewer meets first.", "Edit and direction", "video"),
        ("Sponsor integration cutdown", "A ninety-second read cut to thirty-five without losing the offer, placed after the first payoff rather than before it.", "Edit, timing", "video"),
        ("Interview multicam edit", "Three-camera sit-down assembled with a hard rule: no shot held past its usefulness. Cut ninety minutes to twenty-two.", "Lead editor", "video"),
    ),
    "design": (
        ("Thumbnail A/B set — finance", "Four thumbnails for one upload, built to be legible at 120px and distinct from the eleven videos around them on the channel page.", "Concepting and design", "image"),
        ("Channel grid refresh", "Reworked a back catalogue's thumbnails so the grid reads as one channel — shared type, a fixed face position, and a colour rule per series.", "Design system", "image"),
        ("Packaging system — education series", "Title and thumbnail pairs designed together, with a template a non-designer on the team can extend without breaking it.", "Design system", "image"),
        ("Motion titles system", "A title kit with three states and documented spacing, so later episodes match the first without me.", "Template system", "image"),
    ),
    "writing": (
        ("Script — data-led explainer", "Full script for a nine-minute explainer, researched from primary sources with every claim footnoted in the doc for the fact-check pass.", "Research and script", "link"),
        ("Hook pass — twelve shorts", "Twelve openings rewritten against the originals, with the reasoning for each change kept beside it so the team could apply the pattern themselves.", "Script and structure", "link"),
        ("Translation + subtitle pass", "A full episode localised with reading-speed timing rather than raw transcription, plus a glossary for recurring terms.", "Captions and localisation", "link"),
        ("Series outline — six episodes", "Outline and beat sheet for a six-part run, structured so each episode stands alone and still earns the next.", "Structure and outline", "link"),
    ),
    "strategy": (
        ("Channel audit — 40 uploads", "A read of forty uploads against retention, click-through and publish cadence, ending in three things to stop doing.", "Analysis and recommendations", "link"),
        ("Ninety-day growth plan", "A quarter's calendar with a stated hypothesis per format and the measure that would falsify it.", "Strategy and planning", "link"),
        ("Sponsorship rate card and process", "Rate card, deliverable definitions and an inbound-sorting process that cut reply time to under a day.", "Commercial strategy", "link"),
        ("Community guidelines and escalation path", "Written tone guide and a moderation escalation ladder, adopted across a Discord of forty thousand.", "Policy and process", "link"),
    ),
    "audio": (
        ("Podcast highlight reel", "Twenty-two minutes of highlights pulled from six hours, chosen for what travels as a clip rather than what was most interesting in the room.", "Edit and clip strategy", "audio"),
        ("Dialogue clean-up — weekly show", "Noise floor, plosives and room tone matched across two remote guests recording on very different setups.", "Audio edit and mix", "audio"),
        ("Caption + sound design pass", "Sound design and captions for a narrative episode, timed so the captions never land before the beat they describe.", "Sound and captions", "audio"),
        ("Show format redesign", "Restructured a rambling interview show into a three-act run of show, with the cold open cut from the best answer.", "Production and structure", "audio"),
    ),
}

#: Timezones, keyed by the *actual* strings in LOCATIONS. Written by hand and
#: then checked against that pool by the validator, because a map that silently
#: misses a location produces a profile with no timezone and nothing complains.
TIMEZONES: dict[str, str] = {
    "Mumbai, India": "Asia/Kolkata",
    "Bengaluru, India": "Asia/Kolkata",
    "Delhi NCR, India": "Asia/Kolkata",
    "Hyderabad, India": "Asia/Kolkata",
    "Indore, India": "Asia/Kolkata",
    "Kochi, India": "Asia/Kolkata",
    "Guwahati, India": "Asia/Kolkata",
    "Kathmandu, Nepal": "Asia/Kathmandu",
    "London, UK": "Europe/London",
    "Berlin, Germany": "Europe/Berlin",
    "Austin, USA": "America/Chicago",
    "Toronto, Canada": "America/Toronto",
    "Adelaide, Australia": "Australia/Adelaide",
}

#: Somebody working remotely still lives somewhere. "Remote" is a work mode
#: wearing a location's clothes, so the timezone comes from this instead of
#: being left empty — an empty timezone on a profile reads as missing data.
REMOTE_TIMEZONES: tuple[str, ...] = (
    "Asia/Kolkata",
    "Europe/London",
    "America/New_York",
    "Europe/Berlin",
    "America/Los_Angeles",
)

WORKING_HOURS: tuple[str, ...] = (
    "Mornings IST, overlapping with EU afternoons",
    "Afternoons and evenings, flexible for handover calls",
    "Standard business hours, US Central",
    "Evenings IST — async the rest of the day",
    "Split day, overlapping both EU and US East",
)

TURNAROUND_NOTES: tuple[str, ...] = (
    "Two to three days for a long-form cut, same-day for shorts",
    "One working week per episode, including a revision round",
    "48 hours for a first pass",
    "Same-week delivery, two revision rounds included",
    "Three working days, faster on retainer",
)

#: What a hiring identity is, in its own words.
EMPLOYER_DESCRIPTIONS: dict[str, str] = {
    # Says what *kind* of account this is, never how often it publishes — the
    # cadence is a per-channel fact and stating it here contradicts half of them.
    "creator": "An independent channel working with a small regular bench of editors and designers rather than a rotating pool.",
    "agency": "A creator-economy agency running production for a roster of channels, with a standing team of editors, writers and designers.",
    "studio": "A production studio making long-form and documentary work for creators and brands, with in-house post.",
    "brand": "An in-house content team producing owned-channel video alongside paid social, hiring specialists per format.",
    "production_house": "A production house handling shoot-to-delivery for creator and branded work, staffing crews per project.",
}

# Ceilings, ascending. `audience_band` is a *reading* of the subscriber count on
# the same profile, so it is derived rather than drawn: a card showing "412,000
# subscribers" above the band "10K–50K" is not a data gap, it is a visible lie.
AUDIENCE_BANDS: tuple[tuple[int | None, str], ...] = (
    (10_000, "Under 10K subscribers"),
    (50_000, "10K–50K subscribers"),
    (250_000, "50K–250K subscribers"),
    (500_000, "250K–500K subscribers"),
    (1_000_000, "500K–1M subscribers"),
    (None, "1M+ subscribers"),
)


def audience_band_for(subscribers: int | None) -> str | None:
    """The band that actually contains `subscribers`."""
    if not subscribers:
        return None
    for ceiling, label in AUDIENCE_BANDS:
        if ceiling is None or subscribers < ceiling:
            return label
    return AUDIENCE_BANDS[-1][1]
