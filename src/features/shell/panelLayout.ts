export const PANEL_WIDTHS_STORAGE_KEY = 'code-ai:panel-widths';
export const REPOSITORY_MIN_WIDTH = 268;
export const REPOSITORY_MAX_WIDTH = 480;
export const CONVERSATION_MIN_WIDTH = 320;
export const CONVERSATION_MAX_WIDTH = 560;
export const CANVAS_MIN_WIDTH = 360;
export const PANEL_HANDLE_ALLOWANCE = 12;

export interface PanelWidths {
  repositoryWidth: number;
  conversationWidth: number;
}

export const DEFAULT_PANEL_WIDTHS: PanelWidths = {
  repositoryWidth: 340,
  conversationWidth: 460,
};

export type DockCapacity = 0 | 1 | 2;
export type LastOpenedPanel = 'repository' | 'dock';

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampPanelWidths(value: Partial<PanelWidths> | undefined): PanelWidths {
  return {
    repositoryWidth: clamp(
      Number.isFinite(value?.repositoryWidth) ? value!.repositoryWidth! : DEFAULT_PANEL_WIDTHS.repositoryWidth,
      REPOSITORY_MIN_WIDTH,
      REPOSITORY_MAX_WIDTH,
    ),
    conversationWidth: clamp(
      Number.isFinite(value?.conversationWidth) ? value!.conversationWidth! : DEFAULT_PANEL_WIDTHS.conversationWidth,
      CONVERSATION_MIN_WIDTH,
      CONVERSATION_MAX_WIDTH,
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

/** The thresholds come from the live column minimums rather than a separate CSS breakpoint. */
export function dockCapacityForWidth(width: number): DockCapacity {
  if (width >= REPOSITORY_MIN_WIDTH + CONVERSATION_MIN_WIDTH + CANVAS_MIN_WIDTH + PANEL_HANDLE_ALLOWANCE) return 2;
  if (width >= REPOSITORY_MIN_WIDTH + CANVAS_MIN_WIDTH + PANEL_HANDLE_ALLOWANCE) return 1;
  return 0;
}

export interface ResolvedDockWidths extends PanelWidths {
  repositoryColumnWidth: number;
  conversationColumnWidth: number;
}

/**
 * Resolve persisted preferences against the current shell without ever stealing the canvas
 * minimum. Preferences stay untouched, so widening the window restores the requested widths.
 */
export function resolveDockWidths({
  shellWidth,
  capacity,
  repositoryOpen,
  dockOpen,
  inspectorOpen,
  lastOpened,
  widths,
}: {
  shellWidth: number;
  capacity: DockCapacity;
  repositoryOpen: boolean;
  dockOpen: boolean;
  inspectorOpen: boolean;
  lastOpened: LastOpenedPanel;
  widths: PanelWidths;
}): ResolvedDockWidths {
  let repositoryWidth = clampPanelWidths(widths).repositoryWidth;
  let conversationWidth = clampPanelWidths(widths).conversationWidth;
  if (capacity === 0) {
    return { repositoryWidth, conversationWidth, repositoryColumnWidth: 0, conversationColumnWidth: 0 };
  }

  const repositoryVisible = repositoryOpen;
  const dockVisible = dockOpen;
  const available = Math.max(0, shellWidth - CANVAS_MIN_WIDTH);

  if (repositoryVisible && dockVisible) {
    let overflow = Math.max(0, repositoryWidth + conversationWidth - available);
    const shrinkRepository = () => {
      const amount = Math.min(overflow, repositoryWidth - REPOSITORY_MIN_WIDTH);
      repositoryWidth -= amount;
      overflow -= amount;
    };
    const shrinkConversation = () => {
      const amount = Math.min(overflow, conversationWidth - CONVERSATION_MIN_WIDTH);
      conversationWidth -= amount;
      overflow -= amount;
    };
    // Preserve the most recently opened surface where possible.
    if (lastOpened === 'dock') {
      shrinkRepository();
      shrinkConversation();
    } else {
      shrinkConversation();
      shrinkRepository();
    }
  } else if (repositoryVisible) {
    repositoryWidth = Math.min(repositoryWidth, available);
  } else if (dockVisible) {
    conversationWidth = Math.min(conversationWidth, available);
  }

  const conversationColumnWidth = dockVisible ? conversationWidth : 0;
  const repositoryRoom = Math.max(0, available - conversationColumnWidth);
  const repositoryColumnWidth = repositoryVisible
    ? inspectorOpen && capacity === 2
      ? Math.min(repositoryWidth * 2, repositoryRoom)
      : Math.min(repositoryWidth, repositoryRoom)
    : 0;

  return { repositoryWidth, conversationWidth, repositoryColumnWidth, conversationColumnWidth };
}
