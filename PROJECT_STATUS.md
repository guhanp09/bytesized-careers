# CreatorJobs Phase 1 - Project Status

## How to Run Locally

### Prerequisites
- Node.js (version specified in package.json)
- Python 3.8+ (for backend)
- npm or yarn

### Frontend Setup
```bash
cd /Users/guhanpurushothaman/creator-jobs-phase1
npm install
npm run dev  # Runs on http://localhost:3000
```

### Backend Setup
```bash
cd backend
# Install dependencies. pyproject.toml + uv.lock are the only dependency
# contract; there is no requirements.txt and adding one would create a second
# answer to the same question. See backend/README.md "Dependency contract".
uv sync --all-groups
# Run backend server
make dev  # or uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Environment Variables
- Frontend: `.env.local` with `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000/api/v1`
- Backend: `.env` with database and other configs

## Architecture Overview

### Frontend
- **Framework**: Next.js 16.1.6 with App Router
- **Styling**: Tailwind CSS v4
- **State Management**: React hooks, NextAuth for auth
- **Key Modules**:
  - `app/`: App Router pages and API routes
  - `components/`: Reusable UI components
  - `lib/`: Utilities, types, backend client
  - `backendClient.ts`: API client for backend communication

### Backend
- **Framework**: Python FastAPI (inferred from backend/app/main.py)
- **Database**: PostgreSQL with Alembic migrations
- **Key Modules**:
  - `backend/app/`: FastAPI application
  - `backend/alembic/`: Database migrations
  - `backend/tests/`: Test suite

### Data Flow
- Frontend calls backend via `lib/backendClient.ts`
- Backend base URL: `http://localhost:8000/api/v1` (configurable via env)
- Authentication: NextAuth with Google OAuth

## Behance-inspired CreatorJobs profile redesign

- [x] Phase 1: Inspect current profile implementation
- [x] Phase 2: Build wide profile shell/layout
- [x] Phase 3: Add hero/banner + identity row
- [x] Phase 4: Convert tabs to profile navigation
- [x] Phase 5: Add left profile rail
- [x] Phase 6: Redesign Overview tab as profile snapshot
- [x] Phase 7: Redesign Portfolio tab as visual work grid
- [x] Phase 8: Redesign Jobs tab
- [x] Phase 9: Redesign right checklist rail
- [x] Phase 10: Editing behavior improved
- [x] Phase 11: Creator economy language applied
- [x] Phase 12: Visual design rules applied
- [x] Phase 13: Compact empty states added
- [x] Phase 14: Public profile behavior respected where route exists
- [x] Phase 15: Backend/data integration handled safely
- [x] Phase 16: Components organized cleanly
- [x] Phase 17: Checks run
- [x] Phase 18: Acceptance criteria verified
- [x] Phase 19: Final response prepared

Phase 1 notes:
- Inspected `app/you/page.tsx`, `components/you/YouHubClient.tsx`, `components/you/ProfileCompletionCard.tsx`, `components/you/PortfolioProjectWorkspace.tsx`, `app/u/[slug]/page.tsx`, `components/profile/PublicProfileTabs.tsx`, `app/layout.tsx`, `components/Header.tsx`, and `components/Sidebar.tsx`.
- Current owner profile is constrained by `app/you/page.tsx` at `max-w-6xl`, then `YouHubClient` renders a large profile card followed by a main content column plus right checklist rail.
- Current editing, roles, content style, hiring info, jobs, and portfolio logic is concentrated in `YouHubClient`; safest first step is layout refactoring without changing data flow or backend APIs.
- Public profile route has a separate narrow card stack and should be redesigned in a later phase after the owner shell is stable.

Phase 2 notes:
- Widened authenticated `/you` from `max-w-6xl` to a full-width `max-w-[1560px]` content area.
- Converted the owner profile body into a responsive shell: center content + compact right checklist rail on large screens, and a three-column desktop layout with a left profile snapshot rail at `xl` and above.
- Added an initial left rail using existing profile data only: creator fit, projects/jobs/reviews stats, availability, location/timezone, selected roles, content style, and connected channels/pages.
- Kept all existing owner editing flows, role autosuggest, content style save, hiring info, jobs tab, portfolio project workflow, and backend API usage intact.
- Updated `ProfileCompletionCard` so the right rail can shrink to the new layout width instead of forcing a 360px sidebar.
- Checks run: `npm run lint` passed with existing warnings; `npm run build` passed.

