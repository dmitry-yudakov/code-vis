import type { GitChangedFile } from '@/shared/types';
import type { LocalFileLink } from './localFileLinks';

export type FileTarget = { kind: 'file'; link: LocalFileLink; checkoutId?: string }
  | { kind: 'diff'; checkoutId: string; file: GitChangedFile };
export type FileTab = FileTarget & { id: number; navigation: number; resolved?: { checkoutId: string; path: string } };
export interface FileTabs { tabs: FileTab[]; activeId?: number }

export function openTab(state: FileTabs, target: FileTarget, navigation: number): FileTabs {
  const path = target.kind === 'file' ? target.link.path : target.file.path;
  const prior = state.tabs.find(tab => tab.kind === target.kind && (
    tab.checkoutId === target.checkoutId && (tab.kind === 'file' ? tab.link.path : tab.file.path) === path
    || tab.resolved?.checkoutId === target.checkoutId && tab.resolved?.path === path));
  if (prior && target.kind === 'file' && !target.link.line && !target.link.anchor) return { ...state, activeId: prior.id };
  const next: FileTab = { ...prior, ...target, id: prior?.id ?? navigation, navigation };
  return { tabs: prior ? state.tabs.map(tab => tab.id === prior.id ? next : tab) : [...state.tabs, next], activeId: next.id };
}

/** The server supplies the canonical path; it alone can equate absolute and relative references. */
export function resolveTab(state: FileTabs, id: number, checkoutId: string, path: string): FileTabs {
  const tab = state.tabs.find(item => item.id === id);
  if (!tab || tab.kind !== 'file') return state;
  const prior = state.tabs.find(item => item.id !== id && item.kind === 'file'
    && item.resolved?.checkoutId === checkoutId && item.resolved.path === path);
  if (prior) return {
    tabs: state.tabs.filter(item => item.id !== id).map(item => item.id === prior.id && item.kind === 'file'
      && tab.navigation > item.navigation && (tab.link.line || tab.link.anchor)
      ? { ...item, link: tab.link, checkoutId: tab.checkoutId, navigation: tab.navigation } : item),
    activeId: state.activeId === id ? prior.id : state.activeId,
  };
  if (tab.resolved?.checkoutId === checkoutId && tab.resolved.path === path) return state;
  return { ...state, tabs: state.tabs.map(item => item.id === id ? { ...item, resolved: { checkoutId, path } } : item) };
}

export function closeTab(state: FileTabs, id: number): FileTabs {
  const index = state.tabs.findIndex(tab => tab.id === id);
  const tabs = state.tabs.filter(tab => tab.id !== id);
  const activeId = state.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id : state.activeId;
  return activeId === undefined ? { tabs } : { tabs, activeId };
}
