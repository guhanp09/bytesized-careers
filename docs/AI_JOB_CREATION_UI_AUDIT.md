# AI-assisted job creation UI audit

Baseline: `99216fd7eb095d9feac5b4fb2e5f18f006946df7` on
`integration/import-and-messaging-2026-07-30`.

## What already works

- Import, Bea, native draft handoff, Post Job, Save, and candidate preview use one
  established flow. There is no second import editor.
- Bea presents one active question, keeps the reply and typing state in one
  chronological stream, and offers a manual handoff.
- Progress is continuous and derived from real state. Imported values hydrate as
  ordinary CreatorJobs fields.
- Compensation, custom experience, recruiter precedence, hiring identity,
  application privacy, and background brand-enrichment boundaries are already
  represented in the frontend and must remain unchanged.

## Usability and visual findings

- The import entry repeats privacy reassurance in a separate card and makes the
  source control feel more like a utility panel than the start of one coherent
  creation flow.
- Bea's name and current status are visually weaker than the source label. On
  mobile her avatar disappears, so the experience loses the conversational
  identity it relies on.
- The manual escape hatch has sufficient DOM presence but insufficient visual
  affordance; it resembles footer copy instead of an available action.
- The assistant and preview each sit inside another bordered panel on desktop,
  creating unnecessary nested-card weight. The fixed-height assistant also
  exaggerates empty space while a short first question is active.
- Question choices are easy to scan, but recommended states, focus rings, and
  the free-text composer are inconsistent with the rest of the product.
- Post Job's persistent header reports only the product name and a bar. It does
  not state the focused question, while the form card falls back to terse,
  uppercase section labels.
- Desktop Post Job uses three similarly weighted surfaces (identity, form,
  preview). Primary Continue, Back, and Save actions do not have a clear visual
  hierarchy.
- The recruiter preview repeats empty-value rows, which makes an intelligent
  partial draft feel mostly unfinished. Its outer wrappers add more borders
  than information.
- The About field has the correct hiring-identity label but little context about
  the candidate-facing purpose of the text. Optional enrichment is correctly
  silent; no frontend status should imply work the server has not reported.
- Remote geography is representable by the import preview but was cleared when
  hydrated into Post Job and replaced with the word `Remote` on save. This is a
  frontend representation defect for values such as `Remote, India`.

## Responsive and accessibility findings

- At 390px and 430px the global desktop rail still reserves 80px, leaving an
  unacceptably narrow job-creation canvas. The route needs an intentional mobile
  frame rather than a squeezed desktop frame.
- Mobile preview and fixed actions are reachable, but several quiet text actions
  need clearer 44px targets and focus treatment.
- Assistant avatars are hidden below `sm`; visible identity should not depend on
  viewport width.
- Existing labels and reduced-motion behavior are strong. The remaining work is
  consistent focus visibility, clearer status copy, touch sizing, and long-token
  containment.

## Implementation boundary

The redesign will change presentation and frontend representation only. It will
not add inference, reinterpret extraction, decide source authority, change API
shapes, trigger enrichment on render, or alter publication/application privacy.
