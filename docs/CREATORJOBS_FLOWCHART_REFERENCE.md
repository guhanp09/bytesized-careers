# CreatorJobs Flowchart Reference

Generated: 2026-05-17

Purpose: page-by-page control map for creating flowchart diagrams. This focuses on which visible buttons, links, tabs, cards, and repeated controls lead where or what state/action they trigger.

Legend:

- Route: navigates to another route.
- Query route: navigates to a route with query params.
- Tab state: changes visible content without route navigation.
- Modal/popover: opens or closes an overlay.
- Scroll: scrolls to a section on the same page.
- API/action: submits data or calls an API, then stays, redirects, or shows state.
- External: opens an external URL.
- Placeholder: alert-only or visual-only behavior.
- Disabled: visible but not actionable in the current state.

## 1. High-Level Route Flow

```mermaid
flowchart TD
  Shell[Global Header + Sidebar]
  Home[/]
  Auth[/auth]
  Verify[/auth/verify]
  Intent[/auth/onboarding-intent and /auth/account-type]
  You[/you]
  PostJob[/post-job]
  JobDetail[/jobs/:id]
  PublicProfile[/u/:slug]
  Sent[/you/applications/sent]
  Received[/you/applications/received]
  Saved[/you/saved -> /you?tab=saved]
  LogoDebug[/dev/logo-debug]
  TypingTest[/smart-typing-test]

  Shell --> Home
  Shell --> You
  Shell --> PostJob
  Shell --> Sent
  Shell --> Received
  Shell --> Saved
  Shell --> Auth

  Home --> JobDetail
  Home --> PublicProfile
  Home --> PostJob
  Home --> Auth

  Auth --> Verify
  Auth --> Intent
  Auth --> You
  Auth --> Home

  Verify --> Auth
  Intent --> You
  Intent --> PostJob

  You --> PublicProfile
  You --> JobDetail
  You --> PostJob
  You --> Home

  PostJob --> You
  PostJob --> Home

  JobDetail --> Home
  JobDetail --> PublicProfile
  PublicProfile --> JobDetail
  Received --> PublicProfile
  Sent --> JobDetail
```

## 2. Shared Global Shell

Applies on all normal app pages because `Header` and `Sidebar` are mounted in `app/layout.tsx`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Global header | CreatorJobs logo | Route | `/` |
| Global header | Search text field | Local input | No route; stores no persistent search state in current code |
| Global header | Search icon button | Placeholder | No click handler |
| Global header | Mic button | Placeholder | No click handler |
| Global header | `Post` | Route | `/post-job` |
| Global header | Notifications bell | Popover | Opens/closes notifications popover |
| Notifications popover | Outside click/Escape implied by state? | Popover | Closes when bell is clicked again; current popover says `Notifications coming soon` |
| Global header, unauthenticated | Profile/avatar button | Popover | Opens account menu |
| Account menu, unauthenticated | `Log in` | Query route | `/auth?mode=login` |
| Account menu, unauthenticated | `Sign up` | Query route | `/auth?mode=signup` |
| Global header, authenticated | Profile/avatar button | Popover | Opens account menu |
| Account menu, authenticated | `Account` | Route | `/you` |
| Account menu, authenticated | `Public profile` | Route | `/u/{username}` when username exists |
| Account menu, authenticated | `Public profile` | Disabled | Disabled when username is unavailable |
| Account menu, authenticated | `Log out` | API/action | NextAuth sign out, then `/` |
| Sidebar | Home icon | Route | `/` |
| Sidebar | You/profile icon | Route | `/you` |
| Sidebar | Applications expander | Tab/popover state | Expands/collapses Sent and Received links |
| Sidebar applications | `Sent` | Route | `/you/applications/sent` |
| Sidebar applications | `Received` | Route | `/you/applications/received` |
| Sidebar | Saved icon | Route | `/you/saved` |

## 3. Home Job Feed `/`

