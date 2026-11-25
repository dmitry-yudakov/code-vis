# Story 153 — Add Gemini as a local CodeAI participant

**Status:** Draft · **Type:** Full-stack · **Builds on:** [Story 150 — participant controls](STORY-20261118-participant-controls.md)

## Motivation

A developer with a personal Google AI Plus account wants to ask Gemini to review Claude’s work or hand
Gemini a coding task in the same CodeAI session. Choosing Gemini should keep the checkout, shared
conversation, role, and approval controls the developer already uses. This extends the multi-agent
conversation described in the [arena vision](../docs/vision.md#inside-a-session).

## Provider choice and prerequisites

Use Google Antigravity CLI’s Agent Client Protocol (ACP) server, `agy acp`. Google documents this
interface for custom clients. It runs over stdio, reuses the desktop user’s personal Google sign-in, and
supports streamed replies, tool calls, diffs, permission requests, cancellation, and session resume.
Google moved individual coding accounts to Antigravity in June 2026.
[ACP integration and sign-in](https://antigravity.google/docs/ide/extensions/acp) ·
[Google’s migration announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)

As of November 21, 2026, Google includes CLI access in the weekly baseline available to personal
accounts outside Pro and Ultra, including Plus. The quota depends on the work performed. This machine
reported `agy --version` **1.4.0**. Google introduced `agy acp` in **1.5.0**, so a live trial needs a
newer installation. The account’s model list, remaining quota, and live permission behavior are
unverified. [Antigravity plans](https://antigravity.google/docs/plans) ·
[CLI release notes](https://antigravity.google/docs/changelog)

## Current behavior (where the code is)

- New-session and Add participant controls enumerate Claude and Codex. The API, stored sessions, and
  machine health payloads also validate provider identities.
  [Provider chips](../src/features/agents/ProviderChips.tsx#L16) ·
  [API schema](../src/shared/protocol.ts#L50) · [Session schema](../src/shared/sessionSchema.ts#L14) ·
  [Machine health schema](../src/shared/machineSchema.ts#L106)
- The server resolves the addressed participant’s adapter and checks the requested mode, model, and
  effort before admitting a turn. The registry provides distinct Local and Docker adapters.
  [Turn admission](../src/server/conversation/submitMessage.ts#L209) ·
  [Provider registry](../src/server/agents/providerRegistry.ts#L112)
- The existing runner contract carries the checkout, prompt, permission gate, abort signal, and streamed
  events. The conversation service persists the provider session ID per participant and supplies it on
  resume. [Runner contract](../src/shared/types.ts#L860) ·
  [Session start and resume](../src/server/conversation/conversationService.ts#L105)

## Desired behavior

1. Offer **Gemini** (provider ID `gemini`) in Local session creation and **Add participant**. Preserve
   role selection, Main, and addressed sends. Keep older sessions readable and treat a missing Gemini
   entry in an older machine snapshot as unavailable there. Generate model and effort choices from what
   this account and CLI advertise. Offer the provider default when choices are unavailable.
2. Add a server-owned Antigravity adapter and runner. Preflight checks the executable and ACP handshake
   without sending a model prompt. Missing ACP support gives an upgrade hint. An authentication-required
   response directs the user to sign in on the executing host with `agy acp --login`. Use personal
   Google OAuth (`oauth-personal`), with credentials managed by the CLI. If the installation only offers
   API-key or enterprise authentication, show the personal sign-in instructions. Never switch billing
   methods on failure. On quota exhaustion show Google’s reason and any supplied reset time. Retrying is
   the user’s choice and uses the same account.
3. Start ACP in the resolved checkout. Deliver the prompt’s referenced files and snapshots as read-only
   per-turn context or equivalent embedded ACP resources, respecting the existing attachment bounds.
   Give each Gemini participant its own provider session ID. Resume that exact ID after reload or
   restart. Use the existing prompt builder to deliver messages the participant missed while another
   agent was working. If Google cannot reopen an ID, surface the failed resume and preserve the
   transcript. Map ACP updates to existing activity, permission, and reply events. Persist the final
   reply once.
4. Target Local **Ask** and **Plan** at both security levels and **Agent** at Native. Explicitly select
   the ACP mode each turn. Ask and Plan must enforce CodeAI’s read-only policy for direct edits and
   shell writes, including when user or project rules would allow them. Google documents that existing
   permission rules can resolve actions before the client sees a request. Verify isolation on the actual
   CLI before advertising either read-only mode. For Native Agent, route each ACP permission request to
   the existing card for that run and action. An explicit CodeAI instruction-isolation choice must also
   be honored or the mode reported unavailable.
   [CodeAI mode policy](../src/server/agents/agentPolicy.ts#L67) ·
   [Google’s permission behavior](https://antigravity.google/docs/ide/extensions/acp#permissions)
5. Keep scheduling, write checkpoints, Undo, and transcript recovery with their existing owners. On
   cancellation or process failure, settle outstanding permission cards and stop the provider’s work
   before releasing the checkout. A setup or turn failure for Gemini must leave the other participants
   usable.

**First-release scope.** Deliver foreground Local participation with personal Google sign-in. Docker
execution, additional writing modes, API-key billing, and Gemini-powered background jobs are separate
work. Existing title and archive paths that dispatch by participant provider should skip unsupported
Gemini work.

## Acceptance criteria

- [ ] A user can start a Local session with Gemini, or add it to a Claude/Codex session. A message
      addressed to Gemini streams into that conversation under the correct name and role. Gemini can
      quote a known line from an attached file, and the attachment stays read-only in writing mode.
- [ ] Reload and restart recover the same participant and provider session. Two Gemini participants keep
      distinct IDs. A follow-up can use a message sent by another participant since Gemini’s last turn
      without duplicating prior replies.
- [ ] Missing or outdated CLI, missing or incompatible login, exhausted quota, and expired session ID
      produce distinguishable outcomes. Older session and machine records still open. The server rejects
      unsupported mode, execution, and model selections.
- [ ] Ask and Plan can read a known file and leave the checkout untouched on attempted writes, including
      with a permissive local rule. Unsupported modes stay unavailable. In Native Agent an approved edit
      is visible and eligible for Undo, a denied edit leaves the file intact, and cancelling a pending
      approval prevents the action.
- [ ] A failed or cancelled turn releases its resources and allows a later turn on the same checkout. A
      late event or permission decision cannot affect that later turn.

## How to verify

1. Use a scripted ACP subprocess for handshake, stream, resume, permission, cancellation, quota, and
   process-exit tests. Exercise provider registration and old-record parsing through the production
   entry points. Run the focused Vitest cases and `npm run lint`.
2. Exercise the browser flow in a mixed-provider session. Create or add Gemini, address a turn, switch
   recipients, reload, and resume. Cover both an unavailable installation and an available provider.
3. With an ACP-capable CLI signed into a personal account, repeat the read, allow, deny, cancel, and
   resume cases in a disposable checkout with a text attachment outside it. Compare its files and Git
   status before and after each case. Record the CLI version, security level, mode, and observed results
   in the story. Keep any unproven mode disabled and identify the remaining gap.
