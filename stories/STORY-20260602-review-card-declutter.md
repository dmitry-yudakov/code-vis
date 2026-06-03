# Story 1 — Declutter the Review-changes declaration cards (and show real change details)

**Type:** Frontend-only · **Depends on:** nothing to ship the declutter; the new detail
fields are produced by [Story 2](STORY-20260602-llm-review-annotation.md) but this story should
render them defensively (show only when present) so the two can land in either order.

---

## Motivation

In the **Review changes** lens (declaration level), every node card currently spends its
visual budget restating the diagram instead of telling you what the change *did*.

A typical card today shows:

```
getAnalyticsEvents (filters, db)
admin/agents/shared/db-queries.ts:95-143
[changed declaration: modified] [calls changed declaration (analyticsEventsLimit)]
```

Three problems:

1. **"modified" is the emptiest possible word.** It says *something* changed in this
   function but not *what* — which is the one thing a reviewer actually wants.
2. **The `calls changed declaration (X)` / `called by changed declaration (X)` chips are
   redundant** — there is already a labeled arrow in the graph saying exactly that. The
   card is repeating the edge, doubling the noise.
3. The chips describe *why the graph included this node* (layout bookkeeping), which is
   meta-information about the visualization, not information about the code.

Net effect: the card is busy but uninformative. The user's own words: *"I know what's
done in the code, but I don't see it in the diagram."*

This story makes the card report on **the change**, not on the graph.

---

## Current behavior (where the code is)

- Card component: `FocusedDeclarationView` in
  [web/src/components/IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx#L2385)
  (~line 2385). It renders title + `file:lines` + a `.focused-reasons` row that maps over
  `info.reasons` and renders **every** reason as a `.focused-reason-chip`.
- Reason → label string: `declarationReasonLabel(...)` in the same file (~line 373).
  Produces strings like `"changed declaration: modified"`,
  `"calls changed declaration (analyticsEventsLimit)"`, `"bridge between changes (...)"`.
- Data type: `FocusedDeclarationInfo` in
  [web/src/types.d.ts](../web/src/types.d.ts#L107) (~line 107). Reasons are
  `FocusedDeclarationReason` with `type` ∈
  `changed | calls-changed | called-by-changed | bridge-between-changes` and optional `via`.
- Styles: `.focused-declaration-view`, `.declaration-node-title`, `.declaration-node-file`,
  `.focused-reasons`, `.focused-reason-chip*` in
  [web/src/components/IncludesHierarchy.css](../web/src/components/IncludesHierarchy.css#L724)
  (~line 724).

---

## Desired behavior

A decluttered card that leads with meaning:

```
getAnalyticsEvents (filters, db)                 [modified]   ← status as a badge
db-queries.ts:95-143

added `limit` param, results now capped via analyticsEventsLimit   ← summary (Story 2)
root cause of this change                                          ← causalReason (Story 2, muted)

[bridge]   ← only non-obvious reasons remain as chips
```

### Concrete changes

1. **Filter the reason chips.** In `FocusedDeclarationView`, render chips only for reason
   types that are *not* already represented by a drawn edge. Drop `calls-changed` and
   `called-by-changed`. Keep `bridge-between-changes` (the bridge relationship is not
   otherwise obvious). The `changed` reason should no longer be a chip — see #2.

2. **Promote change status to a badge.** Use `info.changeStatus`
   (`added | modified | deleted | renamed`) as a small colored badge in the title row
   (right-aligned), reusing the color treatment that already exists for the bridge chip.
   `added` = green, `modified` = amber/neutral, `deleted` = red, `renamed` = blue. If
   `changeStatus` is undefined (unchanged context node), render no badge.

3. **Render the new detail fields when present** (produced by Story 2; optional on the type):
   - `info.summary` → a `.declaration-node-summary` line below the file path. This is the
     star of the card: one line describing *what changed and why it matters*.
   - `info.causalReason` → a smaller, muted `.declaration-node-cause` line. The node's role
     in the change story (e.g. "root cause", "downstream consumer").
   - Both are optional — when absent the card simply omits them and looks like the
     decluttered version above. **Do not** crash or reserve empty space when missing.

4. **Shorten the file path display.** `admin/agents/shared/db-queries.ts:95-143` is long and
   `word-break: break-all` makes it ugly. Show the basename prominently
   (`db-queries.ts:95-143`) with the directory either dropped or shown smaller/dimmer.
   Keep the full path in a `title=` tooltip for those who need it.

### Type contract (shared with Story 2)

Add these optional fields to `FocusedDeclarationInfo` in
[web/src/types.d.ts](../web/src/types.d.ts#L107) (mirror of the server type — Story 2
adds the server side):

```ts
export interface FocusedDeclarationInfo {
  // ...existing fields...
  summary?: string;        // what changed & why it matters (≤ ~120 chars)
  causalReason?: string;   // this node's role in the change story (≤ ~80 chars)
  narrativeRank?: number;  // 0 = root cause; consumed by Story 2's layout, not this story
}
```

`narrativeRank` is **not** rendered by this story — it only needs to exist on the type so
both stories compile against the same shape.

---

## Acceptance criteria

- [x] `calls-changed` and `called-by-changed` no longer appear as chips on any card.
- [x] Change status appears as a colored badge in the title row, color-coded by status,
      and is absent for unchanged context nodes.
- [x] `bridge-between-changes` still renders as a chip (shortened to a `bridge` label with
      the full relationship in the hover tooltip).
- [x] When `summary` / `causalReason` are present they render on their own lines; when
      absent the card shows neither and has no empty gap.
- [x] File path shows basename + line range, full path available on hover.
- [x] `web` typechecks and the component renders with mock data lacking the new fields.

## Bonus: file-level cards got the same treatment

The original story scoped the file-level **Files** view out, but on review it had the
identical clutter (a `changed: modified` chip, plus `imports changed file (…)` /
`imported by changed file (…)` chips that merely repeat a labeled import edge). Since the
fix is the same shape, the `FocusedFileView` card in
[web/src/components/IncludesHierarchy.tsx](../web/src/components/IncludesHierarchy.tsx)
was decluttered to match:

- `changed` → the same colored status badge (now a shared `.change-status-badge`).
- `imports-changed` / `imported-by-changed` chips dropped (redundant with the edge).
- `related-test` / `function-neighbor` chips kept (relationships the graph doesn't
  otherwise spell out — the file-level analogue of keeping `bridge`).
- Focused file nodes pinned to `width: 250` (matching the layout's assumed width) so the
  badge right-aligns instead of hugging the filename.

## Out of scope

- Producing `summary` / `causalReason` / `narrativeRank` (that's Story 2).
- Any change to the graph layout / node positions (that's Story 2).
- The overview lens card (`OverviewDeclarationView`) — left alone (not trivially shared).

## How to verify

Run the app, open **Review changes → Commit**, pick a commit that modifies a few
functions, switch to the **Declarations** toggle. Confirm cards are decluttered. Toggle
back to **Files** and confirm those cards are decluttered too (status badge, no import
chips). Then run with Story 2's flag on (if available) and confirm summary/cause lines
appear on the declaration cards.
