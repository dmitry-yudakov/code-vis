# Story 134 — Orchestrate sessions from desktop Arena tiles

**Status:** Shipped · **Type:** Full-stack · **Depends on:** Stories 127, 129, 133

## Problem and outcome

Arena rows require opening a conversation to read the latest response or send a short reply.
Offer an alternative desktop Tiles arrangement: one tile per session, grouped by project, with a
latest-message excerpt, quick reply and existing permission controls. Keep List available for
comparison, use attention/recency grouping on initial load, and retain the phone and immersive presentations.
Active projects and cards keep those positions until page reload, as described in the follow-up below.

## Contracts

- The device remembers List/Tiles; the control appears above 740px in Active only. Project
  shortcuts, empty projects, archive, Inbox, native session links and context indicators stay intact.
- `arenaSessionSummary` adds optional main-agent metadata and one excerpt capped at **600 UTF-16
  characters per session**. User text or assistant Markdown blocks supply it. Code, diagram and
  attachment contents and provider continuation handles stay outside it. Full text stays canonical.
  Optional schema fields allow older executor summaries; those tiles offer Open for replying.
- Existing compact summary caching and workspace subscriptions carry excerpts after committed
  messages, including completed background replies. Token deltas do not rebuild Arena, and the
  tile view never fetches all conversation histories. Full-session reads happen only for Send or
  delivery recovery against the captured machine/session.
- Quick replies address the main agent, follow the session's supported mode and reuse its remembered
  model/effort. Agent/mode changes happen inside the conversation, without a repeated footer caption. Existing
  Native Accept edits/Full access modes are retained where supported. Enter sends, Shift+Enter adds
  a newline, and composition/repeated Enter events do not send. The input contains the same arrow
  button as normal chat. Freshness, readiness, an active run and managed restart gate new sends.
  A running tile still accepts preparation of the next draft; canvas/file attachments and recipient
  changes remain in the full conversation.
- Clipboard images become removable thumbnail chips above the reply input, using the existing
  text-first paste filter, image preparation and four-image limit. An image alone is sendable;
  preparation blocks Send/Enter until all active pastes finish. Images stay with their machine/session
  through view changes and failed sends, in browser memory only. Accepted replies clear them.
  Frozen retries retain the exact image payload; after reload, only canonical delivery checking is
  available when the original pixels are missing, so retries cannot silently omit evidence.
- `useArenaReplies` owns tab-local drafts independently of navigation. Tiles subscribe to their
  own draft, so typing does not render AppShell or other tiles. Text saves coalesce for 150ms and
  flush on send, page exit, visibility changes and teardown. Pending delivery UUID, recipient, mode
  and model save synchronously before the POST. No canonical histories/previews enter tab storage.
- Existing background-launch delivery handles acceptance, stable-message retries and detaching the
  response without stopping execution. Uncertain replies stay read-only, survive reload and check
  canonical delivery before retrying. Checking still works if provider readiness changes; retries
  retain the original agent even if the session's main agent changes. Definitive rejection permits
  editing, and accepted delivery alone clears the draft. Browser storage is optional; when blocked,
  mounted drafts remain usable but reload recovery is unavailable.
- Tile approvals show the exact tool/detail and call the existing machine/run/request permission
  owner. Stale/offline cards cannot submit decisions. There is no new permission authority.

## Acceptance

- [x] Switch desktop arrangements, remember the choice, and retain grouping and narrow layouts.
- [x] Expand bounded latest-message excerpts and see saved background replies without navigation.
- [x] Send to two sessions, keep independent drafts, and route duplicate IDs to their own machine.
- [x] Preserve text and frozen delivery across reload, including failed delivery, the same retry
      UUID/recipient, provider unavailability and a changed main agent.
- [x] Disable unavailable/offline sends through button and keyboard alike; resolve exact approvals.
- [x] Focused unit/browser checks, TypeScript, isolated build, screenshots and independent review pass.

## Verification