Phase 3 notes:
- Replaced the old compact top card on the owner `/you` page with a wide dark matte hero/banner surface and an overlapping avatar.
- Preserved the existing avatar selection menu and YouTube avatar mode without adding upload infrastructure.
- Added a stronger identity row with display name, username, headline/bio fallback, location/timezone, rating, availability, and restrained trust badges for verified channel, proof added, and hiring-ready status.
- Added owner actions in the identity row: `Edit profile` opens the overview headline editor and `View public profile` opens the preview profile route.
- Added a disabled owner-only banner control because banner upload infrastructure does not exist yet.
- Checks run: `npm run lint` passed with existing warnings; `npm run build` passed.

Phase 4 notes:
- Moved profile navigation out of the content card and into a profile-nav row directly below the hero.
- Changed tab language to profile-oriented labels: `Overview`, `Work`, `Jobs`, `Applications`, and `Saved`.
- Kept query-tab behavior intact through the existing `setTab` flow.

Phase 5 notes:
- Expanded the desktop left rail into display-first profile metadata: profile snapshot, creator roles, content style, connected channels/pages, and collaboration preferences.
- Edit affordances reuse existing owner edit actions and do not introduce duplicate profile state.

Phase 6 notes:
- Reworked the owner Overview tab into a snapshot-first surface with featured work, creator fit, stats, about summary, and jobs preview.
- Moved the former always-visible settings/form stack out of `/you` and into the dedicated `/you/edit` editor so the default page reads like a profile rather than a form.
- Preserved existing roles, content style, profile, availability, location/timezone, hiring info, and collaboration preference save paths through the focused editor.

Phase 7 notes:
- Updated the portfolio workspace title to `Work` with proof/outcome-focused copy.
- Kept the Behance-inspired project builder modal and image-first project cards.
- Adjusted work grids to support more columns on wide layouts while staying one column on mobile.

Phase 8 notes:
- Reworked the Jobs tab into a profile management view with posted-role header, active/past stats, hiring identity trust signal, compact job cards, and actionable empty states.
- Existing job detail links and `/post-job` flow are preserved.

Phase 9 notes:
- Made the right rail consistently useful by showing both profile completion and portfolio improvement checklists instead of only showing portfolio progress on the portfolio tab.
- Checklist percentages still use existing real profile/portfolio state.

Phase 10 notes:
- Owner editing forms are no longer the default profile experience. Profile editing now lives behind the primary `Edit profile` action at `/you/edit`.
- Portfolio create/import continues to open the existing guided editor modal instead of rendering a giant always-visible add form.

Phase 11 notes:
- CreatorJobs-specific language is applied across the redesigned owner surfaces: `Work`, `Proof of work`, `Creator fit`, `Roles`, `Channels/pages`, `Collaboration preferences`, `Featured work`, and `Availability`.

Phase 12 notes:
- Owner and public profiles preserve the dark CreatorJobs style: pitch-black page background, dark gray surfaces, subtle borders, restrained badges, off-white text, muted secondary text, and no Behance-blue branding.
- The owner profile shell collapses from a three-column desktop layout to a two-column large layout and a single-column mobile flow.
- Profile navigation is horizontally scrollable for narrow screens.

Phase 13 notes:
- Empty states are compact and actionable: portfolio proof prompts route to import/create actions, jobs empty states route to post or browse jobs, and public profile gaps use small neutral states.

Phase 14 notes:
- Public `/u/[slug]` now uses a matching wide profile shell with a matte banner, prominent identity row, left creator metadata rail, main public tabs, and right credibility/featured-work rail.
- Public profile behavior remains read-only: no edit controls, no owner checklist, no private drafts, and no owner-only controls.
- `components/profile/PublicProfileTabs.tsx` now uses profile-style navigation and an image-first `Work` grid for public portfolio items.

Phase 15 notes:
- Existing backend profile, public profile, jobs, roles, social connection, and portfolio data are reused.
- Backend was not touched for this frontend/profile-layout pass.
- Public and owner profile routes continue to catch missing/API-failed profile states gracefully.

