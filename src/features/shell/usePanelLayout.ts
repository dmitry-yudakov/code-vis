'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  ACTIVITY_BAR_WIDTH,
  CANVAS_MIN_WIDTH,
  CONVERSATION_MIN_WIDTH,
  FILE_VIEW_MIN_WIDTH,
  DEFAULT_PANEL_LAYOUT,
  PANEL_WIDTHS_STORAGE_KEY,
  PANE_GUTTER,
  VIEW_PANEL_LAYOUTS_STORAGE_KEY,
  REPOSITORY_MIN_WIDTH,
  clamp,
  dockCapacityForWidth,
  isCanvasHidden,
  initialSessionLayout,
  panelMaximumForWidth,
  parsePanelWidths,
  parseViewPanelLayouts,
  reconcilePanelLayouts,
  resolveDockWidths,
  storePanelLayout,
  toggledCanvas,
  withoutConversation,
  visiblePanes,
  toggledMaximized,
  canMaximize,
  type Pane,
  type DockCapacity,
  type PanelLayout,
  type ProjectSideTab,
  type SideTab,
} from './panelLayout';

type ResizePanel = 'repository' | 'conversation' | 'files';
const WIDTH_KEYS = { repository: 'repositoryWidth', conversation: 'conversationWidth', files: 'filesWidth' } as const;
const MIN_WIDTHS = { repository: REPOSITORY_MIN_WIDTH, conversation: CONVERSATION_MIN_WIDTH, files: FILE_VIEW_MIN_WIDTH };

