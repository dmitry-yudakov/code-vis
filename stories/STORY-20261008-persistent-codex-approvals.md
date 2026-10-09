# Story 101 — Remember a Codex command approval from CodeAI

**Status:** In progress — blocked on App Server rule isolation · **Type:** Full-stack · **Depends on:** [Story 79](STORY-20260928-sandboxed-auto-mode.md), [Story 82](STORY-20261001-native-security-level.md), [Story 88](STORY-20261002-unlimited-approval-waits.md)

**Vision slice:** [The Arena](../docs/vision.md#the-arena): a permission needs the owner's attention
once when they deliberately choose to remember it. Part of the
[security levels epic](EPIC-20261001-security-levels.md).

## Motivation

On October 8, 2026, the owner asked how to whitelist repeated Codex approvals for a command like:

```sh
env CODEAI_DIST_DIR=.next-e2e CODEAI_AGENT_TIMEOUT_MS=900000 CODEAI_DEBUG_AGENT=0 \
  node_modules/.bin/playwright test e2e/canvas.spec.ts -g 'keeps multiple session views' --max-failures=1
```

They then asked, "what can we do from codeai to always allow this?" CodeAI's Allow button answers
one invocation. Remembering a command currently requires editing Codex's rules outside CodeAI.
Expose Codex's existing persistent command approval, with the exact prefix and its scope visible
before the owner selects it.

## Current behavior (where the code is)

- [codexProcessRunner.ts:317](../src/server/agents/codexProcessRunner.ts#L317) — correlates command
  and file approvals with a provider thread/turn; maps Allow to `accept` and discards proposed rules.
  [Its command display:80](../src/server/agents/codexProcessRunner.ts#L80) shortens paths and long
  commands, which is unsuitable as the source of a remembered rule.
- [codexInvocation.ts:32](../src/server/agents/codexInvocation.ts#L32) and
  [:92](../src/server/agents/codexInvocation.ts#L92) — own App Server flags, modes, sandbox policies,
  and the Guarded user-only reviewer. Two turn-wide permission features stay disabled at both levels.
- [permissionBroker.ts:23](../src/server/runs/permissionBroker.ts#L23) and
  [runRegistry.ts:431](../src/server/runs/runRegistry.ts#L431) — accept one Allow/Deny decision per
  live request, retaining cancellation and optional expiry.
- [types.ts:582](../src/shared/types.ts#L582), [protocol.ts:73](../src/shared/protocol.ts#L73), and
  [api/agent/permission/route.ts:8](../src/app/api/agent/permission/route.ts#L8) — define resolution,
  validate the strict browser request, authorize the device, and resolve the executing run.
- [conversationService.ts:181](../src/server/conversation/conversationService.ts#L181),
  [runRegistry.ts:367](../src/server/runs/runRegistry.ts#L367),
  [machineSchema.ts:67](../src/shared/machineSchema.ts#L67), and
  [runPresentation.ts:117](../src/features/conversation/runPresentation.ts#L117) — carry summaries
  through streams, replay, machine snapshots, and conversation presentation.
- [PermissionCard.tsx:7](../src/features/agents/PermissionCard.tsx#L7),
  [Arena.tsx:270](../src/features/arena/Arena.tsx#L270), and
  [SessionTools.tsx:277](../src/features/shell/immersive/SessionTools.tsx#L277) — desktop conversation,
  Inbox, and VR approval surfaces.
- [usePermissionDecisions.ts:9](../src/features/shell/usePermissionDecisions.ts#L9) — shared desktop/VR
  command owner; routes to the selected machine and prevents duplicate submission.
  [machineGateway.ts:31](../src/server/machines/machineGateway.ts#L31) proxies the existing route.
- [codexProcessRunner.test.ts:317](../test/codexProcessRunner.test.ts#L317) — verifies the one-action
  contract. Existing one-time assertions remain valid for ordinary Allow.

## Desired behavior

### 1. Review and remember a provider-proposed prefix

A pending, eligible Local Codex command approval shows **Deny**, **Allow once**, and **Always allow
this prefix**. The last action appears only when the executing server holds a valid Codex-proposed
execpolicy amendment for that request. Ordinary cards retain their current Allow/Deny behavior.

Show a distinct "Commands starting with" preview and this scope beside the persistent action:

> Applies to Codex on **Machine name**, across projects and conversations, including terminal
> sessions. Matching commands may run outside the sandbox without asking.

Display the exact argument tokens with unambiguous quoting, preserving their boundaries, order,
whitespace, and absolute paths. Do not use shortened command detail or the model's reason as the
prefix. The full preview must be available before approval: wrap/scroll on desktop and page in VR;
do not silently truncate it. The user approves the visible prefix, including any trailing arguments
it fixes. Different test files/filters are covered only if the prefix ends before those arguments.
CodeAI does not promise that every Playwright invocation matches.

For the motivating command, a useful proposal would be:

```json
["env", "CODEAI_DIST_DIR=.next-e2e", "CODEAI_AGENT_TIMEOUT_MS=900000", "CODEAI_DEBUG_AGENT=0", "node_modules/.bin/playwright", "test"]
```

This is an example, not a built-in allowlist. CodeAI never constructs or broadens a proposal from
the command string, strips environment arguments, or substitutes a generic `env`/`bash` rule.
Shell wrappers may lead Codex to propose a different or exact-command prefix. Present that actual
proposal or retain Allow once; do not add a shell parser or command safety classifier.

### 2. Keep the rule and capability on the executing server

Eligibility is per request, not a provider-wide browser toggle:

- Local Codex in Agent or Auto, at Guarded or Native, with a correlated
  `item/commandExecution/requestApproval`; absent `kind` means `command` on older servers.
- `proposedExecpolicyAmendment` is a nonempty array of nonempty literal strings, at most 32 tokens
  and 4,096 UTF-8 bytes of serialized JSON, with no control characters. Malformed/oversized data
  suppresses persistence while leaving one-time approval answerable. Do not normalize tokens.
- If `availableDecisions` is supplied, it must offer `acceptWithExecpolicyAmendment` with the same
  tokens. An empty or malformed supplied list does not grant support. Absent/null lists use the
  validated proposal as the legacy capability signal; confirm this with the real-provider probe.
- File edits, stdin approvals, managed-network approvals, Claude, Docker, Ask/Plan, and requests
  without a valid proposal never offer persistence. An unsupported persistent decision is rejected
  on the server even if a stale or modified browser sends it.

Freeze/copy the original tokens into the pending request's server-owned state before publishing
its optional display metadata. A browser sends only run ID, request ID, and decision; it cannot
submit tokens, a rules path, provider settings, or a sandbox/profile change. Display tokens may
cross the wire for review, but the response always uses the original server-held proposal.

**Always allow this prefix** answers that callback with:

```json
{
  "decision": {
    "acceptWithExecpolicyAmendment": {
      "execpolicy_amendment": ["the", "exact", "proposed", "tokens"]
    }
  }
}
```

Codex owns persistence and matching. CodeAI does not write provider configuration files, maintain
a second rules store, or automatically answer subsequent cards. Ordinary Allow still sends
`accept`; Deny sends `decline`; cancellation sends `cancel`. Do not use `acceptForSession` or enable
`request_permissions_tool`/`exec_permission_approvals` for this feature.

### 3. Preserve request identity and honest outcomes

Carry the optional proposal through the live stream, replay, run summaries, executor snapshot
validation, and desktop/VR presentation. New decoders accept summaries without it; no session
format change is needed. Mixed versions that reject the additional field must report the machine
or protocol as unavailable, not invent support or silently discard a live permission.

Expose persistence in desktop conversation cards and VR Session tools. Inbox keeps its compact
Allow/Deny actions and **Open session** leads to the full review; do not save a rule from an Inbox
row that has not displayed its full prefix and scope. All surfaces use the shared decision owner.
An attached executor saves into its own Codex home, never the home machine's or viewing device's.

Validate the requested decision against that exact live request before consuming it. A rejected
persistent choice leaves Allow/Deny available. Preserve first-answer-wins across devices, timeout,
cancellation, provider exit, and mode changes. A stale request cannot create a rule or approve its
replacement. Reconnect/replay restores the proposal without selecting the action automatically.

If a valid persistent decision wins before cancellation, provider exit, or a mode change, Codex
may still save the rule. Those actions do not revoke a delivered approval or roll back provider
persistence. Reject decisions that arrive after the request closes; do not promise transactional
cancellation of a rule that was already requested.

The route's success means the decision was delivered to the live callback, not that a rule reached
disk. Record the persistent decision distinctly; initial feedback says "Allowed; persistent rule
requested." Surface provider errors/warnings about saving. Never claim "Rule saved" without
provider confirmation. If delivery is uncertain, use the existing refresh flow; do not resend
automatically, fall back to Allow once, or claim persistence. The provider may run the command
even if saving fails; report those outcomes separately when known.

### 4. Define the exception to Guarded's one-time approval contract

This is a deliberate, human-selected exception to [Story 79](STORY-20260928-sandboxed-auto-mode.md)'s
one-action cards and the security epic's "Guarded does not loosen" invariant. Guarded retains its
default policies and user-only reviewer. An explicit remembered prefix authorizes future matching
execution outside the sandbox; it may permit network access and writes outside the checkout,
including protected paths, as that command can. Unmatched commands follow the existing policy.
Selecting the action does not change a mode, profile, reviewer, or writable root.

Saved rules belong to the executing user's Codex home: ordinarily `~/.codex/rules/default.rules`,
or the provider's configured `CODEX_HOME`. They survive new CodeAI turns, conversations, and process
restarts and affect other Codex clients using that home. Relative executable paths are not scoped
to the displayed checkout. Checkout Undo does not remove a remembered rule or undo its external
effects. Document removal of the exact rule through Codex's rules file, preserving other entries,
and that running provider processes may retain it until restarted. A rule management UI is outside
this story.

**Read-only compatibility is a shipping gate.** Test CodeAI Ask and Plan at both levels with a
remembered write-capable prefix already loaded. They must remain read-only. If loaded rules can
bypass that policy, use a verified, supported provider mechanism to isolate those turns from
user/project allow rules; do not rely on instructions or `approvalPolicy: never` alone. If no
supported isolation exists, this story cannot ship its persistence action. On installed
`codex-cli 0.161.0`, a read-only argument check rejected `codex --ignore-rules app-server --help`;
that spelling is not an established solution.

Before shipment, update active README, architecture, mode/tooltips, and AGENTS safety prose that
claims every escalation always asks or Allow is necessarily one-shot, plus the epic's invariant.
Keep the exception explicit and leave historical shipped stories as their original contracts.

### Type contract

```ts
type PermissionDecision = 'allow' | 'allow-always' | 'deny';
type PermissionResolution = PermissionDecision | 'timeout' | 'cancelled';

interface PersistentCommandApproval {
  prefix: string[]; // Display copy of bounded, exact provider-proposed tokens.
}

// Optional on AgentProcessEvent, permission-request AgentEvent,
// RunPermissionSummary, and PendingPermission; validated by machineSchema.
interface PermissionRequestMetadata {
  persistentCommand?: PersistentCommandApproval;
}

// Existing strict POST body: no prefix or settings fields accepted.
interface PermissionDecisionRequest {
  runId: string;
  requestId: string;
  decision: PermissionDecision;
}
```

The broker registers supported decisions per request, defaulting to Allow/Deny for existing
callers, and validates them before settling. The registry/route add an unsupported-decision
outcome (`409`), distinct from unknown run (`404`), resolved request (`409`), and malformed body
(`400`). Resolution consumers, including Claude's denial-message mapping, must handle the added
union member without allowing Claude persistence. Propagate the shared type through callbacks
rather than duplicating string unions. No provider RPC object is accepted from the browser.

## Acceptance criteria

- [ ] Eligible Local Codex Agent/Auto cards at both levels offer persistence and show the complete
      exact prefix, executing machine, cross-project/client scope, and sandbox effect.
- [ ] Only bounded valid proposals and provider-permitted decisions create the capability; all
      ineligible cases retain one-time approval and cannot accept a forged persistent decision.
- [ ] The RPC uses the immutable server-held proposal exactly; ordinary Allow/Deny/cancellation
      retain their responses, and no configuration writer or custom matcher is added.
- [ ] Unsupported persistence returns `409` without consuming the request. First-answer-wins
      rejects duplicate/stale answers, including after expiry, provider exit, cancellation, or mode
      changes; cancellation after a delivered persistent decision makes no revocation promise.
- [ ] Stream/replay, run discovery, snapshot schemas, attached-executor routing, and desktop/VR
      presentation preserve capability and identity; Inbox directs persistence to full review.
- [ ] Feedback distinguishes a requested persistent decision from confirmed saving and handles
      provider save failures and uncertain delivery without automatic retry or fallback approval.
- [ ] A real Codex probe proves matching/nonmatching behavior, persistence across fresh processes,
      storage on the executing machine, concurrent amendments retaining both rules, and save-failure
      behavior. Record version, proposals, decisions, and results without provider credentials.
- [ ] With saved write-capable rules, real CodeAI Ask/Plan remain read-only at Guarded and Native;
      any required isolation is independently verified. Unmatched Guarded Agent/Auto retains its
      sandbox/profile, protected paths, user-only reviewer, and approval behavior.
- [ ] Both-theme desktop browser checks and bounded VR controller checks pass; long previews stay
      readable, and focus, speech, replay, or request navigation never approves or remembers a rule.
- [ ] Active documentation describes the Guarded exception, provider-home scope, manual revocation
      and process-cache limits, matching limitations, and checkout Undo exclusions.
- [ ] Focused failure-first tests, the offline suite, TypeScript, production build, and independent
      implementation review pass. Physical Quest verification is recorded separately.

## Out of scope

- Implementing this feature in the present spec-writing task, changing the owner's rules now,
  restarting/deploying the application, or committing/staging changes without another request.
- Claude persistence, Docker or network-host policy amendments, edit/stdin approvals,
  session-wide approval, per-project rules, and additional security levels.
- A rule editor/revocation UI, new configuration switches, shell parsing, dangerous-command
  classification, hard-coded Playwright rules, or automatic approval based on model rationale.
- Making saved rules bypass provider/admin prohibitions or managed review requirements. "Always"
  remains subject to supported provider policy and precise prefix matching.

## How to verify

1. Before implementation, run disposable real-provider probes for the proposal/RPC, persistence,
   failure behavior, concurrent saves, and read-only compatibility gates above. Use a trusted temp
   checkout; isolate only rules storage through a supported setup while retaining the provider's
   own login. Never copy/read credentials. If storage cannot be isolated, require an explicitly
   scoped owner-approved probe and remove only its generated rules afterwards. Record evidence in
   [docs/experiment-log.md](../docs/experiment-log.md). Schema generation alone does not prove a
   proposal will be offered, saved, or honored.
2. Add focused regressions first, extending the fake Codex approvals in
   [fake-codex.mjs:199](../test/fixtures/fake-codex.mjs#L199). Cover eligibility, exact tokens,
   strict request schema, unsupported choice without consumption, route/auth errors, callback
   races, replay/snapshots, remote routing, and shared desktop/VR decision feedback.
3. Run focused tests for `codexProcessRunner`, `permissionBroker`, `protocol`, `runScheduler`,
   `runPresentation`, `machineGateway`, `multiMachineArenaRoute`, and `immersiveSessionTools`, plus
   actual new/changed tests. Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
   Extend production browser checks in `e2e/canvas.spec.ts`, `e2e/native-security.spec.ts`,
   `e2e/machines.spec.ts`, and `e2e/immersive.spec.ts` as needed.
4. In desktop and VR, inspect a long proposal, Allow once, then select persistence for another
   eligible command. Confirm the exact rule survives a fresh turn/process; matching commands skip
   the card and a nonmatching command asks. Repeat on an attached executor and verify the home
   machine's rules are unchanged. Verify Inbox opens the exact pending review, and failures/offline
   transitions never turn an uncertain result into approval.
5. Have an independent subagent review the implementation and resolve findings. Record automated,
   real-provider, attached-transport, and physical Quest evidence separately; leave unmet shipping
   gates unchecked rather than equating fake-provider success with acceptance.

## Protocol evidence at drafting

Official [App Server approvals](https://learn.chatgpt.com/docs/app-server#approvals) document
`proposedExecpolicyAmendment`, `availableDecisions`, and `acceptWithExecpolicyAmendment`.
[Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules) document prefix matching,
user-layer persistence, shell-wrapper limitations, and stricter-rule precedence.
[Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents
managed `auto_review.ignore_rules` and `required_on_models`; a remembered rule cannot promise to
override those requirements.

Installed `codex-cli 0.161.0` generated the proposal and amendment response in its normal JSON
Schema. `availableDecisions` appeared only with `generate-json-schema --experimental`; do not
enable experimental APIs merely to require that optional field. No model turn, persistent rule,
credential access, or application behavior was changed while drafting this story.

## Spec review — October 8, 2026

An independent read-only subagent reviewed the story against the current approval, broker, route,
shared UI owner, and machine contracts. Its sole finding was corrected: cancellation can reject
a late decision but cannot revoke persistence already delivered to Codex. The reviewer confirmed
the correction and reported no remaining actionable findings. Documentation links/line anchors,
whitespace, and the illustrative TypeScript contract were checked. Implementation and real-provider
shipping gates remain unperformed; this story stays Draft.

## Implementation gate — October 9, 2026

Implementation started with the required disposable real-provider compatibility probes. The
installed `codex-cli 0.161.0` **failed the read-only shipping gate**: with one write-capable
`allow` prefix loaded, the actual `CodexProcessRunner` wrote the requested scratch marker in
Ask and Plan at both configured machine levels. There were no approval requests. Ask/Plan
correctly resolved to Guarded execution at Native as well, so this is the policy CodeAI
actually uses, not a simulated Native writing policy.

The same four commands with an empty rules directory produced no markers; their execution
failed because Codex's nested sandbox could not create a namespace on this machine. That
control establishes the difference in execution, but is not a successful OS-sandbox
compatibility acceptance run. See [the experiment evidence](../docs/experiment-log.md#story-101--persistent-approval-compatibility-gate-2026-10-09).

Both `codex --ignore-rules app-server --help` (checked during drafting) and
`codex app-server --ignore-rules --help` reject the option. The installed `exec --help`
advertises it only for `codex exec`. The generated App Server start/resume schemas and the
current official configuration reference do not establish a supported per-thread equivalent.
No supported App Server isolation mechanism has been verified. The persistence action and
its wire-contract/UI implementation therefore remain unimplemented, as required by this
story's shipping gate. Existing one-time approvals are unchanged.

To resume: obtain and independently probe a supported App Server mechanism that excludes
user **and project** execpolicy allow rules from Ask/Plan, including resumed threads. Repeat
the real compatibility matrix with a working sandbox, then complete persistence/save-failure
and concurrent-save probes before implementing and running the remaining acceptance checks.
All acceptance boxes above remain unchecked. Browser, attached-executor, physical Quest,
full offline suite, TypeScript, and production build have not been run for this blocked feature.

### End-of-work review

The requested independent read-only subagent review confirmed the observed four-case bypass,
the actual Guarded policy for Native Ask/Plan, and the unresolved App Server isolation capability.
It reported no actionable findings in the gate decision or evidence documentation. This was a
review of the blocked investigation, not an implementation review of a completed feature. It
also confirmed that allow rules created outside CodeAI can cause the same existing limitation.
`git diff --check` passed; no product code, provider settings, commits, or deployments changed.