Phase 16 notes:
- The redesign reuses and extends existing components instead of creating a duplicate profile system: `YouHubClient`, `ProfileCompletionCard`, `PortfolioProjectWorkspace`, `PublicProfileTabs`, and `PlatformLogosRow`.
- Small helper components/functions were added in-place where they reduce duplication without a risky broad extraction.

Phase 17 notes:
- Checks run after completing the remaining redesign work: `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
- `npx tsc --noEmit` passes.
- `npm run lint` passes with warnings only, primarily existing `<img>` optimization warnings and unrelated unused variables in `components/post-job/PostJobForm.tsx`.
- `npm run build` passes.

Phase 18 notes:
- Acceptance criteria verified: `/you` is wide and profile-like, hero/banner and identity are prominent, tabs are profile navigation, rails are compact and responsive, Overview is a snapshot, Work is visual/grid-oriented, Jobs is profile-specific, checklist is compact/state-driven, and public profile is structurally aligned.

Phase 19 notes:
- Final response prepared with completed work, changed files, checks, warnings, manual verification, and known limitations.

## Behance-inspired CreatorJobs profile redesign refinement

- `/you` owner profile now uses a wider `max-w-[1680px]` showcase shell so the page feels less like a centered dashboard.
- Hero/banner hierarchy was strengthened with a taller matte banner, larger anchored avatar, larger display name, clearer metadata grouping, and owner actions kept to the right.
- Profile navigation was simplified to readable section labels (`Overview`, `Work`, `Jobs`, `Applications`, `Saved`) with a quiet underline active state instead of dashboard-style eyebrow labels.
- Left rail was tightened into a profile identity/control rail with creator fit, roles, content style, channels/pages, and collaboration preferences using lighter cards and less repeated empty copy.
- Overview was refined to be work-first: the largest section now highlights portfolio work, with compact stats below and secondary creator-fit/about/jobs sections after it.
- Work tab was refined toward a Behance-like project area with a stronger Work header and a visual create-project tile for empty portfolios; add/import still opens the existing project editor.
- Right checklist utilities were made lighter, shorter, sticky on desktop, and still state-driven from real profile/portfolio data.
- Public profile consistency from the previous pass is preserved; `/u/[slug]` remains read-only and does not show owner checklist, drafts/private controls, or edit actions.

Known limitations:
- Banner upload remains unavailable; the banner control is intentionally disabled until upload infrastructure exists.
- Public viewer actions such as message/invite/save are not implemented because there are no existing flows to connect them to.
- Retention and CTR remain self-reported metrics unless imported backend data supplies them.

## Display-first owner profile refactor

- `/you` is now the owner profile preview/showroom, not the profile data-entry surface.
- Added `/you/edit` as a dedicated full-page profile editor with grouped sections: Basics, Roles & content style, Channels & trust, Collaboration preferences, and Visibility & customization.
- Removed the old collapsed inline profile-edit schema from `/you`; the hero now keeps one primary `Edit profile` path and one `View public profile` action.
- Added display-mode rules so `/you` only renders meaningful creator metadata sections. Empty roles, content style, channels/pages, collaboration preferences, and all-zero stats are hidden instead of becoming separate empty cards.
- Kept the Overview work-first: portfolio work remains the primary block, with creator-fit/about/stats only appearing when there is real data.
- Kept Work/project creation in the existing portfolio project editor flow; `/you` and the Work tab do not expose giant add/edit forms by default.
- Updated checklist actions so missing-profile guidance points to `/you/edit#roles`, `/you/edit#content-style`, `/you/edit#channels`, `/you/edit#availability`, or the Work tab instead of scattering prompts across the profile page.
- `/u/[slug]` remains read-only and structurally aligned with the profile showcase language; it does not show owner edit controls, checklist, drafts, or private items.

Known limitations:
- Banner/avatar upload is still not implemented; avatar mode can still use the existing generic/YouTube options.
- Visibility/customization controls in `/you/edit` are currently read-only summaries of the existing backend privacy settings; persistent new section toggles need backend support.
- Hiring identity add/verification management is not duplicated on `/you`; the edit page keeps existing hiring trust fields and connected-account display, while deeper verification flows remain tied to existing backend capabilities.