The new summary regression failed before implementation. The first tile browser regression failed
against the pre-change production build on the missing Tiles control. Focused checks cover compact
summary production/cache, executor-schema limits, subscription delivery, launch acceptance,
tab-local persistence and a hundred independent draft subscribers. Production-browser journeys
cover layout, both themes, phone fallback, real fixture-provider delivery, reload/retry, machine
routing, disabled keyboard sending and permission routing.

November 7, 2026 verification:

- **93 focused unit checks in 11 files pass**, covering reply persistence/subscriptions, session
  summaries/store, background launch, Arena presentation/routes, executor schema/cache, workspace
  feeds/stream framing and immersive Arena compatibility.
- **27 distinct production-browser checks pass** across `arena-tiles.spec.ts`,
  `arena-inbox.spec.ts`, `arena-projects.spec.ts` and `context-usage.spec.ts`. The seven new
  tile journeys include successful fixture-provider turns through real routes, exact UUID/body and
  recipient retry after a main-agent change, reload recovery with unavailable providers, duplicate
  machine-qualified session IDs, offline/legacy-executor keyboard guards and exact permission routing.
- TypeScript (`npm run lint -- --incremental false`), the isolated `.next-e2e` production build
  and `git diff --check` pass. Desktop tile and phone fallback screenshots were inspected in both
  light and dark themes.
- Independent read-only review has no remaining material findings. Its draft/retry persistence,
  changed-provider recovery, shared keyboard eligibility and captured-recipient findings are fixed
  and covered by the browser journeys. Draft subscriptions also preserve Story 133's typing contract.

The running installation was not restarted or deployed. Real signed-in providers, real attached
executor transport and physical devices were not exercised; provider turns and remote routing
above use the isolated suite's fixtures.

## Composer follow-up — November 7, 2026

Removed the mode dropdown, put the chat-style Send arrow inside the reply field and matched chat's
Enter/Shift+Enter behavior. Non-delivery tile mode overrides are discarded on restore so changing
mode in the conversation also changes its tile; frozen delivery retains its original mode.
The shared background-delivery type accepts all existing-session modes while new-session setup
keeps its narrower mode contract.

- The new browser regression failed against the prior production build on the remaining dropdown.
- **28 focused unit checks pass** for draft persistence, background delivery and device choices,
  including Native mode preservation and migration of old tile mode overrides.
- **Nine production-browser journeys pass**, including Enter, Shift+Enter, composition/repeat
  guards, inline-button geometry, mode changes through the full conversation, and all existing
  tile delivery/retry/machine/permission journeys.
- TypeScript, isolated production build, `git diff --check` and light/dark screenshot inspection pass.
- Independent read-only review has no material findings. The running installation was not restarted.

## Clipboard images follow-up — November 7, 2026

Removed the repeated agent/mode caption. Pasting an image adds a compact removable preview to that
tile without adding an Attach/Add control. Image-only replies work through the existing background
delivery path. The new persistence regression failed on the missing pending image count; the new
browser regression failed against the prior build on its remaining agent/mode caption.

- **37 focused unit checks pass** for draft persistence, background delivery and image handling,
  including route acceptance, limits, metadata and exact provider evidence. These checks run with
  `CODEAI_REMOTE_ACCESS=local` so deployment HTTPS requirements do not alter their local fixtures.
- **14 production-browser journeys pass**, including both-theme image-only delivery through real
  fixture-provider routes, plain-text clipboard precedence, thumbnails/removal, tile isolation,
  preparation blocking across view changes, limits/read failures, exact image retries, following
  text-only turns and safe delivery checking after reload clears the original image pixels.
- TypeScript, isolated production build, `git diff --check`, both-theme image-composer screenshot
  inspection and independent read-only review pass. No material review findings remain.

The running installation was not rebuilt/restarted. Signed-in providers and native OS clipboard
interaction were not exercised; browser checks supply real PNG clipboard events to the input.

## Compact headers follow-up — November 8, 2026

The supplied Arena screenshot repeats the project's repository in every tile and spreads status,
provider, activity and timestamp over several rows. Put shared repository names alongside the
project heading in Active. A tile's header has two logical rows: title with Archive, then status,
agent names/context circles and last-activity time. Long titles ellipsize with the full title
available; activity detail moves to the status tooltip and keyboard-open description.

