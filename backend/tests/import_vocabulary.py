"""Vocabulary the public web uses, generated rather than curated.

Three lists decide safety-critical behaviour in this importer: which words name
a channel, which words describe a candidate's own work, and which headings mean
a page has stopped being about its own job. Each is a hand-written set of about
thirty entries, and each is consulted by exact membership.

That is fine when the category is genuinely closed. It is not fine when the web
can write a synonym nobody typed in — and every one of those three categories is
open. "Message us on Skype" routes an applicant off-platform whether or not
Skype was on somebody's list, and "Other opportunities" hides a neighbouring
job's salary whether or not that exact heading was anticipated.

So the words here are deliberately *not* the words in those lists. They are the
ones a real page might use instead, generated in both readings — the same
platform as a destination and as a skill — because a fix that removes every
mention of Instagram is as wrong as one that removes none.
"""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------------------
# Platforms, in both readings
# --------------------------------------------------------------------------

#: Platforms a page can name. Some are in the product's channel list, many are
#: deliberately not — Skype, Teams, Line, KakaoTalk, Jotform, Airtable.
PLATFORMS: tuple[str, ...] = (
    "WhatsApp",
    "WA",
    "Whats App",
    "Telegram",
    "TG",
    "Instagram",
    "IG",
    "Insta",
    "LinkedIn",
    "Discord",
    "Slack",
    "Signal",
    "Messenger",
    "Facebook Messenger",
    "WeChat",
    "Line",
    "KakaoTalk",
    "Viber",
    "Skype",
    "Teams",
    "Microsoft Teams",
    "Google Chat",
    "Twitter",
    "X",
    "YouTube",
    "TikTok",
    "Snapchat",
    "Reddit",
    "Pinterest",
    "Threads",
)

#: Places an application can be sent that are not messaging platforms.
PORTALS: tuple[str, ...] = (
    "our careers portal",
    "the company careers site",
    "our application portal",
    "the external form",
    "a Google Form",
    "a Typeform",
    "a Jotform",
    "an Airtable form",
    "a Notion form",
    "our website",
    "the link below",
    "the form below",
    "our ATS",
    "the job board",
)

#: Verbs that send something somewhere.
ROUTING_VERBS: tuple[str, ...] = (
    "Send",
    "Submit",
    "Share",
    "Forward",
    "Upload",
    "Apply",
    "Message",
    "DM",
    "Contact",
    "Reach out",
    "Email",
    "Ping",
    "Drop",
    "Get in touch",
)

PREPOSITIONS: tuple[str, ...] = ("to", "via", "through", "on", "at", "using", "over")

#: Things a candidate can be asked to provide.
MATERIALS: tuple[str, ...] = (
    "your portfolio",
    "your showreel",
    "your demo reel",
    "your CV",
    "your resume",
    "two work samples",
    "three recent edits",
    "case studies",
    "your rate",
    "your expected rate",
    "your availability",
    "caption examples",
    "writing samples",
    "links to previous work",
)

#: Ways a platform legitimately appears as part of the job itself.
SKILL_FRAMES: tuple[str, ...] = (
    "Experience with {platform} marketing is useful.",
    "You will manage our {platform} presence.",
    "Familiarity with {platform} analytics helps.",
    "Moderate our {platform} community.",
    "Grow our {platform} following month over month.",
    "Plan and schedule {platform} content.",
    "Run paid campaigns on {platform}.",
    "Report on {platform} engagement weekly.",
    "You will own the {platform} content calendar.",
    "Repurpose long-form video into {platform} clips.",
    "Answer customer questions on {platform}.",
    "Audit our {platform} back catalogue.",
    "Write copy for {platform} posts.",
    "Coordinate {platform} influencer partnerships.",
)

#: Ways a candidate's own work on a platform is referenced. Must survive.
PORTFOLIO_FRAMES: tuple[str, ...] = (
    "Include links to your {platform} work.",
    "Share your {platform} channel.",
    "Send examples of your {platform} content.",
    "We would like to see your {platform} profile.",
    "Include your best {platform} edits.",
    "Attach two of your {platform} posts.",
)


@dataclass(frozen=True)
class Sentence:
    """One generated sentence and what it actually means."""

    text: str
    #: True when the sentence tells a candidate where to send an application.
    routes: bool
    #: The platform or portal named, whichever reading.
    subject: str
    #: What the candidate must provide, if the sentence asks for anything.
    material: str | None
    frame: str


def routing_sentences() -> list[Sentence]:
    """Genuine routing instructions, in vocabulary the lists do not contain."""

    sentences: list[Sentence] = []
    for verb_index, verb in enumerate(ROUTING_VERBS):
        for platform_index, platform in enumerate(PLATFORMS):
            preposition = PREPOSITIONS[(verb_index + platform_index) % len(PREPOSITIONS)]
            material = MATERIALS[(verb_index + platform_index) % len(MATERIALS)]
            sentences.append(
                Sentence(
                    text=f"{verb} {material} {preposition} {platform}.",
                    routes=True,
                    subject=platform,
                    material=material,
                    frame=f"{verb}/{preposition}",
                )
            )
        for portal_index, portal in enumerate(PORTALS):
            material = MATERIALS[(verb_index + portal_index) % len(MATERIALS)]
            sentences.append(
                Sentence(
                    text=f"{verb} {material} {PREPOSITIONS[portal_index % len(PREPOSITIONS)]} {portal}.",
                    routes=True,
                    subject=portal,
                    material=material,
                    frame=f"{verb}/portal",
                )
            )
    return sentences


def skill_sentences() -> list[Sentence]:
    """Legitimate job content that happens to name a platform. Must survive."""

    return [
        Sentence(
            text=frame.format(platform=platform),
            routes=False,
            subject=platform,
            material=None,
            frame=frame,
        )
        for frame in SKILL_FRAMES
        for platform in PLATFORMS
    ]


def portfolio_sentences() -> list[Sentence]:
    """A candidate's own work on a platform. The platform must survive."""

    return [
        Sentence(
            text=frame.format(platform=platform),
            routes=False,
            subject=platform,
            material=f"{platform} work",
            frame=frame,
        )
        for frame in PORTFOLIO_FRAMES
        for platform in PLATFORMS
    ]


# --------------------------------------------------------------------------
# Headings that mean "this page has stopped being about its own job"
# --------------------------------------------------------------------------

OTHER_JOB_HEADINGS: tuple[str, ...] = (
    "Similar jobs",
    "Similar job",
    "Related jobs",
    "Related roles",
    "Related openings",
    "Related opportunities",
    "Other jobs",
    "Other openings",
    "Other roles",
    "Other positions",
    "Other opportunities",
    "More jobs",
    "More openings",
    "More roles",
    "More from this company",
    "More related roles",
    "You may also like",
    "You might also like",
    "Recommended jobs",
    "Recommended roles",
    "Recommended for you",
    "Recommended opportunities",
    "Jobs you may like",
    "Jobs you might like",
    "Careers you might like",
    "Explore more roles",
    "Explore more jobs",
    "Current openings",
    "Latest vacancies",
    "Featured roles",
    "Open positions",
    "Available roles",
    "Vacancies",
    "See also",
    "Browse jobs",
    "Additional opportunities",
    "People also viewed",
    "Similar positions",
)


def heading_variants(heading: str) -> list[str]:
    """The same heading as a page might actually print it."""

    return [
        heading,
        heading.upper(),
        heading.lower(),
        f"{heading}:",
        f"{heading} —",
        f"— {heading}",
        f"{heading} ({len(heading)})",
        f"  {heading}  ",
    ]