## Display-first owner profile visual polish

- Banner size was maintained and a centered owner-only empty-banner prompt was added with `Add banner image` and recommended `3200 × 410px` guidance.
- The banner prompt routes to `/you/edit#banner`; upload infrastructure is still not claimed or implemented.
- Hero identity hierarchy was strengthened with larger display name type, a single readable metadata line, a cleaner headline placeholder, and hidden empty platform buttons.
- Primary work language was softened from `Proof of creator work` to `Portfolio work`.
- Portfolio work actions now sit in a clean header row as `Add work sample` and `Import YouTube video`, and they launch the existing portfolio editor flow.
- Empty portfolio state was redesigned as a larger first-project tile with project-card proportions and direct create/import actions.
- Weak starter-state About/Profile Summary and all-zero stats remain hidden unless meaningful content exists.
- Jobs preview no longer renders a large empty card; starter profiles hide hiring CTAs from Overview until there is hiring activity.
- Left rail was simplified to `Profile basics` with availability/location/profile completion CTA, while roles, content style, channels/pages, and preferences still render only when populated.
- Checklist cards were lightened, shortened, and limited to the top tasks by default with concise copy and `See more`.
- `/you` remains display-first while `/you/edit` remains the setup/data-entry surface.
- Hero identity composition was corrected so only the avatar overlaps the banner; the display name, metadata, headline, trust row, and owner actions now sit inside the identity area without clipping.
- Empty portfolio views no longer duplicate create/import CTAs in both the section header and starter tile; header actions appear once there is portfolio content.
- The empty portfolio CTA tile was softened with a calmer project-card surface and lighter nested borders.
- The starter-state `Hiring too?` overview card was hidden so the empty profile stays focused on portfolio creation until hiring activity exists.
- `/you` shell gutters were reduced slightly and the owner profile max-width was widened for a more confident desktop composition.
- Portfolio empty state language was refined for talent users: project language was softened to work sample language, YouTube import CTA was clarified, and the empty card now previews thumbnail/role/tools/outcome structure.
- Portfolio empty state was simplified for talent users: the large work-sample card is now the single primary CTA, duplicate buttons were removed in empty state, examples were converted from chips to subtle guidance text, and Add work sample opens a focused choice flow for YouTube import, custom work, or external links.

Known limitations:
- Banner upload remains unavailable; `/you/edit#banner` is an anchor into the profile editor, not an uploader.
- Existing `<img>` lint warnings remain because this pass did not convert the image system to `next/image`.

## Display-first profile layout cleanup

- Redundant starter-state `Profile basics` card is hidden; username, location, and availability stay in the hero unless there is additional meaningful profile data to show.
- Profile and portfolio setup guidance moved out of the permanent right rail into an owner-only floating bottom-right checklist widget.
- The portfolio section expands into the available profile width when starter-state side rails are absent.
- `Portfolio work` heading, guidance copy, and the clickable `Add work sample` tile now render as one unified card.
- Empty `Published projects` headers and filter controls are hidden until portfolio items exist.

## Profile action button polish

- Hero actions were made quieter and more native to the dark profile surface.
- `Public view` was renamed to `View public profile`.
- `Open proof` was renamed to `Open project`.
- Project card `Pin`/`Edit`/`Delete` actions moved into an owner-only overflow menu.
- Delete no longer appears as a permanent visible card button.
- Public profile project cards remain viewer-safe and do not expose owner management actions.
- Profile and project action controls polished: hero actions now use a quieter native action style, project card actions are visually lighter, owner controls remain in overflow, and overflow menu clipping near card/page edges was fixed.

## Project card and profile action polish

- Project cards are now clickable instead of using a visible `Open project` button.
- Card hover/focus states indicate clickability with subtle border, shadow, and image treatment.
- Role text was made more visible as a hiring signal.
- Project actions remain in the owner-only overflow menu.
- Overflow menus open downward and stay anchored correctly to the trigger.
- Portfolio project areas were expanded to comfortably support two rows on desktop.
- `Edit profile` moved to an icon next to the profile name.
- `View public profile` changed to an icon-only action.
- Tooltips were added for icon-only controls.
- `/you` remains display-first while `/you/edit` remains the setup/data-entry surface.