Where the code is: `src/features/arena/Arena.tsx:46` renders repository/provider facts and
`:211` renders project headings and active cards; `src/app/globals.css:198` owns project headings
and `:223` owns tile geometry. These use the existing bounded Arena projection from Story 134 and
context presentation from Story 132, with no snapshot/storage/protocol change.

Remove a session's repository caption only when its checkout ids match its canonical project's
bindings. Different checkouts, worktree branch/source, Docker execution, loose sessions and
missing-project/checkout fallbacks retain their distinguishing facts. List/phone Active shares the
project-level repository caption; its row layout and Archived/Inbox behavior remain intact.
Multiple agents or exceptional checkout details can wrap when needed. Preserve native session
links/modifier clicks, offline navigation guards, context hover/keyboard access, archive gating,
unread cues and the tile's existing message/reply/approval controls.

- [x] Active project headings show their repository names once, with shared captions removed from
      sessions and differing/loose/worktree targets still identifiable.
- [x] Tile headers group title/Archive and status/agent/context/time in two rows, preserve long-title
      inspection and expose the full activity detail without a routine extra activity row.
- [x] Layout remains contained on desktop/phone, in both themes, with multiple agents and long names;
      navigation, archive, context, previews, replies and permission controls retain their contracts.
- [x] Focused unit/browser checks, TypeScript, isolated build, screenshot inspection and independent
      review pass.

The project-repository regression failed against the preceding production build. All **25 focused
unit checks** pass (`arenaModel`, `contextUsageView`, `arenaReplyDrafts`, `sessionSummaries`), along
with TypeScript, the isolated `.next-e2e` production build and `git diff --check`.

Across `arena-tile-headers`, `arena-tiles`, `context-usage` and `arena-projects`, **39 distinct
production-browser cases pass** across the affected runs. The final seven header cases pass against
the rebuilt final bundle. They check aligned metadata, title truncation/full-title inspection,
repository deduplication, context hover/keyboard access, archive gating/success, keyboard session
navigation, exceptional targets, multiple agents, long names and narrow fallback. The keyboard
assertion uses actual Shift+Tab/Tab focus and selects the activity tooltip independently of the
closing context tooltip. Both-theme desktop/phone and intermediate-width screenshots, plus
exceptional-target and long-name screenshots, were inspected.

Independent review found disabled Archive clicks falling through to the spanning session link.
A coordinate-click regression confirmed the defect before its fix. The native disabled archive
button now retains pointer hits, shielding its sibling link; tests confirm neither navigation nor
an archive request occurs. Follow-up review found no remaining material issue.

The running installation has not been rebuilt or restarted. This follow-up changes presentation
only; real signed-in providers, attached-executor transport and physical phone/Quest use were not
rerun. Existing fixture-based previews, replies, approval handling, archive and archived-context checks pass.

## Stable positions follow-up — November 8, 2026

Active project groups and session cards kept jumping when live status or activity time changed.
Keep their initial attention/recency order for the browser page's lifetime, in List, Tiles and the
phone list. New projects append within their machine; new cards append within their project.
Empty projects stay in place when their first session arrives. Removed sessions disappear, while
returning sessions recover their previous position. A full reload establishes a new initial order.

`useArena` remembers only machine/project/session identity positions; current snapshots continue to
supply status, titles, previews and actions. The persistent shell owns these positions, so navigation,
manual refresh, failed refresh recovery and reconnect cannot reset them. Inbox priority and the
Archived/immersive presentations retain their existing ordering. No new persisted device state or
server protocol is needed.

The new browser regression failed against the preceding production bundle when an old session's
approval moved its project ahead of the initially leading project. Focused unit checks cover live
content, offline presentation, additions, empty projects and removal/return. Browser checks cover
List, Tiles and phone layouts through live approval/failure changes, draft/preview updates, a real
conversation round trip, refresh failure/recovery, reload, additions and returning cards.

