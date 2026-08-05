"""What each field means, in words the model can act on.

The extraction request used to send only a field *path* plus policy metadata.
That is enough for a server to validate a value and not nearly enough for a
reader to find one, because several paths are internal names rather than
descriptions of the thing they hold.

``about_channel`` is the case that proved it. On a corporate engineering listing
the model saw a field called "about_channel", found no channel, and returned
nothing — so the assistant asked the recruiter to paste in a company description
that was sitting in the page. The field means "about whoever is hiring"; nothing
said so.

Every description here is one sentence, written for whoever is reading the
source. They are deliberately short: this text is sent on every request, and the
policy metadata it replaces was far larger and could not be acted on at all.
"""

from __future__ import annotations

from typing import Final

#: Field path -> one sentence describing what belongs in it.
FIELD_DESCRIPTIONS: Final[dict[str, str]] = {
    # --- Identity -------------------------------------------------------
    "title": "The job title as the post states it.",
    "primary_role_key": "The single creator craft this role is for.",
    "role_specialization": "A narrower specialism within the craft, if named.",
    "employer_context_type": "Who is hiring: an individual creator, an agency, a brand, or a company.",
    # The name is historical. It covers any employer, not only a channel.
    "about_channel": (
        "About the employer: what the company, brand, studio, agency or channel "
        "does. Use the post's own description of the organisation hiring, "
        "including an 'About us' or 'About <company>' section."
    ),
    # --- Work -----------------------------------------------------------
    "responsibilities": "What the person will actually do, one item per duty.",
    "requirements": "What a candidate must already have or be able to do.",
    "deliverables": "Concrete outputs and how often they are due.",
    "source_inputs": "What the creator is given to work from, such as raw footage or a script.",
    "platforms": "Platforms the work is published on.",
    "formats_hired_for": "Content formats this role produces.",
    "content_niches": "Subject areas the content covers.",
    "content_genres": "Content styles, such as explainers or reviews.",
    "reference_videos": "Example links the post offers as a quality reference.",
    "tags": "Short free-form keywords describing the role.",
    # --- Arrangement -----------------------------------------------------
    "work_mode": "Whether the work is remote, hybrid or on-site.",
    "location": "The city or region the work is based in, when not fully remote.",
    "timezone_overlap": "Any required overlap with a stated timezone.",
    "engagement_type": "The shape of the engagement, such as full time, part time, internship or freelance.",
    "start_timing": "When the work should start.",
    "start_date": "The exact start date, when a specific one is given.",
    "deadline_at": "The application deadline, if the post states one.",
    "duration_type": "Whether the engagement is ongoing, for a fixed period, or project based.",
    "duration_value": "How long the engagement runs, as a number.",
    "duration_unit": "The unit for the engagement length.",
    "engagement_end_date": "The date the engagement ends, when stated.",
    "expected_weekly_hours_min": "Fewest hours per week expected.",
    "expected_weekly_hours_max": "Most hours per week expected.",
    "turnaround_value": "How quickly each piece of work is due, as a number.",
    "turnaround_unit": "The unit for the turnaround time.",
    "turnaround_basis": "What the turnaround is measured against.",
    # --- Money ------------------------------------------------------------
    "compensation_mode": "Whether pay is a fixed amount, a range, or negotiable.",
    "budget_amount": "The pay figure, or the lower bound of a range.",
    "budget_max": "The upper bound of a pay range.",
    "budget_currency": "The currency the pay is quoted in.",
    "budget_unit": "What the pay figure is per, such as per month or per video.",
    "budget_unit_custom": "A pay basis that does not match the standard units.",
    "budget_note": "Any qualifying note about pay, such as that it depends on experience.",
    # --- Trials -----------------------------------------------------------
    "trial_status": "Whether a trial or test task is required before hiring.",
    "trial_scope": "What the trial task involves.",
    "trial_effort_value": "How much effort the trial takes, as a number.",
    "trial_effort_unit": "The unit for the trial effort.",
    "trial_compensation_amount": "What the trial pays, if anything.",
    "trial_compensation_currency": "The currency the trial pay is quoted in.",
    "trial_compensation_basis": "What the trial pay is calculated against.",
    "trial_work_usage": "Whether the employer may use the trial work.",
    "trial_portfolio_permission": "Whether the candidate may show the trial work in a portfolio.",
    "trial_attribution": "Whether the candidate is credited for trial work.",
    "unpaid_trial_confirmed": "Whether the post explicitly confirms the trial is unpaid.",
    "trial_notes": "Any other stated terms about the trial.",
    # --- Process ----------------------------------------------------------
    "hiring_process": "The stages of the hiring process, in order.",
    "hiring_process_notes": "Extra detail about how hiring will run.",
    "how_to_apply": "Instructions the post gives for applying.",
    "application_requirements": "What a candidate must send with an application.",
    "revision_policy": "Whether revisions are unlimited, a fixed number, or unstated.",
    "revision_rounds": "How many revision rounds are included.",
    "revision_notes": "Extra detail about revisions.",
    "creative_autonomy": "How much creative latitude the person has.",
    "creative_autonomy_notes": "Extra detail about creative direction.",
    # --- Skills and tools ---------------------------------------------------
    "required_skill_keys": "Skills the post requires, as catalog keys.",
    "preferred_skill_keys": "Skills the post prefers but does not require.",
    "other_required_skills": "Required skills that do not match a catalog key.",
    "other_preferred_skills": "Preferred skills that do not match a catalog key.",
    "required_skills_note": "Extra detail about required skills.",
    "preferred_skills_note": "Extra detail about preferred skills.",
    "required_tool_keys": "Software or tools the post requires, as catalog keys.",
    "other_required_tools": "Required tools that do not match a catalog key.",
    "experience_level": "How much prior experience the post asks for.",
    "source_inputs_notes": "Extra detail about what the creator is given to work from.",
}

#: Wording that looks like a company description but belongs to the job board.
#:
#: A page footer explaining that the *board* is an equal-opportunity platform is
#: not a description of the employer, and pre-filling it would be worse than
#: asking — the recruiter would have to notice and delete it.
BOILERPLATE_MARKERS: Final[tuple[str, ...]] = (
    "equal opportunity employer",
    "we are an equal opportunity",
    "all qualified applicants",
    "without regard to race",
    "e-verify",
    "privacy policy",
    "cookie policy",
    "terms of service",
    "powered by greenhouse",
    "powered by lever",
    "powered by ashby",
    "powered by workable",
    "apply for this job",
    "back to jobs",
    "view all jobs",
    "sign in to apply",
    "create a job alert",
    "report this job",
)


def describe(field_path: str) -> str | None:
    """One sentence for the model, or None when the path speaks for itself."""

    return FIELD_DESCRIPTIONS.get(field_path)


def looks_like_boilerplate(value: str) -> bool:
    """True when text is job-board furniture rather than employer context."""

    lowered = " ".join(value.lower().split())
    return any(marker in lowered for marker in BOILERPLATE_MARKERS)