## Portfolio card sizing regression fixed

- Individual project cards were restored to natural portfolio-card height.
- Two-row room is now created at the section/grid level, not by stretching cards.
- The Add Project card matches real project card dimensions again.
- Project Actions trigger and tooltip placement were corrected within the normal card footer.
- Downward Project Actions menu behavior was preserved without oversized cards.

## Project card layout and action behavior refined

- Project cards were restored to a compact natural height focused on thumbnail, badges, title, role, source/date, and actions.
- The Add Project card now matches real project card dimensions and card rhythm.
- Owner card click now opens the internal project detail page.
- External `Open project` moved into the owner dropdown with an external-link icon.
- `Edit project` was removed from the dropdown.
- Role visibility was improved while keeping the title primary.
- Public profile cards remain viewer-safe and do not expose owner controls.

## Dedicated project detail pages

- Existing project cards now open dedicated project detail pages instead of the creation wizard.
- Owner project detail pages show all entered project data at once and include a non-wizard edit surface.
- Public project pages are read-only and hide edit, delete, and pin controls.
- The project creation wizard remains only for new projects from the Add Project card.
- Project pages use portfolio/case-study patterns with large media, title, role, context, tools, contribution, and outcome sections.
- External source links remain available as `Open project` with an external-link icon.

## Project detail route loading fixed

- Project cards now route using saved project IDs.
- Owner project detail pages load by project ID instead of treating the route segment as a token.
- Token expiry errors are no longer shown for normal saved project detail routes.
- Public project routes remain read-only and visibility-safe.
- The Add Project card still opens the project creation flow.

## Post-job hiring info gate removed

- `/post-job` no longer blocks form access on Hiring Info/profile readiness.
- Hiring identity selection is optional; users can publish without adding a channel or Instagram page first.
- The optional hiring identity section still preselects saved identities when available.
- YouTube jobs can be created without a linked YouTube channel when no channel/identity is supplied.
- Supplied hiring identities and linked YouTube channels still use existing ownership validation.

## Frontend local startup fixed

- Confirmed port 3000 had no running frontend server, causing the browser connection refusal.
- Started the Next.js dev server on `http://localhost:3000`.
- The home jobs feed now falls back to local job data in development when the backend is offline.
- `/post-job` and job detail routes continue to load without requiring the backend for initial page render.
- Job posting now falls back to the local job store when the backend is unreachable in local development.
- Job detail pages now try the local job store if the backend does not return a job.
- `/you` now renders a local profile shell instead of surfacing raw backend connection errors when the backend is unavailable.

## Profile and portfolio persistence audit

- Profile edits are routed through authenticated backend profile APIs and persisted to the backend database.
- Portfolio project create/update/delete and pin/unpin actions are routed through authenticated backend portfolio APIs.
- The main Project Builder save path reloads the saved portfolio list from the backend after create/update/delete/pin actions.
- The legacy YouTube portfolio save path now reloads the saved portfolio list from the backend after creation instead of treating React state as the source of truth.
- No permanent profile or portfolio data is stored in `localStorage` or `sessionStorage`.
- Local offline `/you` profile rendering is marked read-only when backend storage is unavailable, and the Add Project entry point is disabled until backend storage is reachable.
- Backend Docker PostgreSQL storage uses the named `postgres_data` volume; the development seed endpoint only inserts missing sample jobs and does not reset user profile or portfolio records.

## Unified profile surface refinement

- Hero, identity row, tabs, and active tab content now share one unified profile surface on `/you`.
- `Portfolio work` no longer appears as a separate disconnected module; its heading and grid sit inside the active profile tab content.
- Tabs are attached to the profile navigation area with a restrained divider/underline treatment.
- Card usage was reduced to actual content objects such as work sample cards and the Add Work Sample card.
- Major left/right edges now share the same profile-surface padding and alignment.
- Portfolio filters are hidden for low sample counts and only appear once there are enough work samples to justify filtering.
- The floating setup checklist remains outside the main profile layout.

## Final profile visual rhythm polish