All **30 focused unit checks** pass (`arenaModel`, `arenaSubscription`, `arenaReplyDrafts`,
`immersiveModel`), and **30 production-browser checks** pass (`arena-order`, `arena-tiles`,
`arena-inbox`, `arena-projects`). TypeScript, the isolated `.next-e2e` production build,
`git diff --check` and independent read-only review pass. The running installation has not been
rebuilt or restarted; real providers, attached-executor transport and physical devices were not exercised.

## Project panels follow-up — November 8, 2026

**Status: Shipped.** Use the available desktop width in Active Tiles for a responsive grid of
project panels, with each project's session cards inside it. A wide desktop can show three
projects across and six projects in two rows; narrower screens reduce the column count, and
session cards wrap within their own project. Keep ordinary page scrolling, without hiding sessions
or adding nested project scroll areas. List, phone, Inbox and Archived keep their existing layouts.

Where the code is: `src/features/arena/Arena.tsx:157` owns the Arena frame and project rendering;
`src/app/globals.css:224` owns tile geometry. `e2e/arena-project-tiles.spec.ts` covers the project
grid through production browser rendering. This extends Story 134's existing Arena outcome and
uses its current bounded summaries, stable positions and per-session reply owners.

- [x] Active Tiles uses the desktop width for project panels, including a three-column/two-row
      arrangement for six projects on a wide desktop and fewer columns at narrower widths.
- [x] Sessions wrap inside their own project; long names, empty projects, and machine headings
      stay contained, with no horizontal overflow or hidden sessions.
- [x] Project creation shortcuts, session links, previews, quick replies, approvals, archive,
      stable ordering and drafts retain their existing behavior through resizing/view changes.
- [x] TypeScript, isolated production browser build, focused browser regressions, both-theme desktop/phone
      screenshot inspection and independent review pass.

All **24 focused unit checks** pass (`arenaModel`, `arenaReplyDrafts`, `arenaSubscription`), along
with TypeScript and **40 production-browser checks** across `arena-project-tiles`, `arena-order`,
`arena-tile-headers`, `arena-tiles`, `arena-projects` and `arena-inbox`. The new layout regression
failed against the old bundle's vertically stacked projects. Light/dark desktop, narrow desktop,
phone and long-name screenshots were inspected. Independent review found no material issues.

How to verify: run the three unit files above, `npm run lint -- --incremental false`, and
`CODEAI_DIST_DIR=.next-e2e npx playwright test` with those six browser spec files after preparing
the isolated bundle. Explicitly select `.next-e2e`; the session environment inherits `.next`.

Build limitation: the normal Turbopack build failed in its existing Google Fonts/Inter loader.
Webpack compiled successfully, but its generated route checks reject pre-existing optional
`Request` arguments in the Arena, Checkouts and Projects GET routes. The browser bundle was
therefore built using webpack's `--experimental-build-mode compile`, then `generate`; source
TypeScript passed after removing only webpack's generated `types/app` checks. No build settings,
fonts or API routes were changed. The browser suite also logs caught network errors from its
simulated workspace-stream transitions. All browser assertions pass, including live order,
saved replies, image delivery/retry and exact permission routing.

The running installation has not been rebuilt or restarted. Real signed-in providers,
attached-executor transport and physical devices were not exercised.

## Use remaining project space — November 8, 2026

**Status: Shipped.** The wider screenshot shows four equal project columns, with one active project
and two empty projects in the last row. Give desktop Tiles up to three populated panels per row, let
populated panels share each row's spare width, and keep empty projects in compact rows. Preserve the
existing machine/project DOM order, including when an empty project gains or loses a session.
Keep the same mounted panel/session identities and the existing page scroll.

Where the code is: `src/app/globals.css:227` owns project wrapping and sizing;
`src/features/arena/Arena.tsx:220` renders each project panel;
`e2e/arena-project-tiles.spec.ts:4` owns the representative multi-project fixture.

- [x] Wide screens have at most three populated project panels per row; populated panels on an
      incomplete row fill its width, while empty projects use compact rows without taking width
      from their populated neighbours.
- [x] Narrow layouts, long names, machine boundaries, project order and project shortcuts remain
      usable; starting/removing a session in an empty project preserves other drafts and focus.
