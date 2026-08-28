# Story 32 — Restyle the shell: sheet and instrument

**Status:** Draft · **Type:** Frontend-only ·
**Depends on:** [Story 31](STORY-20260828-dock-canvas-panels.md) (docked panels) ·
**Epic:** [shell design system](EPIC-20260828-shell-design-system.md)

---

## Motivation

> I see something like Vercel, Miro or Notion style a more appropriate and **modern**. I want also
> nice and readable fonts and light enough style.

The current surface is a warm cream ground with a terracotta accent and a Georgia display face.
It is coherent, but it reads as a document rather than an instrument, and the warm ground competes
with the diagram it is supposed to frame.

The type is also not what it claims to be: `--sans` names **Figtree** at
[globals.css](../src/app/globals.css#L17) (~line 17), but no font is ever loaded — no
`next/font`, no stylesheet link, no `@font-face`. Every screen so far has been rendering a
fallback. Roughly half the text in the app is data rather than prose — paths, diffs, tool names,
counts, zoom percentages — and it is currently set in whatever monospace the OS supplies.

Stories 29 through 31 did the structural work. This is the one that changes how it looks, and by
now it is a values change rather than a rewrite.

---

## Design direction

**Sheet and instrument.** The canvas is a sheet — the lightest surface in either theme, and the
only place the eye should rest. Everything else is the instrument around it: a recessed,
strictly achromatic chrome that never competes. Every hue in the application therefore carries
meaning — run state, mode escalation, git status, diagram ink — and the most colorful thing on
screen is always the user's own diagram.

The reference mock — the target shell in both themes, with a working theme switch — is checked in
at [docs/design/sheet-and-instrument.html](../docs/design/sheet-and-instrument.html). Open it
directly in a browser; it is self-contained apart from the Google Fonts link. It is the
verification oracle for this story, so it lives in the repository rather than behind a URL that a
reviewer may not be able to reach.

---

## Current behavior (where the code is)

- Font stacks name an unloaded family:
  [globals.css](../src/app/globals.css#L16) (~lines 16–18) — `--sans: Figtree, Inter, …`,
  `--display: Georgia, "Times New Roman", serif`.
- No font loading anywhere: [layout.tsx](../src/app/layout.tsx#L1) imports only `globals.css`.
- The header is 64px with four stacked pickers, each carrying its own uppercase mono eyebrow:
  [globals.css](../src/app/globals.css#L31) (~lines 31–47),
  [AppShell.tsx](../src/features/shell/AppShell.tsx#L858) (~lines 858–895).
- Mode escalation is styled but not encoded — Ask, Plan, and Agent get three unrelated background
  colors at [globals.css](../src/app/globals.css#L116) (~lines 116–123).
- Run state is a pulsing dot in three separate places: the health pill
  ([globals.css](../src/app/globals.css#L73), ~line 73), the inline status
  ([globals.css](../src/app/globals.css#L99), ~line 99), and the tool timeline
  ([globals.css](../src/app/globals.css#L217), ~line 217).
- Mermaid still names Figtree in its own `themeVariables`
  ([mermaidRenderer.ts](../src/features/diagram/mermaid/mermaidRenderer.ts#L24), ~line 24), now
  reading tokens after Story 30 but with the font stack still literal.

---

## Desired behavior

### Typography

Three faces, three jobs, loaded through `next/font/google` — which self-hosts at build time, so a
local-first application does not need a CDN to render its own type.

| Role | Face | Used for |
|------|------|----------|
| Interface | **Geist** | All prose and controls, 12–15px |
| Data | **Geist Mono** | Paths, diffs, tool names, counts, zoom, branch names |
| Display | **Archivo**, expanded, 700 | The wordmark, and display headlines ≥ 28px |

Archivo has exactly two uses, and they do not overlap. The **wordmark** is its one persistent
instance — a fixed 13px lockup in the header, which reads as a mark rather than as text. Beyond
that it is a display face for headlines at 28px or larger: the welcome screen, the empty canvas,
and the fatal-empty state, which are mutually exclusive, so at most one appears at a time.

Everything else is Geist, the canvas titleblock included. An earlier draft put Archivo in the
titleblock too, which would have placed two display instances on the same screen as the wordmark;
the titleblock is small, dense, and sits beside monospaced metadata, so Geist is the better fit
regardless.

Geist Mono is not decoration — it marks *data*, and the rule for when a value is set in it is
whether the characters matter individually.

### Concrete changes

1. Load Geist, Geist Mono, and Archivo through `next/font/google` in
   [layout.tsx](../src/app/layout.tsx#L9), exposing them as CSS variables, and point `--sans`,
   `--mono`, and `--display` in `tokens.ts` at them. Declare real fallback stacks.
   `next/font/google` self-hosts the files, so the **running** app never reaches a CDN — but it
   downloads them at **build** time. If offline builds are a requirement, commit the WOFF2 files
   under `src/app/fonts/` and use `next/font/local` instead; the rest of this story is unchanged
   either way. Decide before implementing, since it affects what lands in the repository.
2. Repoint the palette in `src/shared/design/tokens.ts` to the cool-neutral set: achromatic chrome,
   `sheet` as the only true white in light and the lifted surface in dark, and hue reserved for
   `live`, `wait`, `stop`, `plot`, `add`, and `del`. No component CSS changes — this is a values
   edit, which is the point of Story 29.
3. Rebuild the header at 48px: brand, then a breadcrumb of project › conversation replacing the
   four labelled pickers, then run state and panel toggles on the right. Each breadcrumb segment
   opens the picker it names, so nothing becomes less reachable.
4. Encode mode escalation rather than decorating it. Ask is neutral, Plan is neutral with a
   selected state, Agent is `wait` — the same token used for pending approvals and permission
   cards, because they are the same fact: this run can change your working tree.
5. Add the **run ribbon** — a 2px hairline along the top edge of the canvas sheet that traces the
   active run. It is deliberately **not** a progress bar: see the constraint below.
6. Make the ribbon the application's only ambient motion. Remove `breathe`, `pulse`, and the
   drawer/popover entry animations elsewhere, keeping only the ribbon and the streaming cursor.
7. Add the canvas titleblock at the sheet's bottom-left, replacing the `.canvas-context` block in
   the topbar so the canvas carries its own identity. It uses only fields that already exist —
   see the data note below — and is set in Geist and Geist Mono, not Archivo.
8. Set radii, borders, and shadows to one scale: 6px controls, 10px panels and cards, hairline
   borders at `--line`, and two shadow levels only.

### The ribbon shows what the run actually reports

The obvious ribbon — fixed segments that fill as calls complete — cannot be built without changing
the protocol. `AgentEvent.tool-activity` carries `{ tool, detail?, denied? }` and nothing else
([types.ts](../src/shared/types.ts#L309), ~line 309); the client entry adds only a local `key`
([toolActivity.ts](../src/features/agents/toolActivity.ts#L3), ~line 3). There is **no call id, no
completion event, and no total**, and entries are cleared when the run ends. A bar that implies a
denominator would be inventing one.

So the ribbon is a **rolling trace**, not a progress bar, and every state below is derived from
data the client already holds:

| State | Derived from | Appearance |
|---|---|---|
| Idle | no active run | flat hairline at `--line-strong` |
| Working | one tick appended per `tool-activity` | ticks in `live`; the newest tick breathes |
| Denied call | `denied: true` on an entry | that tick in `stop`, no animation |
| Awaiting approval | `pendingApprovals > 0` | whole ribbon shifts to `wait` and breathes |
| Failed | run `error` event | whole ribbon `stop`, static, until the next run starts |

Ticks grow left to right with a fixed minimum width. When more ticks exist than fit, the ribbon
shows the most recent ones that do — a trace of recent activity, which is what the underlying
event stream honestly supports. Each tick's tooltip is its tool and detail, matching the existing
tool timeline. When the run ends and entries clear, the ribbon returns to the idle hairline.

### What the titleblock displays

`DiagramArtifact` has no name and no revision field
([types.ts](../src/shared/types.ts#L186), ~line 186). The titleblock therefore composes existing
values and needs no data-model change:

- **`Diagram {ordinal}`** or **`Sketch {ordinal}`** from `ordinal`, the same value the topbar's
  "Diagram 1 of 1" already uses.
- **Lineage** — `derived from Diagram {n}` — only when `derivedFromDiagramIds` is non-empty. This
  is the existing `.lineage-pill` content, relocated.
- **Mark count** from `thread.annotations[canvasId].marks.length`, already computed for the
  composer's attachment chip.

Naming a canvas is a genuine feature and a data-model change; it is out of scope here and noted
below.

---

## Acceptance criteria

- [ ] Geist, Geist Mono, and Archivo are self-hosted by `next/font/google`; the built app renders
  all three with no network access at runtime.
- [ ] No text renders in an unintended fallback — `--sans`, `--mono`, and `--display` all resolve
  to a loaded family.
- [ ] Archivo appears only as the header wordmark and at ≥28px display headlines, and never twice
  on one screen besides the wordmark.
- [ ] The header is 48px and reaches every picker through the breadcrumb, with no loss of keyboard
  access or labelling.
- [ ] Agent mode, pending approvals, and permission cards share the `wait` token; Ask and Plan are
  neutral.
- [ ] The run ribbon appends one tick per `tool-activity` event, breathes on the newest, marks
  denied calls `stop`, shifts to `wait` while an approval is pending, goes `stop` on run error,
  and returns to a flat hairline when the run ends.
- [ ] The ribbon implies no total or percentage, and adds no field to `AgentEvent`.
- [ ] The titleblock renders from `ordinal`, `derivedFromDiagramIds`, and the mark count, with no
  change to `DiagramArtifact`.
- [ ] The ribbon and the streaming cursor are the only ambient motion left; all of it is disabled
  under `prefers-reduced-motion`.
- [ ] Mermaid ink uses the `plot` token family and the loaded font stack, in both themes.
- [ ] Both themes still meet WCAG AA on body text, muted text, and every state color.
- [ ] Keyboard focus is visible on every control in both themes.
- [ ] `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

- Any change to what the application does. This story is presentation only — no route, no store,
  no run-lifecycle change. The ribbon renders only state the client already holds.
- **Per-call lifecycle for the ribbon.** True segment completion would need `tool-activity` to
  carry a call id and a `started`/`finished` status, which changes `AgentEvent`, both provider
  adapters, and the run orchestration — a full-stack story, and the reason the ribbon is specified
  as a trace instead. Worth doing on its own merits; not here.
- Naming a canvas. The titleblock uses `ordinal` because there is no name field, and adding one is
  a data-model and persistence change.
- New iconography beyond what the current UI uses.
- A component library. Radix primitives for the project popover and the agent menu (a raw
  `<details>` today at
  [ParticipantControls.tsx](../src/features/agents/ParticipantControls.tsx#L79), ~line 79) are
  worth doing, but they are an accessibility change and belong in their own story.
- Tailwind and shadcn/ui. The tokens in `src/shared/design/tokens.ts` are the design system, and
  they have to stay readable by the planned react-three-fiber client, which cannot consume CSS
  classes at all.
- The VR client itself. It imports `tokens.ts`; nothing here anticipates it further.

## How to verify

1. `npm test && npm run lint && npm run build && npm run test:e2e`.
2. Run `npm start` with the network disabled and confirm all three faces still render.
3. Open [docs/design/sheet-and-instrument.html](../docs/design/sheet-and-instrument.html) beside
   the running app and compare in both themes: header, repository panel, canvas sheet,
   conversation panel, composer, and mode selector.
4. Start an Agent-mode run that requests permission. Watch ticks append as tools are called, the
   ribbon turn `wait` when the permission card appears, a denied call leave a `stop` tick, and the
   ribbon fall back to a flat hairline when the run ends.
5. Enable **Reduce motion** at the OS level and confirm nothing animates.
6. Tab through the whole shell in both themes and confirm every stop is visibly focused.
