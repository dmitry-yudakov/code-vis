# Story — Introduce CodeAI through a local editorial landing

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** nothing

## Motivation

Give international visitors a concise, honest introduction to the visual workspace before they
read the repository. This previews the collaboration direction in [vision](../docs/vision.md),
without presenting the future semantic map as a shipped feature.

## Current behavior (where the code is)

- [tokens.ts](../src/shared/design/tokens.ts#L1) — application palette and font roles.
- [tokens.css](../src/app/tokens.css#L1) — generated application colors.
- [desktopTheme.ts](../src/features/shell/desktopTheme.ts#L1) — compact MUI app controls.
- No independent marketing site exists. New entry will be `site/index.html:1`.

## Desired behavior

A dependency-free static English landing in `site/`, independent of Next.js. Warm paper,
graphite, product-blue, editorial typography and an explicitly illustrative workflow sheet.
Use local sans stacks for direct headings, serif for editorial emphasis, mono for sheet notation;
no downloaded fonts. Existing blue links the marketing treatment to the app without copying its chrome.

## Acceptance criteria

- [x] Honest current/direction split, provider/auth, licensing, Linux and prerequisites disclosed.
- [x] Real repository/README CTAs, usable static content, no submissions or external load requests.
- [x] Accessible enhanced workflow; keyboard, touch, FAQ, anchors and responsive layout verified.
- [x] Two RED→GREEN slices logged, static/syntax checks and desktop/mobile Chromium checks pass.
- [x] Screenshots inspected and design self-audit documented; exact local instructions provided.
- [x] Independent read-only code review has no blocking findings.
- [x] Only `site/` and this story changed; temporary servers stopped; no deployment or push.

## Out of scope

Application/runtime/dependencies, root queue, license selection, hosting, agents/providers,
analytics, public binding, push/PR/merge and deployment. Illustration is not an app screenshot.
The owner separately authorized a local task-branch commit with an English message.

## How to verify

See `site/README.md` for isolated preview and tests. Evidence is stored outside tracked source in
`/home/trevor/.hermes/cache/scratch/codeai-landing-evidence/`. Root app suite/build are excluded
because the application is unchanged.

## Implementation and verification record

Implemented `site/index.html:1`, `site/style.css:1`, `site/workflow.js:1`, local SVG mark,
loopback-only preview server, self-contained package scripts, content/interaction tests and
portable Chromium matrix. No app integration or root dependency changes.

Content missing-file RED and GREEN are recorded in `01-content-red.log` and
`02-content-green.log`. Interaction missing-script RED and GREEN are in
`04-interaction-red.log` and `05-interaction-green.log`. Final 3 tests and syntax checks pass
in `06-final-checks.log`. Direct Node built-in test invocation avoids a restricted child runner.
The browser matrix was written before the interaction implementation, but could not reach
page assertions: loopback listen failed EPERM, and file-mode Chromium failed on a prohibited
crashpad socket. These failures are recorded, not counted as functional test evidence.

Parent verification subsequently passed in the normal host environment: both Chromium desktop/mobile viewports, keyboard/touch, FAQ, anchors, visible target sizes, no overflow/errors/remote load requests, reduced motion and JS-disabled content. Actual screenshots in `codeai-landing-parent-evidence/` were visually inspected. A hidden-mobile-anchor assertion was corrected in the harness. A malformed URL request was reproduced as a real preview-server crash; `test/preview.test.mjs` went RED, target parsing was fixed, and all 4 Node tests plus syntax now pass.

Visual anti-slop audit: 1/10 initially, 0/10 after removing a decorative quote rail (10 = maximum slop). See `site/README.md` for rationale and scope. The Next application and root dependencies remain unchanged.

Independent read-only review passed with no security/logic blockers. Its nonblocking pointer-test coverage suggestion was fixed; the parent reran 4 Node tests, syntax and desktop/mobile Chromium in HTTP and direct-file modes successfully. Page/server assets were verified byte-identical to the independently reviewed versions. Scoped local implementation is complete; “Shipped” here records story acceptance, **not deployment**. No server remains running; no deployment or push. The owner approved recording the work on the existing feature branch with an English commit message.
