"""Hand-authored canonical journeys.

Bulk generation produces volume; these produce *meaning*. Each one is a
situation a designer or a reviewer needs to look at repeatedly and recognise —
the disputed payment, the interview that was moved, the decision recorded but
not shared — so the copy is written the way these people actually write, not
assembled from fragments.

Every hero has a stable key. Its identifiers therefore survive regeneration,
which is what lets the scenario index point at "the disputed payment one" and
still be pointing at it a month later.

Timestamps are offsets in seconds from the scenario anchor. Negative is the
past; positive is the future, so a scheduled interview is still ahead whenever
the manifest is read.
"""

from __future__ import annotations

from typing import Any

MINUTE = 60
HOUR = 60 * MINUTE
DAY = 24 * HOUR

#: Each entry becomes one relationship, with its conversation, interview,
#: engagement and payment state. `kind` selects the direction:
#: "application" is talent -> job, "hiring_request" is recruiter -> talent.
HEROES: tuple[dict[str, Any], ...] = (
    {
        "key": "strong-application",
        "kind": "application",
        "stage": "new",
        "participant_stage": "new",
        "created": -4 * HOUR,
        "unread": 1,
        "summary": "A strong inbound application, unread, nothing decided yet.",
        "condition": "New · unread · portfolio attached",
        "action": "Open it and record a first decision.",
        "cover_note": (
            "Hi — I already edit weekly finance explainers for two creator-led channels, so I can match "
            "your pacing from the first video rather than spending a month learning it."
        ),
        "messages": [
            (
                "talent",
                -4 * HOUR,
                "Hi — I already edit weekly finance explainers for two creator-led channels, so I can "
                "match your pacing from the first video. I've attached the retention rebuild I mentioned; "
                "the original was losing people at 0:40 and we moved the payoff forward.",
            ),
        ],
        "portfolio": 3,
        "starred": False,
    },
    {
        "key": "awaiting-portfolio-answer",
        "kind": "application",
        "stage": "reviewing",
        "participant_stage": "reviewing",
        "created": -3 * DAY,
        "unread": 0,
        "summary": "Recruiter asked a question; the applicant has not replied.",
        "condition": "Waiting on them · no reply needed from you",
        "action": "Confirm the card does not ask you to act while you are the one waiting.",
        "messages": [
            ("talent", -3 * DAY, "Hi — sending over three recent long-form edits for the channel."),
            (
                "recruiter",
                -2 * DAY,
                "Thanks. Could you share one where you rebuilt the structure rather than just tightening "
                "it? That's closer to what we need.",
            ),
        ],
        "portfolio": 2,
    },
    {
        "key": "response-required",
        "kind": "hiring_request",
        "stage": "new",
        "participant_stage": "new",
        "created": -20 * HOUR,
        "unread": 2,
        "summary": "An outbound request the talent has not answered.",
        "condition": "Needs your reply (talent side)",
        "action": "Reply from the Talent inbox and watch the state change on both sides.",
        "messages": [
            (
                "recruiter",
                -20 * HOUR,
                "Hi — we're moving to two uploads a week and need someone reliable on the edit. "
                "Roughly ₹3,000 per video to start, with a paid test on last week's upload first.",
            ),
            (
                "recruiter",
                -19 * HOUR,
                "Files land every Monday and we'd need a first draft by Thursday. Does that work?",
            ),
        ],
        "portfolio": 0,
    },
    {
        "key": "interview-proposed",
        "kind": "application",
        "stage": "interviewing",
        "participant_stage": "interviewing",
        "created": -6 * DAY,
        "summary": "Interview proposed, awaiting the applicant's confirmation.",
        "condition": "Interview proposed · future time · unconfirmed",
        "action": "Check the arranged time reads as upcoming and the applicant has no organiser controls.",
        "messages": [
            ("talent", -6 * DAY, "Hi — I'd love to help with the shorts workflow. Two recent batches attached."),
            ("recruiter", -2 * DAY, "These look good. Can we talk Thursday?"),
        ],
        "interview": {"state": "proposed", "scheduled": 3 * DAY, "detail": "https://meet.example.com/qa-shorts"},
        "portfolio": 4,
    },
    {
        "key": "interview-rescheduled",
        "kind": "application",
        "stage": "interviewing",
        "participant_stage": "interviewing",
        "created": -9 * DAY,
        "summary": "Interview confirmed, then moved once.",
        "condition": "Interview confirmed after a reschedule",
        "action": "Confirm the timeline shows the move without contradicting itself.",
        "messages": [
            ("talent", -9 * DAY, "Applying for the thumbnail role — A/B sets from the last two months attached."),
            ("recruiter", -4 * DAY, "Can we move Wednesday to Friday? Something came up on our side."),
            ("talent", -4 * DAY + HOUR, "Friday works, same time."),
        ],
        "interview": {
            "state": "confirmed",
            "scheduled": 2 * DAY,
            "detail": "https://meet.example.com/qa-thumbnails",
            "note": "Moved from Wednesday at the recruiter's request.",
        },
        "portfolio": 6,
    },
    {
        "key": "interview-done-awaiting-decision",
        "kind": "application",
        "stage": "interviewing",
        "participant_stage": "interviewing",
        "created": -14 * DAY,
        "summary": "Interview happened; the recruiter owes a decision.",
        "condition": "Decision needed · interview completed",
        "action": "Record a decision and choose whether to share it.",
        "messages": [
            ("talent", -14 * DAY, "Applying for the scriptwriter role — three Hindi explainer scripts attached."),
            ("recruiter", -6 * DAY, "Good call yesterday. I'll come back to you this week."),
        ],
        "interview": {"state": "completed", "scheduled": -5 * DAY, "detail": "https://meet.example.com/qa-scripts"},
        "portfolio": 3,
    },
    {
        "key": "hired-start-pending",
        "kind": "application",
        "stage": "hired",
        "participant_stage": "hired",
        "created": -18 * DAY,
        "summary": "Hired; the work has not been confirmed as started.",
        "condition": "Start confirmation pending",
        "action": "Confirm the start and watch the engagement move without touching payment.",
        "messages": [
            ("talent", -18 * DAY, "Applying for the long-form role. Two documentary-style edits attached."),
            ("recruiter", -3 * DAY, "We'd like to go ahead. Can you start on Monday?"),
            ("talent", -3 * DAY + 2 * HOUR, "Yes — Monday works. I'll send a first cut by Thursday."),
        ],
        "engagement": {"state": "start_pending", "payment_state": "setup_pending"},
        "portfolio": 5,
    },
    {
        "key": "engagement-funded",
        "kind": "application",
        "stage": "hired",
        "participant_stage": "hired",
        "created": -30 * DAY,
        "summary": "Work under way with the payer reporting the engagement funded.",
        "condition": "Engagement active · payment funded",
        "action": "Check the payment card says funded without claiming funds are held.",
        "messages": [
            ("talent", -30 * DAY, "Applying for the weekly editing retainer."),
            ("recruiter", -12 * DAY, "Welcome aboard. First batch is in the drive."),
            ("talent", -2 * DAY, "First two are done, third is rendering."),
        ],
        "engagement": {
            "state": "active",
            "payment_state": "funded",
            "payment_note": "Payer reported the first month as funded.",
            "started": -12 * DAY,
        },
        "portfolio": 8,
    },
    {
        "key": "completion-awaiting-release",
        "kind": "application",
        "stage": "hired",
        "participant_stage": "hired",
        "created": -60 * DAY,
        "summary": "Work finished; a release has been requested but not confirmed.",
        "condition": "Completion confirmed · release requested",
        "action": "Confirm the work status and the payment status are reported separately.",
        "messages": [
            ("talent", -60 * DAY, "Applying for the podcast editing role."),
            ("talent", -4 * DAY, "All twelve episodes are delivered and the show notes are in the sheet."),
            ("recruiter", -3 * DAY, "Confirmed on my side — thank you, this was clean work."),
        ],
        "engagement": {
            "state": "completed",
            "payment_state": "release_requested",
            "payment_note": "Release requested; awaiting the payer's confirmation.",
            "started": -50 * DAY,
            "completed": -3 * DAY,
        },
        "portfolio": 4,
    },
    {
        "key": "payment-disputed",
        "kind": "application",
        "stage": "hired",
        "participant_stage": "hired",
        "created": -45 * DAY,
        "summary": "A disputed payment that leaves the work status untouched.",
        "condition": "Payment disputed · engagement unaffected",
        "action": "Confirm the dispute changes no application or engagement state, and blocks no action.",
        "messages": [
            ("talent", -45 * DAY, "Applying for the motion graphics role."),
            ("talent", -6 * DAY, "The full title system is delivered — six templates plus the end card."),
            (
                "recruiter",
                -5 * DAY,
                "Work's fine, this is a billing problem on our side, not yours. Finance is sorting it.",
            ),
        ],
        "engagement": {
            "state": "completed",
            "payment_state": "disputed",
            "payment_note": "Raised by the payer's finance team. The delivered work is not in question.",
            "started": -40 * DAY,
            "completed": -6 * DAY,
        },
        "portfolio": 7,
    },
    # --- the other direction and the decision shapes -------------------------
    {
        "key": "request-accepted",
        "kind": "hiring_request",
        "stage": "accepted",
        "participant_stage": "accepted",
        "created": -11 * DAY,
        "summary": "Outbound request the talent accepted.",
        "condition": "Accepted (talent side)",
        "action": "Check the accepted request reads as an agreement, not as a pending action.",
        "messages": [
            ("recruiter", -11 * DAY, "We're looking for someone on captions and localisation for a Hindi series."),
            ("talent", -10 * DAY, "Yes, I'd like to. I do Hindi and Marathi, and I can start next week."),
        ],
        "portfolio": 0,
    },
    {
        "key": "request-declined",
        "kind": "hiring_request",
        "stage": "declined",
        "participant_stage": "declined",
        "created": -21 * DAY,
        "summary": "Outbound request declined with a reason.",
        "condition": "Declined with an explanation",
        "action": "Confirm the decline is shown as final and the reason survives.",
        "messages": [
            ("recruiter", -21 * DAY, "Would you take on a weekly gaming montage edit?"),
            (
                "talent",
                -20 * DAY,
                "Thanks for asking — I'm booked through the quarter on two retainers. Happy to revisit in "
                "January if you still need someone.",
            ),
        ],
        "portfolio": 0,
    },
    {
        "key": "not-proceeding-private",
        "kind": "application",
        "stage": "rejected",
        "participant_stage": "reviewing",
        "created": -8 * DAY,
        "summary": "A decision recorded privately and deliberately not shared.",
        "condition": "Not proceeding · saved privately (counterparty still sees Reviewing)",
        "action": "Verify the applicant is never shown the private decision.",
        "manager_note": "Portfolio is fine but the rate is well over budget. Keeping warm, not telling them yet.",
        "messages": [
            ("talent", -8 * DAY, "Applying for the channel manager role — I run ops for two channels already."),
        ],
        "portfolio": 2,
    },
    {
        "key": "not-proceeding-shared",
        "kind": "application",
        "stage": "rejected",
        "participant_stage": "rejected",
        "created": -25 * DAY,
        "summary": "A decision that was recorded and then communicated.",
        "condition": "Not proceeding · shared with them",
        "action": "Confirm both sides read the same outcome.",
        "messages": [
            ("talent", -25 * DAY, "Applying for the colorist role."),
            (
                "recruiter",
                -19 * DAY,
                "We've gone with someone who works in DaVinci natively. Thanks for the time you put in.",
            ),
        ],
        "portfolio": 3,
    },
    {
        "key": "withdrawn-by-talent",
        "kind": "application",
        "stage": "withdrawn",
        "participant_stage": "withdrawn",
        "created": -16 * DAY,
        "summary": "The applicant pulled out mid-process.",
        "condition": "Withdrawn by the applicant",
        "action": "Check no action is offered that would move a withdrawn record.",
        "messages": [
            ("talent", -16 * DAY, "Applying for the UGC creator role."),
            ("talent", -9 * DAY, "I've taken a full-time role — withdrawing this, sorry for the back and forth."),
        ],
        "portfolio": 1,
    },
    {
        "key": "legacy-shortlisted-communicated",
        "kind": "application",
        "stage": "shortlisted",
        "participant_stage": "shortlisted",
        "created": -75 * DAY,
        "summary": "A legacy Shortlisted record the applicant was actually told about.",
        "condition": "Legacy Shortlisted · communicated · reads as Under consideration",
        "action": "Confirm the applicant sees Under consideration and no new transition offers Shortlisted.",
        "historical": "Shortlisted was retired as a target in migration 0047. This row predates it and "
                      "the applicant was genuinely told, so the label must stay honest.",
        "messages": [
            ("talent", -75 * DAY, "Applying for the brand-deal manager role."),
            ("recruiter", -70 * DAY, "You're on our shortlist — we'll come back once the quarter's budget lands."),
        ],
        "portfolio": 2,
    },
    {
        "key": "legacy-shortlisted-private",
        "kind": "application",
        "stage": "shortlisted",
        "participant_stage": "new",
        "created": -80 * DAY,
        "summary": "A legacy Shortlisted record nobody was told about.",
        "condition": "Legacy Shortlisted · private · maps to Reviewing plus a private Star",
        "action": "Confirm the private legacy state reads as Reviewing and carries a Star.",
        "historical": "Private legacy Shortlisted. Nothing was communicated, so it maps forward to "
                      "Reviewing with the manager's private Star rather than to a shared label.",
        "starred": True,
        "messages": [
            ("talent", -80 * DAY, "Applying for the community manager role."),
        ],
        "portfolio": 1,
    },
)


def hero_keys() -> tuple[str, ...]:
    return tuple(str(hero["key"]) for hero in HEROES)
