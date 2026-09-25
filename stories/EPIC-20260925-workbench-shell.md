# EPIC — A workbench shell: activity bar, status bar, and flat panes

**Status:** Draft · **Updated:** September 25, 2026 · **Owns:** the frame of the flat desktop shell
after [Story 62](STORY-20260920-simplify-flat-shell.md): where views, layout toggles, session tabs,
ambient state, notices, and composer controls live. It continues the
[shell design-system epic](EPIC-20260828-shell-design-system.md), whose invariants still hold. The
immersive workspace is unaffected.

## Motivation

The user, on September 25, 2026, with a screenshot of VS Code beside the running app:

> I like the style of vscode - especially the panes. perhaps other elements could also be useful.

And after the first design round, with VS Code's chat panel as the reference:

> I think we could improve the chat - ask/plan/agent takes too much space. attach option would also
> be nice to have. the canvas pane should also be toggle-able

Story 62 cut the default layout from 45 to 43 visible controls, but the shell still reaches the
same views three ways: header links (Arena, Inbox), header toggles (Repository, Conversation), and
side-panel tabs (Changes, History, Reports), plus a toolbar History button. Four rows of chrome sit
above the canvas (header, tabs, toolbar, drawing tools). Ambient facts such as Local or Docker, "Ready
for an instruction", and provider readiness are scattered. Notices float over the layout, and Story
62 recorded that the centred banner covers the side panel's close button.

VS Code's workbench solves the same problem with a small set of parts, and each fits "sheet and
instrument": an activity bar, flat panes divided by 1px lines, a status bar, layout toggles in the
title bar, and a compact chat composer.

## Design

The verification oracle is [docs/design/workbench-shell/](../docs/design/workbench-shell/). Serve
`docs/design` over HTTP and open any `.dc.html` board; `canvas.json` lists the boards and the four
design notes. The editable original is a private Claude Design canvas:
https://claude.ai/artifact/WKfhHJmFZuTRsnphe41FVE. If an implementation deliberately diverges, update
the repository copy in the same change.

| Board | Shows |
|---|---|
| `Main` | 1440, Story 62's default (conversation open, side panel closed), a running turn. Interactive: the activity bar, the two layout toggles, and the composer menus work. |
| `ArenaDark` | Dark, Arena in the side panel, Docker session, mode menu open, another session needs you |
| `Default1280` | 1280, an approval waiting in this session, Agent mode, a notice row |
| `Narrow1000` | 1000, one dock, the execution menu with Docker not enabled |
| `ChatWide` | Canvas hidden: the conversation takes the width, capped at 760px; the attach menu is open |
| `Palette` | The command palette, placed for a later follow-up |
| `Phone`, `PhoneDark` | 390, a bottom bar in place of the activity bar |

A review agent checked the design twice against the code and Story 62 on September 25, 2026. It
removed every element the browser cannot back without new server work (see *Needs the server*).

## Where the code is