/** `width` is what the panels and the canvas share: the shell less its activity bar. */
export function useDockCapacity(shellRef: RefObject<HTMLElement | null>): { capacity: DockCapacity; width: number } {
  const [measurement, setMeasurement] = useState<{ capacity: DockCapacity; width: number }>({ capacity: 2, width: 0 });
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const shellWidth = shell.getBoundingClientRect().width;
      const width = Math.max(0, shellWidth - ACTIVITY_BAR_WIDTH);
      setMeasurement((current) => current.width === width
        ? current
        : { width, capacity: dockCapacityForWidth(shellWidth) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [shellRef]);
  return measurement;
}

export function usePanelLayout(shellRef: RefObject<HTMLElement | null>, repositoryAvailable: boolean, viewId?: string,
  hasCanvasContent?: boolean, project?: { scope: string; sideTab?: ProjectSideTab }) {
  const { capacity: dockCapacity, width: shellWidth } = useDockCapacity(shellRef);
  const [layouts, setLayouts] = useState<Record<string, PanelLayout>>({});
  const [defaultLayout, setDefaultLayout] = useState(DEFAULT_PANEL_LAYOUT);
  const [projectLayouts, setProjectLayouts] = useState<Record<string, PanelLayout>>({});
  const projectScope = project?.scope;
  const projectSideTab = project?.sideTab ?? 'files';
  const projectLayout = useMemo<PanelLayout>(() => ({
    ...defaultLayout, repositoryOpen: true, conversationOpen: false, canvasOpen: true,
    filesOpen: false, maximized: null, lastOpened: 'repository',
    ...(projectScope ? projectLayouts[projectScope] : undefined),
    sideTab: projectSideTab,
  }), [defaultLayout, projectScope, projectLayouts, projectSideTab]);
  const [resize, setResize] = useState<{ panel: ResizePanel; startX: number; startWidth: number }>();
  const [storageReady, setStorageReady] = useState(false);
  const layout = projectScope ? projectLayout : viewId ? layouts[viewId] || defaultLayout : defaultLayout;
  const lastOpened = layout.lastOpened;
  const setLayout = useCallback((update: (current: PanelLayout) => PanelLayout) => {
    if (projectScope) {
      setProjectLayouts(current => ({
        ...current,
        [projectScope]: update({ ...(current[projectScope] ?? projectLayout), sideTab: projectSideTab }),
      }));
      return;
    }
    if (!viewId) {
      setDefaultLayout(update);
      return;
    }
    setLayouts((current) => {
      const prior = current[viewId] || defaultLayout;
      const next = update(prior);
      return next === prior ? current : storePanelLayout(current, viewId, next);
    });
  }, [defaultLayout, projectLayout, projectScope, projectSideTab, viewId]);
  const shown = visiblePanes(layout, dockCapacity, shellWidth);
  const sideShown = repositoryAvailable && shown.side;
  const conversationShown = shown.conversation;
  const filesShown = shown.files;
  const canvasHidden = !shown.canvas;
  const dockOpen = conversationShown;
  const contentWidth = Math.max(0, shellWidth - Object.values(shown).filter(Boolean).length * PANE_GUTTER);

  useEffect(() => {
    try {
      const widths = parsePanelWidths(localStorage.getItem(PANEL_WIDTHS_STORAGE_KEY));
      setDefaultLayout((current) => ({ ...current, ...widths }));
      setLayouts(parseViewPanelLayouts(localStorage.getItem(VIEW_PANEL_LAYOUTS_STORAGE_KEY)));
    } catch {
      // Device preferences are optional; an unavailable localStorage keeps safe defaults.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady || !viewId || hasCanvasContent === undefined) return;
    setLayouts((current) => current[viewId] ? current
      : storePanelLayout(current, viewId, initialSessionLayout(undefined, defaultLayout, hasCanvasContent)));
  }, [defaultLayout, hasCanvasContent, storageReady, viewId]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(VIEW_PANEL_LAYOUTS_STORAGE_KEY, JSON.stringify({ version: 1, layouts }));
      localStorage.setItem(PANEL_WIDTHS_STORAGE_KEY, JSON.stringify({
        repositoryWidth: layout.repositoryWidth,
        conversationWidth: layout.conversationWidth,
        filesWidth: layout.filesWidth,
      }));
    } catch {
      // Resizing remains usable when preference persistence is unavailable.
    }
  }, [layout.conversationWidth, layout.repositoryWidth, layout.filesWidth, layouts, storageReady]);

  // Without the canvas both panels fit in one dock's band, so neither has to give way.
  useEffect(() => {
    if (layout.filesOpen || layout.maximized || dockCapacity !== 1 || canvasHidden || !repositoryAvailable || !layout.repositoryOpen || !dockOpen) return;
    setLayout((current) => current.lastOpened === 'dock'
      ? { ...current, repositoryOpen: false }
      : withoutConversation(current));
  }, [layout.filesOpen, layout.maximized, canvasHidden, dockCapacity, dockOpen, layout.repositoryOpen, repositoryAvailable, setLayout]);

  // Explicit navigation leaves maximize and reveals its destination.
  const openSide = useCallback((sideTab: SideTab) => {
    setLayout((current) => {
      const next: PanelLayout = { ...current, lastOpened: 'repository', repositoryOpen: true, sideTab, maximized: null };
      return !current.filesOpen && (dockCapacity === 0 || dockCapacity === 1 && !isCanvasHidden(next, dockCapacity)) ? withoutConversation(next) : next;
    });
  }, [dockCapacity, setLayout]);
  const closeRepository = useCallback(() => setLayout((current) => ({ ...current, repositoryOpen: false, maximized: null })), [setLayout]);
  // Each view toggles itself: a second press closes the panel, a press on another view switches.
  // `shownTab` is the view on screen, which differs from the stored one where Reports is unavailable.
  const toggleSide = useCallback((sideTab: SideTab, shownTab: SideTab = layout.sideTab) => {
    if (sideShown && shownTab === sideTab) closeRepository();
    else openSide(sideTab);
  }, [closeRepository, layout.sideTab, openSide, sideShown]);
  const openRepository = useCallback(() => openSide('changes'), [openSide]);

  const openConversation = useCallback(() => {
    setLayout((current) => {
      const next: PanelLayout = { ...current, lastOpened: 'dock', conversationOpen: true, maximized: null };
      return !current.filesOpen && (dockCapacity === 0 || dockCapacity === 1 && !isCanvasHidden(next, dockCapacity)) ? { ...next, repositoryOpen: false } : next;
    });
  }, [dockCapacity, setLayout]);
  const openConversationFor = useCallback((targetViewId: string, hasCanvasContent = false) => {
    setLayouts((current) => {
      const prior = initialSessionLayout(current[targetViewId], defaultLayout, hasCanvasContent);
      return storePanelLayout(current, targetViewId, {
        ...prior,
        lastOpened: 'dock',
        repositoryOpen: dockCapacity <= 1 ? false : prior.repositoryOpen,
        maximized: null,
        conversationOpen: true,
      });
    });
  }, [defaultLayout, dockCapacity]);
  const reconcile = useCallback((sessionIds: readonly string[]) => {
    setLayouts((current) => reconcilePanelLayouts(current, sessionIds));
  }, []);
  const closeConversation = useCallback(() => setLayout(withoutConversation), [setLayout]);
  const toggleConversation = useCallback(() => {
    if (conversationShown) closeConversation();
    else openConversation();
  }, [closeConversation, conversationShown, openConversation]);
  const openFiles = useCallback((emptyPane = false) => setLayout(current => {
    const next: PanelLayout = { ...current, filesOpen: true,
      canvasOpen: projectScope ? false : current.canvasOpen,
      maximized: current.maximized === 'files' ? 'files' : null,
      lastOpened: current.maximized === 'files' ? current.lastOpened : 'files' };
    // Revealing a file should give it reading room; subsequent tabs keep a manual resize.
    if (dockCapacity > 0 && shellWidth > 0 && (emptyPane || !visiblePanes(current, dockCapacity, shellWidth).files)) {
      const panes = visiblePanes(next, dockCapacity, shellWidth);
      const share = repositoryAvailable && panes.side && panes.conversation ? .35 : .5;
      next.filesWidth = Math.max(current.filesWidth, Math.ceil(shellWidth * share));
      // Without canvas/chat the file is flexible, so make its room in the fixed side column.
      if (repositoryAvailable && panes.side && !panes.conversation && !panes.canvas) {
        next.repositoryWidth = Math.min(current.repositoryWidth,
          Math.max(REPOSITORY_MIN_WIDTH, shellWidth - next.filesWidth - 2 * PANE_GUTTER));
      }
    }
    return next;
  }), [dockCapacity, projectScope, repositoryAvailable, setLayout, shellWidth]);
  const closeFiles = useCallback(() => setLayout(current => ({ ...current, filesOpen: false,
    canvasOpen: projectScope ? true : current.canvasOpen, maximized: null })), [projectScope, setLayout]);
  const toggleFiles = useCallback(() => { if (filesShown) closeFiles(); else openFiles(); }, [filesShown, closeFiles, openFiles]);
  const toggleCanvas = useCallback(() => setLayout(current => {
    if (current.filesOpen) return { ...current, canvasOpen: canvasHidden, maximized: null, lastOpened: canvasHidden ? 'canvas' : current.lastOpened };
    return toggledCanvas(current, dockCapacity);
  }), [canvasHidden, dockCapacity, setLayout]);
  const showCanvas = useCallback(() => setLayout(current => {
    if (current.filesOpen) return { ...current, canvasOpen: true, maximized: null, lastOpened: 'canvas' };
    const next = { ...current, maximized: null };
    return isCanvasHidden(next, dockCapacity) ? toggledCanvas(next, dockCapacity) : next;
  }), [dockCapacity, setLayout]);
  const toggleMaximized = useCallback((pane: Pane) => setLayout((current) => toggledMaximized(current, pane)), [setLayout]);
  useEffect(() => {
    if (!layout.maximized) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
        || [...document.querySelectorAll('[role="dialog"]')].some(element => element.getClientRects().length > 0
          && getComputedStyle(element).visibility !== 'hidden')) return;
      setLayout((current) => ({ ...current, maximized: null }));
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [layout.maximized, setLayout]);

  const resolved = useMemo(() => resolveDockWidths({
    shellWidth,
    capacity: dockCapacity,
    repositoryOpen: sideShown,
    dockOpen: conversationShown,
    canvasShown: !canvasHidden,
    filesOpen: filesShown,
    lastOpened,
    widths: layout,
  }), [canvasHidden, dockCapacity, conversationShown, filesShown, lastOpened, layout, sideShown, shellWidth]);

  const panelMaximum = useCallback((panel: ResizePanel) => {
    const minimum = MIN_WIDTHS[panel];
    const maximum = Math.max(minimum, panelMaximumForWidth(shellWidth));
    if (dockCapacity === 0 || !shellWidth) return maximum;
    const others = (panel !== 'repository' && sideShown ? REPOSITORY_MIN_WIDTH : 0)
      + (panel !== 'files' && filesShown ? FILE_VIEW_MIN_WIDTH : 0)
      + (panel !== 'conversation' && conversationShown ? CONVERSATION_MIN_WIDTH : 0)
      + (!canvasHidden ? CANVAS_MIN_WIDTH : 0);
    return Math.max(minimum, Math.min(maximum, contentWidth - others));
  }, [canvasHidden, contentWidth, conversationShown, dockCapacity, filesShown, sideShown, shellWidth]);

  const setPanelWidth = useCallback((panel: ResizePanel, width: number) => {
    const minimum = MIN_WIDTHS[panel];
    const maximum = panelMaximum(panel);
    setLayout((current) => ({
      ...current,
      [WIDTH_KEYS[panel]]: clamp(width, minimum, maximum),
    }));
  }, [panelMaximum, setLayout]);

  useEffect(() => {
    if (!resize) return;
    const move = (event: PointerEvent) => {
      const delta = event.clientX - resize.startX;
      setPanelWidth(resize.panel, resize.startWidth + (resize.panel === 'conversation' ? -delta : delta));
    };
    const finish = () => setResize(undefined);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    window.addEventListener('blur', finish, { once: true });
    document.body.classList.add('panel-resizing');
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      document.body.classList.remove('panel-resizing');
    };
  }, [resize, setPanelWidth]);

  const beginResize = useCallback((panel: ResizePanel, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setResize({
      panel,
      startX: event.clientX,
      startWidth: resolved[WIDTH_KEYS[panel]],
    });
  }, [resolved]);

  const resizeByKeyboard = useCallback((panel: ResizePanel, event: React.KeyboardEvent<HTMLElement>) => {
    const minimum = MIN_WIDTHS[panel];
    const maximum = panelMaximum(panel);
    const current = resolved[WIDTH_KEYS[panel]];
    const step = event.shiftKey ? 24 : 8;
    let next: number | undefined;
    if (event.key === 'Home') next = minimum;
    if (event.key === 'End') next = maximum;
    if (event.key === 'ArrowLeft') next = current + (panel === 'conversation' ? step : -step);
    if (event.key === 'ArrowRight') next = current + (panel === 'conversation' ? -step : step);
    if (next === undefined) return;
    event.preventDefault();
    setPanelWidth(panel, next);
  }, [resolved, panelMaximum, setPanelWidth]);

  const shellStyle = {
    '--files-column-width': canvasHidden && !conversationShown && filesShown ? 'minmax(0, 1fr)' : `${resolved.filesColumnWidth}px`,
    '--pane-gutter': `${dockCapacity > 0 ? PANE_GUTTER : 0}px`,
    '--repository-width': `${resolved.repositoryWidth}px`,
    '--conversation-width': `${resolved.conversationWidth}px`,
    '--repository-panel-width': `${resolved.repositoryWidth}px`,
    '--conversation-panel-width': `${resolved.conversationWidth}px`,
    '--repository-column-width': `${resolved.repositoryColumnWidth}px`,
    '--conversation-column-width': `${resolved.conversationColumnWidth}px`,
    '--conversation-grid-column': canvasHidden && conversationShown ? 'minmax(0, 1fr)' : `${resolved.conversationColumnWidth}px`,
  } as CSSProperties;

  return {
    ...layout,
    dockCapacity,
    shellStyle,
    repositoryPanelWidth: resolved.repositoryWidth,
    conversationPanelWidth: resolved.conversationWidth,
    repositoryMaximum: panelMaximum('repository'),
    conversationMaximum: panelMaximum('conversation'),
    filesShown,
    filesPanelWidth: resolved.filesWidth,
    filesMaximum: panelMaximum('files'),
    openFiles, closeFiles, toggleFiles,
    sideShown,
    canvasHidden,
    conversationShown,
    openRepository,
    closeRepository,
    toggleSide,
    openConversation,
    openConversationFor,
    reconcile,
    closeConversation,
    toggleConversation,
    toggleCanvas,
    showCanvas,
    selectSideTab: openSide,
    toggleMaximized,
    canMaximize: canMaximize(layout, dockCapacity, shellWidth),
    beginResize,
    resizeByKeyboard,
  };
}
