# Story 41 — Pair personal devices with one home machine

**Status:** Shipped · **Type:** Full-stack ·
**Depends on:** [Story 38](STORY-20260903-arena-and-inbox.md) (the local Arena, shipped) and
[Story 40](STORY-20260903-arena-routes.md) (canonical Arena routes, shipped)

**Vision context:** step 7, “Your own devices,” in [vision.md](../docs/vision.md#sequence), and the
authenticated-device delivery slice in
[multi-project-session-environment.md](../docs/multi-project-session-environment.md#possible-delivery-slices).

---

## Motivation

The machine already owns durable projects, sessions, runs, and permission decisions, but every
route assumes the browser is on the same trusted desktop. A tablet or headset cannot safely open
the Arena: ordinary HTTP exposes session content and pairing secrets in transit, and every client
that can reach the port can currently read repositories, start or cancel turns, and answer agent
permissions. The next useful step is one person's authenticated devices connected to that one home
machine without introducing accounts, teams, or another executor.

---

## Shipped implementation (where the code is)

- Configuration and TLS startup: [src/server/config.ts](../src/server/config.ts#L9) (~line 9) owns
  the local/paired mode and exact public origin; [scripts/start-remote.mjs](../scripts/start-remote.mjs#L1)
  (~line 1) terminates TLS, enforces Host/port, and stamps requests with a process-only marker.
- Pairing persistence: [src/server/devices/deviceAuthStore.ts](../src/server/devices/deviceAuthStore.ts#L1)
  (~line 1) atomically stores bounded challenge and credential digests; the terminal issuer is
  [scripts/create-pairing-code.ts](../scripts/create-pairing-code.ts#L1) (~line 1).
- Authorization boundary:
  [src/server/devices/deviceAuthorization.ts](../src/server/devices/deviceAuthorization.ts#L1)
  (~line 1) validates transport, Host/Origin, cookie, and durable device state; every private route
  calls it before domain work, including
  [src/app/api/agent/message/route.ts](../src/app/api/agent/message/route.ts#L21) (~line 21).
- Bootstrap and management routes: [src/app/api/auth](../src/app/api/auth) provides bounded status,
  one-time exchange, listing, revocation, and self-sign-out without exposing secrets.
- Browser boundary: [src/features/devices/DeviceAccess.tsx](../src/features/devices/DeviceAccess.tsx#L1)
  (~line 1) gates `AppShell`; [DeviceMenu.tsx](../src/features/devices/DeviceMenu.tsx#L1) (~line 1)
  manages paired summaries from the header.
- Coverage: [test/deviceAuthStore.test.ts](../test/deviceAuthStore.test.ts#L1) (~line 1),
  [test/deviceAuthRoutes.test.ts](../test/deviceAuthRoutes.test.ts#L1) (~line 1), and
  [e2e/device-pairing.spec.ts](../e2e/device-pairing.spec.ts#L1) (~line 1) exercise persistence,
  route authorization classes, pairing UI, management, and unchanged local startup.

---

## Desired behavior

### A. Remote access is explicit and encrypted

1. Normal `dev` and `start` remain local-mode compatible and require no pairing. Personal-device
   access is enabled only with `CODEAI_REMOTE_ACCESS=paired`, an exact HTTPS
   `CODEAI_PUBLIC_ORIGIN`, TLS certificate/key paths, and the dedicated `start:remote` command.
2. The remote server terminates TLS itself and stamps requests as coming through that server.
   Paired-mode APIs reject insecure, wrong-origin, or ordinary `next start` requests before reading
   host data or accepting an action. Mutation requests also require the exact configured browser
   `Origin`.

### B. Pairing proves possession and creates a revocable device session

3. `npm run device:pair` creates one high-entropy, single-use pairing code in the configured data
   directory and prints its expiry. The stored challenge is a digest, expires after ten minutes,
   and is invalidated after a small bounded number of failed attempts.
4. An unpaired HTTPS device sees a focused pairing screen before `AppShell` mounts. It submits a
   bounded device label and code to the only unauthenticated mutation endpoint; success consumes
   the challenge and sets an opaque `HttpOnly`, `Secure`, `SameSite=Strict`, host-only cookie.
5. Device credential secrets are never persisted or logged in plaintext. The host stores only a
   salted/digested credential, device id and label, pairing/expiry timestamps, in an atomic `0600`
   record outside the canonical session store. Corrupt auth state fails closed in paired mode.
6. An authenticated device can list paired-device summaries, revoke another device, or sign out
   itself from a compact header menu. Revocation takes effect on its next API request; responses
   never expose pairing challenges or credential digests.

### C. Authorization is enforced at the data boundary

7. Every existing `/api` read, mutation, run-discovery, attachment stream, turn, cancellation, and
   permission-decision handler performs the same durable device authorization before its domain
   operation. The pairing status and code-exchange endpoints reveal only the bounded bootstrap
   facts needed to pair.
8. The single personal owner has one authorization scope: a paired device may use the existing
   product, while an unpaired/revoked device may use none of its host data or actions. Provider
   capabilities continue to be resolved on the execution machine.

### Device auth contract

```ts
interface DeviceAuthStatus {
  mode: 'local' | 'paired';
  authenticated: boolean;
  transportSecure: boolean;
  hostLabel: string;
  device?: { id: string; label: string };
}

interface PairedDeviceSummary {
  id: string;
  label: string;
  pairedAt: string;
  expiresAt: string;
  current: boolean;
}
```

---

## Acceptance criteria

- [x] Default local development and production behavior stays frictionless, while paired mode
      fails closed unless it is served at the configured HTTPS origin through `start:remote`.
- [x] The terminal command issues only a hashed, ten-minute, single-use pairing challenge; bounded
      failed attempts, malformed input, expiry, reuse, and corrupt persistence are covered.
- [x] Successful pairing creates a hashed durable device credential and a host-only HttpOnly,
      Secure, SameSite Strict cookie; no route or response exposes either secret or digest.
- [x] An auth gate prevents the shell and its polls from mounting before paired-mode authentication,
      explains insecure/misconfigured transport, and completes pairing without a page reload.
- [x] Every private API handler authorizes first; tests prove unpaired and revoked clients cannot
      read sessions/repositories/runs or start/cancel turns and cannot answer permissions.
- [x] Authenticated device listing, revocation, and self-sign-out work from the shell without
      changing canonical project/session records or device-local layouts.
- [x] Focused route/store tests cover the security contract and Playwright covers the pairing gate,
      successful entry, device menu, sign-out, and the unchanged local-mode shell.
- [x] README, architecture, environment notes, sample configuration, and plan-of-record status
      describe the one-home-machine topology, certificate trust, pairing/revocation, and limits.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

- Internet discovery, NAT traversal, an outbound relay/coordinator, automatic certificate issuance,
  or teaching another device to trust a private certificate authority.
- A second execution machine, machine routing/offline state, cross-machine record replication, or
  durable shared workspace layouts. Those remain vision steps 8–10.
- Multiple human accounts, roles, invitations, recovery credentials, SSO, teams, presence, or
  concurrent transcript editing. A pairing code proves possession for the one personal owner.
- Push notifications or background delivery while the web application is closed.

## How to verify

1. Run the normal local server with no remote variables and confirm the existing shell and all API
   tests work without a pairing step.
2. Build, configure paired mode with a trusted certificate and exact LAN HTTPS origin, then run
   `npm run start:remote`. Open it from an unpaired device and confirm only the pairing screen loads.
3. Run `npm run device:pair`, enter its code and a device name, and confirm the Arena and session
   views load. Reusing the code on another browser must fail.
4. Start a turn, answer a permission, cancel another turn, and inspect repository/session data from
   the paired device. Repeat without its cookie and confirm each route rejects the request.
5. Pair a second browser, revoke it from the device menu, and confirm its next API request returns
   unauthorized. Sign out the current browser and confirm it returns to the pairing gate without
   losing host records or its disposable local layout.
6. Attempt paired mode over HTTP, at another Host/Origin, and through ordinary `npm start`; confirm
   host APIs fail closed with no session or repository data.
7. Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`.