- [x] Focused unit/browser checks, TypeScript, both-theme screenshot inspection and independent
      review pass; record the production build path and any existing build limitations.

All **24 focused unit checks** and **42 production-browser checks** pass across the same files
listed above, along with TypeScript and `git diff --check`. The new wide-screen regression failed
against the preceding bundle's fourth project in the first row. Its final fixture mirrors the
screenshot's five populated and two empty projects, verifies the incomplete row reaches both
edges, and preserves draft/focus/order while an empty project gains and loses a session. Long
unbroken names are checked in both populated and empty panels. Both-theme wide/narrow desktop
and phone screenshots were inspected; independent review found no material issues.

The isolated production browser bundle uses the same webpack compile/generate fallback recorded
above; source TypeScript passes after removing only webpack's generated `types/app` checks.
No build settings or API routes changed. The running installation has not been rebuilt or restarted;
signed-in providers, real attached transport and physical devices were not exercised.

## Follow-up — recent replies and durable unread attention (November 9)

The user could not distinguish a just-finished session from one idle for twenty hours, and a
completion's unread cue disappeared after the run registry's five-minute replay window.

- Active status uses blue **Running**, green **Ready** for one hour after a successful reply, then
  neutral **Idle**. Approval, queue, failure and Offline retain precedence. Labels carry the meaning
  alongside color; Ready's tooltip explains the hour. Both desktop arrangements and the immersive
  Arena share the same age rule. A local minute clock and activation updates age the cue without
  another server request. Renames, other metadata edits and marking read do not renew the hour.
- Successful completion attention falls back to the saved latest reply after run expiry/restart.
  Summaries project the saved turn's optional run id through the strict machine schema; older
  executors use stable message identity with execution-interval matching during the live window.
- Unread clears when the corresponding successful reply loads in the visible conversation on a
  visible browser tab, or through the existing Inbox actions. Failed loads and hidden conversations
  keep the notice. Reading does not remove Ready. Live permissions cannot be acknowledged locally.
- Device read markers cover all supported sessions across nine machines: up to 20,000 ids, with
  obsolete ids pruned on acknowledgment while current active and archived notices retain markers.
  Existing run-id read aliases normalize to stable ids while their registry entry is available,
  including archived sessions, so restoring them after expiry preserves read state.

Regression checks cover the one-hour boundary, metadata edits, active/Offline precedence, saved
summary/schema compatibility, stable read ids through expiry, older executors, 9,000 retained
markers, loaded-successful-reply matching and existing ordering/Inbox/header behavior. The new
state and retention unit regressions were observed failing before implementation.

All **111 focused unit checks** pass (`arenaModel`, `sessionStore`, `immersiveArena`, `machineClient`,
`arenaSubscription`, `arenaReplyDrafts`, `arenaRoutes`, `multiMachineArenaRoute`, `runPresentation`,
`workspaceLocation`), plus **22 production-browser checks** (`arena-status`, `arena-order`,
`arena-inbox`, `arena-tile-headers`). TypeScript, `git diff --check`, light/dark desktop Tiles/List
and phone screenshot inspection, and independent read-only review pass. The provider-delivery
browser journey uses the real route/store/summary path with the fake offline Claude: a failed
URL load retains unread, opening the reply clears it while keeping Ready, and a second reply
received in a hidden tab stays unread until visibility returns. Earlier revisions of that browser
regression caught premature acknowledgment of a preloaded reply before URL resolution succeeded.

Prepare the isolated bundle with `env -u TURBOPACK CODEAI_DIST_DIR=.next-e2e npx next build --webpack
--experimental-build-mode compile`, then the same command with `generate`. Run the four browser
files with `CODEAI_DIST_DIR=.next-e2e npx playwright test`. The previously recorded normal-build
font/generated-route-check limitations remain; source TypeScript passes after removing only
webpack's generated `.next-e2e/types/app` checks. No build configuration or API routes changed.
Caught network errors from controlled stream transitions appear in test logs; all assertions pass.

The running installation has not been rebuilt or restarted. Signed-in providers, real attached
executor transport and physical Quest use were not exercised.
