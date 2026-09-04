# Story 42 — Attach a second execution machine to the Arena

**Status:** Shipped · **Type:** Full-stack ·
**Depends on:** [Story 41](STORY-20260904-authenticated-devices.md) (authenticated personal devices,
shipped) and [Story 38](STORY-20260903-arena-and-inbox.md) (the local Arena, shipped)

**Vision context:** step 8, “A second machine,” in [vision.md](../docs/vision.md#sequence), and the
second-execution-machine delivery slice in
[multi-project-session-environment.md](../docs/multi-project-session-environment.md#possible-delivery-slices).

---

## Motivation

Before this story, CodeAI let several personal devices use one home machine, but every session,
checkout, run, and provider still belonged to that one executor. A laptop and desktop therefore
remained two separate arenas: the user could not see both machines' work together, open a session
on the other machine, or answer its permission without navigating to another origin. This slice
makes the boundary explicit while preserving the rule that capabilities and repository writes are
resolved only by the machine that performs the work.

---

## Shipped implementation (where the code is)

- Pairing and durable trust records:
  [machineAuthStore.ts](../src/server/machines/machineAuthStore.ts#L124) and
  [machineRegistry.ts](../src/server/machines/machineRegistry.ts#L88).
- Executor snapshot and aggregated Arena:
  [localExecutorSnapshot.ts](../src/server/machines/localExecutorSnapshot.ts) and
  [the Arena route](../src/app/api/arena/route.ts#L58).
- Same-origin remote routing:
  [machineGateway.ts](../src/server/machines/machineGateway.ts#L31) and
  [client route selection](../src/features/machines/routes.ts#L2).
- Machine-grouped interaction:
  [Arena.tsx](../src/features/arena/Arena.tsx#L48),
  [AppShell.tsx](../src/features/shell/AppShell.tsx#L75), and
  [machine-qualified views](../src/features/shell/useWorkspaceViews.ts#L20).
- Operator entry points: `machine:pair`, `machine:attach`, `machine:list`, `machine:detach`,
  `machine:peers`, and `machine:revoke` in [package.json](../package.json).

---

## Desired behavior

### A. Machines attach explicitly over the trusted HTTPS transport

1. On the executor being attached, `npm run machine:pair` issues a hashed, single-use, ten-minute
   machine pairing code. On the home machine, `npm run machine:attach -- <origin> <code>` exchanges
   it over the executor's exact configured HTTPS origin and records the returned executor identity
   and opaque credential in a bounded `0600` registry.
2. The executor stores only a salted credential digest and a bounded peer summary. Machine
   credentials are accepted only through `start:remote`'s verified TLS transport, never through
   ordinary local startup, and can be revoked with `npm run machine:detach -- <machine-id>`.
3. Pairing rejects malformed origins, redirects, expired/reused codes, self-attachment, duplicate
   or over-limit peers, corrupt state, oversized bodies, and responses whose machine identity does
   not match the authenticated attachment.

### B. One bounded gateway preserves execution ownership

4. The home machine exposes a same-origin `/api/machines/<machine-id>/…` gateway only to its
   authenticated personal devices. It forwards an explicit allowlist of existing project, session,
   repository, run, stream, cancellation, and permission routes with the stored machine credential;
   authentication, pairing, registry, and arbitrary paths are never proxyable.
5. Request credentials, cookies, origins, hop-by-hop headers, remote URLs, and machine registry
   details never reach the browser. Buffered request/snapshot bodies and copied response headers
   remain bounded, redirects fail, and an unreachable executor becomes a bounded `502` response.
   NDJSON responses stream through without buffering the agent turn.
6. Existing provider policy, checkout resolution, run scheduling, and canonical session mutations
   continue to execute on the owning machine. A client chooses a target machine but cannot assert
   executable paths, provider handles, policy, concurrency, or capabilities.

### C. The Arena spans machines and treats offline as normal

7. `/api/arena` returns the local machine plus every attached executor. Each machine projection
   contains its identity, online/offline state, projects, checkouts, provider health, bounded session
   summaries, and run discovery. Remote snapshots are fetched concurrently with a short timeout.
8. The last valid bounded remote projection is cached durably. If a machine is asleep or
   unreachable, its cached cards remain visible as **Offline**, with their last-seen time; live
   actions and creation are disabled until it reconnects. Full offline transcripts are deferred to
   durable coordinator continuity.
9. The Arena groups projects beneath machines, aggregates Inbox attention across them, and routes
   open/create/archive/restore/permission actions to the owning machine. Opening an online remote
   session switches the shell to that machine's catalog; repository reads, mutations, agent turns,
   cancellation, reattachment, and event streams use the gateway while device layout stays local.
10. Loose-session workspace scopes and checkout selection are machine-qualified so switching
    machines cannot overwrite another executor's disposable browser layout.

### Machine contract

```ts
interface ArenaMachineSnapshot {
  machine: {
    id: string;
    label: string;
    kind: 'local' | 'remote';
    state: 'online' | 'offline';
    lastSeenAt?: string;
  };
  projects: DurableProject[];
  checkouts: CheckoutSummary[];
  recentCheckoutIds: string[];
  providers: Record<AgentProvider, ProviderHealth>;
  sessions: ArenaSessionSummary[];
  archivedSessions: ArenaSessionSummary[];
  runs: RunDiscovery;
}

interface ArenaSnapshot {
  machines: ArenaMachineSnapshot[];
}
```

---

## Acceptance criteria

- [x] Machine pairing/attachment uses the configured HTTPS transport, hashed single-use challenges,
      hashed executor-side credentials, bounded atomic `0600` records, and explicit detach/revoke.
- [x] The gateway authenticates the local personal device, permits only the documented API matrix,
      strips authority-bearing headers, bounds bodies, rejects redirects, and streams NDJSON.
- [x] Remote requests execute against the remote store, checkout registry, provider policy, and
      per-machine scheduler; no browser request can supply or widen those capabilities.
- [x] The Arena displays local and remote machine groups, aggregates attention, supports creation
      and existing session actions on online executors, and shows cached offline cards without
      presenting live controls.
- [x] Opening a remote session routes full transcript, repository, mutation, turn, permission,
      cancellation, discovery, and reattachment traffic through its owning machine.
- [x] Machine-qualified device scopes preserve independent loose-session layouts and repository
      selection without changing canonical project/session records.
- [x] Focused store/auth/gateway/snapshot/model tests cover expiry, replay, corruption, offline
      caching, route denial, credential stripping, remote routing, and stream pass-through.
- [x] README, architecture, environment notes, sample configuration, vocabulary/status, and command
      help describe attachment, trust, routing, offline behavior, limits, and removal.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

- Internet discovery, NAT traversal, outbound relays, automatic certificate issuance, accounts,
  invitations, teams, roles, or machine access shared with another human.
- Moving or replicating a canonical session/project between machines, portable repository identity,
  multi-machine repositories in one runnable turn, or concurrent transcript writers.
- Full transcript/canvas reads while an executor is offline, durable cross-device workspace/view
  state, or a coordinator no device owns. Those belong to future continuity work.
- Chained/transitive machine discovery. A hub queries only its own explicitly attached executors;
  an executor's registry is never exposed through its snapshot.

## How to verify

1. Start two builds in paired mode at two trusted HTTPS origins with separate data directories. On
   the second executor run `npm run machine:pair`; on the home machine run
   `npm run machine:attach -- <executor-origin> <code>`.
2. Open the home Arena from a paired browser. Confirm both machine groups appear, create/open a
   session on the executor, inspect its repository, stream a turn, answer a permission, cancel a
   second turn, and reload while it runs to verify reattachment.
3. Stop the executor. Confirm its last cards remain with Offline state and last-seen copy, while
   open/create/archive/permission controls fail closed. Restart it and confirm the next Arena poll
   returns it to Online without re-pairing.
4. Try an unpaired browser, ordinary `npm start`, an unlisted proxy path, a redirected endpoint, an
   invalid/reused pairing code, and a revoked machine credential; confirm none reads host data or
   performs an action.
5. Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`.

Automated verification includes the full Vitest suite plus a Playwright home/remote route harness
that opens and streams a remote session, then confirms its cached card becomes non-actionable when
the executor is Offline. Real certificate distribution and two-host reachability remain operator
checks because the test suite stays offline.
