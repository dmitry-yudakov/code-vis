export const PANEL_WIDTHS_STORAGE_KEY = 'code-ai:panel-widths';
export const VIEW_PANEL_LAYOUTS_STORAGE_KEY = 'code-ai:device:v1:view-panel-layouts';
export const REPOSITORY_MIN_WIDTH = 268;
export const CONVERSATION_MIN_WIDTH = 320;
export const FILE_VIEW_MIN_WIDTH = 320;
export const CANVAS_MIN_WIDTH = 360;
export const PANEL_HANDLE_ALLOWANCE = 12;
export const PANE_GUTTER = 4;
/** The activity bar's column. The docks and the canvas share what is left of the shell. */
export const ACTIVITY_BAR_WIDTH = 48;
export const MAX_VIEW_PANEL_LAYOUTS = 200;

export interface PanelWidths {
  repositoryWidth: number;
  conversationWidth: number;
  filesWidth: number;
}

export const DEFAULT_PANEL_WIDTHS: PanelWidths = {
  repositoryWidth: 340,
  conversationWidth: 460,
  filesWidth: 420,
};

export type DockCapacity = 0 | 1 | 2;
export type LastOpenedPanel = 'repository' | 'dock' | 'files' | 'canvas';
/** What the side panel shows. Its open state keeps the stored name `repositoryOpen`. */
export type SideTab = 'files' | 'changes' | 'history' | 'reports';
const SIDE_TABS: readonly SideTab[] = ['files', 'changes', 'history', 'reports'];
export type Pane = 'conversation' | 'canvas' | 'side' | 'files';

export interface PanelLayout extends PanelWidths {
  repositoryOpen: boolean;
  conversationOpen: boolean;
  /** False while the user has hidden the canvas; see `isCanvasHidden` for when that holds. */
  canvasOpen: boolean;
  sideTab: SideTab;
  filesOpen: boolean;
  maximized: Pane | null;
  lastOpened: LastOpenedPanel;
}

// The conversation is the work; the side panel is opened when it is wanted.
export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  repositoryOpen: false,
  conversationOpen: true,
  canvasOpen: true,
  sideTab: 'changes',
  filesOpen: false,
  maximized: null,
  lastOpened: 'dock',
  ...DEFAULT_PANEL_WIDTHS,
};