- Removed the extra divider above the profile tabs so navigation sits naturally under the identity section with one subtle divider below.
- Rating row restored for zero-review profiles: empty stars and `(0 reviews)` now display on owner/public profiles instead of being hidden.
- The unclear `Work added` hero badge was removed so starter profiles do not show internal status language.
- The Work grid now uses available desktop space more intentionally with up to three portfolio-card columns.
- The Add Work Sample card was polished as a future-card placeholder with the same grid footprint as saved work samples.
- Portfolio guidance copy was shortened to keep the Work tab calmer and more hiring-focused.
- The floating setup widget was made more compact and discreet while staying owner-only and outside the main layout.
- Portfolio filters remain hidden until there are enough work samples to make filtering useful.

## Link-first portfolio work sample flow

- External links are now the default starting point for adding portfolio work: the Add Work Sample dialog first asks for a work link instead of asking users to choose a technical source type.
- Add Work Sample flow simplified to link-first only: the first screen now asks only for a public/shareable work link, removes `Add manually` and manual work-type choices from the default path, fetches metadata when possible, and lets users fill missing hiring context after preview or fallback.
- The `Add work sample` card uses the same grid footprint as future work cards and remains in the grid after samples are added.
- Source detection supports YouTube, Vimeo, Drive, Google Docs, Notion, Behance, Instagram, TikTok, Figma, Canva, Dropbox, and generic website links where possible.
- YouTube links route into the existing YouTube metadata import path; other detected links use the existing manual/external work-sample editor with the URL prefilled.
- Manual completion remains available only after a link is supplied and preview/fallback opens the work-sample editor.
- `/you` remains display-first; creation details stay inside the Add Work Sample flow.

## Work sample builder wizard refinement

- The work sample builder now shows one focused wizard stage at a time instead of stacking all form sections in one long admin-style form.
- Work Sample Builder wizard simplified: Source and Cover steps were merged into one `Source & cover` screen, reducing unnecessary clicks while preserving link preview, Google Drive restriction guidance, thumbnail override, and card preview.
- The builder modal uses a viewport-bounded layout with internal scrolling, visible close controls, a subtle progress bar, and persistent footer actions.
- User-facing source labels were clarified, including `Google Drive` instead of `Drive`, with clearer external/source badges.
- Private or restricted link guidance was added for Google Drive/Docs-style preview failures while preserving the URL for manual completion.
- Cover wording now focuses on `Cover / thumbnail`, `Thumbnail preview`, and `Thumbnail image URL` instead of source-specific cover text.
- The title field is labeled `Work sample title` with a creator-economy placeholder, and source-generated fallback titles are avoided when metadata is missing.
- The old Now/Past status choice was replaced in the visible builder with project timeline fields and an `I'm currently working on this` option, while preserving the existing Now/Past persistence mapping internally.
- Role/source-aware contribution and tool suggestions were expanded for creator-economy roles such as video editor, thumbnail designer, scriptwriter, researcher, motion graphics designer, and animator.
- Manual fallback remains available after link preview failure; no file upload or storage support was added.

## Project builder copy and flow cleanup

- Duplicate step headings were removed from the visible builder screens so each wizard stage has one clear title.
- User-facing builder copy now uses project language, including `Project builder`, `Add project`, `Project details`, and `Project title`.
- The Contribution screen spacing was tightened and reset-on-step navigation was added so the active card starts cleanly in the modal body.
- The redundant `What did you handle?` chips were removed from the visible Contribution step.
- The Outcome/Metrics step was removed from the visible wizard; existing saved metric data remains preserved by the current portfolio data model.
- The wizard is now shortened to `Source & cover`, `Project details`, `Contribution`, and `Review`.
- Existing link-preview/manual fallback behavior remains preserved; no backend or upload support changes were made.
- Project Builder Source & cover step now includes Refresh preview behavior so users can edit the Project URL and refetch metadata without restarting the flow; clicking Next also auto-refreshes when the Project URL changed.

## Add Project first-screen copy polish

- `Project link` was renamed to `Project URL` on the first Add Project dialog.
- First-screen explanatory copy was reduced to a concise title, subtitle, input, primary action, helper text, and supported-platform line.
- The supported platform list was cleaned up and generic website support was moved to softer helper copy.
- A subtle animated URL placeholder was added with reduced-motion fallback behavior.
- Existing link-preview and manual fallback flow remains preserved; no backend changes were made.

