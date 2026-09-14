'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultImmersiveLayout, IMMERSIVE_LAYOUT_KEY, MAX_IMMERSIVE_LAYOUTS, PANEL_SIZES, parseImmersiveLayouts, placeImmersivePanel, updateImmersivePanel,
  type ImmersiveLayout, type ImmersiveLayouts, type PanelCommand, type PanelEditing, type PanelPlacement, type WorkspacePanelId,
} from './workspaceLayout';

export function useImmersiveLayout(viewKey: string) {
  const [layouts, setLayouts] = useState<ImmersiveLayouts>({ version: 4, views: {} });
  const [editing, setEditing] = useState<PanelEditing>();
  const layoutsRef = useRef(layouts);
  const defaultLayout = useRef(defaultImmersiveLayout());
  useEffect(() => {
    try { layoutsRef.current = parseImmersiveLayouts(localStorage.getItem(IMMERSIVE_LAYOUT_KEY)); }
    catch { /* Device storage may be unavailable. */ }
    setLayouts(layoutsRef.current);
  }, []);
  useEffect(() => setEditing(undefined), [viewKey]);
  const commit = useCallback((update: (layout: ImmersiveLayout) => ImmersiveLayout) => {
    const current = layoutsRef.current;
    const views = { ...current.views };
    const next = update(views[viewKey] || defaultImmersiveLayout());
    delete views[viewKey];
    views[viewKey] = next;
    const value: ImmersiveLayouts = { version: 4, views: Object.fromEntries(Object.entries(views).slice(-MAX_IMMERSIVE_LAYOUTS)) };
    layoutsRef.current = value;
    setLayouts(value);
    try { localStorage.setItem(IMMERSIVE_LAYOUT_KEY, JSON.stringify(value)); } catch { /* Optional device state. */ }
  }, [viewKey]);
  const onPanelAction = useCallback((id: WorkspacePanelId, command: PanelCommand) => {
    if (command === 'drag') { setEditing({ id, mode: 'drag' }); return; }
    if (command === 'done') { setEditing(undefined); return; }
    commit((layout) => updateImmersivePanel(layout, id, command));
    if (command === 'resize') setEditing((current) => current?.id === id && current.mode === 'resize' ? undefined : { id, mode: 'resize' });
    else if (['open', 'toggle', 'focus', 'close'].includes(command) || Object.hasOwn(PANEL_SIZES, command)) setEditing(undefined);
  }, [commit]);
  const onPanelPlacement = useCallback((id: WorkspacePanelId, placement: PanelPlacement) => {
    commit((layout) => placeImmersivePanel(layout, id, placement));
    setEditing(undefined);
  }, [commit]);
  const onResetWorkspace = useCallback(() => { setEditing(undefined); commit(defaultImmersiveLayout); }, [commit]);
  return { layout: layouts.views[viewKey] || defaultLayout.current, editing, onPanelAction, onPanelPlacement, onResetWorkspace };
}
