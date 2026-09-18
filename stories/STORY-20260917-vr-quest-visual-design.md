# Story 54 — Restyle the VR workspace after Quest system UI

**Status:** In progress · **Type:** Frontend-only · **Depends on:**
[Story 46](STORY-20260905-vr-workspace-panels.md); restyles the tool surfaces of
[Stories 47](STORY-20260905-vr-conversation-input.md)–[49](STORY-20260905-vr-review-and-annotations.md).

**Vision slice:** [immersive workspace epic](EPIC-20260905-immersive-workspace.md). Runs before
[Story 50](STORY-20260905-vr-spatial-diagrams.md). [Story 55](STORY-20260917-vr-uikit-horizon-spike.md)
follows only if this story's headset review still doesn't feel like Quest.

## Motivation

The user, after using the workspace on Quest 3S (September 17, 2026):

> I don't really like current VR design - it's a lot different from Quest UI design and I'd like it
> to resemble more their design.

The immersive workspace reuses the desktop "sheet and instrument" palette
([Story 32](STORY-20260828-visual-language.md)) on canvas-2D textures. In the headset it reads as a
web page floating in a black void. Quest users learn Horizon OS conventions every day: neutral
rounded panels, circular and pill controls, a control bar under each window, and unambiguous icons.
Matching those conventions makes CodeAI easier to learn and more comfortable to read.

**Approach:** restyle the existing texture pipeline, with no new packages. A review of adopting
pmndrs uikit's Horizon kit found blockers:

- The bundled MSDF fonts have 104 glyphs and render `·`, `…`, and other Unicode as solid boxes.
- The R3F wrapper drops `name` and `userData`.
- Kit defaults fall below Meta's minimums.
- The kit changes renderer-global settings.

Story 55 records those findings as a conditional spike.

### Evaluation findings (September 17, verified in code)

