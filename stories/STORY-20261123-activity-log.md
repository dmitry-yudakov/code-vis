# Story 154 — Inspect CodeAI activity from the More menu

**Status:** Shipped · **Type:** Full-stack · **Builds on:** [Story 151](STORY-20261120-mcp-external-observer.md)

## Motivation

The user needs to see what happened on a CodeAI machine, especially when an MCP client reads a
conversation or acts on their behalf. Session history alone does not show who initiated an action,
whether an integration call was denied, or why a session entered the archive.

## Where the code is

- [MCP bridge](../src/server/integrations/mcp/bridge.ts#L53) authorizes grants and dispatches operations.
- [Session store](../src/server/storage/sessionStore.ts#L585) owns canonical session changes.
- [Turn acceptance](../src/server/conversation/submitMessage.ts#L355) saves new user messages and
  restores existing ones after restart.
- [More menu](../src/features/shell/AppShell.tsx#L3327) opens the activity log across the web app.
- [Activity storage](../src/server/storage/activityLog.ts#L58) persists events, rotates segments and
  serves history to the [activity endpoint](../src/app/api/activity/route.ts#L11).

## Acceptance criteria

- [x] **More → Activity log** opens a recent-first view on desktop and phone. It filters by source,
  refreshes, and can load older entries. In paired mode, only personal devices can open it.
- [x] Session creation, accepted user messages, participant changes, manual archive, both
  automatic archive policies and restore show their origin and affected IDs. Recovery and exact
  retries preserve the existing session and queue contracts and do not duplicate saved events.
- [x] The main project, agent-control and repository changes are recorded at their successful boundary.
- [x] MCP calls from authenticated grants show the grant, operation, outcome and available target IDs,
  including reads, subscription admission, scope denials and partial launches. Workspace stream
  updates do not create per-update entries.
- [x] The private log survives restart and stays within two rotating 1 MiB segments per machine.
  It stores only operation metadata. Storage failure leaves the original operation's outcome intact
  and is surfaced when possible in the log view.

### Persistence and scope

The log starts with new activity on the machine serving the browser. The view shows accepted web
actions and MCP calls from verified grants, including scope denials.

Session creation and first-message acceptance are separate saved events linked by session ID. Worktree
creation uses its existing journal schema so older releases can still open managed worktrees. When
startup reconciliation creates the session, it records Automatic as the source. A session creation
or message acceptance has one saved event, including after an exact retry or resume.

The machine rotates two private NDJSON segments of 1 MiB each. It serves up to 50 entries at a time
using a retained entry as a cursor. The running process admits up to 128 pending log writes. Storage
errors or excess writes can leave a gap. CodeAI reports a warning for the life of the process and
keeps the canonical operation result. Canonical operations and best-effort activity entries use
separate writes.

## How to verify

Run focused store, session lifecycle and MCP tests. In an isolated production browser, open the
log through More after submitting a prompt and after an MCP call, and verify filters and targets.

Verified with 343 focused unit checks, five MCP SDK runtime cases, TypeScript, an isolated
production build, and six Chrome cases. Light and dark desktop and phone screenshots were
reviewed. A fresh process reopened and paged the saved browser fixture log. Independent review
led to preserving the worktree journal format, bounding pending writes, and capturing the web
actor before the action. The running application still needs a rebuild to pick up this change.