Source files: `app/page.tsx`, `components/JobGridClient.tsx`, `components/JobCard.tsx`, `components/jobs/ChannelAttribution.tsx`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Home filter bar | Category chip `All` | Tab/filter state | Shows all jobs on `/` |
| Home filter bar | Category chip generated from `CATEGORIES` | Tab/filter state | Filters job grid by `job.category` |
| Home filter bar | `Start within` | Tab/filter state | Expands/collapses start timeframe chips |
| Home filter bar | Start timeframe chip generated from `START_TIME_VALUES` | Tab/filter state | Toggles start timeframe filter |
| Job grid | Job card click | Route | `/jobs/{job.id}` |
| Job grid | Job card Enter/Space key | Route | `/jobs/{job.id}` |
| Job card | Channel name, normal poster with slug | Route | `/u/{channelProfileSlug}` |
| Job card | Channel name, normal poster without slug | Disabled | No route; title says profile is not available |
| Job card | Channel name, agency poster | Modal | Opens agency destination chooser |
| Agency chooser | Backdrop | Modal | Closes chooser |
| Agency chooser | `X` close | Modal | Closes chooser |
| Agency chooser | `CreatorJobs profile` with slug | Route | `/u/{channelProfileSlug}` |
| Agency chooser | `CreatorJobs profile` without slug | Disabled | No route |
| Agency chooser | `YouTube channel` | External | Opens `https://www.youtube.com` placeholder |
| Job card | Save icon | Placeholder | Alert `Saved: {TITLE}`; no route or persistence |
| Job card | Share icon | API/action | Copies `/jobs/{id}` to clipboard, alert `Link copied!` |
| Home empty state | No button | None | Displays `No jobs found` |
| Home posted notice | No button | None | Appears when query `posted=1` |

## 4. Auth Page `/auth`

Source files: `app/auth/page.tsx`, `components/AuthPage.tsx`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Auth mode switch | `Log in` | Query route | `/auth?mode=login` |
| Auth mode switch | `Sign up` | Query route | `/auth?mode=signup` |
| Auth page | `Back to jobs` | Route | `/` |
| Auth page | `Continue with YouTube` | External/auth action | Starts Google OAuth through NextAuth |
| Google OAuth success | OAuth callback | Route | Safe `next`, otherwise `/auth/onboarding-intent` or `/you` depending session state |
| Login form | Email input | Local input | Updates login email |
| Login form | Password input | Local input | Updates login password |
| Login form | `Resend verification email` | API/action | Calls backend resend verification; stays on `/auth` |
| Login form | `Log in` submit | API/action | Calls NextAuth credentials; success routes to safe `next`, onboarding intent, or `/you` |
| Login form | `Log in` submit failure | Error state | Stays on `/auth`, shows error |
| Signup form | Intent option `I am looking for work` | Local state | Selects `LOOKING_FOR_WORK` |
| Signup form | Intent option `I am hiring creator talent` | Local state | Selects `HIRING_CREATOR_TALENT` |
| Signup form | Intent option `I want to do both` | Local state | Selects `BOTH` |
| Signup form | Intent option `I will decide later` | Local state | Selects `DECIDE_LATER` |
| Signup form | Username input | Local input | Updates username |
| Signup form | Email input | Local input | Updates email |
| Signup form | Password input | Local input | Updates password |
| Signup form | Confirm password input | Local input | Updates password confirmation |
| Signup form | `Resend verification email` | API/action | Calls backend resend verification; stays on `/auth` |
| Signup form | `Sign up` submit | API/action | Calls backend register; stays on `/auth`, shows verify-email success state |
| Signup success, development only | `Open verification link` | Query route | Opens backend-provided verification URL, typically `/auth/verify?token=...` |

## 5. Verify Email `/auth/verify`

Source files: `app/auth/verify/page.tsx`, `components/VerifyEmailPage.tsx`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Verify page load with token | Auto action | API/action | Calls backend verify endpoint |
| Verify success | `Go to log in` | Query route | `/auth?mode=login` |
| Verify error state | Email input | Local input | Updates resend email |
| Verify error state | `Resend verification email` | API/action | Calls backend resend verification; stays on page |
| Verify error/success page | Auth/login link variant | Query route | `/auth?mode=login` |

## 6. Onboarding Intent

Routes: `/auth/onboarding-intent`, `/auth/account-type`.

Source file: `components/AccountTypePage.tsx`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Page load, unauthenticated | Auth guard | Query route | `/auth?mode=login&next={currentRoute}` |
| Page load, admin/already selected | Auto route | Safe `next` or `/you` |
| Intent page | `Looking for work` option | Local state | Selects `LOOKING_FOR_WORK` |
| Intent page | `Hiring creator talent` option | Local state | Selects `HIRING_CREATOR_TALENT` |
| Intent page | `Both` option | Local state | Selects `BOTH` |
| Intent page | `Decide later` option | Local state | Selects `DECIDE_LATER` |
| Intent page | `Continue` | API/action | Saves onboarding intent, updates session, routes to safe `next` or `/you` |

