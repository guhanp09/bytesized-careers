# AI job import conversational guidance

## Current product boundary

CreatorJobs has one import conversation and one job editor.

The import conversation happens on the private Draft Assistant canvas before a
native job draft is handed off. After handoff, the recruiter enters the normal
Post Job flow on its first screen. Post Job does not run a second import review,
repeat assistant questions, or intercept its Next button with import-specific
guidance.

This boundary is deliberate:

- the assistant clarifies extraction uncertainty before handoff;
- the server checkpoints every conversation transition;
- the recruiter remains authoritative over every answer;
- the native editor owns ordinary validation, saving, preview, and publication;
- import metadata remains available for reconciliation and analytics without
  creating another editing experience.

## Architecture

### Server-owned conversation

The authoritative state machine lives in:

- `backend/app/core/job_import_conversation.py`;
- `backend/app/services/job_import_conversation_service.py`;
- `backend/app/core/job_import_questions.py`;
- `backend/app/core/job_import_answer_shapes.py`;
- `backend/app/core/job_import_answer_effects.py`.

The service exposes one current question, records recruiter answers, supports
skip and continue-manually actions, and advances with optimistic context
versions. Refreshing or resuming reads the persisted checkpoint instead of
reconstructing a browser-only conversation.

Provider extraction never owns recruiter decisions. Explicit source values,
contextual inference, suggestions, conflicts, and missing fields retain their
separate provenance and confirmation state. Recruiter answers take precedence.

### Assistant canvas

The active conversational UI lives in:

- `components/import-job/ImportJobPageClient.tsx`;
- `components/import-job/assistant/DraftAssistantCanvas.tsx`;
- `components/import-job/assistant/ConversationTurn.tsx`;
- `components/import-job/assistant/DraftAssistantRobot.tsx`.

The canvas renders the server's current question and submits an answer, skips
the current or remaining optional questions, or continues manually. It shows a
bounded preview of the emerging draft and uses the existing private import API.
No chain-of-thought, provider selection, model name, or provider-specific copy
is exposed.

### Native handoff

The handoff creates or attaches a private native job and opens
`components/PostJobPage.tsx`. Imported drafts hydrate through the same domain
mapping as saved native drafts. Post Job then owns:

- the standard screen sequence and validation;
- candidate preview;
- private draft saving;
- import attachment and reconciliation metadata;
- the existing publication boundary.

Imported drafts start on the first native screen. A recruiter edit is never
overwritten by stale extraction context, and a removed imported value remains a
meaningful recruiter decision for analytics and reconciliation.

## Interaction rules

1. Ask only questions supplied by the server-owned conversation state.
2. Ask one decision at a time and keep choices bounded to the canonical field
   contract.
3. Do not imply certainty that the source or recruiter did not provide.
4. Never publish from the import canvas. Handoff creates or attaches a private
   draft only.
5. Once handed off, use the ordinary Post Job controls and validation messages.
6. Do not add an import banner, review workspace, or conversational layer to
   Post Job.
7. Preserve accessibility: announced state changes, keyboard-operable choices,
   visible focus, and motion reduction.

## Resume and failure behavior

Conversation checkpoints are resumable. Refresh, navigation away, provider
pause, and transient failures must not discard source content or recruiter
answers. A recruiter can continue manually when appropriate; remaining fields
then become ordinary incomplete native fields.

Provider failures remain private and actionable. The UI may say that the draft
could not be prepared and offer retry or manual continuation, but it must not
expose credentials, raw provider responses, internal prompts, or model details.

## Testing guardrails

Contract tests should preserve these invariants:

- questions render only in `DraftAssistantCanvas` and `ConversationTurn`;
- Post Job has no import conversation or field-review request helpers;
- deleted second-editor modules cannot return;
- checkpoint resume, answer precedence, skip, manual continuation, draft
  hydration, attachment, analytics, and publication tests remain covered;
- development scenarios do not call a provider;
- no public response exposes source text, provider payloads, or private evidence.

The guiding product rule is simple: Bea helps prepare the draft, then gets out
of the editor's way.
