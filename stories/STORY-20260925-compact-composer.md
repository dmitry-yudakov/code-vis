# Story 71 — Fold the composer's modes into one picker, and add an attach menu

**Status:** In progress · **Type:** Frontend-only · **Depends on:** nothing. First story of the
[workbench shell epic](EPIC-20260925-workbench-shell.md).

---

## Motivation

The user, on September 25, 2026, with VS Code's chat panel as the reference:

> I think we could improve the chat - ask/plan/agent takes too much space. attach option would also
> be nice to have.

VS Code's composer keeps its action row short: `+` to attach, one mode picker ("Agent ⌄"), model,
and send. A quiet line under the input says where the turn runs and with what permissions ("Local ·
Default permissions"). CodeAI's composer spends that row differently:

- **Modes:** three always-visible mode buttons.
- **Hint:** a 9px hint in `--faint`, below the 4.5:1 contrast minimum.
- **Attaching:** there is no way to attach from the composer. A diagram is attached from History's
  "Attach next", and a report from the Reports tab. Both live in the side panel, which is closed by
  default since Story 62.
- **Execution:** the conversation header spends up to three lines on the execution badge,
  "Continue in Docker", and the reason it is unavailable.

The design is the composer in [docs/design/workbench-shell/](../docs/design/workbench-shell/): the
`Main`, `ArenaDark` (mode menu), `ChatWide` (attach menu), and `Narrow1000` (execution menu) boards.

---

## Current behavior (where the code is)

- **Mode radios:** [InstructionComposer.tsx:152](../src/features/conversation/InstructionComposer.tsx#L152).
  Three `role="radio"` buttons, disabled while a turn runs or when unsupported. Their titles carry
  the long explanations, including the Docker variants ([:163](../src/features/conversation/InstructionComposer.tsx#L163)).
- **Model and effort menu:** [InstructionComposer.tsx:16](../src/features/conversation/InstructionComposer.tsx#L16).
  A `<details>` with `useMenuDismiss` and radiogroups inside. This is the pattern to reuse.
- **Hint, Send, and Cancel:** the hint is at [InstructionComposer.tsx:176](../src/features/conversation/InstructionComposer.tsx#L176);
  Send turns into Cancel at [:179](../src/features/conversation/InstructionComposer.tsx#L179). The
  hint text is `AGENT_MODE_HINTS` in [toolActivity.ts:64](../src/features/agents/toolActivity.ts#L64),
  and the tooltips are `AGENT_MODE_TOOLTIPS` at [:71](../src/features/agents/toolActivity.ts#L71).
- **Attachment chips:** [InstructionComposer.tsx:110](../src/features/conversation/InstructionComposer.tsx#L110).
  Canvases come from `pendingAttachmentIds`, toggled by `toggleAttachment`
  ([AppShell.tsx:803](../src/features/shell/AppShell.tsx#L803)) from History's "Attach next"
  ([DiagramNavigator.tsx:76](../src/features/diagram/components/DiagramNavigator.tsx#L76)).
  Reports come from `pendingReportIds` ([AppShell.tsx:218](../src/features/shell/AppShell.tsx#L218)),
  up to `MAX_REPORTS_PER_MESSAGE` = 4 ([limits.ts:17](../src/shared/limits.ts#L17)), only where
  `reports.isSelfProject`.
- **Thumbnails:** [CanvasThumbnail.tsx:28](../src/features/diagram/components/CanvasThumbnail.tsx#L28)
  (Story 62, Part D: one render at a time, only in view, cached per artifact and theme).
- **New sketch and History entry points:** `createSketch` and `panelLayout.toggleHistory`, passed to
  the canvas at [AppShell.tsx:2130](../src/features/shell/AppShell.tsx#L2130).
- **Conversation header:** [ConversationDrawer.tsx:72](../src/features/conversation/ConversationDrawer.tsx#L72).
  It holds the provider badge, the execution badge, the Continue in Docker/Local button, and the
  reason line. The rules are `continuationUnavailable` ([AppShell.tsx:312](../src/features/shell/AppShell.tsx#L312))
  and `continueSession` ([:663](../src/features/shell/AppShell.tsx#L663)).
- **Remembered mode per device (Story 70):** [devicePreferences.ts:14](../src/features/shell/devicePreferences.ts#L14).
- **Styles:** `.composer-hint`, `.mode-selector`, and Agent's `wait` fill at
  [globals.css:333](../src/app/globals.css#L333)–[338](../src/app/globals.css#L338).
- **Tests that touch the composer:**
  - mode radios clicked by role in [canvas.spec.ts:623](../e2e/canvas.spec.ts#L623), :632, :733, :938, and :1139
  - Continue in Docker in [docker-execution.spec.ts:214](../e2e/docker-execution.spec.ts#L214), :219, and :279
  - the flat composer's Ask radio in [immersive.spec.ts:444](../e2e/immersive.spec.ts#L444)
  - the row order in [modelMenu.test.ts:59](../test/modelMenu.test.ts#L59)

  The Arena's new-session form has its own mode radios ([canvas.spec.ts:790](../e2e/canvas.spec.ts#L790)); they stay.

---

## Desired behavior

### Part A — One mode picker

1. The three mode buttons become one picker that shows the current mode ("Plan ⌄"). It uses the
   `<details>` and `useMenuDismiss` pattern of the model menu, with a radiogroup inside. The radios
   keep their accessible names, Ask, Plan, and Agent.
2. Agent keeps its encoding: the picker fills with `wait`, as the active Agent button does today.
3. Each choice shows its hint under its name. Local sessions use `AGENT_MODE_HINTS`. Docker
   sessions use "Docker · repository read-only" for Ask and Plan, and "Docker · autonomous direct
   edits" for Agent. The long `AGENT_MODE_TOOLTIPS` and Docker texts stay as the choice's title.
4. An unsupported mode is a disabled choice whose hint is today's reason ("… is unavailable for this
   provider and execution. Check provider setup.").
5. The picker is disabled while a turn runs, as the radios are today. A choice writes the same device
   preference that Story 70 remembers.
6. The picker's accessible name carries the mode and its hint, for example "Mode: Plan. Read-only ·
   ends in a plan".

### Part B — A `+` attach menu

1. A `+` button starts the composer's action row and opens a menu titled "This session". It lists
   the active diagram and up to three recent diagrams and sketches, each with its `CanvasThumbnail`
   and its ordinal and kind ("Diagram 8 · flowchart · 1h").
2. Choosing an entry toggles the same pending attachment as History's "Attach next", so the chip
   appears or disappears. An entry that is already attached shows a check, and the active diagram
   reads "Included" when it is.
3. "All history…" opens the History view in the side panel.
4. "New sketch" calls `createSketch`.
5. "Headset report…" appears only where `reports.isSelfProject` holds, and opens the Reports view.
   The four-report limit is unchanged, because the Reports view enforces it.
6. The menu follows Story 62's thumbnail rules: one render at a time, and only for the entries it
   shows.
7. `+` is disabled while a turn runs, as the instruction field is.

### Part C — An execution line under the composer

1. A line under the composer shows the execution (a Local or Docker icon and label) as a menu
   button, followed by the current mode's hint. The hint drops its "Docker ·" prefix when the line
   already says Docker.
2. The execution menu holds "Continue in Docker…" or "Continue in Local…", which calls
   `continueSession`. When `continuationUnavailable` has a reason, the item is disabled and shows
   that reason under its name.
3. The conversation header loses the execution badge, the Continue button, and the reason line. The
   provider badge stays until the title-bar story.
4. The `composer-hint` span is removed; its text now lives in the line. The line uses `--ink-2` at
   11px or larger.

### Component contract

The composer gains attachment and continuation props. No wire type changes. As shipped, the checks
come from today's `attached` list, so no `pendingAttachmentIds` prop is needed, and the composer
names the continuation itself.

```ts
// InstructionComposer, in addition to today's props
theme: ThemeName;                           // for the menu's thumbnails
recentCanvases: RecentCanvas[];             // active canvas first, then up to three newest
onToggleAttachment(id: string): void;       // the same handler History uses
onOpenHistory(): void;
onNewSketch(): void;
onOpenReports?(): void;                     // present only in CodeAI's own project
continuation: { unavailable?: string; busy?: boolean; onContinue(): void };
```

---

## Acceptance criteria

### Part A
- [x] The composer shows one mode picker instead of three buttons. Its menu offers Ask, Plan, and
      Agent, each with its hint, and uses the Docker hints in a Docker session.
- [x] Agent fills the picker with `wait` in both themes.
- [x] An unsupported mode is a disabled choice that says why.
- [x] The picker is disabled while a turn runs, and a chosen mode survives a reload as in Story 70.
- [x] The picker opens, moves, chooses, and closes from the keyboard, and Escape returns focus to
      it.

### Part B
- [x] `+` lists the active diagram and up to three recent canvases with thumbnails. Choosing one
      adds or removes the same chip that History's "Attach next" does.
- [x] "All history…" opens History; "New sketch" starts a sketch.
- [x] "Headset report…" appears only in CodeAI's own project and opens Reports.
- [x] Opening the menu never runs more than one Mermaid render at a time.

### Part C
- [x] The line under the composer shows Local or Docker and the mode's hint, without a repeated
      "Docker".
- [x] Its menu offers Continue in Docker or Local, disabled with the existing reason when
      unavailable. Continuing still opens a new session with an editable recap.
- [x] The conversation header no longer shows the execution badge, the Continue button, or the
      reason line.

### All parts
- [x] At 1440×900 the default layout shows at most 42 visible controls (43 after Story 62). The
      footer drops from five controls to four; the execution button replaces Continue.
- [x] Every new control's text meets 4.5:1 in both themes.
- [x] The e2e mode steps, the Continue in Docker steps, `immersive.spec.ts`'s composer assertion, and
      `modelMenu.test.ts` use the new controls, and each was shown to fail against the old
      composer.
- [x] The Arena's new-session mode control is unchanged.
- [x] `docs/design/workbench-shell/` matches what shipped, or is updated in the same change.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass after each part.

## Out of scope

- The activity bar, the layout icons, and hiding the canvas (Story 72).
- Moving the provider badge and the session title (Story 73), and the status bar (Story 74).
- Attaching a file or image from the device, or mentioning a repository file: both need server
  routes (see the epic's *Needs the server*).
- Queueing an instruction while a turn runs: the scheduler rejects a second turn in a session.
- The Arena's new-session form and the immersive workspace's composer controls.
- The model and effort menu itself (Story 66).

## How to verify

1. `npm run lint && npm test && npm run test:e2e`.
2. `npm run dev` and open a session at 1440×900. The composer row reads `+`, "Plan ⌄", the model,
   and Send. The line under it reads "Local · Read-only · ends in a plan".
3. Choose Agent: the picker fills amber and the line reads "Edits files · asks first". Reload, and
   Agent is still chosen.
4. Open `+` and choose Diagram 8: its chip appears. Open `+` again: Diagram 8 is checked. Choose it
   to remove it.
5. Start a turn: `+`, the picker, and the model menu are disabled, and Send becomes Cancel.
6. In a Docker session, the line reads "Docker · autonomous direct edits" in Agent mode, and its
   menu offers "Continue in Local…". With Docker disabled in the Arena, a Local session's menu shows
   "Continue in Docker…" disabled, with "Enable Docker in Arena to continue there."
7. Switch to the dark theme and repeat steps 2 and 3.

## What shipped

- **One menu pattern.** `ComposerMenu` wraps each popover in a `<details>` with `useMenuDismiss`,
  closes it while disabled, and returns focus to its summary after a choice
  ([InstructionComposer.tsx:50](../src/features/conversation/InstructionComposer.tsx#L50)). The arrow
  keys move between enabled items and enter from the summary at either end
  ([:34](../src/features/conversation/InstructionComposer.tsx#L34)). All four composer popovers,
  the model menu included, share `name="composer-menu"`, so opening one closes the others. `MenuItem`
  ([:81](../src/features/conversation/InstructionComposer.tsx#L81)) names a choice with `aria-label`
  and describes it with its detail line and, when longer, its title.
- **Part A.** `ModePicker` ([:107](../src/features/conversation/InstructionComposer.tsx#L107)) is a
  radiogroup named "Agent mode" behind a summary named, for example, "Mode: Plan. Read-only · ends in
  a plan". The hints and tooltips are `agentModeHint`, `executionModeHint`, and `agentModeTooltip`
  in [toolActivity.ts:90](../src/features/agents/toolActivity.ts#L90). Agent fills the summary with
  `wait`, including on hover and while open ([globals.css:360](../src/app/globals.css#L360)).
- **Part B.** `AttachMenu` ([:138](../src/features/conversation/InstructionComposer.tsx#L138)) lists
  `recentCanvases(session, now)`: the active canvas, then the three newest others, each titled,
  typed by `mermaidKind`, and timed by the Arena's `relativeActivityTime`
  ([recentCanvases.ts:29](../src/features/conversation/recentCanvases.ts#L29)). The Mermaid header
  scan is shared with the policy as `firstMermaidStatement`
  ([mermaidPolicy.ts:87](../src/features/diagram/mermaid/mermaidPolicy.ts#L87)). Thumbnails are
  Story 62's `CanvasThumbnail`, which renders only once the open menu shows it. "All history…" and
  "Headset report…" open their side views through `openSideFromComposer`, which also closes the
  conversation where the side panel is a phone overlay
  ([AppShell.tsx:804](../src/features/shell/AppShell.tsx#L804)). The drawer memoizes the list per
  session ([ConversationDrawer.tsx:71](../src/features/conversation/ConversationDrawer.tsx#L71)).
- **Part C.** `ExecutionLine` ([:197](../src/features/conversation/InstructionComposer.tsx#L197))
  shows the execution menu, then the mode's hint, or "Creating a Docker session…" while a
  continuation is created. The header keeps the title and the provider badge.

## What shipped differently

- Relative times read "1h ago", reusing the Arena's formatter; the design copy now says so. The
  design copy's mode menu is now a radiogroup anchored at the composer's left edge, and its canvas
  entries are `menuitemcheckbox`, as shipped.
- The model menu keeps Story 66's style (10px, filled). The design's borderless model button
  belongs to the flat-panes story (76).
- Each summary carries its name as a `title`, so the icon-only `+` has a tooltip.
- Known and left alone: with a 260px draft on a viewport about 650px tall, the attach menu can be
  clipped by the drawer, as the model menu already can.

## Verification record

September 25, 2026, offline, against the fake Claude.

- `npm run lint` passes; `npm test` passes 90 files / 714 tests, including
  [composerMenus.test.ts](../test/composerMenus.test.ts),
  [recentCanvases.test.ts](../test/recentCanvases.test.ts), and the new contrast pairs in
  [designTokens.test.ts:66](../test/designTokens.test.ts#L66) (ink, ink-2, and muted on raised,
  sunk, and control-wash backgrounds, in both themes).
- `npm run test:e2e` passes 93 of 93. New:
  `attaches from the composer, picks a mode from the keyboard, and names the execution under it`
  ([canvas.spec.ts:1464](../e2e/canvas.spec.ts#L1464)); "Headset report…" in
  [reports.spec.ts](../e2e/reports.spec.ts#L63); the phone row now counts four controls and checks
  each new menu stays on screen ([canvas.spec.ts:1304](../e2e/canvas.spec.ts#L1304)).
- Shown to fail against the old composer, with only the source changes stashed: the 12 composer
  menu tests written by then and `modelMenu.test.ts`'s row order, and every changed e2e test (12 in canvas, docker,
  reports, and immersive specs, plus Docker's project-creation test).
- Mutation proofs, each restored: 17 unit mutations (active-first order, the limit, pinned, `graph`,
  `Diagram` suffix, sketch marks, disabled while running, unsupported reason, the execution hint,
  report availability, "Included", busy, the Docker tooltip, the `ink-2` token, and others) and six
  e2e mutations (ArrowUp wrap, focus return, the phone overlay close, the Agent hover fill, the
  in-view gate on thumbnails, and the shared `name`) all fail their tests.
- Visible controls at 1440×900 in the default layout, counted with the same script on a production
  build with the e2e fixtures and a diagram on the canvas: 46 before, 45 after. The removed control
  is the same on any data (five footer controls become four; the execution button replaces
  Continue), so Story 62's 43 becomes 42.
- Screenshots of the composer, each menu, and Agent mode in both themes matched the design boards.
- A review subagent found the phone overlay, Agent hover, hidden "Creating…", menu ARIA structure,
  lost mode tooltips for assistive technology, and overlapping popovers; all are fixed and covered.
- Pending before **Shipped**: **How to verify** steps 2–7 in the running app on real data, which
  also confirms the 42 there.