/** Called once after loading a session and its device preferences. Artifact arrival is not navigation. */
export function initialSessionLayout(saved: PanelLayout | undefined, defaults: PanelLayout, hasCanvasContent: boolean): PanelLayout {
  return saved ?? { ...defaults, conversationOpen: true, canvasOpen: hasCanvasContent };
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** A panel can use 80% of the window; shellWidth excludes the activity bar. */
export function panelMaximumForWidth(shellWidth: number): number {
  return Math.floor((shellWidth + ACTIVITY_BAR_WIDTH) * 0.8);
}

// Persist the preference without a screen-dependent cap; resolve it against the live window.
export function clampPanelWidths(value: Partial<PanelWidths> | undefined, maximum = Number.MAX_SAFE_INTEGER): PanelWidths {
  return {
    filesWidth: clamp(
      Number.isFinite(value?.filesWidth) ? value!.filesWidth! : DEFAULT_PANEL_WIDTHS.filesWidth,
      FILE_VIEW_MIN_WIDTH, Math.max(FILE_VIEW_MIN_WIDTH, maximum),
    ),
    repositoryWidth: clamp(
      Number.isFinite(value?.repositoryWidth) ? value!.repositoryWidth! : DEFAULT_PANEL_WIDTHS.repositoryWidth,
      REPOSITORY_MIN_WIDTH,
      Math.max(REPOSITORY_MIN_WIDTH, maximum),
    ),
    conversationWidth: clamp(
      Number.isFinite(value?.conversationWidth) ? value!.conversationWidth! : DEFAULT_PANEL_WIDTHS.conversationWidth,
      CONVERSATION_MIN_WIDTH,
      Math.max(CONVERSATION_MIN_WIDTH, maximum),
    ),
  };
}

export function parsePanelWidths(value: string | null): PanelWidths {
  if (!value) return DEFAULT_PANEL_WIDTHS;
  try {
    const parsed = JSON.parse(value) as Partial<PanelWidths>;
    return clampPanelWidths(parsed);
  } catch {
    return DEFAULT_PANEL_WIDTHS;
  }
}

export function parseViewPanelLayouts(value: string | null): Record<string, PanelLayout> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { version?: unknown; layouts?: unknown };
    if (parsed.version !== 1 || !parsed.layouts || typeof parsed.layouts !== 'object' || Array.isArray(parsed.layouts)) return {};
    const result: Record<string, PanelLayout> = {};
    for (const [viewId, raw] of Object.entries(parsed.layouts).slice(-MAX_VIEW_PANEL_LAYOUTS)) {
      if (!/^[0-9a-f-]{36}$/i.test(viewId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const candidate = raw as Partial<PanelLayout> & { focusMode?: boolean };
      result[viewId] = {
        repositoryOpen: candidate.repositoryOpen !== false,
        conversationOpen: candidate.conversationOpen === true,
        // A layout that closed the conversation has nothing to give the canvas's width to.
        canvasOpen: candidate.canvasOpen !== false || candidate.conversationOpen !== true,
        sideTab: SIDE_TABS.includes(candidate.sideTab as SideTab) ? candidate.sideTab as SideTab : 'changes',
        filesOpen: candidate.filesOpen === true,
        maximized: candidate.maximized === 'canvas' || candidate.maximized === 'conversation' || candidate.maximized === 'side' || candidate.maximized === 'files'
          ? candidate.maximized : candidate.maximized === undefined && candidate.focusMode === true ? 'canvas' : null,
        lastOpened: candidate.lastOpened === 'dock' || candidate.lastOpened === 'files' || candidate.lastOpened === 'canvas' ? candidate.lastOpened : 'repository',
        ...clampPanelWidths(candidate),
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Re-adding a layout makes object order a small device-local recency list. The bound is enforced
 * while the app runs as well as while storage is parsed, so a long-lived tab cannot grow forever.
 */
export function storePanelLayout(
  layouts: Record<string, PanelLayout>,
  viewId: string,
  layout: PanelLayout,
): Record<string, PanelLayout> {
  const others = { ...layouts };
  delete others[viewId];
  return Object.fromEntries(
    Object.entries({ ...others, [viewId]: layout }).slice(-MAX_VIEW_PANEL_LAYOUTS),
  );
}

/** Keep layouts for views that remain known in any saved project scope. */
export function reconcilePanelLayouts(
  layouts: Record<string, PanelLayout>,
  availableSessionIds: readonly string[],
): Record<string, PanelLayout> {
  const available = new Set(availableSessionIds);
  const entries = Object.entries(layouts).filter(([viewId]) => available.has(viewId));
  if (entries.length === Object.keys(layouts).length && entries.length <= MAX_VIEW_PANEL_LAYOUTS) return layouts;
  return Object.fromEntries(entries.slice(-MAX_VIEW_PANEL_LAYOUTS));
}

/** The thresholds come from the live column minimums rather than a separate CSS breakpoint. */
export function dockCapacityForWidth(shellWidth: number): DockCapacity {
  const width = shellWidth - ACTIVITY_BAR_WIDTH;
  if (width >= REPOSITORY_MIN_WIDTH + CONVERSATION_MIN_WIDTH + CANVAS_MIN_WIDTH + PANEL_HANDLE_ALLOWANCE) return 2;
  // Either dock must fit: the conversation's minimum is wider than the repository's.
  if (width >= Math.max(REPOSITORY_MIN_WIDTH, CONVERSATION_MIN_WIDTH) + CANVAS_MIN_WIDTH + PANEL_HANDLE_ALLOWANCE) return 1;
  return 0;
}

/** Resolve temporary maximize and the narrow module without changing the saved desktop layout. */
export function visiblePanes(layout: PanelLayout, capacity: DockCapacity, shellWidth = Infinity) {
  if (layout.maximized) return {
    side: layout.maximized === 'side', files: layout.maximized === 'files',
    conversation: layout.maximized === 'conversation', canvas: layout.maximized === 'canvas',
  };
  if (capacity === 0) {
    if (layout.lastOpened === 'canvas' && layout.canvasOpen) return { side: false, files: false, conversation: false, canvas: true };
    const files = layout.filesOpen && layout.lastOpened === 'files';
    const side = !files && layout.repositoryOpen && (layout.lastOpened === 'repository' || !layout.conversationOpen);
    const conversation = !files && layout.conversationOpen && !side;
    return { side, files, conversation, canvas: !files && !side && !conversation };
  }
  const shown = { side: layout.repositoryOpen, files: layout.filesOpen,
    conversation: layout.conversationOpen, canvas: layout.canvasOpen || !layout.conversationOpen && !layout.filesOpen };
  if (shown.files) {
    const minimums = { side: REPOSITORY_MIN_WIDTH, files: FILE_VIEW_MIN_WIDTH, conversation: CONVERSATION_MIN_WIDTH, canvas: CANVAS_MIN_WIDTH };
    const order: Pane[] = layout.lastOpened === 'repository' ? ['canvas', 'conversation', 'files']
      : layout.lastOpened === 'dock' ? ['canvas', 'side', 'files']
      : layout.lastOpened === 'canvas' ? ['side', 'conversation', 'files'] : ['canvas', 'side', 'conversation'];
    const needed = () => Object.entries(shown).reduce((sum, [pane, open]) => sum + (open ? minimums[pane as Pane] + PANE_GUTTER : 0), 0);
    for (const pane of order) {
      if (needed() <= shellWidth) break;
      shown[pane] = false;
    }
  }
  return shown;
}

export function toggledMaximized(layout: PanelLayout, pane: Pane): PanelLayout {
  return { ...layout, maximized: layout.maximized === pane ? null : pane };
}

/** A docked pane alone already has the room; narrow modules keep consistent maximize controls. */
export function canMaximize(layout: PanelLayout, capacity: DockCapacity, shellWidth = Infinity): boolean {
  return capacity === 0 || Object.values(visiblePanes(layout, capacity, shellWidth)).filter(Boolean).length > 1;
}

export function isCanvasHidden(layout: PanelLayout, capacity: DockCapacity, shellWidth = Infinity): boolean {
  return !visiblePanes(layout, capacity, shellWidth).canvas;
}

/** Closing the conversation shows the canvas, and keeps it shown when the conversation returns. */
export function withoutConversation(layout: PanelLayout): PanelLayout {
  return { ...layout, conversationOpen: false, canvasOpen: true, maximized: null };
}

/**
 * Hiding the canvas opens the conversation to take its width. Showing it again keeps the
 * conversation and closes the side panel where it no longer fits beside the two.
 */
export function toggledCanvas(layout: PanelLayout, capacity: DockCapacity, sideFits = capacity === 2): PanelLayout {
  if (capacity === 0) return { ...layout, maximized: null, canvasOpen: true, conversationOpen: false, repositoryOpen: false, filesOpen: false, lastOpened: 'canvas' };
  if (isCanvasHidden(layout, capacity)) {
    return { ...layout, maximized: null, canvasOpen: true, ...(capacity === 1 || !sideFits ? { repositoryOpen: false } : {}) };
  }
  return { ...layout, canvasOpen: false, conversationOpen: true, maximized: null, lastOpened: 'dock' };
}

export interface ResolvedDockWidths extends PanelWidths {
  repositoryColumnWidth: number;
  conversationColumnWidth: number;
  filesColumnWidth: number;
}

/** Resolve all four surfaces together, keeping preferred widths for when the window widens. */
export function resolveDockWidths({ shellWidth, capacity, repositoryOpen, dockOpen, filesOpen = false,
  canvasShown = true, lastOpened, widths }: {
  shellWidth: number; capacity: DockCapacity; repositoryOpen: boolean; dockOpen: boolean;
  filesOpen?: boolean; canvasShown?: boolean; lastOpened: LastOpenedPanel; widths: PanelWidths;
}): ResolvedDockWidths {
  const preferred = clampPanelWidths(widths, panelMaximumForWidth(shellWidth));
  if (capacity === 0) return { ...preferred, repositoryColumnWidth: 0, conversationColumnWidth: 0, filesColumnWidth: 0 };
  const open = { side: repositoryOpen, files: filesOpen, conversation: dockOpen, canvas: canvasShown };
  const minimum = { side: REPOSITORY_MIN_WIDTH, files: FILE_VIEW_MIN_WIDTH, conversation: CONVERSATION_MIN_WIDTH, canvas: CANVAS_MIN_WIDTH };
  const size = { side: preferred.repositoryWidth, files: preferred.filesWidth, conversation: preferred.conversationWidth, canvas: CANVAS_MIN_WIDTH };
  const flex: Pane = canvasShown ? 'canvas' : dockOpen ? 'conversation' : filesOpen ? 'files' : 'side';
  const panes = (Object.keys(open) as Pane[]).filter(pane => open[pane]);
  const available = Math.max(0, shellWidth - panes.length * PANE_GUTTER);
  size[flex] = minimum[flex];
  let overflow = Math.max(0, panes.reduce((sum, pane) => sum + size[pane], 0) - available);
  const priority = lastOpened === 'repository' ? 'side' : lastOpened === 'dock' ? 'conversation' : lastOpened;
  const fixed = panes.filter(pane => pane !== flex).sort((a, b) => Number(a === priority) - Number(b === priority));
  for (const pane of fixed) {
    const shrink = Math.min(overflow, Math.max(0, size[pane] - minimum[pane]));
    size[pane] -= shrink;
    overflow -= shrink;
  }
  // The responsive visibility resolver normally prevents this; keep first measurement safe too.
  for (const pane of fixed) {
    const shrink = Math.min(overflow, size[pane]);
    size[pane] -= shrink;
    overflow -= shrink;
  }
  const column = (pane: Pane) => open[pane] && pane !== flex ? size[pane] + PANE_GUTTER : 0;
  return {
    repositoryWidth: size.side, conversationWidth: size.conversation, filesWidth: size.files,
    repositoryColumnWidth: column('side'), conversationColumnWidth: column('conversation'), filesColumnWidth: column('files'),
  };
}
