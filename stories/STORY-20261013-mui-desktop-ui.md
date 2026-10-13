# Story 106 — Use MUI for desktop controls and panels

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** [Story 73](STORY-20261003-title-bar-tabs.md), [Story 104](STORY-20261008-quiet-arena-settings.md), [Story 97 session setup](STORY-20261007-compose-new-session.md) (implemented desktop scope)

## Motivation

The user, on October 13, 2026:

> I'm not really happy with our custom style and I feel like the new things we develop by default
> have visual defects.

Shared colour tokens already keep the palette consistent, but each feature still defines its own
control sizes, typography, borders, and interaction styling. New controls introduce more choices
and more opportunities for defects. The desktop feature files contain 123 button declarations,
16 selects, and two dialogs; `globals.css` has 986 lines at the time of this assessment.

Adopt Material UI (MUI) as the default for ordinary desktop components, with a small shared theme
and visual regression checks. This supports [the Arena](../docs/vision.md#the-arena) and continues
the [workbench shell epic](EPIC-20260925-workbench-shell.md). Its placement, control-budget,
canvas-inset, and presentation-only invariants remain. Recognizable MUI styling is acceptable;
pixel-for-pixel recreation of the current custom controls is not a requirement.

## Current behavior (where the code is)

- [layout.tsx:47](../src/app/layout.tsx#L47) — the existing appearance key’s pre-paint stamp,
  streaming Emotion collection, and the provider above the shell’s device gate.
- [desktopTheme.ts:23](../src/features/shell/desktopTheme.ts#L23) and
  [DesktopThemeProvider.tsx:8](../src/features/shell/DesktopThemeProvider.tsx#L8) — compact MUI
  defaults and both token palettes; MUI has no separate preference storage or appearance stamp.
- [useTheme.ts:51](../src/features/shell/useTheme.ts#L51) — the one persisted appearance owner;
  desktop, portals, and Mermaid use its resolved light/dark/system choice.
- [DesktopPopover.tsx:13](../src/features/shell/DesktopPopover.tsx#L13) — nonmodal form/multiple-choice
  pickers, peer exclusivity, pointer dismissal, nested Escape, and bounded placement.
  [Disclosure.tsx:9](../src/features/shell/Disclosure.tsx#L9) covers repeated expandable sections.
- [MachineSettingsDialog.tsx:23](../src/features/arena/MachineSettingsDialog.tsx#L23) and
  [SessionSetupDialog.tsx:31](../src/features/session-launch/SessionSetupDialog.tsx#L31) — kept-mounted
  dialogs with protected backdrops, nested pickers, retained owners, and explicit focus recovery.
- [InstructionComposer.tsx:245](../src/features/conversation/InstructionComposer.tsx#L245) — the
  shared model picker; the composer at [:287](../src/features/conversation/InstructionComposer.tsx#L287)
  retains its actual textarea, sizing, paste/drop, and IME handling.
- [WorkspaceTabs.tsx:16](../src/features/conversation/WorkspaceTabs.tsx#L16) — MUI selection scrolling,
  wrapped arrows, close/reopen, and a resize-only reveal observer.
- [ToastStack.tsx:24](../src/features/shell/ToastStack.tsx#L24) — Alert presentation around the existing
  lifetime, pause, deduplication, and action owner; timer logic is unchanged.
- [globals.css:1](../src/app/globals.css#L1) — application geometry and specialized content, with
  superseded ordinary-control skins removed. [AGENTS.md:11](../AGENTS.md#L11) sets the component default.
- [mui-desktop.spec.ts:1](../e2e/mui-desktop.spec.ts#L1),
  [desktopTheme.test.ts:1](../test/desktopTheme.test.ts#L1), and
  [desktopControls.test.ts:1](../test/desktopControls.test.ts#L1) — integration, contrast, keyboard,
  focus, and visual checks alongside the existing workflow/geometry suites.

## Desired behavior

### One desktop component system

1. Install compatible stable releases of `@mui/material`, its standard Emotion dependencies, and
   `@mui/material-nextjs`; update `package.json` and the lockfile together during implementation.
   Record the selected versions. Follow the current
   [Next.js integration](https://mui.com/material-ui/integrations/nextjs/) for the repository's
   actual Next.js/React versions, including streaming style collection. Use ordinary component
   imports; no new CSS framework, alternative styling engine, or paid MUI X package is needed.
2. A client-owned MUI theme adapts the existing shared colour/font/effect tokens. Keep one
   light/dark/system preference owner, the existing storage key, and the pre-paint behavior.
   MUI, existing desktop surfaces, and Mermaid resolve the same appearance on initial load,
   reload, preference changes, and system changes. Do not create a second palette or theme store,
   import MUI into `src/shared`, or pass MUI components into the Three.js/VR renderer.
   Place the shared provider and preference owner above `DeviceAccessGate`, including the pairing/
   loading presentation before `AppShell` mounts; do not mount a separate preference owner there.
3. Define typography, density, shape, and component defaults centrally. Prefer MUI's existing
   components and variants, with compact desktop controls and restrained surfaces/shadows. Keep
   readable text, visible keyboard focus, and the semantic use of `wait` for approvals/Agent.
   Text contrast must meet the existing 4.5:1 requirement in both themes. The initial screenshot
   review records the chosen theme; avoid feature-specific overrides that recreate the old style.
4. Ordinary buttons, icon buttons, fields, checkboxes/switches, chips, alerts, menus/popovers,
   dialogs, tabs, and panel/list/card chrome use MUI after their stage migrates. A styled native
   select is an acceptable MUI control when its existing behavior is suitable. Menus containing
   forms or persistent multi-selection must retain appropriate semantics rather than being forced
   into single-action menu items. Reuse existing icons and behavior owners where practical.
   Add wrappers only for concrete repeated application patterns, not for every MUI component.
5. New ordinary desktop controls use MUI and the shared theme by default. Keep custom code for
   application geometry and specialized content: pane resizing, canvas/SVG/ink, diagram thumbnails,
   transcript Markdown, code/diff rendering, and hidden file inputs. When the integration lands,
   update `AGENTS.md`'s UI design principles with this component default, theme location, and
   specialized-content exceptions. Inventory remaining controls per stage; any ordinary control
   still awaiting migration prevents completion. Record only justified specialized-content
   exceptions in the final inventory, not unfinished controls relabelled as exceptions.

### Preserve behavior during replacement

- Keep routes, server contracts, persisted session formats, capability resolution, and workflow
  owners unchanged. Existing actions, loading/disabled states, retry paths, evidence preparation,
  permission decisions, and home-versus-executor routing retain their current meaning.
- Keep background Docker update discovery/progress and the gear's update badge alive with settings
  closed. Preserve the owner with `keepMounted` or its existing enclosing owner; mounting policy
  must not accidentally pause polling or reset an in-progress action.
- Closing/reopening setup preserves its draft, attachments, selected settings, preparation state,
  and background launch behavior. Hiding desktop setup on entry to immersive mode must not cancel
  or discard the shared launcher. Preserve initial message focus, IME-safe Enter/Shift+Enter,
  paste/drop evidence, and preview behavior. A MUI text-field ref must reach the actual textarea.
- Preserve modal Escape/explicit-close behavior and focus return to a connected, visible opener
  or the relevant stable shell control if that opener disappeared. Backdrop clicks must not newly
  dismiss the two existing modals. Nested popovers/previews close before their parent modal on
  Escape; portalled controls must remain usable inside the dialog's focus handling and stacking.
- Preserve tab Left/Right navigation, overflow visibility, Delete-to-close and neighbour focus,
  explicit close controls, stored layouts, pane widths/capacity, and canvas fit insets. Toast visuals
  may change; lifetimes, hover pause, deduplication, persistence, and actions keep their existing owner.
  Retain the All sessions picker's keyboard selection behavior; new tab shortcuts are not required.
- During coexistence, remove or scope superseded descendant selectors and global control rules so
  they cannot restyle MUI children. Check disabled opacity, inherited fonts, portal theme/stacking,
  and any reset introduced by `CssBaseline`. Keep custom layout and spatial/immersive DOM rules
  needed by the excluded surfaces. Remove dismiss hooks only after their final consumer migrates.

### Rollout

Each stage is independently reviewable and leaves a working application. All stages belong to
this story; the pilot alone does not ship the migration. Implementation proceeds through the
stages once their checks pass, without an additional deployment or restart requirement.

| Stage | Scope | Exit evidence |
|---|---|---|
| 1 — Theme and pilot | Next.js integration, shared theme, Machine settings and its child controls, New session setup and its child controls | Reviewed light/dark screenshots; closed-dialog updates, retained setup, nested controls, keyboard/focus, and narrow viewport checks |
| 2 — Conversation | Composer, mode/model/execution menus, attachment chips, participant controls, permission/checkpoint actions | Existing conversation/evidence/approval/recovery journeys still pass; minimum-width conversation screenshots |
| 3 — Arena and shell | Arena/Inbox/archive, project/session pickers, activity/header controls and tabs, device/settings/lifecycle controls | Session and machine routing, tabs, archive/Undo and stored-layout checks; unchanged frame geometry |
| 4 — Remaining desktop panels | Repository/history/reports/evidence/drawing-toolbar controls, canvas toolbar chrome, toast presentation; final CSS cleanup | Exception inventory complete, focused visual baselines and full regression checks pass |

Shared child controls migrate once, with checks for all their existing consumers in that stage.
In particular, setup's `ModelMenu` is also used by the composer; Stage 1 therefore includes both
consumers' model/effort and menu behavior checks even though the rest of the composer migrates
later. Do not create separate pilot and composer implementations.

The planning estimate is 2–3 engineer days for Stage 1 and 8–15 engineer days for the whole
controls/panels migration, including CSS cleanup and test updates. These are source-audit estimates,
not acceptance limits or promises; record actual complexity after the pilot. Changing the shell's
geometry or pursuing a broader visual redesign would need a separate scope decision.

### Visual acceptance

Use deterministic browser fixtures and reviewed screenshot baselines for representative surfaces,
not every possible state. Cover the pilot dialogs, composer/permission card, Arena, title bar,
side panel, and toasts in light and dark. Exercise 1440×900, 1000×800, and 360×800 where those
surfaces are available, plus the conversation and repository panels at their minimum widths.

Include open menus/selects, keyboard focus, loading/disabled/error states, long project/session/
model labels, and attachment previews. Essential controls stay visible and reachable; text may
wrap or deliberately truncate with an accessible full value. Controls must not overlap, crop
focus rings, overflow the viewport, or unexpectedly cover the canvas. Mask only nondeterministic
content such as timestamps, not the controls under review. Inspect initial baselines before
accepting them and inspect diffs when updating them; generating screenshots alone is not a pass.

Use behavior/geometry assertions for transient states that cannot support a stable baseline.
Existing geometry checks remain alongside screenshots. Update the affected workbench design notes
to describe deliberate appearance changes so their older handcrafted control styling is no longer
the visual oracle; their layout and placement requirements still apply.

## Acceptance criteria

- [x] Compatible MUI/Emotion/Next.js integration and one shared theme are in place; production
  initial load and all light/dark/system transitions keep desktop and Mermaid in sync without
  a wrong-theme flash or hydration errors, including pairing/loading before the shell mounts.
  Existing device preference storage still works.
- [x] Stage 1 passes its screenshot and workflow checks, including background updates while
  settings is closed and retained setup across closing, reopening, and immersive entry.
- [x] Stages 2–4 migrate the listed ordinary desktop controls; the specialized-content exception
  inventory is recorded, and `AGENTS.md` documents the library/theme default for new controls.
- [x] Dialog/menu keyboard behavior, nested portal focus/stacking, accessible names, contrast,
  and focus recovery pass, including long labels and narrow/minimum-width surfaces.
- [x] Session setup/evidence, modes/models, permissions/checkpoints, routing, archive, lifecycle,
  device controls, tabs/layout persistence, and toast behavior retain their existing contracts.
- [x] Superseded CSS/control dismissal code is removed where unused; remaining custom desktop
  and spatial/immersive surfaces retain geometry, theme behavior, and usable controls. No MUI
  dependency is introduced into shared wire modules or immersive renderer modules.
- [x] Reviewed screenshot baselines and their failure checks are saved; layout assertions remain,
  and affected design notes match. At the owner's October 13 commit request, generated PNGs remain
  local and Git-ignored; the fixtures and explicit comparison/generation workflow are committed.
- [x] Focused checks per stage, the full offline suite, TypeScript, isolated production build,
  final desktop browser suites, and independent implementation review pass. Record desktop bundle
  change and any unavailable spatial/VR checks separately; physical Quest acceptance is not a gate.

## Out of scope

- Implementing the workbench epic's remaining status bar, Arena placement, pane restructuring,
  command palette, or phone bottom bar. Those stories use the new component defaults when built.
- Changing server/provider/security policy, durable schemas, workflow ownership, or user actions.
- Replacing Mermaid, SVG/ink rendering, Markdown/code/diff content, pane resizing, or VR/uikit.
- Paid MUI X widgets, a component wrapper framework, exact preservation of the old visual style,
  changing appearance storage keys, deploying, or restarting the running installation.

## How to verify

1. Before replacement, run the relevant existing browser journeys and capture reference geometry
   and behavior. Use the project's offline providers and isolated test store/build; consult current
   Next.js/MUI documentation before selecting integration APIs. Record selected package versions.
2. Per stage, update DOM-dependent tests to assert the actual replacement control's accessible
   behavior. Retain native `selectOption` checks only for actual native selects. Closed portalled
   menus need interaction checks in the browser rather than static markup-only coverage. Prove
   new regression checks fail when their protected behavior is broken; do not weaken assertions
   merely to accommodate new markup. Review screenshots before moving to the next stage.
3. Exercise settings close/reopen during a Docker update and verify progress and the gear badge;
   use fixtures, not a real provider upgrade. Exercise setup close/reopen, preparation/retry,
   images/reports, background launch, and switching to immersive presentation. Check home-machine
   settings while an executor session is selected and the existing provider/isolation restrictions.
4. Run `npm run lint`, `npm test`, and `CODEAI_DIST_DIR=.next-e2e npm run build`. Run the desktop
   Playwright suites against that build with `CODEAI_DIST_DIR=.next-e2e` and a spare
   `CODEAI_E2E_PORT` so no existing server or managed release is reused. The focused suite grows
   with each stage: start with `machine-settings`, `session-setup`, `docker-versions`,
   `global-instructions`, `native-security`, `machines`, and `device-pairing`; include
   `test/modelMenu.test.ts`, `test/composerMenus.test.ts`, and the affected composer/session-picker
   browser cases when shared child controls migrate. Finish with all desktop suites.
   Include DOM-only cases inside mixed files such as `canvas.spec.ts`; do not omit a whole file
   merely because it also contains spatial/XR cases. Record the exact file/test selection and any
   omitted renderer-dependent cases, using case-level filtering or separation when needed.
5. Review the visual matrix, including system-theme changes, unavailable browser storage, first
   paint/reload, nested overlays, long labels, active approvals, minimum-width panels, and hidden
   canvas mode. Preserve automated spatial/immersive behavior checks where available and record
   concrete renderer/device limitations without claiming physical headset verification.
6. Record final package versions, the exception inventory, screenshot locations/review, desktop
   bundle delta from comparable builds, test evidence, and independent review findings here.
   Mark Shipped only when every acceptance checkbox is satisfied; a finished pilot stays In progress.

## Spec review — October 13, 2026

A read-only review subagent checked the scope, source anchors, lifecycle/theme/focus contracts,
visual acceptance, and verification plan, then rechecked the revised story. No critical/high issues
remain. Clarifications cover the provider above the device gate, both shared model-menu consumers,
existing tab shortcuts, DOM coverage in mixed browser suites, repository artifacts, future UI defaults,
and the requirement to finish all ordinary controls. Local links/source line bounds and whitespace
checks pass. The specification review preceded implementation; completion evidence follows below.

## Implementation evidence — October 13, 2026

All four stages are implemented. MUI/Emotion versions are `@mui/material` and
`@mui/material-nextjs` **9.5.0**, `@emotion/react` **11.14.0**, `@emotion/styled` **11.14.1**, and
`@emotion/cache` **11.14.0**, with Next.js **16.3.1** and React **19.2.8**. The
[official Next integration](https://mui.com/material-ui/integrations/nextjs/) and the installed
Next.js CSS-in-JS guide informed the `v16-appRouter` streaming cache. Both token palettes are
emitted under `data-appearance`; the existing `code-ai:theme` owner and `data-theme` behavior remain.
MUI storage and automatic scheme-node writes are disabled. Guarded/provider/server/storage owners
and wire formats did not change.

The shared defaults use compact outlined buttons, small fields/chips, neutral outlined surfaces,
32px tabs, visible keyboard focus, and semantic warning actions for permission decisions. Existing
hover tokens preserve filled-button contrast. Form/multiple-choice pickers use nonmodal Popper
surfaces to preserve direct switching and access to surrounding controls; ordinary action items
use Button/ListItemButton with their existing roles. The concrete repeated helpers are pickers,
expandable sections, removable evidence chips, and dialog focus recovery. No wrapper library or
additional state/store layer was added.

The pilot’s substantial work was lifecycle and interaction compatibility: parent dialogs must
retain their owners, nested poppers must join their focus boundary, and delayed setup must focus
its eventual textarea. Later stages added explicit peer keyboard exclusivity, retained worktree
retry identity, resize-only tab recovery, and scoped CSS cleanup. These requirements explain the
small helpers; routine feature controls remain direct MUI imports.

### Final exception inventory

- Hidden file inputs in InstructionComposer and SessionSetupDialog remain native; they are reached
  through visible MUI actions and feed the existing evidence-preparation owners.
- Pane resize separators, SVG/Mermaid/ink, diagram and image thumbnails, transcript Markdown,
  code/diff rendering, scene/world labels, and renderer placeholders retain specialized geometry.
- Three.js/uikit VR renderer controls and the hidden injectable-XR semantic adapter remain outside
  MUI. ImmersiveBoundary’s visible desktop Enter VR action uses MUI; MUI is never passed into the
  scene tree or imported into shared wire modules or VR renderer modules.
- Ordinary desktop spatial-room controls and list/panel chrome use MUI outside its Canvas tree.
  No ordinary desktop control remains awaiting migration. The unused `useMenuDismiss` hook is gone.

### Visual review and regression proof

The local `e2e/mui-desktop.spec.ts-snapshots/` directory contains **84 reviewed PNG baselines**,
produced by [e2e/mui-desktop.spec.ts](../e2e/mui-desktop.spec.ts): settings/setup, composer/mode picker/approval, title bar/More/Arena, repository/history,
canvas/drawing controls, and toast in both themes at 1440×900, 1000×800, and 360×800; plus narrow
saving/disabled controls, long model labels, and an actual image preview. The 1440 panel fixture
explicitly resizes repository/conversation to 268/320px. Only history timestamps are masked;
their text is normalized before masking because its width also positions the title.
The full initial matrix and changed captures were inspected; branch spacing, phone action wrapping,
portal description spacing, and an initially obscured phone repository capture were corrected.
The workbench epic, editable boards, and canvas notes now distinguish placement/geometry from
these implemented component baselines. Planned shell features remain planned.

The owner requested that the commit exclude snapshot images. Generated PNGs are therefore
Git-ignored and retained locally. Ordinary browser behavior/geometry assertions run by default;
`CODEAI_E2E_VISUAL=1` enables screenshot comparisons and the deliberate mismatch proof. A fresh
checkout first generates and reviews its local references with `--update-snapshots`, then compares
against them. [README](../README.md) gives the exact commands. This means a clone does not carry
the original reviewed pixels; local generation establishes a new reference set. The commit
verification temporarily moved all PNG references outside the repository: the MUI browser suite
passed **31 cases**, with only the intentional visual mismatch proof skipped, and created no
snapshot directory. TypeScript passed afterward. The documented generation command passed
31 cases, produced all 84 reference images, and skipped the mismatch proof to keep its deliberately
changed control out of the references. Explicit visual mode was rechecked against the retained
reviewed references, including the deliberate mismatch proof.

TDD evidence includes missing-theme and native-control red checks, a failing filled-button hover
contrast check, failed drawing/Alert checks before Stage 4, and real-browser red/green regressions
for keyboard picker exclusivity, pointer dismissal before mouse-up, retained worktree retry options
and identity, and moderate-width tab resizing. A review agent separately proved delayed-draft
focus fails with the old onEntered flag and passes with the fix. A browser check deliberately
changes a close button’s color and requires the saved screenshot comparison to reject it;
normal baseline runs also check hydration/page errors. Existing routing, archive/Undo, permission,
checkpoint, evidence/export, device, lifecycle, layout and minimum-width assertions remain.

### Independent review

Two review subagents checked behavior/ownership and scope/CSS/accessibility, then rechecked fixes.
They identified and helped verify delayed focus, picker-owned retry state, tab resize visibility,
keyboard picker exclusivity, toast pointer handling, permission hover contrast, and pointer-press
dismissal. Their final reviews report no remaining concrete findings. The parent completes the
full application/browser verification below; physical headset verification is separate.

### Final verification and bundle cost

- `npm test`: **134 files / 1,457 tests pass**, including the focused theme/control contracts and
  the existing offline workflows. `npm run lint` and
  `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- Production Chrome desktop verification: **141 tests pass**, with one worker and an isolated
  store/server on port 3124. The exact selection is `npx playwright test e2e --grep-invert
  'immersive.spec.ts|loads the bounded spatial room|enters and cleans up the immersive workspace'`
  under `CODEAI_E2E_PORT=3124 CODEAI_DIST_DIR=.next-e2e` (now also use `CODEAI_E2E_VISUAL=1`
  to include screenshot comparisons). This includes all DOM-only cases in the
  mixed canvas suite, all visual comparisons, and the deliberate screenshot mismatch proof.
- Chrome **155.0.8059.39** supports both WebGL and WebGL2 here. All **66 remaining spatial and
  injectable-XR cases are verified** using `npx playwright test e2e/canvas.spec.ts
  e2e/immersive.spec.ts --grep 'immersive.spec.ts|loads the bounded spatial room|enters and cleans up
  the immersive workspace'` with the same isolated build/server. The initial run passed 63;
  two initial-state races and a delayed sketch-seed save race in the test fixtures were corrected.
  All six affected navigation cases pass under `npx playwright test e2e/immersive.spec.ts --grep
  'enters once from|retains one XR store'`. The unchanged equality, loading/error/offline, XR store,
  draft, and cleanup assertions remain. No renderer-dependent case was omitted. Physical Quest 3S
  verification was not performed and is not this story's acceptance gate.

The comparable initial-desktop measurements are saved in
[e2e/mui-desktop-bundle.json](../e2e/mui-desktop-bundle.json). Both production builds use the same
Next.js/React versions; the baseline is commit `05cd440721fe9a0f34bfb41e79c8381bfb4f9a57`.
A fresh 1440×900 Chrome context opens an empty Claude session and waits for the composer and
network idle without activating a scene or diagram. The measurement sums the JavaScript responses
actually loaded, with each response gzip-compressed independently.

| Initial desktop JavaScript | Before | After | Change |
|---|---:|---:|---:|
| Uncompressed | 1,212,487 B | 1,544,168 B | +331,681 B |
| Gzipped | 343,043 B | 449,938 B | +106,895 B (104.4 KiB / 31.2%) |
| Loaded chunks | 10 | 14 | +4 |

The artifact also records all emitted chunks separately; those include lazy spatial/VR assets and
are not the initial desktop transfer. The added desktop size is the migration's measured cost.
No provider upgrade, deployment, managed release swap, or running-application restart was performed.
