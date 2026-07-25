"""Retire Shortlisted as a workflow stage, preserving what was actually said.

Shortlisted conflated two different things: a private "keep this one in mind"
and, sometimes, a real update the applicant was told. Splitting them is the whole
point of this migration.

  * **Never communicated** (``participant_status`` is not ``shortlisted``): the
    manager was only marking their own interest. The record moves to ``reviewing``
    — where it actually sits in the funnel — and the manager gets a private Star,
    which is what they meant all along. The applicant is told nothing, because
    nothing was ever told to them.

  * **Communicated** (``participant_status = 'shortlisted'``): the applicant was
    genuinely told. That stays exactly as it is. Trusted events, messages,
    notifications and timeline entries are untouched, and the serializer renders
    it to them as "Under consideration" until a later shared outcome supersedes
    it. Pretending it never happened would be a lie to the applicant.

Deployment order is backend-first. New backends already tolerate the legacy value
(the transition table still lets a `shortlisted` record move forward, it just
cannot be entered), so an older frontend keeps working against a migrated
backend. A newer frontend running before this migration simply sees records it
no longer offers `Shortlisted` for — also safe.

Revision ID: 0047_shortlisted_to_private_star
Revises: 0046_interaction_review_started_at
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0047_shortlisted_to_private_star"
down_revision = "0046_interaction_review_started_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    # 1. Give each affected manager their private Star, keyed by conversation so
    #    it matches how preferences are stored everywhere else. Only for records
    #    that were never communicated — a communicated shortlist was a shared
    #    outcome, not a private bookmark.
    #
    #    ON CONFLICT DO NOTHING: a manager who already starred the thread keeps
    #    their existing (earlier) star rather than having it overwritten.
    connection.execute(
        sa.text(
            """
            INSERT INTO interaction_user_preferences
                (id, user_id, conversation_id, starred_at, created_at, updated_at)
            SELECT
                gen_random_uuid(),
                a.job_owner_user_id,
                c.id,
                COALESCE(a.updated_at, NOW()),
                NOW(),
                NOW()
            FROM job_applications a
            JOIN conversations c ON c.application_id = a.id
            WHERE a.status = 'shortlisted'
              AND COALESCE(a.participant_status, '') <> 'shortlisted'
              AND a.job_owner_user_id IS NOT NULL
            ON CONFLICT (user_id, conversation_id) DO NOTHING
            """
        )
    )

    # 2. Move the private ones to the stage they actually occupy. The version is
    #    bumped so any client holding the old value refetches rather than writing
    #    over this with a stale expectation.
    connection.execute(
        sa.text(
            """
            UPDATE job_applications
            SET status = 'reviewing',
                status_version = status_version + 1
            WHERE status = 'shortlisted'
              AND COALESCE(participant_status, '') <> 'shortlisted'
            """
        )
    )

    # 3. Communicated shortlists are deliberately left untouched: status,
    #    participant_status, events, messages and notifications all stand.


def downgrade() -> None:
    """Restore the private records to ``shortlisted``.

    Reverses step 2 only. The Star rows created in step 1 are intentionally left
    in place: they are the user's own organisation, they are harmless when the
    stage is restored, and deleting them would discard something a person may
    since have curated. Communicated shortlists never changed, so there is
    nothing to undo for them.
    """
    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            UPDATE job_applications a
            SET status = 'shortlisted'
            FROM interaction_user_preferences p
            JOIN conversations c ON c.id = p.conversation_id
            WHERE c.application_id = a.id
              AND p.user_id = a.job_owner_user_id
              AND p.starred_at IS NOT NULL
              AND a.status = 'reviewing'
              AND COALESCE(a.participant_status, '') <> 'shortlisted'
            """
        )
    )