## 7. Job Detail `/jobs/{id}`

Source files: `app/jobs/[id]/page.tsx`, `JobHero`, `JobDescriptionSections`, `ReferenceVideos`, `JobActionsPanel`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Not found state | `Back` | Route | `/` |
| Job hero | Channel name, normal poster with slug | Route | `/u/{channelProfileSlug}` |
| Job hero | Channel name, agency poster | Modal | Opens agency destination chooser |
| Agency chooser | `CreatorJobs profile` | Route/disabled | `/u/{slug}` when available; otherwise disabled |
| Agency chooser | `YouTube channel` | External | Opens `https://www.youtube.com` placeholder |
| Reference videos section | Reference video/card link | External | Opens reference video URL |
| Action panel | `Apply` | Placeholder | Alert `Apply flow later`; no route |
| Action panel | `Save` | Placeholder | Alert `Saved!`; no route or persistence |
| Action panel | `Share` | API/action | Copies `/jobs/{id}` to clipboard; success/failure alert |

## 8. Public Profile `/u/{slug}`

Source files: `app/u/[slug]/page.tsx`, `components/profile/PublicProfileTabs.tsx`, `PlatformLogosRow`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Profile not found | `Back to jobs` | Route | `/` |
| Profile moved | `Open new profile` | Route | `/u/{moved_to_username}` |
| Preview badge | `Exit preview` | Query route | `/you?preview=1` |
| Platform logo row | Platform icon button | Popover | Opens platform account popover |
| Platform account popover | Close icon | Popover | Closes popover |
| Platform account popover | `Open channel` or `Open profile` | External | Opens connected account URL |
| Public profile tabs | `Overview` | Tab state | Shows overview cards |
| Public profile tabs | `Jobs` | Tab state | Shows jobs tab |
| Public profile tabs | `Portfolio` | Tab state | Shows portfolio tab |
| Jobs tab | `Active` | Tab state | Shows active public jobs |
| Jobs tab | `Past` | Tab state | Shows past public jobs |
| Jobs tab job row | `View job` | Route | `/jobs/{job.id}` |
| Overview tab | Public link | External | Opens public link URL |
| Portfolio tab | `Now` | Tab state | Shows current portfolio items |
| Portfolio tab | `Past` | Tab state | Shows past portfolio items |
| Portfolio item | `Open proof` | External | Opens proof URL |

## 9. Authenticated Dashboard `/you`

Source file: `components/you/YouHubClient.tsx`.

Page-level route behavior:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| `/you`, unauthenticated | Sign-in prompt | Query route | `/auth` or `/auth?mode=login&next=/you` depending guard path |
| Profile header | Public view button/link | Route | `/u/{username}` when username exists |
| Preview banner | Dismiss/close | Local state | Hides preview banner |
| Top tabs | `Overview` | Query/tab state | Sets `/you?tab=overview`; shows overview |
| Top tabs | `Jobs` | Query/tab state | Sets `/you?tab=jobs`; shows jobs |
| Top tabs | `Portfolio` | Query/tab state | Sets `/you?tab=portfolio`; shows portfolio |

Profile header controls:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Header avatar | Avatar button | Popover | Opens avatar mode menu |
| Avatar menu | `Use generic avatar` | API/action | Updates avatar mode; stays on `/you` |
| Avatar menu | YouTube channel avatar option | API/action | Updates avatar mode to selected YouTube channel; stays on `/you` |
| Display name | Pencil/edit | Local state | Opens display name input |
| Display name edit | Save icon | API/action | Saves profile display name; stays on `/you` |
| Display name edit | Cancel icon | Local state | Cancels edit; stays on `/you` |
| Platform icon row | Platform icon | Popover | Opens platform account popover |
| Platform popover | Close icon | Popover | Closes popover |
| Platform popover | `Open channel/profile` | External | Opens connected account URL |
| Platform popover, owner mode | `Connect YouTube`/`Connect Instagram` or `Add account` | API/action | Starts connect callback when supplied |
| Platform popover, owner mode | `Remove` | API/action | Confirms then removes account when supplied |

Profile completion card:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Completion card | Checklist task button | Tab/scroll/local state | Runs task action; usually switches tab, opens edit mode, or scrolls to section |
| Completion card | `See more` | Local state | Expands hidden checklist items |
| Completion card | `See less` | Local state | Collapses checklist items |

