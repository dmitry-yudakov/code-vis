# Story 122 — Access CodeAI through both LAN and Tailscale addresses

**Status:** Shipped · **Type:** Server-only · **Depends on:** [Story 41](STORY-20260904-authenticated-devices.md)

## Motivation

One person's paired devices should reach the same home machine through its LAN IP or its
Tailscale IP. Replacing the configured origin breaks the other address. This extends the vision's
“Your own devices” slice while preserving pairing and the browser security boundary.

## Implementation (where the code is)

- `src/server/devices/publicOrigins.mjs:2` owns exact HTTPS validation, normalization,
  deduplication and the shared-port requirement for configuration and the plain-Node launcher;
  `publicOrigins.d.mts:1` declares its TypeScript contract.
- `src/server/config.ts:142` retains the primary URL and resolves its full explicit allowlist.
- `scripts/start-remote.mjs:68` loads the same list; `:105` rejects unknown Hosts before Next.js.
- `src/server/devices/deviceAuthorization.ts:35` resolves the allowed origin from actual Host,
  retains the private TLS marker requirement and checks mutations against that origin.
- `next.config.ts:17` includes additional public hostnames in development asset hints.
- `test/deviceAuthRoutes.test.ts:154`, `test/machineRoutes.test.ts:89` and
  `test/gitPushRoute.test.ts:69` cover additional-address delivery and security regressions.
- `e2e/remote-origins.spec.ts:100` exercises the real TLS listener and production Next.js routes
  through two IPs, using a temporary certificate verified by the test client.

## Desired behavior

Keep `CODEAI_PUBLIC_ORIGIN` as the primary URL, including existing pairing CLI output. Add optional
`CODEAI_ADDITIONAL_ORIGINS`, a comma-separated list of exact HTTPS origins; both variables retain
their `CODEAI_WEB2_*` compatibility names. Share validation between configuration and TLS startup.
Normalize and deduplicate the list; reject malformed origins, wildcards, credentials, paths,
queries, fragments, empty entries and ports different from the primary listener.

The TLS listener admits only configured Hosts and overwrites the private transport marker as
before. Authorization uses the actual Host header, falling back to the request URL when absent,
because Next.js can normalize that URL. Each browser mutation must match the exact HTTPS origin
addressed by that request, even when its Origin names another allowed address. Never use forwarded
headers to authorize a browser. Preserve local mode, machine bearer access, host-only cookies,
single-use pairing, and immediate revocation. A bad request must not consume a pairing challenge.

Certificates remain operator-owned and must cover every configured name/IP. Each hostname/IP has
its own browser cookies and storage; pair it separately. No automatic certificate issuance,
network/service changes, deployments, or edits to the installation's private settings.

## Acceptance criteria

- [x] Existing single-origin settings and compatibility names keep working.
- [x] Additional exact HTTPS origins work at the listener and authorization boundaries; invalid
      configuration fails closed and all origins share the listener port.
- [x] Both addresses can pair, read protected data, perform a same-origin mutation and sign out;
      revocation is enforced. Unpaired callers, unknown Hosts, forged transport and missing,
      foreign or other-allowed browser Origins remain rejected.
- [x] Actual Host wins over a Next-normalized URL; forwarded headers cannot change authorization.
- [x] Development origin hints include the additional addresses; README and `.env.example`
      explain setup, certificate coverage and separate pairing/storage.
- [x] Focused regressions fail before implementation, then pass alongside TypeScript, an isolated
      production build, a real TLS/Next.js check through two local IPs, and independent review.

## How to verify

Run the focused suite without inheriting the installation's private `CODEAI_*` environment:

```sh
python3 - <<'PY'
import os, subprocess
clean = {key: value for key, value in os.environ.items() if not key.startswith('CODEAI_')}
raise SystemExit(subprocess.call([
    'npx', 'vitest', 'run', 'test/config.test.ts', 'test/deviceAuthRoutes.test.ts',
    'test/deviceAuthStore.test.ts', 'test/machineRoutes.test.ts', 'test/nextConfig.test.ts',
    'test/dockerSettings.test.ts', 'test/dockerVersionsRoute.test.ts', 'test/gitPushRoute.test.ts',
    'test/codeAiLifecycle.test.ts', 'test/managedLifecycle.test.ts', 'test/codeAiSession.test.ts',
], env=clean))
PY
npm run lint
CODEAI_DIST_DIR=.next-e2e CODEAI_REMOTE_ACCESS=local npm run build
CODEAI_DIST_DIR=.next-e2e CODEAI_E2E_PORT=3134 npx playwright test e2e/remote-origins.spec.ts
```

November 2 verification: all 183 focused tests, TypeScript, the isolated production build, the
production TLS test and `git diff --check` pass. The new configuration, secondary-address access,
Next-normalized Host and development-origin regressions failed before implementation. The first
run also exposed six pre-existing config-test failures caused by inherited installation settings;
the isolated environment above avoids them. The push fixture now supplies the actual public Host
alongside its normalized request URL, and tests rejection in both directions between allowed origins.

The production test creates disposable data and a one-day self-signed certificate for
`127.0.0.1` and `127.0.0.2`, verifies TLS with that certificate explicitly trusted by its client,
and runs the real `start-remote.mjs` process against the build. It proves page delivery, pairing
without consuming a challenge on origin rejection, authenticated reads, both settings guards,
cross-origin rejection, sign-out/revocation, unknown Host rejection and transport-marker replacement.
The test cleans up its server, data and keys. OpenSSL is required; no trust store is changed.

An independent subagent found no remaining actionable issues and independently passed 92 focused
tests and the diff whitespace check. The initial sandboxed build could not fetch the existing
Google Fonts, and loopback connections were blocked; both checks passed with approved access.
Actual LAN/Tailscale routing and certificates on the user's remote device remain unverified.
The private `.env.local` and certificate were not changed, and the running application was not restarted.
