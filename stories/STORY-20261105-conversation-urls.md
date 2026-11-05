# Story 128 — Restore each browser tab from its conversation URL

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 40](STORY-20260903-arena-routes.md), [Story 73](STORY-20261003-title-bar-tabs.md)

## Motivation

Several browser tabs can show different conversations, but all use `/`. Reloading after an
update, or restoring the browser, can select another tab's saved conversation or the first
project. Each URL should identify the destination and load its current server content.
This follows the device/workspace navigation slice of [the vision](../docs/vision.md).

## Implementation (where the code is)

- [workspaceLocation.ts:1](../src/features/shell/workspaceLocation.ts#L1) validates URL identity
  and builds host-default links, keeping explicit empty workspaces distinct from legacy `/`.
- [AppShell.tsx:139](../src/features/shell/AppShell.tsx#L139) owns persistent navigation;
  `navigateWorkspace` at line 165 integrates query history, and the resolver at line 721 determines
  machine/project before initial scope reconciliation.
- [AppShell.tsx:517](../src/features/shell/AppShell.tsx#L517) refreshes on activation with
  navigation/snapshot/live-owner guards and reuses targeted run discovery at line 2324.
- [useWorkspaceViews.ts:21](../src/features/shell/useWorkspaceViews.ts#L21) restores and writes the
  tab's workspace before the shared migration/default mirror;
  [workspaceViews.ts:319](../src/features/shell/workspaceViews.ts#L319) carries drafts across project removal.
- [WorkspaceTabs.tsx:17](../src/features/conversation/WorkspaceTabs.tsx#L17) keeps native keyboard
  and archive behavior around title links;
  [Arena.tsx:197](../src/features/arena/Arena.tsx#L197) and line 247 expose Active/Inbox links.
- [workspaceLocation.test.ts:1](../test/workspaceLocation.test.ts#L1),
  [workspaceViews.test.ts:33](../test/workspaceViews.test.ts#L33) and
  [conversation-urls.spec.ts:1](../e2e/conversation-urls.spec.ts#L1) cover identity, migration,
  multiple tabs, refresh/recovery and live delivery.

## Desired behavior

1. `/?session=<uuid>` opens a conversation on the machine serving the URL. Only an attached
   executor needs `&machine=<uuid>`. Resolve the project from the saved conversation.
2. Preserve `/arena`, `/arena/inbox`, `/arena/archived`. A project-only workspace URL preserves
   the selected project when no conversation is open, including No project.
3. URLs win over saved focus on direct entry, refresh, browser restoration and Back/Forward.
   Canonicalize an unqualified initial `/` once its existing fallback has resolved. Keep one
   mounted shell across navigation; opening links in a new tab works through real anchors.
   Query-only changes use Next's integrated native browser history without fetching a server page.
4. Keep drafts, canvas and panel layout outside URLs. Keep each browser tab's workspace in
   tab-scoped storage, using the existing local workspace as a migration/new-tab seed and mirror, so
   another tab cannot replace its drafts or focus. Device-wide execution/theme preferences stay shared.
5. Reload current server content on entry and browser activation, preserve drafts, ignore late
   responses for abandoned destinations and retain existing live-run recovery. A failed refresh
   must preserve loaded content and expose Retry.
6. Malformed, missing, archived, or offline destinations retain their requested URL and show
   concise recovery actions instead of silently selecting another conversation. Existing archive,
   Undo, last-view close and New chat behavior remain intact. A deliberate close/archive updates
   the current URL to its surviving neighbour or empty project workspace.

### Affected invariants and failure paths

The URL owns navigation identity; the server owns conversation/project content and run ownership;
the browser tab owns its drafts and presentation. Host-default routing must remain stable as the
attached-machine list changes. Use the existing same-origin executor gateway and device gate.
Keep Story 40's persistent shell, Stories 107/111/117's snapshot delivery protections, and
Stories 109/112's empty-workspace, archive and focus contracts. Ordinary refresh does not resume
a provider process killed by a server restart; it loads saved content and discovers surviving runs.
Old documents addressed only by `/` have no recoverable historical per-tab conversation identity.

## Acceptance criteria

- [x] Local URLs omit machine id; attached URLs include it; project comes from the session.
- [x] Refresh/direct entry, Back/Forward and restored browser pages select the named conversation
      across projects and machines, independent of shared saved focus.
- [x] Session navigation exposes links usable for open-in-new-tab and retains one mounted shell.
- [x] Separate tabs preserve their own drafts and conversation focus through reload, including
      migration from existing device state, without removing existing device preferences.
- [x] Empty projects, No project, last-view close, archive/Undo and New chat retain their contracts.
- [x] Invalid/missing/archived/offline destinations expose recovery without opening another chat;
      an abandoned request cannot redirect a newer navigation.
- [x] Activation refresh delivers newer saved messages without replacing an unsent draft or
      duplicating a turn; failure retains loaded content with explicit retry.
- [x] Focused unit/browser regressions, TypeScript, isolated production build and independent
      review pass. Record coverage and remaining limits below.

## Out of scope

- Encoding messages, drafts, credentials, scroll positions, or pane geometry in URLs.
- Recovering the lost identity of old `/` browser tabs retroactively, or durable agent processes
  across server restarts. No server session-format change or deployment.

## How to verify

Open different conversations in two pages of the same browser context, edit drafts independently,
refresh each, and recreate pages from their URLs. Verify machine/project selection, saved messages
and drafts. Exercise real links, Back/Forward, project-only/No project, archive/Undo/last-close,
malformed/missing/archived/offline links, delayed abandoned responses, failed refresh/retry and
activation after another client saves a message. Run focused Vitest, production Playwright,
TypeScript and an isolated build; review the final diff.

## Verification evidence

- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build` pass. The ordinary running
  installation was neither rebuilt in its release slot nor restarted/deployed.
- 65 focused Vitest checks pass across `workspaceLocation`, `workspaceViews`, `arenaRoutes` and
  `sessionStore`. The new URL tests failed before their module existed, and the moved-draft
  regression failed before same-machine scope retention was implemented.
- 84 distinct production Chrome cases pass across the final scoped runs (reruns are counted once):
  19 new conversation URL cases, 9 existing title-bar cases, 4 New chat, 2 Inbox, 11 Arena project,
  2 machine, 28 session-setup, 8 selected canvas and 1 automatic-archive case. Coverage includes
  two pages in one browser context, independent drafts for the same conversation, storage migration,
  cross-project/executor reload, Back/Forward, Ctrl-click, empty focus, archive/Undo, external
  archive/Restore/activation, late reads, failed refresh/retry, and an actual two-page fake-provider
  turn whose approval and final reply reach the observing page once without losing its draft.
- Existing browser expectations now use links and canonical workspace URLs. Wider checks also
  exposed stale title-based identity, an ambiguous New session selector and the old expectation
  that an empty Arena project disappears; those checks now use stable URLs and shipped behavior.
- Both-theme desktop and phone screenshots were inspected. Independent read-only review found
  and verified fixes for initial Arena loading, project movement, activation run recovery and
  restored requested destinations; the final review found no remaining issues.
- The wider `phone tab archive persists after reload and header session actions fit in both themes`
  case again reports expected revision 3 / current revision 4 after background title generation.
  This is the same wider failure recorded in
  [Story 125](STORY-20261104-repository-panel.md); it was excluded from the
  final focused set. There is no claim that the complete browser suite passes.
- Browser restart was simulated by recreating a page with its URL and saved tab storage; actually
  closing/reopening Chrome, real-provider turns, production attached transport, physical phones
  and Quest were not rerun. Draft restoration after browser closure remains browser-dependent.