Overview tab controls:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Roles card | Search roles input | Local filter | Filters role options |
| Roles card | Selected role chip/button | API/action | Toggles selected role; save persists through roles endpoint |
| Roles card | Role option button | API/action | Toggles selected role; save persists through roles endpoint |
| Content style | `Save` | API/action | Saves content style; stays on overview |
| Content style | Primary niche input | Local input | Updates primary niche |
| Content style | Format chip | Local state | Toggles format value |
| Content style | Tone chip | Local state | Toggles tone value |
| Content style | Target audience input | Local input | Updates target audience |
| Headline card | Card click or pencil | Local state | Opens headline editor |
| Headline editor | Save icon | API/action | Saves headline; stays on overview |
| Headline editor | Cancel icon | Local state | Cancels edit |
| Bio card | Card click or pencil | Local state | Opens bio editor |
| Bio editor | Save icon | API/action | Saves bio; stays on overview |
| Bio editor | Cancel icon | Local state | Cancels edit |
| Skills/tools card | Card click or pencil | Local state | Opens skills editor |
| Skills/tools editor | Save icon | API/action | Saves skills; stays on overview |
| Skills/tools editor | Cancel icon | Local state | Cancels edit |
| Availability card | Card click or pencil | Local state | Opens availability editor |
| Availability editor | Save icon | API/action | Saves availability; stays on overview |
| Availability editor | Cancel icon | Local state | Cancels edit |
| Location/timezone card | Card click or pencil | Local state | Opens location/timezone editor |
| Location/timezone editor | Save icon | API/action | Saves location/timezone; stays on overview |
| Location/timezone editor | Cancel icon | Local state | Cancels edit |
| Collaboration preferences card | Card click or pencil | Local state | Opens preferences editor |
| Preferences editor | Save icon | API/action | Saves preferences; stays on overview |
| Preferences editor | Cancel icon | Local state | Cancels edit |

Hiring Info controls:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Hiring Info card | `Save` | API/action | Saves user-level hiring info; stays on overview |
| Hiring identity row | `Request verification` | API/action | Calls verification request; updates identity status |
| Add identity form | Platform selector | Local state | Chooses YouTube or Instagram |
| Add identity form | Own/represented selector | Local state | Chooses own channel/page or agency representation |
| Add identity form | `Add channel/page` or save identity button | API/action | Creates/updates hiring identity; stays on overview |

Jobs tab controls:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Jobs tab | `Active` | Tab state | Shows active owner jobs |
| Jobs tab | `Past` | Tab state | Shows past owner jobs |
| Owner job row/card | `View job` | Route | `/jobs/{job.id}` |
| Jobs empty state | Browse/post link when present | Route | Usually `/` or `/post-job` depending empty state |

