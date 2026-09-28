# Story 78 — Show notices as a stack of toasts in the canvas corner

**Status:** In progress · **Type:** Frontend-only · **Depends on:** nothing. Belongs to the
[workbench shell epic](EPIC-20260925-workbench-shell.md). It takes the notices from Story 74,
which keeps the status bar.

---

## Motivation

The user, on September 28, 2026:

> I want some really nice toast notifications inside the app. the current ones are not good.

Today every notice fills one slot: a 700px yellow banner, centred 90px from the top. Story 62 found
that it covers the side panel's close button. The slot has four problems:

- **Everything looks like a warning.** "Restored “Auth review”." and "Could not create the
  project." get the same amber wash, and nothing marks success, failure, or plain news apart.
- **One slot.** A new notice silently replaces the one being read, and a session's failed turn
  hides every other notice while that session is focused.
- **Nothing leaves on its own.** "Reconnected to 1 active turn." stays until someone clicks ×.
- **Buttons belong to the slot, not the message.** Undo archive, Cancel, and Refresh approval
  status appear beside whatever text holds the slot. Cancel for a busy provider sits behind the
  failed-turn message, so it never shows (see below).

The user chose toasts in the canvas corner over the epic's docked notice row (see *Design
decision*).

---

## Current behavior (where the code is)