## Completed Features

### Auth (DONE)
- Google OAuth login via NextAuth
- Session handling with `next-auth/react`
- Files: `app/api/auth/[...nextauth].ts`, `components/AuthProvider.tsx`, `app/auth/page.tsx`

### Jobs Feed (DONE)
- Job listing with filtering by category and start timeframe
- Pagination (basic)
- Tags display
- Files: `app/page.tsx`, `components/JobCard.tsx`, `components/JobGridClient.tsx`, `lib/jobs.ts`

### Job Details Page (DONE)
- Full job details with hero, description, actions
- Reference videos display
- Files: `app/jobs/[id]/page.tsx`, `components/job-details/`

### Post a Job Flow (PARTIAL)
- Multi-step form with validation
- Preview card
- Files: `app/post-job/page.tsx`, `components/post-job/PostJobForm.tsx`
- Missing: Backend integration for job creation

### Apply Flow (TODO)
- Placeholder button with alert
- Files: `components/job-details/JobActionsPanel.tsx`

### Profile Page (PARTIAL)
- Basic profile display
- Files: `app/u/[slug]/page.tsx`, `components/you/`
- Missing: Full profile editing, portfolio section

### Roles Selection (DONE)
- Autosuggest chips with popularity scoring
- Files: `seed/roles_batch_1.json`, `components/post-job/PostJobForm.tsx`

### Role Clarification Questions (TODO)
- Not implemented
- No backend endpoints or UI

### Portfolio Section (TODO)
- Behance-inspired creator proof-of-work workflow added for `/you?tab=portfolio`
- Users now create projects through a guided editor instead of an always-visible form
- Supports YouTube metadata preview, Custom URL/Google Drive/Google Docs/Notion/Behance/Instagram/Vimeo/Figma/Canva proof, draft/published states, featured work, public/private visibility, role-aware contribution chips, tools, tags, and self-reported metrics
- Files: `components/you/PortfolioProjectWorkspace.tsx`, `components/you/YouHubClient.tsx`, `backend/app/api/v1/routers/portfolio.py`, `backend/app/models/portfolio_item.py`, `backend/app/services/profile_service.py`

## Portfolio System Update

- Behance-inspired project workflow added: content/proof first, cover preview, basics, contribution details, metrics, review, save draft, publish.
- YouTube import preview added through `POST /api/v1/portfolio/youtube/preview`; fetches public metadata only and does not auto-save.
- Portfolio project editor added inside the owner dashboard portfolio tab.
- Rich image-first portfolio cards added for owner portfolio projects and existing public profile cards now receive published-only backend data.
- Overview project preview now reuses/matches the Work tab project card style for consistent profile presentation. Management-style actions were removed from the Overview preview where inconsistent.
- Draft/published states added with `publish_status`.
- Featured work support added with pin/unpin from cards.
- Custom project support includes Custom URL, Google Drive, Google Docs, Notion, Behance, Instagram, Vimeo, Figma, and Canva source labels.
- Portfolio checklist now uses real saved portfolio state and requires at least one published proof item.

New backend endpoints:
- `POST /api/v1/portfolio/youtube/preview`
- `POST /api/v1/portfolio/items`
- `GET /api/v1/portfolio/items?user_id=me`
- `GET /api/v1/portfolio/items?user_id={user_id}`
- `PATCH /api/v1/portfolio/items/{id}`
- `DELETE /api/v1/portfolio/items/{id}`
- `GET /api/v1/portfolio/{user_id}`

New migration:
- `backend/alembic/versions/0014_portfolio_project_states.py`

