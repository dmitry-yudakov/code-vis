# Story — Make browser-generated UUIDs work on LAN clients

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Web2 agent Mermaid canvas](STORY-20260805-web2-agent-mermaid-canvas.md)

---

## Motivation

Cartograph works when opened locally on Linux, but message sending and diagram annotation fail on
Mac and iPad clients with an error about `crypto.randomUUID()`. LAN clients commonly open the app
over plain HTTP, where Safari does not expose that secure-context-only convenience method. The
browser can still generate cryptographically random bytes, so these interactions should not depend
on the convenience API.

This keeps the multi-modal diagram workspace described in the vision usable from tablet and desktop
browsers on the local network.

---

## Current behavior (where the code is)

- Message creation: [web2/components/AppShell.tsx](../src/features/shell/AppShell.tsx#L239) (~line 239) — creates a compatible UUID before sending a user message.
- Drawing creation: [web2/components/DiagramCanvas.tsx](../src/features/diagram/components/DiagramCanvas.tsx#L137) (~line 137) — creates compatible UUIDs for pen, rectangle, arrow, and text marks.
- UUID compatibility: [web2/lib/client/uuid.ts](../src/shared/uuid.ts#L1) (~line 1) — prefers the native method and falls back to UUID-v4 formatting from random bytes.
- Runtime validation: [web2/lib/shared/protocol.ts](../src/shared/protocol.ts#L6) (~line 6) — requires identifiers crossing the agent API to retain UUID syntax.

---

## Desired behavior

Browser-created identifiers remain UUID-v4 values whether or not the runtime provides
`crypto.randomUUID()`. Modern secure contexts use the native method; LAN HTTP clients use
`crypto.getRandomValues()` and set the RFC UUID version and variant bits explicitly.

### Concrete changes

1. Add one client UUID helper with native and `getRandomValues()` paths.
2. Use the helper for message and drawing-mark identifiers.
3. Cover native delegation and fallback UUID formatting with unit tests.

---

## Acceptance criteria

- [x] Sending a message does not call `crypto.randomUUID()` directly from browser UI code.
- [x] Pen, rectangle, arrow, and text marks do not call `crypto.randomUUID()` directly from browser UI code.
- [x] The fallback produces a valid UUID-v4 value with RFC 4122 variant bits using `crypto.getRandomValues()`.
- [x] The native method remains preferred when it is available.
- [x] `web2` unit tests and typecheck pass.

## Out of scope

- Serving Cartograph over HTTPS on the local network.
- Changing server-generated thread, run, assistant-message, or artifact identifiers.
- Supporting browsers without the broadly available `crypto.getRandomValues()` primitive.

## How to verify

1. Run `cd web2 && yarn test`.
2. Run `cd web2 && yarn lint`.
3. Run `cd web2 && yarn build`.
4. The UUID unit test removes `crypto.randomUUID`, supplies deterministic `crypto.getRandomValues()` bytes, and verifies the resulting UUID-v4 value. A Mac/iPad LAN smoke test can additionally confirm the target environment end to end.
