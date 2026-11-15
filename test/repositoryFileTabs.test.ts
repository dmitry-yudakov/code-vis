import { describe, expect, it } from 'vitest';
import { openTab, closeTab, resolveTab, type FileTabs } from '@/features/repository/repositoryFileTabs';

const empty: FileTabs = { tabs: [] };
const file = (path: string, line?: number) => ({ kind: 'file' as const, checkoutId: 'alpha', link: { path, line } });

describe('repository file tabs', () => {
  it('keeps files and diffs distinct and reuses a file tab for a new line reference', () => {
    let state = openTab(empty, file('a.ts'), 1);
    state = openTab(state, file('b.ts'), 2);
    state = openTab(state, { kind: 'diff', checkoutId: 'alpha', file: { path: 'a.ts', status: 'modified', staged: false, unstaged: true } }, 3);
    state = openTab(state, file('a.ts', 20), 4);
    expect(state.tabs).toHaveLength(3);
    expect(state.activeId).toBe(1);
    expect(state.tabs[0]).toMatchObject({ navigation: 4, link: { line: 20 } });
    state = openTab(state, file('a.ts'), 5);
    expect(state.tabs[0].navigation).toBe(4);
  });

  it('keeps checkout identities separate and merges absolute/relative aliases after resolution', () => {
    let state = openTab(empty, file('a.ts'), 1);
    state = resolveTab(state, 1, 'alpha', 'a.ts');
    state = openTab(state, { ...file('a.ts'), checkoutId: 'beta' }, 2);
    state = openTab(state, { kind: 'file', link: { path: '/repo/a.ts', line: 12 } }, 3);
    state = resolveTab(state, 3, 'alpha', 'a.ts');
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe(1);
    expect(state.tabs[0]).toMatchObject({ link: { path: '/repo/a.ts', line: 12 } });
    // A late resolution of a closed tab cannot change the active tab.
    expect(resolveTab(closeTab(state, 1), 1, 'alpha', 'a.ts').activeId).toBe(2);
  });

  it('closing the active tab selects its right neighbour, or left at the end', () => {
    let state = openTab(openTab(openTab(empty, file('a'), 1), file('b'), 2), file('c'), 3);
    expect(closeTab(state, 1).activeId).toBe(3);
    state = closeTab({ ...state, activeId: 2 }, 2);
    expect(state.activeId).toBe(3);
    state = closeTab(state, 3);
    expect(state.activeId).toBe(1);
    expect(closeTab(state, 1)).toEqual(empty);
  });

  it('reopening a canonical alias without a target keeps loaded content and position', () => {
    let state = openTab(empty, { kind: 'file', link: { path: '/repo/a.ts', line: 120 } }, 1);
    state = resolveTab(state, 1, 'alpha', 'a.ts');
    const prior = state.tabs[0];
    state = openTab(state, file('a.ts'), 2);
    expect(state.tabs[0]).toBe(prior);
    state = openTab(state, { kind: 'file', link: { path: '/other/alias.ts' } }, 3);
    state = resolveTab(state, 3, 'alpha', 'a.ts');
    expect(state.tabs[0]).toBe(prior);
    expect(state.tabs).toHaveLength(1);
    expect(state.activeId).toBe(1);
  });
});