- **Notice state:** [AppShell.tsx:150](../src/features/shell/AppShell.tsx#L150), one `notice`
  string. About fifty `setNotice(…)` calls write it: errors from `catch` blocks, reasons a send was
  refused, and successes such as archive, restore, and project deletion. Six `setNotice(undefined)`
  calls clear it when an action starts again: sessions loaded
  ([:508](../src/features/shell/AppShell.tsx#L508)), creating a session
  ([:602](../src/features/shell/AppShell.tsx#L602)), adding an agent or changing the main agent
  ([:957](../src/features/shell/AppShell.tsx#L957), [:988](../src/features/shell/AppShell.tsx#L988)),
  sending ([:1197](../src/features/shell/AppShell.tsx#L1197)), and opening a session from VR
  ([:1663](../src/features/shell/AppShell.tsx#L1663)).
- **Failed turns:** `runOutcomesBySession`
  ([AppShell.tsx:148](../src/features/shell/AppShell.tsx#L148)) holds one `SessionRunOutcome` per
  session ([runPresentation.ts:22](../src/features/conversation/runPresentation.ts#L22)). The focused
  session's outcome takes the slot first:
  `displayedNotice = focusedRunOutcome?.message || notice`
  ([AppShell.tsx:1378](../src/features/shell/AppShell.tsx#L1378)).
- **The banner:** [AppShell.tsx:2036](../src/features/shell/AppShell.tsx#L2036). Its buttons are
  Undo archive (while `archiveUndo` is set, for 10 s,
  [:410](../src/features/shell/AppShell.tsx#L410)), Cancel {session}
  (`!focusedRunOutcome && busyRun`), Refresh approval status (while any permission result is
  retryable), Continue in new session, Continue, and ×. A second banner explains sessions hidden
  because a newer CodeAI wrote them ([:2051](../src/features/shell/AppShell.tsx#L2051)). Its CSS is
  `.notice-banner` ([globals.css:658](../src/app/globals.css#L658)).
- **A hidden Cancel:** when a send is refused because the session or its provider session is busy,
  `busyRun` is set ([AppShell.tsx:1323](../src/features/shell/AppShell.tsx#L1323)). The refusal then
  becomes the session's run outcome ([:1350](../src/features/shell/AppShell.tsx#L1350)), and
  `!focusedRunOutcome && busyRun` hides Cancel. Before commit `8b6c353` (September 2, 2026) the
  refusal was a plain notice and Cancel showed beside it.
- **Other readers of `notice`:** the header's and the welcome screen's session forms show it as
  their failure text (`error={notice}`, [AppShell.tsx:1764](../src/features/shell/AppShell.tsx#L1764),
  [SessionPicker.tsx:78](../src/features/conversation/SessionPicker.tsx#L78)). VR's status line shows it
  (`immersiveStatus`, [AppShell.tsx:1730](../src/features/shell/AppShell.tsx#L1730)).
- **Permission outcomes:** `usePermissionDecisions` reports a finished decision as a message
  ([usePermissionDecisions.ts:23](../src/features/shell/usePermissionDecisions.ts#L23)), and
  AppShell prefixes the session title ([AppShell.tsx:178](../src/features/shell/AppShell.tsx#L178)).

---

## Design decision

The [design-system epic](EPIC-20260828-shell-design-system.md)'s invariant 4 says the canvas is
never occluded, and the workbench epic's invariant 5 planned a notice row for that reason. On
September 28, 2026 the user chose toasts in the canvas corner over a docked row and over toasts
above the conversation. Both invariants gain one exception: **small, transient toasts may float in
the canvas's top-right corner.** Fit-to-view keeps diagrams centred, so that corner is usually
empty sheet. The drawing toolbar sits top-left and the zoom bar bottom-right, so toasts cover
neither.

---

## Desired behavior

### What a toast looks like

A toast is a raised card, 360px wide at most, in the canvas's top-right corner. It sits 12px below
the canvas toolbar and 16px in from the conversation's edge, and stays clear of a docked
conversation. In Spatial it also stays clear of the room's control column. With the canvas hidden,
on the Arena, and on the welcome screen it keeps the same top and sits 16px from the window's right
edge. On a phone it never covers the activity bar. It rises above the canvas and the docked panels
but stays under the header's menus. At phone widths it also rises above the panel overlays, so a
refused send stays visible from the conversation.

- **Tone.** Each toast has one of four tones, shown by a glyph in a small tinted disc. Colour and
  shape both carry it, so no toast relies on colour alone:
  - **success**: a check on `live`;
  - **warning**: an exclamation mark on `wait`;
  - **error**: a cross on `stop`;
  - **info**: an `i`, achromatic, because the instrument stays grey unless something means
    something.

  Every colour comes from existing tokens.
- **Content.** The message is 12px ink text. A repeated message shows a mono `×2` count instead of
  a second card. Actions are small quiet buttons under the message. The × is labelled
  "Dismiss notification".
- **Stack.** The newest toast is on top. At most three raised toasts are kept, and a fourth drops
  the oldest one that can time out. Two standing toasts sit below the stack in a fixed order: the
  focused session's run outcome, then the newer-format explanation. So a stored toast never
  pushes them out.
- **Lifetime.** Info and success toasts leave after 6 s. Warnings, and any toast with an action,
  leave after 10 s. Errors and standing toasts stay until dismissed. The countdown pauses while the
  pointer is over the stack, while focus is inside it, and while the page is hidden. A repeated
  message restarts its toast's countdown.
- **Motion.** A toast answers something the user did, so it moves. It slides in from the right
  while its row opens, which pushes older toasts down smoothly. On leaving, the row closes. This is
  a one-off CSS transition, not an animation, so the ambient-motion rule still holds. Under
  `prefers-reduced-motion` the existing global rule makes it instant.
- **Accessibility.** The stack is a region labelled "Notifications". An error toast is
  `role="alert"` and any other is `role="status"`. Escape dismisses the focused toast. Choosing an
  action dismisses a raised toast. A standing toast follows its own state instead: Continue clears
  a run outcome only once it has sent.

### Where each notice goes

1. **Keys replace the single slot.** Each toast has a key. Raising a toast with a key already
   shown replaces that toast in place. Without a key, the key is the tone and message, so repeats
   merge. The six `setNotice(undefined)` calls become `supersede` of their own key:
   `sessions-load`, `session-create`, `participants`, `send`, and `open-session`. That removes the
   key's toast and never an unrelated one.
2. **Tones by kind.**
   - **error:** a `catch` block.
   - **warning:** a refused action, such as "Attach a repository…", a provider that is not
     available, a machine that is offline, the report cap, an expired approval, or a composite
     export that fell back.
   - **success:** a completed action (archive, restore, deleting a project, a cancellation
     request, a delivered permission decision).
   - **info:** news, such as reconnected turns, several diagram results, or sessions hidden by a
     newer format.
3. **Archive and restore share a key.** Archiving raises `archive:<id>`, a success toast with
   Undo archive. Restoring raises the same key, so the Undo toast becomes "Restored “…”." The
   `archiveUndo` state and its 10 s timer go.
4. **The run outcome is a standing toast.** It is derived from the focused session's
   `SessionRunOutcome`, so switching sessions still shows each session's own outcome. Its tone:
   - **info** when the user cancelled the turn;
   - **warning** when the turn reached its limit and offers Continue;
   - **error** otherwise.

   Dismissing it clears that session's outcome, as × does today.
5. **Cancel comes back.** A refused send records the run that refused it on its outcome as
   `blockingRun`. The standing toast then offers Cancel {session} for that run. The global
   `busyRun` state goes.
6. **Permission outcomes pick their tone.** The hook also reports whether the decision was
   delivered. A retryable failure is an error toast with Refresh approval status. This replaces
   the banner's rule of showing that button beside any notice while any result is retryable.
   Until the status is confirmed the permission card ignores Allow and Deny, so that toast stays
   until then. Refresh keeps it while the status is still unknown, and dismissing it refreshes and
   brings it back if the status is still unknown.
7. **Readers of `notice` read toasts.** The session forms read the `session-create` toast's
   message. VR cannot dismiss a toast, so its status line reads the newest toast raised since an
   action last started, the moment the old slot was cleared. An old error therefore never outlives
   the next send.

### Type contract

```ts
// src/features/shell/toasts.ts: pure, and unit tested
export type ToastTone = 'info' | 'success' | 'warning' | 'error';
export interface ToastAction { label: string; onSelect(): void; disabled?: boolean }
export interface ToastInput {
  tone: ToastTone;
  message: string;
  key?: string;           // defaults to `${tone}:${message}`
  actions?: ToastAction[];
  persistent?: boolean;   // stays until dismissed, whatever its tone
  onDismiss?(): void;     // runs when it leaves by × or countdown, not when replaced or an action is chosen
}
export interface Toast extends ToastInput { key: string; count: number; serial: number }
export function toastLifetime(toast: ToastInput): number | undefined;
export function withToast(toasts: readonly Toast[], input: ToastInput, serial: number): Toast[];
export function withoutToast(toasts: Toast[], key: string): Toast[];
export function standingToast(key: string, input: Omit<ToastInput, 'key' | 'persistent'>): Toast;
export function runOutcomeTone(outcome: SessionRunOutcome): ToastTone;

// src/features/shell/useToasts.ts
useToasts(): { toasts: Toast[]; latest?: Toast; notify(input: ToastInput): void;
  dismiss(key: string): void; supersede(key: string): void };

// src/features/conversation/runPresentation.ts: client-only, not a wire type
export interface SessionRunOutcome {
  // …existing fields
  cancelled?: boolean;          // the user stopped the turn; nothing failed
  blockingRun?: RunDescriptor;  // the run that refused this send, which the user may cancel
}

// src/features/shell/usePermissionDecisions.ts
onOutcome(target: PermissionTarget, result: PermissionResult, delivered: boolean): void;
refreshFailures(): Promise<string[]>;  // the decisions whose status still cannot be confirmed
```

---

## Acceptance criteria

- [x] `withToast` replaces a toast with the same key in place of stacking it. Repeating the same
  message counts up, and a new message under the key resets the count to 1.
- [x] Past three raised toasts, the oldest that can time out is dropped. The oldest persistent one
  goes only when every toast is persistent, and the toast being raised is never dropped.
- [x] `toastLifetime` gives 6 s for info and success, 10 s for warnings and toasts with actions,
  and none for errors and persistent toasts.
- [x] `runOutcomeTone` gives info for a cancelled turn, warning for a turn with Continue, and error
  otherwise. A stream `cancelled` error and an aborted request both mark the outcome `cancelled`.
- [x] The stack renders each tone with its glyph, the `role` for its tone, its actions, and a `×n`
  count. A toast leaves on its own after its lifetime, and not while the pointer rests on the stack.
- [x] Every `setNotice` call is gone, along with `notice`, `archiveUndo`, `busyRun`, and
  `.notice-banner`. Each former clear dismisses only its own key.
- [x] Undo archive turns into the restored toast, and restoring from the Arena removes Undo.
- [x] A send refused by a busy run shows Cancel {session} on the standing toast, and choosing it
  requests that run's cancellation.
- [x] Each session still shows its own run outcome, with Continue and Continue in new session, as
  before.
- [x] The session forms still show the creation failure's reason, and VR's status line still shows
  the newest notice.
- [x] No colour literal is added, both themes land together, and no new `animation:` name is
  added.
- [x] The epics record the exception to "the canvas is never occluded", and Story 74's row no
  longer owns notices.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- VR's own notices, such as report capture status in `ImmersiveWorkspace`, and VR's "Failed ·"
  status wording.
- A notification history or centre. Dismissed toasts are gone, as dismissed notices are today.
- Inline statuses that already sit where they belong: the Arena's refresh error, Docker version
  progress, and Build & restart status.
- Swipe to dismiss, and collapsing the stack into a deck.

## How to verify

1. `npm run lint && npm test`.
2. `CODEAI_REMOTE_ACCESS=local npm run test:e2e`.
3. In the running app at 1440×900, in both themes:
   1. Archive a session from More, then choose Undo archive. The toast becomes "Restored “…”."
      and leaves after 6 s.
   2. Send in a session without a repository. A warning toast appears in the canvas's top-right
      corner, clear of the conversation and the canvas toolbar.
   3. Send the same instruction again. The toast shows `×2`.
   4. Rest the pointer on the stack. It stays until the pointer leaves.
   5. Hide the canvas. The stack moves to the right edge above the conversation.

---

## What shipped

- **The model:** [toasts.ts](../src/features/shell/toasts.ts).
  - `withToast` ([:44](../src/features/shell/toasts.ts#L44)) keys, merges, counts, and caps the
    stack, and never drops the toast being raised.
  - `toastLifetime` ([:35](../src/features/shell/toasts.ts#L35)) sets 6 s, 10 s, or no timeout.
  - `standingToast` ([:57](../src/features/shell/toasts.ts#L57)) builds the derived toasts.
  - `runOutcomeTone` ([:66](../src/features/shell/toasts.ts#L66)) picks a run outcome's tone.
- **The hook:** [useToasts.ts](../src/features/shell/useToasts.ts) holds the raised toasts.
  `supersede` ([:18](../src/features/shell/useToasts.ts#L18)) replaces the old slot's clears, and
  `latest` ([:22](../src/features/shell/useToasts.ts#L22)) feeds VR's status line.
- **The stack:** [ToastStack.tsx](../src/features/shell/ToastStack.tsx#L21).
  - Hover comes from document pointer moves while toasts show
    ([:49](../src/features/shell/ToastStack.tsx#L49)).
    Focus and page visibility also pause every countdown.
  - Each raise is its own `ToastCard` ([:80](../src/features/shell/ToastStack.tsx#L80)). It owns
    its countdown and its leave, and is `inert` while leaving
    ([:107](../src/features/shell/ToastStack.tsx#L107)).
- **The shell:** [AppShell.tsx](../src/features/shell/AppShell.tsx).
  - `notify` and `notifyError` ([:153](../src/features/shell/AppShell.tsx#L153)) replace
    `setNotice`.
  - Permission outcomes pick their tone and refresh when dismissed
    ([:186](../src/features/shell/AppShell.tsx#L186)).
  - Archive and restore share a key ([:1443](../src/features/shell/AppShell.tsx#L1443)).
  - `cancelBlockingRun` ([:1494](../src/features/shell/AppShell.tsx#L1494)) is the refused send's
    Cancel.
  - The standing toasts and the placement are at
    [:1752](../src/features/shell/AppShell.tsx#L1752) and
    [:1779](../src/features/shell/AppShell.tsx#L1779).
- **The run outcome:** `cancelled` and `blockingRun` on `SessionRunOutcome`
  ([runPresentation.ts:28](../src/features/conversation/runPresentation.ts#L28)).
  `usePermissionDecisions` reports whether a decision was delivered
  ([:24](../src/features/shell/usePermissionDecisions.ts#L24)).
- **CSS:** [globals.css:658](../src/app/globals.css#L658).
  - Placement and z-index, with the phone overrides at
    [:855](../src/app/globals.css#L855) and [:872](../src/app/globals.css#L872).
  - The `@starting-style` entry and the grid-row collapse on leaving.
  - Tone glyphs on existing ink and wash tokens.
- **Tests:**
  - [test/toasts.test.ts](../test/toasts.test.ts): 11 cases covering the model and the markup.
  - A new Playwright scenario ([canvas.spec.ts:957](../e2e/canvas.spec.ts#L957)) on Playwright's
    clock. It covers placement, `×2`, hover pause, the 10 s and 6 s lifetimes, an error that stays,
    the busy run's Cancel, Undo becoming Restored, and the header menu above the stack on a phone.
  - The existing banner assertions moved to the stack in canvas, lifecycle, and reports.
    `startSession` no longer dismisses notices before Start session. Toasts sit under the header's
    menus, and the old workaround would click through the open menu.
  - Two more scenarios: Refresh approval status staying until the status is confirmed
    ([canvas.spec.ts:1056](../e2e/canvas.spec.ts#L1056)), and a toast staying on screen beside
    Spatial at 1440, 800, and 390px ([:1093](../e2e/canvas.spec.ts#L1093)).

## What shipped differently

- **An independent review found real defects, all fixed:**
  - A fourth toast raised over three errors was dropped at once.
  - VR's status line kept an old error.
  - Toasts covered the header's menus.
  - Dismissing a failed approval left its card ignoring Allow and Deny.
  - Toasts covered the Spatial controls.
  - A leaving toast could still be activated from the keyboard.
  - A late cancel could clear a newer refusal.
- **The mutation proof found one more.** A toast replaced under a resting pointer never sends
  `pointerleave`, so the whole stack stayed paused after the pointer left. Hover now comes from
  document pointer moves.
- **The z-index is layered, not one value.**
  - Docked, the stack is at 18: over the canvas and the panels (12, 15), under the tabs and the
    header (19, 20).
  - At phone widths the panels become overlays at 60. There the stack rises to 70 and the header
    to 75. Its box ends above the overlays, so only its menus gain.
- **The type contract changed:**
  - `ToastInput` gained `onDismiss`, which runs on × or timeout. Standing toasts use it in place
    of key parsing.
  - `withoutToast` takes only a key: a card that a new raise replaces unmounts, which cancels its
    removal.
- **A second review, after the change moved to `master`, found two more:**
  - Choosing Refresh approval status dismissed its toast before the refresh succeeded. If that
    refresh failed, the card stayed blocked with no refresh left. The toast is now persistent and
    follows the status. `refreshFailures` resolves to the decisions it still cannot confirm.
  - In Spatial on a phone, the toast kept its offset for the side column and started off screen.
    Its test showed the same at 800px, where a docked conversation plus the Spatial column pushed
    the toast to x = −178. The stack's right offset is now capped so its left edge always stays
    16px clear of the activity bar. Below 620px, where Spatial's controls sit under the canvas,
    the offset returns to the edge.
- **Known limit.** A `role="status"` toast is inserted together with its text. Some screen readers
  may not announce it. The old banner had the same limit; a persistent live region would fix it.

## Verification record

September 28, 2026, in the worktree on branch `worktree-toast-notifications`:

- **Type check:** `npm run lint` passes.
- **Unit tests:** `npm test` passes, 744 tests including the 11 in `test/toasts.test.ts`.
- **Unit mutation proof:** each unit mutation fails at least one test and was then restored.
  - The cap drops the oldest regardless of lifetime.
  - Actions do not extend the lifetime.
  - The count is not reset for a new message.
  - `persistent` is ignored.
  - A cancel is not marked on the outcome.
  - Errors are not announced as alerts.
  - The oldest toast is shown first.
  - The new-raise cap test failed against the code before its fix.
- **E2E mutation proof:** the new scenario fails against scratch builds (`.next-mut`, port 3025).
  - Hover no longer pausing is caught at the 12 s check.
  - Errors timing out is caught at the 60 s check.
  - The phone check failed against the build before the header fix; the error toast intercepted
    Start session.
  - The focus re-check survives mutation, because current Chrome fires `focusout` both when a
    focused node is removed and when it turns inert (probed directly). It is kept for browsers
    that do not.
- **E2E suite:** `CODEAI_REMOTE_ACCESS=local npm run test:e2e` passes, 96 of 96, on the final
  build.
  - One earlier full run failed a VR timing test ("delays tooltip appearance…", which measures
    real 100 ms and 500 ms waits). It passed in every other full run and five times in a row on
    its own, so it is a load-sensitive flake, not this change.
  - The stack attaches its pointer listener only while toasts show.
- **Screenshots** on a scratch production server, then discarded:
  - 1440×900 light and dark: three toasts in the canvas corner, clear of the drawing tools, the
    zoom bar, the conversation, and the fitted diagram.
  - Spatial: the stack left of the room's controls.
  - 390px: the stack over the conversation overlay and clear of the activity bar; the open
    new-session menu rises above it.
September 28, 2026, on `master` after the second review:

- **Before the fixes:** both new scenarios failed against the unfixed code.
  - Refresh approval status was gone after a refresh that could not read the status.
  - Beside Spatial, the toast's left edge was at −178px at 800px.
- **Mutation proof:** a build where dismissing no longer brings the toast back fails at the
  dismissal check.
- **After the fixes:** `npm run lint` passes, `npm test` passes 744 tests, and
  `CODEAI_REMOTE_ACCESS=local npx playwright test` passes 98 of 98.
- **Not verified:** the check in the running app on the user's own data (How to verify, step 3)
  is the user's.