| Today | Where | Becomes |
|---|---|---|
| Header: breadcrumb pickers, Arena and Inbox links, Repository and Conversation toggles, More | [AppShell.tsx:1724](../src/features/shell/AppShell.tsx#L1724), actions at [:1763](../src/features/shell/AppShell.tsx#L1763) | Title bar: identity, session tabs, two layout icons (canvas, conversation); the activity bar owns the side panel |
| Session tab strip in its own 34px row | [WorkspaceTabs.tsx:44](../src/features/conversation/WorkspaceTabs.tsx#L44), mounted at [AppShell.tsx:1978](../src/features/shell/AppShell.tsx#L1978) | Tabs inside the title bar |
| Side panel tabs Changes, History, Reports | [RepositorySidebar.tsx:38](../src/features/repository/RepositorySidebar.tsx#L38) | Activity bar views |
| Canvas toolbar row: Flat/Spatial, New sketch, History, Focus | [CanvasWorkspace.tsx:103](../src/features/diagram/components/CanvasWorkspace.tsx#L103) | A floating canvas bar that publishes its inset |
| Composer mode radios, hint, Send/Cancel | [InstructionComposer.tsx:152](../src/features/conversation/InstructionComposer.tsx#L152) | Mode picker, attach menu, execution line |
| Conversation header: execution badge, Continue in Docker/Local, reason | [ConversationDrawer.tsx:72](../src/features/conversation/ConversationDrawer.tsx#L72) | The execution line under the composer |
| Notice banner floating over the layout | [AppShell.tsx:2052](../src/features/shell/AppShell.tsx#L2052) | A notice row in the layout |
| Shell grid: header, tabs, and rail · canvas · dock | [globals.css:27](../src/app/globals.css#L27) | Title bar, activity bar · side panel · canvas · conversation, status bar |
| Dock capacity bands (960 and 640) from column minimums | [panelLayout.ts:129](../src/features/shell/panelLayout.ts#L129) | The same rule plus the 48px activity bar (1008 and 688) |

## Invariants

1. **Presentation only.** No route, store, wire schema, or `AgentEvent` change. When an idea needs
   data the client does not hold, the idea changes or moves to *Needs the server*.
2. **The shell design-system invariants hold.** Every colour comes from `tokens.ts`. Both themes
   land together. Text meets 4.5:1. Agent mode and pending approvals share `wait`.
3. **Each fact appears once.** The session name, run state, change count, execution, and needs-you
   each have one home in the default layout. A second copy is allowed only where the first one is
   hidden, such as run state in the status bar while the conversation is closed.
4. **A control budget.** Every story measures visible controls at 1440×900 in the default layout, and
   none raises the count. The epic's target is 35, against 43 after Story 62. (It was 36 until
   Story 72 left out the design's side panel icon, which the count could not pay for.)
5. **Nothing covers the canvas** at docking widths. Notices become a layout row, and floating canvas
   bars publish their inset. Hiding the canvas is the user's choice, and the canvas and the
   conversation are never both hidden.
6. **Every story ships alone.** Stored layouts written before a story still parse. Keyboard flows
   such as Delete closing a tab and focusing its neighbour survive a move.

## Story map

| # | Story | Theme | Status | Depends on |
|---|---|---|---|---|
| 71 | [compact-composer](STORY-20260925-compact-composer.md) | One mode picker, a `+` attach menu, and an execution line under the composer | **In progress** | — |
| 72 | [layout-frame](STORY-20260925-layout-frame.md) | Activity bar (Changes, History, Reports; Arena and Inbox open the Arena page until 75); canvas and conversation layout icons; hiding the canvas; dock bands move by 48px; More moves to the gear | **In progress** | — |
| 73 | title-bar-tabs | Session tabs move into the title bar; All sessions takes overflow; the tab keyboard flow survives; decide where a tab's close control sits | Planned | 72 |
| 74 | status-bar-and-notices | Status bar: branch, needs-you with its reason, run state while the conversation is closed, provider not ready. Notices become a row in the layout | Planned | — |
| 75 | arena-in-the-side-panel | Arena and Inbox as side-panel views sharing `arenaModel` ordering, with Open the full Arena | Planned | 72 |
| 76 | flat-panes | Pane and section headers, borderless icon buttons, flat message rows, the floating canvas bar, and the remaining eyebrow labels | Planned | 72–75 |
| 77 | phone-bottom-bar | Below 688px a bottom bar replaces the activity bar; Inbox lives inside Arena, Reports in More | Planned | 72 |

Story 71 comes first because the user asked for it directly, it is self-contained, and it pays for
itself: three mode buttons fold into one picker. Story 74 is also independent and fixes Story 62's
known defect. Stories 73, 75, 76, and 77 need the frame from Story 72. Write each story from the
template when it starts; the rows above are the scope, not the spec.

## Budget at 1440×900 with today's widths (side panel 340, conversation 460)

- Visible controls in the default layout: 35 in the design, against 43 after Story 62.
- Canvas in the default layout: 932×836, against about 980×776 today, about 2.5% more area.
- Canvas with both panels open: 592×836, against 640×776, about the same area.
- Chrome above and below the canvas: 64px (title bar and status bar), against 124px (header, tabs,
  and toolbar).

## Needs the server (separate full-stack stories, not scheduled here)

- Tool rows that stay in the transcript and show completion: `tool-activity` has no call id or
  completion event.
- Queueing a second instruction during a running turn: the scheduler rejects it with
  `session-conflict`.
- Diagram names: `DiagramArtifact` has no name field.
- Machine capacity, such as "2 of 2 slots": `maxConcurrentRuns` is server-only.
- Failure detail, reply excerpts, and Retry in the Inbox: `lastActivity` carries only a status.
- Searching other sessions' diagrams.
- Issuing pairing codes from the browser: codes are terminal-issued by design.
- Attaching a file or image from the device, and mentioning an arbitrary repository file: the
  repository routes serve only status and diff.

## Deliberately not scheduled

- **The command palette.** The `Palette` board places it, but it adds a permanent entry point and a
  search model. Revisit after Story 75, when the side panel already lists sessions.
- **A bottom panel.** CodeAI has no terminal, and the conversation already shows run activity.
- **Opening a diff as a tab beside the canvas.** The diff inspector stays in the side panel, which
  widens on Changes.

## Terms

These describe the flat shell only; [vocabulary.md](../docs/vocabulary.md) stays authoritative for
domain words.

- **Title bar**: the top row with identity, session tabs, and layout icons.
- **Activity bar**: the 48px icon column that picks the side panel's view.
- **Side panel**: the left column (Changes, History, Reports, Arena, Inbox).
- **Status bar**: the 24px bottom row of ambient facts.
- **Notice row**: a transient message that takes a row in the layout instead of floating over it.
- **Mode picker**, **attach menu**, **execution line**: the composer's controls from Story 71.

## Risks to watch

- **The shell grid is a regression boundary.** Stories 72–74 change its rows and columns. Keep the
  Playwright panel and canvas bounding-box and responsive-band assertions from Story 31.
- **Tests that find controls by role.** About a dozen e2e steps click the mode radios, and the suite
  counts tabs. Move them to the new controls in the same story, and prove each still fails against
  the old markup.
- **The design drifting from the code.** The repository copy is the oracle. A stale one is worse than
  none.
- **Hiding the canvas.** The canvas is the product's centre. Hiding it must stay one click away from
  showing it again, and fit-to-view must behave when it returns.
