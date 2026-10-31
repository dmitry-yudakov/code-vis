# CodeAI local landing preview

Independent static HTML/CSS/JS. No root dependencies, app routes, provider calls, submissions,
storage or analytics. All assets are local. GitHub links navigate only when activated.
The workflow sheet and study are editorial illustrations, **not real app screenshots or sessions**.

## Preview

Requires Node.js 20.9+; no installation or build step:

```sh
cd site
npm run preview
# Open http://127.0.0.1:4173
# Ctrl+C stops the server.
```

The allowlisted preview server binds only to 127.0.0.1 and serves only the four page assets.
You can also open `index.html` directly. The site works without JavaScript; JavaScript adds
stage selection using native buttons (Tab, Enter/Space). FAQ uses native details/summary.

## Checks

From `site/`:

```sh
npm test
npm run check
npm run test:browser
```

Static/interaction tests use Node’s built-in test runner, invoked directly to avoid this
sandbox's child-runner restriction. The interaction test uses a minimal DOM contract, so it
is **not** a substitute for browser verification.

Browser checks require an existing `@playwright/test` installation and Chromium. No root
installation is necessary. If they are outside normal module resolution:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/@playwright/test \
CHROMIUM_PATH=/absolute/path/to/chromium \
EVIDENCE_DIR=/absolute/path/to/evidence \
npm run test:browser
```

`PLAYWRIGHT_MODULE` is a module directory or entry file. Without it the script resolves local
`@playwright/test`. Without `CHROMIUM_PATH` it uses Playwright's installed Chromium. Evidence
defaults to `codeai-landing-evidence` inside the operating-system temporary directory (respecting `TMPDIR`). The runner starts an ephemeral loopback server and
closes it in `finally`. `PREVIEW_MODE=file` is an optional direct-file fallback; it still needs
permission to launch Chromium. Only Chromium at 1440×1000 and 390×844 is in scope.

Checks cover stage changes with keyboard and click/touch-capable context, focus, FAQ, anchor
navigation, source link destinations, 44px target heights, overflow, reduced-motion preference,
JS-disabled content/FAQ, errors and non-local page requests. It does not follow GitHub links.

## Verification on 2026-10-17

Evidence directory: `/home/trevor/.hermes/cache/scratch/codeai-landing-evidence/`.

- Content RED: missing `index.html` (01); GREEN: honest copy and real source CTA (02).
- Interaction RED: missing `workflow.js` (04); GREEN: activation updates visibility and
  pressed state, responsive/focus/reduced-motion rules exist (05).
- Final static tests and JS syntax checks: see `06-final-checks.log`.
- Browser attempt blocked before page checks: loopback listen returns EPERM (03-browser-red).
  File-mode fallback also blocked: Chromium crashpad socket returns operation not permitted
  (03-browser-red-file). These are infrastructure failures, not a functional RED test.
- Parent reran outside the restricted CLI sandbox: **Chromium desktop 1440×1000 and mobile 390×844 passed**, including native keyboard and touch, FAQ, anchors, visible 44×44 targets, reduced motion, no overflow, no JS/HTTP errors or non-local load requests, and JS-disabled content/FAQ.
- Actual renders: `codeai-landing-parent-evidence/desktop.png`, `mobile.png`, and labeled `preview-board.png` in the same scratch directory. Parent visually inspected desktop/full mobile and the first-fold comparison.
- Parent caught a browser-harness error that measured an intentionally hidden mobile nav link; now it measures visible controls in both dimensions.
- A real malformed request crashed the local preview server. Added `test/preview.test.mjs`, observed RED (`07-preview-red.log`), then fixed target parsing; all **4 Node tests** and syntax checks pass. The listener remains loopback-only and rejects non-allowlisted paths.
- Independent read-only review passed with no blocking security or logic findings. Its nonblocking pointer-test suggestion was addressed: a click/tap now must switch from Review to Discuss and update visibility/pressed state.
- Post-review verification: all 4 Node tests, syntax, and both desktop/mobile Chromium configurations passed in HTTP preview **and direct file mode** (`10-post-review-green.log`). Production page/server assets are byte-identical to those reviewed. No deployment or push was performed; a local task-branch commit is authorized separately by the owner.
- No temporary server remains. Root app suite/build not run because application unchanged.

## Design rationale and self-audit

Reviewed `src/shared/design/tokens.ts`, `src/app/tokens.css`, and `desktopTheme.ts` before design.
Product blue (#2f5ad0) connects the page to the app. Warm paper and graphite distinguish an
editorial introduction from app chrome; a single deep-green section gives optional VR weight.
Local Helvetica/Arial handles direct statements, Georgia gives questions a human editorial voice,
and local mono identifies schematic notation. This avoids font downloads intentionally.

Parent visual anti-slop audit: **1/10 initially** (a decorative quote accent rail), then **0/10 after removing that rail**, where 10 is maximum slop. The seven-surface rubric is Decide/Learn: asymmetric hero, intentionally chosen local typography, one narrative per section, and an explicitly illustrative schematic. No generic feature grid, fake statistics, purple gloss, stock photos or invented endorsements. Desktop and mobile actual renders were visually inspected; no clipping/overlap was seen at the checked viewports. This is a design judgment, not a usability-study result.

Licensing remains undecided. This preview adds no license and makes no production-readiness
claim. It does not change the application runtime or configure hosting.
