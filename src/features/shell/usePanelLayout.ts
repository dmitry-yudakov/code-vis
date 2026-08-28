'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  CANVAS_MIN_WIDTH,
  CONVERSATION_MAX_WIDTH,
  CONVERSATION_MIN_WIDTH,
  DEFAULT_PANEL_WIDTHS,
  PANEL_WIDTHS_STORAGE_KEY,
  REPOSITORY_MAX_WIDTH,
  REPOSITORY_MIN_WIDTH,
  clamp,
  dockCapacityForWidth,
  parsePanelWidths,
  resolveDockWidths,
  type DockCapacity,
  type LastOpenedPanel,
} from './panelLayout';

export interface PanelLayout {
  repositoryOpen: boolean;
  conversationOpen: boolean;
  historyOpen: boolean;
  inspectorOpen: boolean;
  focusMode: boolean;
  repositoryWidth: number;
  conversationWidth: number;
}

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

export function usePanelLayout(shellRef: RefObject<HTMLElement | null>, repositoryAvailable: boolean) {
  const { capacity: dockCapacity, width: shellWidth } = useDockCapacity(shellRef);
  const [layout, setLayout] = useState<PanelLayout>({
    repositoryOpen: true,
    conversationOpen: false,
    historyOpen: false,
    inspectorOpen: false,
    focusMode: false,
    ...DEFAULT_PANEL_WIDTHS,
  });
  const [lastOpened, setLastOpened] = useState<LastOpenedPanel>('repository');
  const [resize, setResize] = useState<{ panel: ResizePanel; startX: number; startWidth: number }>();
  const [storageReady, setStorageReady] = useState(false);
  const dockOpen = layout.conversationOpen || layout.historyOpen;

  useEffect(() => {
    try {
      const widths = parsePanelWidths(localStorage.getItem(PANEL_WIDTHS_STORAGE_KEY));
      setLayout((current) => ({ ...current, ...widths }));
    } catch {
      // Device preferences are optional; an unavailable localStorage keeps safe defaults.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(PANEL_WIDTHS_STORAGE_KEY, JSON.stringify({
        repositoryWidth: layout.repositoryWidth,
        conversationWidth: layout.conversationWidth,
      }));
    } catch {
      // Resizing remains usable when preference persistence is unavailable.
    }
  }, [layout.conversationWidth, layout.repositoryWidth, storageReady]);

  useEffect(() => {
    if (dockCapacity !== 1 || !repositoryAvailable || !layout.repositoryOpen || !dockOpen) return;
    setLayout((current) => lastOpened === 'dock'
      ? { ...current, repositoryOpen: false }
      : { ...current, conversationOpen: false, historyOpen: false });
  }, [dockCapacity, dockOpen, lastOpened, layout.repositoryOpen, repositoryAvailable]);

  useEffect(() => {
    if (!layout.inspectorOpen || dockCapacity !== 2 || !repositoryAvailable || !layout.repositoryOpen || !dockOpen) return;
    const needed = layout.repositoryWidth * 2 + layout.conversationWidth + CANVAS_MIN_WIDTH;
    if (needed > shellWidth) {
      setLayout((current) => ({ ...current, conversationOpen: false, historyOpen: false }));
    }
  }, [dockCapacity, dockOpen, layout.conversationWidth, layout.inspectorOpen, layout.repositoryOpen, layout.repositoryWidth, repositoryAvailable, shellWidth]);

  const openRepository = useCallback(() => {
    setLastOpened('repository');
    setLayout((current) => ({
      ...current,
      repositoryOpen: true,
      ...(dockCapacity === 1 ? { conversationOpen: false, historyOpen: false } : {}),
    }));
  }, [dockCapacity]);
  const closeRepository = useCallback(() => setLayout((current) => ({ ...current, repositoryOpen: false })), []);
  const toggleRepository = useCallback(() => {
    if (layout.repositoryOpen) closeRepository();
    else openRepository();
  }, [closeRepository, layout.repositoryOpen, openRepository]);

  const openConversation = useCallback(() => {
    setLastOpened('dock');
    setLayout((current) => ({
      ...current,
      repositoryOpen: dockCapacity === 1 ? false : current.repositoryOpen,
      conversationOpen: true,
      historyOpen: false,
    }));
  }, [dockCapacity]);
  const closeConversation = useCallback(() => setLayout((current) => ({ ...current, conversationOpen: false })), []);
  const openHistory = useCallback(() => {
    setLastOpened('dock');
    setLayout((current) => ({
      ...current,
      repositoryOpen: dockCapacity === 1 ? false : current.repositoryOpen,
      conversationOpen: false,
      historyOpen: true,
    }));
  }, [dockCapacity]);
  const closeHistory = useCallback(() => setLayout((current) => ({ ...current, historyOpen: false })), []);
  const setInspectorOpen = useCallback((inspectorOpen: boolean) => {
    setLayout((current) => current.inspectorOpen === inspectorOpen ? current : { ...current, inspectorOpen });
  }, []);
  const toggleFocusMode = useCallback(() => setLayout((current) => ({ ...current, focusMode: !current.focusMode })), []);

  const panelMaximum = useCallback((panel: ResizePanel) => {
    if (dockCapacity === 0 || !shellWidth) return panel === 'repository' ? REPOSITORY_MAX_WIDTH : CONVERSATION_MAX_WIDTH;
    if (panel === 'repository') {
      const dockMinimum = dockOpen ? CONVERSATION_MIN_WIDTH : 0;
      const room = shellWidth - CANVAS_MIN_WIDTH - dockMinimum;
      return Math.max(REPOSITORY_MIN_WIDTH, Math.min(REPOSITORY_MAX_WIDTH, layout.inspectorOpen && dockCapacity === 2 ? Math.floor(room / 2) : room));
    }
    const repositoryMinimum = repositoryAvailable && layout.repositoryOpen ? REPOSITORY_MIN_WIDTH : 0;
    return Math.max(CONVERSATION_MIN_WIDTH, Math.min(CONVERSATION_MAX_WIDTH, shellWidth - CANVAS_MIN_WIDTH - repositoryMinimum));
  }, [dockCapacity, dockOpen, layout.inspectorOpen, layout.repositoryOpen, repositoryAvailable, shellWidth]);

  const setPanelWidth = useCallback((panel: ResizePanel, width: number) => {
    const minimum = panel === 'repository' ? REPOSITORY_MIN_WIDTH : CONVERSATION_MIN_WIDTH;
    const maximum = panelMaximum(panel);
    setLayout((current) => ({
      ...current,
      [panel === 'repository' ? 'repositoryWidth' : 'conversationWidth']: clamp(width, minimum, maximum),
    }));
  }, [panelMaximum]);

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
    inspectorOpen: layout.inspectorOpen,
    lastOpened,
    widths: layout,
  }), [dockCapacity, dockOpen, lastOpened, layout, repositoryAvailable, shellWidth]);

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
    closeConversation,
    openHistory,
    closeHistory,
    setInspectorOpen,
    toggleFocusMode,
    beginResize,
    resizeByKeyboard,
  };
}
