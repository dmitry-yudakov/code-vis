# Story 38 — Orchestrate local sessions from the Arena

**Status:** Shipped · **Type:** Full-stack ·
**Depends on:** [Story 37](STORY-20260901-concurrent-turns.md) (concurrent turns and host-wide run
discovery, shipped) and [Story 35](STORY-20260829-projects-and-repositories.md) (project grouping,
shipped)

**Vision context:** step 6, “The arena,” in [vision.md](../docs/vision.md#sequence), and the Arena
delivery slice in
[multi-project-session-environment.md](../docs/multi-project-session-environment.md#possible-delivery-slices).

---

## Motivation

CodeAI can run and retain several independent sessions, but seeing them still requires selecting one
project and opening its session views. A permission in another project is invisible, a completed or
failed background turn has no host-wide destination, and starting work begins from whichever project
happens to be selected. The concurrency machinery exists, but the person still has to remember where
the work is.

This slice adds the smallest useful Arena: a calm, project-grouped card overview and an Inbox for
the few events that deserve attention. It keeps execution on the one trusted local machine and does
not pretend the later machine/device security work has shipped.

---

## Shipped implementation (where the code is)

- [route.ts](../src/app/api/arena/route.ts#L11) returns one bounded, no-cache cross-project snapshot;
  [sessionStore.ts](../src/server/storage/sessionStore.ts#L176) derives its transcript-free session
  summaries.
- [runRegistry.ts](../src/server/runs/runRegistry.ts#L195) retains safe permission details, current
  status, and terminal outcome for host-wide discovery.
- [arenaModel.ts](../src/features/arena/arenaModel.ts#L64) owns state precedence, project grouping,
  attention ordering, and bounded versioned read markers; [useArena.ts](../src/features/arena/useArena.ts#L14)
  polls while retaining the last good snapshot.
- [Arena.tsx](../src/features/arena/Arena.tsx#L45) renders project cards, the Inbox, permission
  decisions, and configured session creation.
- [AppShell.tsx](../src/features/shell/AppShell.tsx#L1034) integrates global attention and exact-id
  permission routing; [useWorkspaceViews.ts](../src/features/shell/useWorkspaceViews.ts#L62) opens
  the canonical project scope without losing device-local view state.

---

## Desired behavior

### A. A project-grouped Arena

1. An always-reachable **Arena** control opens one host-wide overview without discarding any open
   session view or its device state. Session cards are grouped under named projects plus **No
   project**, and groups and cards follow canonical update recency.
2. Every card shows the session title, repository names, agent participants, this machine's label,
   a concise current/latest activity line, unread attention, and exactly one state: **Idle**,
   **Running**, **Needs you**, **Queued**, or **Failed**. **Offline** is not fabricated while only one
   local machine exists.
3. Active run state wins over canonical terminal state. Otherwise, a failed last turn is **Failed**
   and a completed turn returns the ongoing session to **Idle**; there is no Done state.
4. Opening a card switches to its canonical project scope, opens/focuses its device-local view, and
   works while unrelated local turns are queued, running, or waiting for approval.

### B. A quiet Inbox that reaches every session

5. A persistent header Inbox control shows the host-wide unread attention count from any session.
   Its panel contains unresolved permission requests first, then failed turns, then completed turns.
6. Each item names the project and session and states the concrete reason. Permission items expose
   **Allow** and **Deny** in place and route the decision by `runId` plus `requestId`; an item cannot
   be answered by or attributed to another session.
7. Completed and failed items can be marked read individually or together. Read state is bounded,
   versioned, and device-only; unresolved permissions remain until the server reports resolution and
   cannot be hidden by marking the Inbox read.
8. The overview refreshes while it is open and the Inbox badge refreshes while inside a session.
   Refresh failure retains the last good snapshot and exposes a non-destructive retry/status message.

### C. Start work from the overview

9. **New session** in the Arena chooses project (including No project), provider, and initial
   Ask/Plan/Agent mode before creation. Unsupported provider modes are disabled or omitted using
   server-owned health capabilities.
10. Creation still sends only the existing server-owned project/provider/role contract. The chosen
    mode is stored in that session's device-local view, the new session opens in its project scope,
    and no provider turn starts automatically.

### Arena snapshot and run-discovery extension

```ts
interface RunPermissionSummary {
  requestId: string;
  participantId: string;
  tool: string;
  detail: string;
}

interface RunDescriptor {
  // existing identity, lifecycle, queue, and count fields
  status?: string;
  pendingPermissions: RunPermissionSummary[];
  outcome?: 'completed' | 'failed' | 'cancelled'; // retained finished runs only
}
```

The run registry derives these summaries only from events it already buffers. Provider credentials,
private provider-session ids, arbitrary transcript content, and capability choices do not enter the
response.

---

## Acceptance criteria

- [x] Arena cards include every canonical session, group by project/No project, sort by recency,
      expose the local state vocabulary accurately, and open the right project-scoped view.
- [x] Each card shows title, repositories, agents, machine, activity, and attention without storing
      canonical session content in browser persistence.
- [x] The header Inbox is reachable inside any session, counts host-wide unresolved/read attention,
      orders permission/failure/completion items, and retains the last good snapshot on refresh error.
- [x] A permission from another project can be allowed or denied directly from the Inbox by its own
      run/request ids, updates promptly, and cannot resolve another run's request.
- [x] Completed and failed attention is individually/all dismissible through a bounded versioned
      device record; permissions remain non-dismissible until resolved.
- [x] Arena creation requires project, provider, and supported mode up front, opens the resulting
      session in the correct scope with that mode selected, and starts no turn.
- [x] Existing session views, drafts, panels, canvases, stream recovery, queue promotion, and
      same-session permission cards retain their behavior while project navigation is no longer
      locked by unrelated work.
- [x] Run discovery tests cover permission detail isolation, status, terminal outcome, and cleanup;
      pure UI-model tests cover state precedence, grouping, Inbox ordering/read semantics, and
      malformed device persistence.
- [x] Playwright covers opening the Arena, cross-project state, an Inbox permission decision without
      first opening its session, completed/read and refresh-failure behavior, and mode-aware session
      creation; model and route tests cover failed attention.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- Authenticated devices, network exposure, another execution machine, machine selection, remote
  routing, or real **Offline** state. Those begin at vision steps 7 and 8.
- Durable/synchronized Inbox read state, OS/browser push notifications, email, sound, or interruption
  while the page is closed.
- Agent-authored questions as a new protocol event. This slice handles the existing human-blocking
  permission request; a typed question/choice event needs its own provider and wire contract.
- Spatial/freeform session placement, saved Arena layouts, priorities, drag ordering, search, archive,
  or task completion semantics.
- Starting an agent turn from the Arena. “Starting work” here creates and opens the configured
  persistent session; the instruction remains an explicit action inside it.

## How to verify

1. Create sessions in two projects plus No project, then open the Arena. Every session appears once
   in the right recency-ordered group with repositories, agents, machine, and Idle state; opening any
   card focuses it in the correct project scope without losing other saved views.
2. Run two delayed turns and queue a third across projects. The cards and Inbox button update to
   Running/Queued without selecting those projects; queue promotion later changes the card to
   Running.
3. Make an Agent turn in a background project request Edit permission. From another session, open
   Inbox, verify its project/session/tool/path reason, choose Allow or Deny, and confirm only that
   run continues.
4. Let one turn complete and one fail. Both enter Inbox, the failed card stays Failed, and marking
   the items read clears their badge without hiding an unresolved permission. Reload and confirm the
   bounded device-only read state restores.
5. From Arena choose a different project, provider, and supported mode, then create. The session
   opens in that project with the mode selected and an empty transcript; no run appears until Send.
6. Block one Arena polling response. The prior cards remain usable and a refresh notice appears;
   restoring the response catches the overview up.
7. Run `npm run lint`, `npm test`, and `npm run test:e2e`.