The headset follows `prefers-color-scheme` ([useTheme.ts:76](../src/features/shell/useTheme.ts#L76));
Quest Browser showed the dark theme. Sizes use the dp convention defined under Decisions.

| # | Finding | Evidence |
|---|---|---|
| F1 | The scene background never applies, in either theme; the clear color stays black. `<color attach="background">` attaches to its parent, which is a `<group>`, not the scene. | [ImmersiveEnvironment.tsx:6](../src/features/shell/immersive/ImmersiveEnvironment.tsx#L6) rendered from [ImmersiveWorkspace.tsx:197](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L197) inside [ImmersiveBridge.tsx:275](../src/features/shell/immersive/ImmersiveBridge.tsx#L275) |
| F2 | Panels use desktop surfaces: `#ffffff` or `#171c24`, square corners, a 6 mm border plane, a highlight wash for focus, and a separate title texture that leaves a seam. | [WorkspacePanel.tsx:103](../src/features/shell/immersive/WorkspacePanel.tsx#L103), [workspaceResources.ts:7](../src/features/shell/immersive/workspaceResources.ts#L7) |
| F3 | Four font stacks: `system-ui` (headers, evidence, tooltips), `Arial` (transcript, input, list), `ui-monospace` (diff), and a serif fallback for diagram labels. The diagram SVG is drawn as an image, and its `var(--font-geist)` stack cannot resolve there. | [conversationHistoryResource.ts:62](../src/features/shell/immersive/conversationHistoryResource.ts#L62), [workspaceResources.ts:146](../src/features/shell/immersive/workspaceResources.ts#L146), [panelResources.ts:73](../src/features/diagram/spatial/panelResources.ts#L73), [tokens.ts:387](../src/shared/design/tokens.ts#L387) |
| F4 | Some text is below Meta's 14 dp minimum: transcript metadata ≈ 11 dp, evidence diff ≈ 13 dp, evidence page line ≈ 11 dp. Already comfortable: transcript body ≈ 19 dp, headers ≈ 24 dp, inline input ≈ 20 dp. | [conversationHistoryResource.ts:77](../src/features/shell/immersive/conversationHistoryResource.ts#L77) (32 of 1,280 units across 1.28 m), [workspaceResources.ts:131](../src/features/shell/immersive/workspaceResources.ts#L131) (28 and 24 px of 1,024 across 1.32 m) |
| F5 | One glyph means several unrelated things (list below). | [ConversationTools.tsx:18](../src/features/shell/immersive/ConversationTools.tsx#L18), [CanvasReviewTools.tsx:23](../src/features/shell/immersive/CanvasReviewTools.tsx#L23), [ImmersiveWorkspace.tsx:28](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L28), [ImmersiveWorkspace.tsx:99](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L99) |
| F6 | Evidence shows three identical `‹ ›` pairs (repository, file, page) and Refresh in one unlabelled row. | [ImmersiveWorkspace.tsx:244](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L244) |
| F7 | Canvas review shows 11 icon-only buttons in rows of 7 and 4; the grouping doesn't match their jobs. | [CanvasReviewTools.tsx:319](../src/features/shell/immersive/CanvasReviewTools.tsx#L319) |
| F8 | State feedback is faint: hover is a 3 % scale, selected is a `#a9c2ff` multiply tint, and there is no pressed state. The ray is `#7d9df5`. | [WorkspacePanel.tsx:64](../src/features/shell/immersive/WorkspacePanel.tsx#L64), [WorkspacePanel.tsx:69](../src/features/shell/immersive/WorkspacePanel.tsx#L69), [ImmersiveBridge.tsx:54](../src/features/shell/immersive/ImmersiveBridge.tsx#L54) |
| F9 | No texture has mipmaps. The transcript is about 37 texels per degree on a display of about 20 pixels per degree, so it is minified about 2× without mipmaps. That aliases and shimmers with head motion. | [immersiveResources.ts:38](../src/features/diagram/spatial/immersiveResources.ts#L38), [panelResources.ts:89](../src/features/diagram/spatial/panelResources.ts#L89) |
| F10 | The recovery strip sits about 48° below eye level; Meta's limit is 15°. This belongs to Story 46 and is recorded here only. | [ImmersiveWorkspace.tsx:251](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L251) (`[0, -1.45, -1.3]` from the eye origin) |
| F11 | Panel layers float at different depths in front of the panel surface (−0.02 m): content +2 cm, heading +3 cm, draft and status +4–4.5 cm, inline input +5.5 cm, header buttons +6 cm, canvas tools and voice meter +8 cm, label input +9 cm. Extra large scales these by 1.3×. Viewed 30° off-axis, a 6 cm layer shifts about 3.5 cm, so the opaque heading strip slides over content and header buttons slide off the heading. The heading (top 0.9075 m) and header buttons (top 0.91 m) also overhang the 0.9 m panel edge; this is visible on the angled panel in `vr-canvas-panel.png`. | [WorkspacePanel.tsx:125](../src/features/shell/immersive/WorkspacePanel.tsx#L125), [WorkspacePanel.tsx:129](../src/features/shell/immersive/WorkspacePanel.tsx#L129), [ImmersiveWorkspace.tsx:214](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L214), [InlineConversationInput.tsx:22](../src/features/shell/immersive/InlineConversationInput.tsx#L22), [CanvasReviewTools.tsx:325](../src/features/shell/immersive/CanvasReviewTools.tsx#L325) |

**Icon collisions (F5):**
- `check`: Append speech, Make main, Done editing, Add label.
- `close`: Discard speech, Clear draft, Clear marks, Cancel label. The panel Close is a separately drawn but identical ×.
- `stop`: Stop recording, Cancel run.
- `refresh`: Retry voice, Redo mark, Refresh changes.
- `replace`: Replace word, Replace draft, Arrow tool.
- `spell`: Spell speech, Text label tool.
- `trash`: Delete word, Eraser tool.
- `settings`: Session tools, Agent mode, Role, Speech tools.
- `help`: Voice help, Ask mode.
- `edit`: Pen tool, Plan mode.
- `agents`: Agents, Provider.
- `plus`: Add agent, Attach canvas, Load more.
- `canvas`: Rectangle tool, New sketch, Show/hide Canvas.
- `chat`: Read, Show/hide Conversation.
- `history`: Conversation list, Compare canvases. `reset` (Reset workspace) is a near-identical clock.

## Reference — Quest design language

Verified September 17, 2026 against developers.meta.com (D = `…/horizon/design/`).

- **Themes:** support light and dark. Light backgrounds no brighter than `#DADADA`, dark ones no
  darker than `#1A1A1A`. WCAG AA: 4.5:1 for text (D `styles_color/`).
- **Typeface:** Inter is the typeface available to developers (D `styles_typography/`). Meta's own
  *Optimistic* is proprietary. Text is legible at 14 px (dp) and comfortable at 18 or more.
- **Targets:** hit areas at least 48 dp (22 mm, 3° at 0.42 m) and visible elements at least 32 dp
  (D `accessibility/`, D `styles_inputs_hit_targets/`).
- **Focus:** at least 2 px, distinct from hover and selected, not color-only (D `accessibility/`).
- **Window chrome:** app content fills the panel. The **Control Bar**, a pill below the
  bottom-center edge, carries the title and close; Horizon OS shows it on hover (D `panels/`,
  D `windows/`).
- **Buttons:** primary (one per view), secondary, borderless, destructive. Icon buttons are circles;
  labels are ideally one word (D `buttons/`).
- **Tooltips:** above or below the element, 0.01 m toward the viewer, fade in and out, linger 0.5 s
  after hover (D `tooltips_specs/`).
- **Ray:** `#FFFFFF` while hovering, `#001E78` while selecting (D `raycasting_specs/`).
- **Icons:** one style per app; filled recommended in immersive apps (D `styles_icons_images/`).
- **Comfort:** don't make people tilt their head down more than 15° (D `accessibility/`).
- **Horizon kit reference values** (`@pmndrs/uikit-horizon`, based on Meta's Reality Labs Design
  System; not a Meta spec): dark panel `#414141`→`#272727`, 24 dp corners, monochrome buttons.
- **Unverified:** the H1–Body2 scale, collider spacing, the 0.46–3 m ray range, and panel curvature.

## Decisions

1. **Keep the raster pipeline; add no packages.** Canvas-2D text already handles every Unicode
   character through system font fallback. Mipmaps fix most of the softness (F9). Story 55 is the
   route to uikit if the restyle falls short.
2. **dp convention: 1 dp = 0.0625° anchored at the default 2.6 m distance** (1 dp ≈ 2.84 mm; the
   Medium 1.4 × 1.8 m panel ≈ 493 × 634 dp; 24 dp padding leaves 445 dp for content). This is a
   project convention derived from Meta's "48 dp ≈ 3°", not a Meta constant; Spatial SDK uses
   500 dp/m. Minimums apply at the default distance and Medium size. Story 46 lets people push
   panels to 4.5 m, where everything is 42 % smaller; that is their choice. Calibrate the scale once
   on the headset against Quest Browser's own text.
3. **Flat surfaces.** Horizon's subtle panel gradient is omitted: content textures fill with the
   exact surface color. Header rasters leave their background transparent so they cannot cover
   adjacent controls; render queues and the thin depth stack determine their order.
4. **Deliberate deviations from Horizon OS:**
   - The Control Bar is always visible, because controller users would not discover a hover-only bar.
   - Icons are outline (Lucide), because Meta's filled set isn't available for the web.
   - While selecting, the ray uses the link color instead of `#001E78`, which measures 1.21:1
     against the `#1A1A1A` environment.

## Current behavior (where the code is)

- **Environment and ray:** [ImmersiveEnvironment.tsx:5](../src/features/shell/immersive/ImmersiveEnvironment.tsx#L5)
  sets the background and lights; [ImmersiveBridge.tsx:38](../src/features/shell/immersive/ImmersiveBridge.tsx#L38)
  configures the XR store, ray, and cursor.
- **Panel chrome:** [WorkspacePanel.tsx:81](../src/features/shell/immersive/WorkspacePanel.tsx#L81)
  draws frame, title (also the focus target), lower toolbar, and Size menu. `WorldButton` at
  [WorkspacePanel.tsx:16](../src/features/shell/immersive/WorkspacePanel.tsx#L16) is the one textured
  button, with a delayed tooltip and the `userData.immersiveAction` hook.
- **Raster helpers:** [workspaceResources.ts](../src/features/shell/immersive/workspaceResources.ts)
  (titles, text buttons, conversation text, panel controls, evidence) and
  [workspaceIcons.ts:6](../src/features/shell/immersive/workspaceIcons.ts#L6) (hand-drawn path icons
  on rounded-square backgrounds, and tooltips).
- **Textures and budget:** [immersiveResources.ts:36](../src/features/diagram/spatial/immersiveResources.ts#L36)
  creates panel textures. [panelResources.ts:66](../src/features/diagram/spatial/panelResources.ts#L66)
  rasterizes diagrams. [resourceLedger.ts:119](../src/features/diagram/spatial/resourceLedger.ts#L119)
  enforces `MAX_IMMERSIVE_TEXTURE_PIXELS` ([immersiveTypes.ts:9](../src/features/diagram/spatial/immersiveTypes.ts#L9)).
- **Tools:**
  - [ConversationTools.tsx:120](../src/features/shell/immersive/ConversationTools.tsx#L120): per-mode action lists and grid layout.
  - [ConversationHistory.tsx](../src/features/shell/immersive/ConversationHistory.tsx) with [conversationHistoryResource.ts](../src/features/shell/immersive/conversationHistoryResource.ts).
  - [InlineConversationInput.tsx](../src/features/shell/immersive/InlineConversationInput.tsx), [ConversationList.tsx](../src/features/shell/immersive/ConversationList.tsx), and [SessionTools.tsx](../src/features/shell/immersive/SessionTools.tsx).
  - [CanvasReviewTools.tsx:310](../src/features/shell/immersive/CanvasReviewTools.tsx#L310).
  - Evidence and the recovery strip in [ImmersiveWorkspace.tsx:242](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L242).
- **Fonts:** [layout.tsx:2](../src/app/layout.tsx#L2) loads Archivo, Geist, and Geist Mono through
  `next/font`.
- **Frame samples:** [ImmersiveWorkspace.tsx:124](../src/features/shell/immersive/ImmersiveWorkspace.tsx#L124)
  records `useFrame` deltas. Median and p95 are the time between frames, not render cost.

## Desired behavior

### Tokens, type, and texture quality

1. **`immersiveTheme.ts` is the only place VR colors, type sizes, radii, and the dp conversion are
   chosen.** The desktop palette is unchanged. Starting values:

   | Token | Dark | Light |
   |---|---|---|
   | environment | `#1A1A1A` | `#B0B0B0` |
   | surface | `#303030` | `#DADADA` |
   | raised (cards, fields, bubbles, tooltips) | `#3B3B3B` | `#CECECE` |
   | control / hover / pressed | `#454545` / `#505050` / `#3A3A3A` | `#CACACA` / `#C0C0C0` / `#D4D4D4` |
   | selected background / ink | `#EBEBEB` / `#1F1F1F` | `#1F1F1F` / `#EBEBEB` |
   | text / secondary text | `#EBEBEB` / `#BDBDBD` | `#1A1A1A` / `#424242` |
   | positive / negative / warning / link | `#7FE38A` / `#FFB3B9` / `#FFB866` / `#8CC8FF` | `#07561A` / `#8C1022` / `#6B3A00` / `#084C96` |
   | focus outline | `#FFFFFF` | `#1A1A1A` |

   A unit test enforces:
   - Text, glyphs, and status colors are at least 4.5:1 on surface, raised, control, hover, and pressed.
   - Secondary text is at least 4.5:1 on surface and raised, and is never used on controls.
   - Light surfaces are no brighter than `#DADADA`; dark ones are no darker than `#1A1A1A`.
2. **Theme.** VR keeps following the app's resolved theme.
3. **Fonts.** Inter (added through `next/font` with `preload: false`, weights 400 and 600) for all VR
   text, and Geist Mono (already loaded) for code and diffs. Canvas text needs its fonts loaded
   first, so VR availability stays "checking" until `document.fonts.load` resolves for each
   face/weight. On failure, continue with `system-ui, sans-serif` and record a diagnostic event; font
   loading never blocks entry.
4. **Type scale (dp, size/line height).**
   - Title 24/28 (600) and heading 20/24 (600).
   - Reading text (transcript, draft, permission details) 18/26.
   - Code and diff 16/22 mono.
   - Button labels 16/20 (600); labels, metadata, and tooltips 14/20.
   - Nothing below 14 dp.

   Diff columns derive from the content width: about 46 at 16 dp, replacing Story 46's fixed 56.
   Evidence lines per page derive from the content height. Pixel sizes derive from dp and each
   texture's texels per meter; no literal pixel font sizes remain in immersive code.
5. **Mipmaps.** Every panel, text, icon, and diagram texture uses mipmaps (`LinearMipmapLinearFilter`)
   and anisotropy 4. The exception is the canvas draft preview, which re-uploads during a gesture.
   The ledger counts a mipmapped texture as 4/3 of its base texels. `MAX_IMMERSIVE_TEXTURE_PIXELS`
   rises from 4,194,304 to 5,592,405 (× 4/3), so base-level allocations are unchanged.

### Environment and panels

6. **Background (F1).** Apply the environment color to the scene itself, not to a child group, in
   both themes. No gradient or decoration.
7. **Panel surface.**
   - A rounded rectangle (24 dp radius) in the surface color, replacing the border plane and
     highlight wash.
   - Content stays inset by 24 dp, so the corners never clip it.
   - Every content texture fills with its exact token color: surface or raised.
   - **One thin depth stack (F11).** Everything on a panel sits within 1 cm of its surface (before
     panel scale): content and headers +3 mm; compact status +3.5 mm; fields and canvas content
     +4–4.5 mm; control backgrounds +6.5 mm; glyphs +7 mm; hover +9 mm; tooltips +10 mm (Meta's
     0.01 m). The Control Bar uses the same offsets. `renderOrder` per layer sets draw order, and
     layers above the surface don't write depth. Only the surface writes depth, so millimetre
     offsets can't z-fight at any distance and overlapping panels still hide each other. The offsets
     also give overlapping ray targets a deterministic hit order.
   - Nothing except the Control Bar and tooltips extends past the panel edge.
8. **Content headers** replace generic panel names; the name moves to the Control Bar. The header
   stays the `panel:*:focus` target; its hit area covers only the title text, never the header
   buttons.
   - **Conversation:** session title plus detail, with header icon buttons (unchanged content).
   - **Canvas:** `Diagram 1` or `Sketch 2` plus "Hold trigger to draw". This replaces the footer
     label.
   - **Evidence:** file path (middle-truncated) plus repository name, with Refresh at the right.
     This replaces the title and page lines inside the diff texture.
9. **Control Bar (Horizon pattern).**
   - A rounded pill 12 dp below the bottom edge, in the raised color.
   - Contents: Move (grip), the panel name (14 dp), Size, and Close.
   - Always visible. Drag capture, gain, bounds, and tooltips stay as in Story 46.
   - The Size menu keeps Story 46's in-panel presets and Done, restyled as a list with a check on the
     current size.
10. **Panel focus.** A 3 dp focus-color outline 4 dp outside the rounded edge, plus the panel name in
    600 weight. Focus applies to panels only; controls use hover, pressed, and selected.
11. **Recovery strip.** A raised pill holding:
    - labelled toggles "Conversation", "Canvas", and "Evidence" (selected when open);
    - "Reset";
    - "Exit VR".

    The status line stays above it. Its position stays Story 46's (see F10).

### Controls

12. **One button component**, replacing the rounded-square icon backgrounds and the text-button
    textures:
    - **Background:** geometry whose color follows state: control, hover, pressed while the trigger
      is held, selected, or disabled.
    - **Foreground:** a transparent glyph or label texture.
    - **Icon buttons:** 48 dp circles.
    - **Text buttons:** 48 dp tall pills with 16 dp horizontal padding.
    - **Hover:** hover color plus the 3 mm lift from item 7's depth stack, replacing the scale.
    - **Disabled:** foreground at 40 % and no hover.
    - **Destructive:** foreground in the negative color.
    - **Primary:** selected colors (Send, Allow), one per view.

    Hit areas are 48 dp at Medium, which is 41 dp (2.55°) at Small.
13. **Tooltips.**
    - Raised pill with 14 dp text, above the control and 0.01 m toward the viewer.
    - Keep the current 450 ms delay and fade; linger 0.5 s after hover ends.
    - Hide immediately on press; never intercept rays.
14. **Icons: one glyph, one meaning (F5).** Replace `iconPaths` with Lucide path data (ISC license;
    keep the notice in the file). Stroke 2 on the 24 grid. The complete glyph map:

    | Lucide glyph | Meaning | Actions |
    |---|---|---|
    | `Pencil`, `RectangleHorizontal`, `MoveUpRight`, `Type`, `Eraser` | Drawing tools | `canvas:pen`, `rectangle`, `arrow`, `text`, `eraser` |
    | `Undo2` / `Redo2` | Undo / redo | `canvas:undo`, `conversation:undo` / `canvas:redo` |
    | `Trash2` | Delete selected word | `conversation:delete` |
    | `Delete` | Clear the text field | `conversation:clear` |
    | `CornerDownLeft` | New line | `conversation:newline` |
    | `Mic` / `CircleStop` | Dictate / stop recording | `conversation:record` / `conversation:stop` |
    | `SendHorizontal` | Send | `conversation:send` |
    | `ArrowDown` | Jump to latest | `conversation:latest` |
    | `ArrowLeft` | Back | `conversation:back`, `conversation:read` |
    | `History`, `Users`, `SlidersHorizontal` | List, agents, session tools | header buttons |
    | `RefreshCw` | Refresh changes | `refresh-evidence` |
    | `ZoomIn` / `ZoomOut` | Zoom canvas | `larger` / `smaller` |
    | `GripHorizontal`, `Scaling`, `X` | Move, size, close panel | `panel:*:drag`, `resize`, `close` |
    | `ChevronLeft` / `ChevronRight` | Previous / next | only inside a labelled pager (item 15) |

    Every other world action is a text button:
    - **Speech:** Retry, Discard, Append, Replace word, Replace all, Spell, Help, Done.
    - **Runs and agents:** Cancel run, Ask/Plan/Agent, Make main, Provider, Role, Add agent.
    - **Canvas:** Attach, New sketch, Compare, Clear, Add label, Cancel.
    - **Workspace:** Load more, Reset, Exit VR, and the panel toggles.

    The glyph map is one exported record keyed by action with an explicit meaning string. A unit test
    proves no glyph serves two meanings and no chevron appears outside a pager.
15. **Pager component.** `‹ label ›`: two 48 dp chevron buttons around a 14 dp label that names the
    position (for example `File 3 of 12`). Chevron buttons carry the existing previous/next actions.
16. **Canvas review (F7).**
    - **Row 1:** a segmented tool selector (Pen, Rectangle, Arrow, Text, Eraser; selected state
      visible), a gap, then Undo and Redo. That is about 392 dp.
    - **Row 2:** the toggles "Attach" and "Compare", then "New sketch" and a destructive "Clear" that
      keeps its two-step confirmation.
    - **Footer:** canvas pager `‹ 1 of 3 ›` plus zoom − and +. While comparing, a second pager
      `‹ Compare 2 of 3 ›` appears.
    - **Label entry:** "Add label" (primary) and "Cancel".
17. **Evidence (F6).** Footer pagers `‹ File 3 of 12 ›` and `‹ Page 2 of 5 ›` share one row. A
    repository pager row appears above them only when there are two or more checkouts. The diff uses
    the 16 dp mono scale, with additions and deletions in the positive and negative colors.
18. **Conversation.**
    - **Transcript:** body at least 18 dp and metadata 14 dp. User and agent bubbles use the raised
      and control colors.
    - **Inline input:** a raised field with 16 dp corners; Dictate, Clear, and Send are icon buttons,
      and Send is primary.
    - **Speech editing and review:** grouped rows instead of the six-per-row icon grid:
      1. A word pager `‹ Selected: App.tsx ›`, which replaces the separate "Selected:" status line.
      2. Edit icons (Delete word, Undo, New line, Dictate), or in review the text buttons Append,
         Replace word, Replace all, and Spell.
      3. Discard (destructive), Help, and Done.
    - **Draft paging:** a draft pager `‹ Page 1 of 3 ›` beside the draft heading.
    - **Cancel run:** a destructive text button, always in the status row.
    - **Agents tab:**
      - an agent pager;
      - a segmented Ask/Plan/Agent control that honors unsupported modes;
      - "Make main";
      - "Provider: Claude" and "Role: Coder" as cycling text buttons;
      - "Add agent".
    - **Conversation list:** whole-row targets at least 48 dp; title 18 dp (600), metadata 14 dp
      secondary; rows separated by 8 dp gaps, with a raised background on hover and no hairlines.
    - **Session tools and permission cards:** raised cards with 16 dp corners; Allow is primary, Deny
      secondary, and "Forget this device" destructive.
19. **Ray and cursor (F8).** The ray uses the text color while hovering and the link color while
    selecting. The cursor ring uses the same colors, with higher opacity while selecting; the XR
    cursor size option is not per-pointer. Configure both in the XR store at
    [ImmersiveBridge.tsx:51](../src/features/shell/immersive/ImmersiveBridge.tsx#L51).
20. **Diagram labels (F3).** Before rasterizing, replace `var(...)` font stacks in the SVG with
    `system-ui, sans-serif`, which an SVG image can use; never serif. Compose diagrams on the raised
    color instead of the desktop sheet color.

### Contracts to keep

21. **Behavior.** No action is added or removed, and no command changes target. Drag, layout
    records, voice/draft handling, permissions, and content isolation keep Story 46–49 semantics.
    The DOM semantic controls in [ImmersiveBoundary.tsx:37](../src/features/shell/immersive/ImmersiveBoundary.tsx#L37)
    are unchanged.
22. **Sibling stories.** This story amends ticked text, which is updated when it ships:
    - Story 46's toolbar criterion (the Control Bar adds the panel name).
    - Story 46's sizing table (dp sizes, 46 diff columns, the texture ceiling).
    - Story 47's "Clear draft ×" (now the `Delete` glyph).
    - Story 47's "navigation uses icons" (icons for unambiguous actions, labels otherwise).
23. **Test hooks.** Every actionable object keeps `userData.immersiveAction`, and every object the
    e2e suite finds by name keeps its name.
    - **May change**, because they encode restyled geometry: header button positions
      ([immersive.spec.ts:67](../e2e/immersive.spec.ts#L67)), the Latest position (:966), toolbar icon
      geometry (:1085–1092), the 1024×768 evidence canvas (:1261), and conversation list row
      positions (:872–876).
    - **Must still hold:** texture reuse while scrolling (:960/:974, :1005/:1026) and every behavior
      assertion.
24. **Resources.** Twenty open/close/reset cycles and exit still return tracked resources to zero
    under the new ceiling.

### Delivery order

1. **Baseline.** On the current build, record Quest 3S median and p95 frame deltas with three panels
   open, a 200-message transcript, and a streaming reply.
2. **Foundation.** Tokens and contrast test, background, fonts, mipmaps and ledger, the button
   component, panel surface, Control Bar, and focus. Screenshots in both themes.
3. **Headset check A.** The user compares the panels against Quest system panels and calibrates the
   dp scale against Quest Browser text. Frame deltas on the same fixture must have a median equal to
   the session interval and a p95 no worse than the baseline or 1.5× the interval, whichever is
   larger. Adjust tokens here.
4. **Glyph map and panels.** Glyph map, pagers, canvas review, and evidence.
5. **Remaining surfaces.** Conversation input, speech and agents rows, conversation list, session
   tools and permission cards, recovery strip, tooltips, and diagram labels.
6. **Cleanup.** Remove replaced code (hand-drawn icon paths, rounded-square icon and text-button
   rasters, the old toolbar/tooltip helpers, and literal font strings), then update Stories 46 and 47.
7. **Final checks.** Screenshot matrix, full suites, and **headset check B**. The user decides
   whether this is Quest-like enough, or whether Story 55's spike is warranted.

## Acceptance criteria

- [ ] The baseline and headset check A frame deltas are recorded, and check A meets the step 3 rule.
- [x] The scene background equals the environment token in both themes (test reads `scene.background`).
- [x] The token contrast and brightness test passes; no immersive code picks colors outside
  `immersiveTheme.ts`.
- [x] VR text uses only Inter and Geist Mono after font loading. A failed font load still allows entry
  and records a diagnostic. Diagram labels are sans-serif.
- [x] A unit test covers the dp conversion and type scale: nothing below 14 dp, and reading text at
  least 18 dp at the default distance and Medium size.
- [x] Panel, text, icon, and diagram textures use mipmaps, except the draft preview. The ledger counts
  4/3 texels under the 5,592,405 ceiling.
- [x] Panels have 24 dp rounded surfaces with no border plane or seam. Content headers are
  specific (Canvas: diagram or sketch name; Evidence: file path).
- [ ] A scene test proves every panel descendant except tooltips sits within 1 cm of the panel
  surface, before scale. Every descendant except the Control Bar and tooltips stays inside the
  panel bounds. Oblique screenshots show no layer sliding over or off another.
- [x] Each panel has a Control Bar (Move, name, Size, Close) below it, and the Size presets still work.
- [x] The focused panel shows the outline and 600-weight name. Controls show hover lift, pressed,
  selected, and disabled states. Icon and text hit areas are 48 dp at Medium.
- [x] Tooltips linger 0.5 s, hide on press, and never intercept rays.
- [x] The glyph map test passes: one meaning per glyph, and chevrons only in pagers. Every action in
  item 14's text list renders as a labelled button.
- [x] Evidence shows the File and Page pagers, plus a repository pager only with two or more
  checkouts. Diff text is 16 dp mono.
- [x] Canvas review shows the segmented tool selector, Undo/Redo, the labelled Attach/Compare/New
  sketch/Clear row, and the canvas pager and zoom footer.
- [x] Conversation uses item 18's layouts: word and draft pagers, destructive Cancel run and Discard,
  the segmented mode control, labelled agent actions, gap-separated list rows, and card-styled
  session tools and permission cards.
- [x] The ray and cursor use the text color while hovering and the link color while selecting.
- [x] All `e2e/immersive.spec.ts` and `e2e/canvas.spec.ts` XR cases pass. Only the assertions listed
  in item 23 change.
- [x] Twenty open/close/reset cycles and exit return tracked resources to zero.
- [x] Replaced code is deleted, and the Story 46 and 47 text is amended.
- [ ] The screenshot matrix is saved and reviewed in both themes.
- [ ] Headset check B: on Quest 3S the user reads the fixture seated, operates every panel, and records
  the verdict, browser and OS versions, and the decision on Story 55.
- [x] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

## Out of scope

- **uikit:** conditional [Story 55](STORY-20260917-vr-uikit-horizon-spike.md).
- **Transcript content:** real code blocks and diagram cards (today `[ts code]` and
  `[Diagram 1 is available on the canvas]`,
  [immersiveTranscript.ts:64](../src/features/diagram/spatial/immersiveTranscript.ts#L64)). They are
  new features and need their own story.
- **Placement and comfort (Story 46):** panel distance, bounds, drag gain, and the recovery strip's
  48° position (F10).
- **Horizon behaviors not adopted:** hover-only Control Bar, gradient surfaces, panel curvature,
  filled icons, the Optimistic font, and cursor shrink on select.
- **Input and presentation:** hand tracking and poke, virtual keyboard, AR/passthrough.
- **Desktop:** desktop styling (Story 32), and desktop marked-attachment export
  ([compositeExport.ts:55](../src/features/diagram/annotations/compositeExport.ts#L55)), which has
  the same `var()` font pattern.

## How to verify

1. Run `npm run lint`, `npm test`, then `npm run test:e2e`.
2. **Screenshot matrix.** Capture Conversation (thread, compose, speech review, agents, list, session
   tools, permission card), Canvas (tools, compare, clear confirmation, label entry), Evidence (one
   and two checkouts), the Size menu, a tooltip, and the recovery strip. Capture each in dark and
   light via `page.emulateMedia({ colorScheme })`, as `test-results/vr-quest-<surface>-<theme>.png`.
   Also capture each panel from 35° to the side and 20° below its normal
   (`vr-quest-<panel>-oblique.png`) to check the depth stack. Compare with the
   [Meta Horizon OS UI Set](https://www.figma.com/community/file/1509641173090552632/meta-horizon-os-ui-set).
3. **Headset.** Run `npm run build` and `npm run start:remote`, then enter VR on Quest 3S with the
   reading fixture and a 200-message transcript that includes `·…‹›`, accented, and non-Latin text.
   - Read seated.
   - Hover every icon and check its tooltip against item 14.
   - Operate each Control Bar, pager, the canvas tools, speech editing, the agents tab, and a
     permission card.
   - Retrieve frame samples through the README's VR diagnostics procedure.
4. Record the results below.

## Verification record

September 18, 2026 — implementation and automated verification complete; physical review remains pending.

- Added the shared dp/type/radius/color system, Inter font gate with a recorded fallback diagnostic,
  mipmapped anisotropic raster textures, sans-serif diagram sanitization, and direct scene background
  application. Unit coverage verifies contrast, the minimum type scale, glyph semantics, mip costs,
  and diagram font fallback.
- Rebuilt panel chrome around rounded surfaces, a focus outline, the always-visible Control Bar, one
  geometry-backed button component, delayed non-intercepting tooltips, and the labelled recovery pill.
  A browser scene test verifies both theme backgrounds, the thin depth stack, panel bounds, and that
  only panel surfaces write depth.
- Reorganized Canvas, Evidence, Conversation, session, and permission controls around labelled pagers,
  distinct Lucide glyph meanings, contextual text actions, and content-specific headers. The existing
  action contracts, semantic controls, drag/layout persistence, voice, permissions, and annotations are
  unchanged. Stories 46 and 47 now describe the amended visual and resource contracts.
- `npm run lint` passes. `npm test` passes **397 tests in 63 files**. `npm run build` passes.
  `npm run test:e2e` passes **69 Chrome tests**, including all immersive/canvas cases, font-failure
  fallback, both theme backgrounds, sequential tooltip allocation, and twenty resource cycles.
- The automated suite refreshed its existing VR screenshots, but the full named dark/light and oblique
  screenshot review matrix is not claimed complete. The Quest 3S baseline, check A, and check B require
  the physical headset, browser/OS version, and user verdict; those criteria remain unchecked and keep
  this story In progress.

September 18, 2026 — external review and first Quest captures followed up.

- Reviewed the two raw Quest captures `28212796478391961.jpg` and `28327938546835109.jpg`. They are
  useful dark-theme evidence, but are not the required named dark/light matrix and were left as the
  user's untracked originals. The captures exposed the compact status surface crossing the composer
  boundary and icon-button backgrounds sharing the input field's depth. The status raster is now
  physically separated and control backgrounds sit deterministically in front of fields.
- Addressed every external code-review item: pre-colored headers no longer receive mask tinting,
  mixed-width speech controls are packed from their measured widths, a 1.5-second font-loading timeout
  preserves VR entry, and automatic tooltips are limited to icon buttons. Removed the stale Evidence
  parameters and dead toolbar type.
- Added scene coverage for the light-theme header material, composer/status separation, field/control
  depth ordering, speech-action bounds, icon-only tooltips, and a font promise that never settles.
  `npm run lint` passes. `npm test` passes **398 tests in 63 files**. The production build passes, and
  the complete Playwright suite passes **70 Chrome tests**.

September 18, 2026 — physical Quest follow-up found two remaining rendering regressions.

- Moving the headset off-axis exposes coplanar transparent/opaque planes around the Conversation
  header and composer. Headers no longer paint an opaque background under their controls; button
  chrome now shares the transparent queue, and the header, status, field, background, glyph, and
  hover tiers have explicit render orders and distinct panel-local depths within 1 cm.
- Canvas content now renders after and 4 mm in front of the depth-writing panel surface. Live preview
  restoration copies from a CPU canvas instead of synchronous `getImageData()`, and preview setup
  failure cannot abort the gesture or prevent the committed mark.
- Browser coverage verifies the effective panel-local depths and render queues and proves drawing
  survives an injected `getImageData()` failure. `npm run lint`, all **398 unit tests**, and the
  production build pass. After restoring the tooltip's effective depth from 16 mm to its established
  10 mm, the complete Playwright suite passes **70 Chrome tests**. Fresh Quest captures are still
  required before the oblique screenshot and headset criteria can close.

September 18, 2026 — the third Quest capture `28212120205124676.jpg` found two placement issues.

- The compact “Cancel run” pill sat at the left edge between the status and input surfaces. It is now
  right-aligned in the status row with its lower edge clear of the input field.
- The shared Close circle extended past the Control Bar's right cap. Size and Close are redistributed
  so every circular target stays within the 0.94 m bar on every panel.
- Scene coverage asserts the Cancel/status placement and checks every panel toolbar target against
  the bar bounds. `npm run lint`, the production build, and both focused browser regressions pass.
  The user's headset capture remains untouched.