Portfolio tab controls:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Portfolio top actions | `Create project` | Modal | Opens project builder for custom/manual proof |
| Portfolio top actions | `Import from YouTube` | Modal | Opens project builder in YouTube import mode |
| Portfolio empty state | `Import from YouTube` | Modal | Opens project builder in YouTube import mode |
| Portfolio empty state | `Create custom project` | Modal | Opens project builder for custom/manual proof |
| Project builder | Close `X` | Modal | Closes editor without saving |
| Project builder step 1 | YouTube URL input | Local input | Updates preview URL/source URL |
| Project builder step 1 | `Fetch video` | API/action | Calls `POST /api/v1/portfolio/youtube/preview`; prefills title, cover, source, channel, public metrics; does not save |
| Project builder step 1 | `Add this project manually` | Local state | Switches editor from YouTube import to custom source |
| Project builder step 1 | Source selector | Local state | Chooses Custom, Website, Drive, Behance, Instagram, Vimeo, or Other |
| Project builder step 1 | Proof URL input | Local input | Updates source/proof URL |
| Project builder step 2 | Thumbnail URL input | Local input | Overrides cover image URL |
| Project builder step 2 | Thumbnail quality button | Local state | Selects fetched YouTube thumbnail option |
| Project builder step 3 | Project title input | Local input | Updates title |
| Project builder step 3 | Role autosuggest input | Local input | Selects/enters exact role from role catalog when available |
| Project builder step 3 | Visibility selector | Local state | Chooses Public or Private |
| Project builder step 3 | Status selector | Local state | Chooses Now or Past |
| Project builder step 3 | Summary textarea | Local input | Updates contribution summary |
| Project builder step 4 | Contribution chip | Local state | Toggles role-aware contribution tag |
| Project builder step 4 | Tool chip | Local state | Toggles tool |
| Project builder step 4 | Add tools input/button | Local state | Adds comma-separated tools |
| Project builder step 4 | Tag input/button | Local state | Adds up to 10 tags |
| Project builder step 4 | Existing tag chip | Local state | Removes tag |
| Project builder step 5 | Metric inputs | Local input | Updates self-reported views, retention, CTR, turnaround, subscriber gain, and metric notes |
| Project builder review | Featured checkbox | Local state | Toggles featured pin |
| Project builder review | `Save draft` | API/action | Creates/updates portfolio item with `publish_status=draft`; closes editor and refreshes portfolio |
| Project builder review | `Publish` | API/action | Validates title, cover, role, proof/summary, visibility, metrics; creates/updates item with `publish_status=published`; closes editor and refreshes portfolio |
| Project builder review | `Cancel` | Modal | Closes editor without saving |
| Published projects | Source filter | Local filter | Filters published cards by source |
| Published projects | Status filter | Local filter | Filters published cards by Now/Past |
| Published projects | Role filter input | Local filter | Filters published cards by role |
| Portfolio item | `Open proof` | External | Opens proof link |
| Portfolio item | `Pin` / `Unpin` | API/action | Toggles `is_featured`; refreshes portfolio |
| Portfolio item | `Edit` | Modal/local state | Opens project builder prefilled with project data |
| Portfolio item | `Delete` | API/action | Deletes item; stays on portfolio |

## 10. Post Job `/post-job`

Source files: `components/PostJobPage.tsx`, `components/post-job/PostJobForm.tsx`.

Page-level and readiness controls:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Page load, authenticated and profile readiness loading | Auto state | Loading | Shows hiring readiness skeleton |
| Readiness blocked | `Complete Hiring Info` | Query route | `/you?tab=overview&section=hiring-info&returnTo=/post-job` |
| Readiness error | `Retry` | API/action | Reloads current page |
| Hiring identity section | `Add new channel/page` | Query route | `/you?tab=overview&section=hiring-info&returnTo=/post-job` |
| Hiring identity card | Card click | Local state | Selects hiring identity for the job |

Post-job step navigation:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Any form step except first | Back arrow | Tab state | Previous form step |
| Any form step except last | Next arrow | Tab state | Next form step after validation |
| Any changed form step | Save check button | Local state | Saves step snapshot; shows `Saved` toast |
| Tags/final step | `POST JOB` | API/action | Creates job, then redirects to `/?posted=1` |
| Submit failure | Form error state | Error state | Stays on current flow and shows error |

Basics step controls:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Basics | Job title input | Local input | Updates title and preview |
| Basics | Location select | Local state | Remote, Hybrid, or On-site |
| Basics | City input | Local input/autocomplete | Opens suggestions for Hybrid/On-site |
| City suggestions | Suggestion button | Local state | Selects city |
| City input | Arrow keys | Local state | Moves city suggestion highlight |
| City input | Enter | Local state | Selects highlighted city |
| City input | Escape | Local state | Closes city suggestions |
| Basics | Budget min/max inputs | Local input | Updates budget and preview |
| Basics | Budget unit select | Local state | Per project or per month |
| Basics | Experience min/max selects | Local state | Updates experience and preview |
| Basics | Platform chip `YouTube` | Local state | Sets platform to YouTube |
| Basics | Platform chip `Instagram` | Local state | Sets platform to Instagram |
| Basics, no identity | `Connect YouTube` | External/auth/API action | Starts Google/YouTube verification flow |
| Basics, no identity | `Connect Instagram` | Error state | Shows Instagram verification unavailable error |
| Basics, identity connected | `Refresh` | API/action | Refreshes YouTube identity data |
| Basics, multiple YouTube identities | Posting-as select | Local state | Selects identity |
| Identity picker modal | Account option button | Local state | Selects identity and closes modal |
| Identity picker modal | `Close` | Modal | Closes modal |
| Style smart input | Enter | Local state | Commits style chip |
| Style smart input | Tab | Local state | Accepts ghost suggestion when present |
| Style smart input | Related suggestion button | Local state | Adds style chip |
| Style chip | Remove `x` | Local state | Removes style chip |
| Basics | Turnaround value input | Local input | Updates turnaround |
| Basics | Turnaround unit select | Local state | Hours, days, or weeks |
| Tools input | Enter | Local state | Adds tool chip |
| Tools input | Tab | Local state | Accepts ghost suggestion |
| Tool suggestion button | Local state | Adds tool chip |
| Tool chip | Remove `x` | Local state | Removes tool |
| Basics | Start timeframe chip | Local state | Selects or clears start timeframe |

