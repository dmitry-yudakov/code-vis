'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  CANVAS_MIN_WIDTH,
  CONVERSATION_MAX_WIDTH,
  CONVERSATION_MIN_WIDTH,
  DEFAULT_PANEL_LAYOUT,
  PANEL_WIDTHS_STORAGE_KEY,
  VIEW_PANEL_LAYOUTS_STORAGE_KEY,
  REPOSITORY_MAX_WIDTH,
  REPOSITORY_MIN_WIDTH,
  clamp,
  dockCapacityForWidth,
  parsePanelWidths,
  parseViewPanelLayouts,
  reconcilePanelLayouts,
  resolveDockWidths,
  storePanelLayout,
  type DockCapacity,
  type PanelLayout,
  type SideTab,
} from './panelLayout';

type ResizePanel = 'repository' | 'conversation';

export function useDockCapacity(shellRef: RefObject<HTMLElement | null>): { capacity: DockCapacity; width: number } {
  const [measurement, setMeasurement] = useState<{ capacity: DockCapacity; width: number }>({ capacity: 2, width: 0 });
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const width = shell.getBoundingClientRect().width;
      setMeasurement((current) => current.width === width
        ? current
        : { width, capacity: dockCapacityForWidth(width) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [shellRef]);
  return measurement;
}

export function usePanelLayout(shellRef: RefObject<HTMLElement | null>, repositoryAvailable: boolean, viewId?: string) {
  const { capacity: dockCapacity, width: shellWidth } = useDockCapacity(shellRef);
  const [layouts, setLayouts] = useState<Record<string, PanelLayout>>({});
  const [defaultLayout, setDefaultLayout] = useState(DEFAULT_PANEL_LAYOUT);
  const [resize, setResize] = useState<{ panel: ResizePanel; startX: number; startWidth: number }>();
  const [storageReady, setStorageReady] = useState(false);
  const layout = viewId ? layouts[viewId] || defaultLayout : defaultLayout;
  const lastOpened = layout.lastOpened;
  const setLayout = useCallback((update: (current: PanelLayout) => PanelLayout) => {
    if (!viewId) {
      setDefaultLayout(update);
      return;
    }
    setLayouts((current) => {
      const prior = current[viewId] || defaultLayout;
      const next = update(prior);
      return next === prior ? current : storePanelLayout(current, viewId, next);
    });
  }, [defaultLayout, viewId]);
  const dockOpen = layout.conversationOpen;
  // The diff inspector belongs to the changes; history never widens the panel.
  const inspectorOpen = layout.inspectorOpen && layout.sideTab === 'changes';

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
    if (!storageReady) return;
    try {
      localStorage.setItem(VIEW_PANEL_LAYOUTS_STORAGE_KEY, JSON.stringify({ version: 1, layouts }));
      localStorage.setItem(PANEL_WIDTHS_STORAGE_KEY, JSON.stringify({
        repositoryWidth: layout.repositoryWidth,
        conversationWidth: layout.conversationWidth,
      }));
    } catch {
      // Resizing remains usable when preference persistence is unavailable.
    }
  }, [layout.conversationWidth, layout.repositoryWidth, layouts, storageReady]);

  useEffect(() => {
    if (dockCapacity !== 1 || !repositoryAvailable || !layout.repositoryOpen || !dockOpen) return;
    setLayout((current) => current.lastOpened === 'dock'
      ? { ...current, repositoryOpen: false }
      : { ...current, conversationOpen: false });
  }, [dockCapacity, dockOpen, layout.repositoryOpen, repositoryAvailable, setLayout]);

  useEffect(() => {
    if (!inspectorOpen || dockCapacity !== 2 || !repositoryAvailable || !layout.repositoryOpen || !dockOpen) return;
    const needed = layout.repositoryWidth * 2 + layout.conversationWidth + CANVAS_MIN_WIDTH;
    if (needed > shellWidth) {
      setLayout((current) => ({ ...current, conversationOpen: false }));
    }
  }, [dockCapacity, dockOpen, layout.conversationWidth, inspectorOpen, layout.repositoryOpen, layout.repositoryWidth, repositoryAvailable, setLayout, shellWidth]);

  const openSide = useCallback((sideTab: SideTab) => {
    setLayout((current) => ({
      ...current,
      lastOpened: 'repository',
      repositoryOpen: true,
      sideTab,
      ...(dockCapacity === 1 ? { conversationOpen: false } : {}),
    }));
  }, [dockCapacity, setLayout]);
  const closeRepository = useCallback(() => setLayout((current) => ({ ...current, repositoryOpen: false })), [setLayout]);
  // Each entry point toggles its own tab: a second press closes the panel, a press on the other tab switches.
  const toggleSide = useCallback((sideTab: SideTab) => {
    if (layout.repositoryOpen && layout.sideTab === sideTab) closeRepository();
    else openSide(sideTab);
  }, [closeRepository, layout.repositoryOpen, layout.sideTab, openSide]);
  const openRepository = useCallback(() => openSide('changes'), [openSide]);
  const toggleRepository = useCallback(() => toggleSide('changes'), [toggleSide]);
  const toggleHistory = useCallback(() => toggleSide('history'), [toggleSide]);

  const openConversation = useCallback(() => {
    setLayout((current) => ({
      ...current,
      lastOpened: 'dock',
      repositoryOpen: dockCapacity === 1 ? false : current.repositoryOpen,
      conversationOpen: true,
    }));
  }, [dockCapacity, setLayout]);
  const openConversationFor = useCallback((targetViewId: string) => {
    setLayouts((current) => {
      const prior = current[targetViewId] || defaultLayout;
      return storePanelLayout(current, targetViewId, {
        ...prior,
        lastOpened: 'dock',
        repositoryOpen: dockCapacity === 1 ? false : prior.repositoryOpen,
        conversationOpen: true,
      });
    });
  }, [defaultLayout, dockCapacity]);
  const reconcile = useCallback((sessionIds: readonly string[]) => {
    setLayouts((current) => reconcilePanelLayouts(current, sessionIds));
  }, []);
  const closeConversation = useCallback(() => setLayout((current) => ({ ...current, conversationOpen: false })), [setLayout]);
  const setInspectorOpen = useCallback((inspectorOpen: boolean) => {
    setLayout((current) => current.inspectorOpen === inspectorOpen ? current : { ...current, inspectorOpen });
  }, [setLayout]);
  const toggleFocusMode = useCallback(() => setLayout((current) => ({ ...current, focusMode: !current.focusMode })), [setLayout]);

  const panelMaximum = useCallback((panel: ResizePanel) => {
    if (dockCapacity === 0 || !shellWidth) return panel === 'repository' ? REPOSITORY_MAX_WIDTH : CONVERSATION_MAX_WIDTH;
    if (panel === 'repository') {
      const dockMinimum = dockOpen ? CONVERSATION_MIN_WIDTH : 0;
      const room = shellWidth - CANVAS_MIN_WIDTH - dockMinimum;
      return Math.max(REPOSITORY_MIN_WIDTH, Math.min(REPOSITORY_MAX_WIDTH, inspectorOpen && dockCapacity === 2 ? Math.floor(room / 2) : room));
    }
    const repositoryMinimum = repositoryAvailable && layout.repositoryOpen ? REPOSITORY_MIN_WIDTH : 0;
    return Math.max(CONVERSATION_MIN_WIDTH, Math.min(CONVERSATION_MAX_WIDTH, shellWidth - CANVAS_MIN_WIDTH - repositoryMinimum));
  }, [dockCapacity, dockOpen, inspectorOpen, layout.repositoryOpen, repositoryAvailable, shellWidth]);

  const setPanelWidth = useCallback((panel: ResizePanel, width: number) => {
    const minimum = panel === 'repository' ? REPOSITORY_MIN_WIDTH : CONVERSATION_MIN_WIDTH;
    const maximum = panelMaximum(panel);
    setLayout((current) => ({
      ...current,
      [panel === 'repository' ? 'repositoryWidth' : 'conversationWidth']: clamp(width, minimum, maximum),
    }));
  }, [panelMaximum, setLayout]);

  useEffect(() => {
    if (!resize) return;
    const move = (event: PointerEvent) => {
      const delta = event.clientX - resize.startX;
      setPanelWidth(resize.panel, resize.startWidth + (resize.panel === 'repository' ? delta : -delta));
    };
    const finish = () => setResize(undefined);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    document.body.classList.add('panel-resizing');
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      document.body.classList.remove('panel-resizing');
    };
  }, [resize, setPanelWidth]);

  const beginResize = useCallback((panel: ResizePanel, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setResize({
      panel,
      startX: event.clientX,
      startWidth: panel === 'repository' ? layout.repositoryWidth : layout.conversationWidth,
    });
  }, [layout.conversationWidth, layout.repositoryWidth]);

  const resizeByKeyboard = useCallback((panel: ResizePanel, event: React.KeyboardEvent<HTMLElement>) => {
    const minimum = panel === 'repository' ? REPOSITORY_MIN_WIDTH : CONVERSATION_MIN_WIDTH;
    const maximum = panelMaximum(panel);
    const current = panel === 'repository' ? layout.repositoryWidth : layout.conversationWidth;
    const step = event.shiftKey ? 24 : 8;
    let next: number | undefined;
    if (event.key === 'Home') next = minimum;
    if (event.key === 'End') next = maximum;
    if (event.key === 'ArrowLeft') next = current + (panel === 'repository' ? -step : step);
    if (event.key === 'ArrowRight') next = current + (panel === 'repository' ? step : -step);
    if (next === undefined) return;
    event.preventDefault();
    setPanelWidth(panel, next);
  }, [layout.conversationWidth, layout.repositoryWidth, panelMaximum, setPanelWidth]);

  const resolved = useMemo(() => resolveDockWidths({
    shellWidth,
    capacity: dockCapacity,
    repositoryOpen: repositoryAvailable && layout.repositoryOpen && !layout.focusMode,
    dockOpen: dockOpen && !layout.focusMode,
    inspectorOpen,
    lastOpened,
    widths: layout,
  }), [dockCapacity, dockOpen, inspectorOpen, lastOpened, layout, repositoryAvailable, shellWidth]);

  const shellStyle = {
    '--repository-width': `${layout.repositoryWidth}px`,
    '--conversation-width': `${layout.conversationWidth}px`,
    '--repository-panel-width': `${resolved.repositoryWidth}px`,
    '--conversation-panel-width': `${resolved.conversationWidth}px`,
    '--repository-column-width': `${resolved.repositoryColumnWidth}px`,
    '--conversation-column-width': `${resolved.conversationColumnWidth}px`,
  } as CSSProperties;

  return {
    ...layout,
    dockCapacity,
    shellStyle,
    repositoryPanelWidth: resolved.repositoryWidth,
    conversationPanelWidth: resolved.conversationWidth,
    repositoryMaximum: panelMaximum('repository'),
    conversationMaximum: panelMaximum('conversation'),
    openRepository,
    closeRepository,
    toggleRepository,
    openConversation,
    openConversationFor,
    reconcile,
    closeConversation,
    toggleHistory,
    selectSideTab: openSide,
    setInspectorOpen,
    toggleFocusMode,
    beginResize,
    resizeByKeyboard,
  };
}