Required env vars:
- `YOUTUBE_API_KEY`
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_USE_LOCAL_MOCKS`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Known limitations:
- Retention and CTR are self-reported unless a user provides them manually.
- YouTube public metadata does not include retention.
- Custom project uploads are URL-based; no upload infrastructure is implemented.
- YouTube API quota/caching may be needed later.

Manual verification:
1. Start Postgres.
2. Run backend migrations.
3. Start backend with `YOUTUBE_API_KEY` set.
4. Start frontend.
5. Open `/you?tab=portfolio`.
6. Click `Import from YouTube`.
7. Paste a public YouTube URL and click `Fetch video`.
8. Confirm thumbnail, title, channel, views, duration, and verified badge appear.
9. Select a role, contribution chips, tools, and retention.
10. Save draft and confirm it appears in Drafts.
11. Edit the draft and publish it.
12. Pin it and confirm it appears in Featured work.
13. Refresh and confirm persistence.
14. Add a custom project and confirm it appears with Manual/Self-reported badges.
15. Smoke check jobs feed, auth, and post-job.

### Link-preview metadata auto-fill added
- Added authenticated `POST /api/v1/portfolio/link-preview` for pasted portfolio/work links.
- YouTube links use server-side YouTube API metadata when `YOUTUBE_API_KEY` is configured; YouTube oEmbed and manual fallback remain available when full metadata is unavailable.
- Vimeo uses oEmbed where public metadata is available; generic sites use Open Graph/Twitter/title metadata fallback.
- Behance, Drive, Google Docs, Notion, Instagram, TikTok, and generic public links are detected and fall back gracefully when metadata is blocked or limited.
- Frontend Add Work Sample now calls link preview, pre-fills title/source/thumbnail/provider/public metrics when available, and keeps all fetched fields editable.
- Manual fallback remains available for private, blocked, unsupported, or partially fetched links.
- SSRF safety added through http/https-only validation, localhost/private-network rejection, request timeout, redirect checks, and response-size limiting.
- `YOUTUBE_API_KEY` is optional but required for full YouTube title/thumbnail/channel/public metric metadata.

### Saved Jobs / Bookmarks (PARTIAL)
- Save button with alert
- Files: `components/job-details/JobActionsPanel.tsx`
- Missing: Persistence and saved jobs page

### Notifications (PARTIAL)
- Bell icon with placeholder
- Files: `components/Header.tsx`

### Admin / Moderation (TODO)
- Not implemented

### Backend Endpoints Coverage + Seed Data (PARTIAL)
- Basic job listing: `api/jobs/route.ts`
- Auth endpoints: `api/auth/[...nextauth].ts`
- Identity endpoints: `api/identity/`
- Seed data: `seed/roles_batch_1.json`, `lib/jobs.ts`
- Missing: Full CRUD for jobs, applications, users

## Partially Done Features

### Post a Job Flow
- **What's done**: Form UI, validation, preview
- **What's missing**: Backend API call to create job
- **Where to finish**: `components/post-job/PostJobForm.tsx` submit handler, backend `POST /jobs`

### Profile Page
- **What's done**: Public profile display, owner editing, portfolio project cards
- **What's missing**: Upload infrastructure for portfolio media/covers
- **Where to finish**: upload service and portfolio media storage

### Saved Jobs
- **What's done**: UI button
- **What's missing**: Backend persistence, saved jobs list
- **Where to finish**: `api/jobs/saved/route.ts`, `app/you/saved/page.tsx`

### Notifications
- **What's done**: UI placeholder
- **What's missing**: Real notification system
- **Where to finish**: Backend notification service, real-time updates

## Todo List Prioritized for MVP

1. **Implement job creation backend** - POST /api/jobs endpoint to save posted jobs
2. **Complete apply flow** - Create application form and backend storage
3. **Add job persistence** - Connect frontend to real backend jobs instead of static data
4. **Implement saved jobs** - Backend endpoint and frontend persistence
5. **Add profile editing** - Allow users to edit their profiles
6. **Implement role clarification questions** - Dynamic questions based on selected roles
7. **Add portfolio uploads** - Optional upload infrastructure for project covers/media beyond URL-based proof
8. **Complete notifications system** - Real notifications for applications, etc.
9. **Add job search functionality** - Full-text search across jobs
10. **Implement admin moderation** - Dashboard for job approval/rejection

## Known Issues / Tech Debt

- Many `<img>` tags should be replaced with Next.js `<Image>` for performance
- ESLint warnings for unused variables (Link, useEffect, etc.)
- Static job data in `lib/jobs.ts` needs to be replaced with dynamic backend calls
- No error handling for API failures
- Missing loading states for async operations
- No tests implemented
- Backend and frontend are separate repos/services - integration complexity