Content steps:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| About step | About textarea | Local input | Updates about text |
| Responsibilities step | Bullet dot | Local state | Focuses bullet line |
| Responsibilities step | Enter in bullet | Local state | Adds bullet line |
| Responsibilities step | Backspace at line start | Local state | Merges/removes bullet |
| Requirements step | Bullet dot | Local state | Focuses bullet line |
| Requirements step | Enter in bullet | Local state | Adds bullet line |
| Requirements step | Backspace at line start | Local state | Merges/removes bullet |
| How to apply step | Textarea | Local input | Updates application instructions |

Reference videos step:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Reference video form | Video title input | Local input | Updates reference title |
| Reference video form | YouTube URL input | Local input | Updates reference URL |
| Reference video form | `Add` | Local state | Adds valid reference video to list |
| Reference video row | `Open` | External | Opens reference video URL |
| Reference video row | Remove `x` | Local state | Removes reference video |

Tags step:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Tags form | Tag input | Local input | Updates tag text |
| Tags form | Enter in tag input | Local state | Adds tag |
| Tags form | `Add` | Local state | Adds tag |
| Tag chip | Remove `x` | Local state | Removes tag |

Right preview and safety:

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Preview card | Save icon | Placeholder | Prevents default only; no route or persistence |
| Preview card | Share icon | Placeholder | Prevents default only; no copy route/action |
| Safety card | No controls | None | Informational |

## 11. Sent Applications `/you/applications/sent`

Source file: `app/you/applications/sent/page.tsx`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Page load, unauthenticated | Auth guard | Query route | `/auth?mode=login&next=/you/applications/sent` |
| Application tabs | `Sent` | Route | `/you/applications/sent` |
| Application tabs | `Received` | Route | `/you/applications/received` |
| Sent application job card | Card click | Route | `/jobs/{job.id}` |
| Sent application job card | Channel name | Route/modal/disabled | Same as home job card channel attribution |
| Sent application job card | Save icon | Placeholder | Alert-only save |
| Sent application job card | Share icon | API/action | Copies job URL |
| Empty state | `Browse jobs` | Route | `/` |

## 12. Received Applications `/you/applications/received`

Source file: `components/you/ReceivedApplicationsClient.tsx`.

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Page load, unauthenticated | Auth guard | Query route | `/auth?mode=login&next=/you/applications/received` |
| Applicant inbox | Search applicant input | Local filter | Filters applicant list |
| Applicant inbox | Applicant row button | Local state | Selects applicant preview |
| Applicant preview | `Open full profile` | Route | `/u/{applicant.username}` |
| Applicant preview | Portfolio link | External | Opens applicant portfolio URL |
| Empty filtered list | No button | None | Shows `No applicants found.` |
| No selected applicant | No button | None | Shows select-an-applicant empty state |

## 13. Applications Redirect `/you/applications`

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Page load, unauthenticated | Auth guard | Query route | `/auth?mode=login&next=/you/applications` |
| Page load, authenticated | Redirect | Route | `/you/applications/sent` |

## 14. Saved Redirect `/you/saved`

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Page load, unauthenticated | Auth guard | Query route | `/auth?mode=login&next=/you/saved` |
| Page load, authenticated | Redirect | Query route | `/you?tab=saved` |
| `/you?tab=saved` current behavior | Render fallback | Gap | `saved` is typed internally but not rendered in current `/you` profile tab list |

## 15. Development/Test Routes

### `/dev/logo-debug`

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Logo debug page | No buttons | None | Displays logo comparisons and SHA status |

### `/smart-typing-test`

| Source | Control | Type | Destination or result |
| --- | --- | --- | --- |
| Smart typing test | Single-line input | Local input | Tests smart typing in an input |
| Smart typing test | Paragraph textarea | Local input | Tests smart typing in textarea |
| Smart typing test | Bullet editor textarea | Local input | Tests bullet behavior |
| Bullet editor | Enter | Local state | Inserts new bullet |
| Bullet editor | Backspace at start | Local state | Merges bullet with previous |

## 16. Flowchart Node Suggestions

Use these node labels for a readable diagram:

- `Global Shell`
- `Home Feed`
- `Job Card`
- `Agency Chooser`
- `Job Detail`
- `Auth Login`
- `Auth Signup`
- `Verify Email`
- `Onboarding Intent`
- `You Dashboard`
- `Overview Tab`
- `Hiring Info`
- `Jobs Tab`
- `Portfolio Tab`
- `Project Builder`
- `YouTube Preview API`
- `Portfolio Tab Drafts`
- `Portfolio Tab Published Projects`
- `Post Job Readiness Gate`
- `Post Job Identity Selector`
- `Post Job Basics`
- `Post Job About`
- `Post Job Responsibilities`
- `Post Job Requirements`
- `Post Job How To Apply`
- `Post Job References`
- `Post Job Tags/Submit`
- `Public Profile`
- `Public Profile Jobs`
- `Public Profile Portfolio`
- `Sent Applications`
- `Received Applications`
- `Saved Redirect Gap`

## 17. Flowchart Edge List

This compact edge list can be pasted into diagramming tools or converted to Mermaid.

```text
Global Shell -- logo --> Home Feed
Global Shell -- Post --> Post Job Readiness Gate
Global Shell -- Account --> You Dashboard
Global Shell -- Public profile --> Public Profile
Global Shell -- Log in --> Auth Login
Global Shell -- Sign up --> Auth Signup
Global Shell -- Sent applications --> Sent Applications
Global Shell -- Received applications --> Received Applications
Global Shell -- Saved --> Saved Redirect Gap

Home Feed -- job card --> Job Detail
Home Feed -- channel name --> Public Profile
Home Feed -- agency channel name --> Agency Chooser
Agency Chooser -- CreatorJobs profile --> Public Profile
Agency Chooser -- YouTube channel --> External YouTube

Auth Login -- login success --> Onboarding Intent or You Dashboard or Safe Next
Auth Login -- Continue with YouTube --> Google OAuth
Auth Signup -- signup success --> Verify Email
Verify Email -- Go to log in --> Auth Login
Onboarding Intent -- Continue --> You Dashboard or Safe Next

You Dashboard -- Overview tab --> Overview Tab
You Dashboard -- Jobs tab --> Jobs Tab
You Dashboard -- Portfolio tab --> Portfolio Tab
You Dashboard -- Public view --> Public Profile
Overview Tab -- Hiring Info task/link --> Hiring Info
Hiring Info -- returnTo post-job --> Post Job Readiness Gate
Jobs Tab -- View job --> Job Detail
Portfolio Tab -- Create project --> Project Builder
Portfolio Tab -- Import from YouTube --> Project Builder
Project Builder -- Fetch video --> YouTube Preview API
Project Builder -- Save draft --> Portfolio Tab Drafts
Project Builder -- Publish --> Portfolio Tab Published Projects
Portfolio Tab -- Open proof --> External Proof URL

Post Job Readiness Gate -- Complete Hiring Info --> Hiring Info
Post Job Identity Selector -- Add new channel/page --> Hiring Info
Post Job Identity Selector -- select identity --> Post Job Basics
Post Job Basics -- Next --> Post Job About
Post Job About -- Next --> Post Job Responsibilities
Post Job Responsibilities -- Next --> Post Job Requirements
Post Job Requirements -- Next --> Post Job How To Apply
Post Job How To Apply -- Next --> Post Job References
Post Job References -- Next --> Post Job Tags/Submit
Post Job Tags/Submit -- POST JOB success --> Home Feed with posted=1

Job Detail -- Back not found --> Home Feed
Job Detail -- channel name --> Public Profile
Job Detail -- Apply --> Placeholder Apply Alert
Job Detail -- Save --> Placeholder Save Alert
Job Detail -- Share --> Clipboard

Public Profile -- Jobs tab --> Public Profile Jobs
Public Profile -- Portfolio tab --> Public Profile Portfolio
Public Profile Jobs -- View job --> Job Detail
Public Profile Portfolio -- Open proof --> External Proof URL

Sent Applications -- Received tab --> Received Applications
Sent Applications -- job card --> Job Detail
Received Applications -- Open full profile --> Public Profile
Received Applications -- portfolio link --> External Portfolio URL

Saved Redirect Gap -- redirects --> You Dashboard with tab=saved
```
