import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImmersiveSessionControls } from '@/features/shell/immersive/sessionControls';

const rendered = vi.hoisted(() => ({ details: '', actions: new Map<string, () => void>() }));
vi.mock('@/features/shell/immersive/useTextureResource', () => ({ useTextureResource: (create: (ledger: object) => unknown) => create({}) }));
vi.mock('@/features/shell/immersive/workspaceResources', () => ({
  createConversationTextResource: (_title: string, lines: string[]) => { rendered.details = lines.join(' '); return undefined; },
  createWorkspaceButtonResource: () => undefined, createReportPreviewResource: () => undefined,
}));
vi.mock('@/features/shell/immersive/WorkspacePanel', async () => {
  const { createElement } = await import('react');
  return { WorkspacePager: () => null, WorldButton: (props: { action: string; label: string; disabled: boolean; onAction(): void }) => {
    rendered.actions.set(props.action, props.onAction);
    return createElement('button', { 'data-action': props.action, disabled: props.disabled }, props.label);
  } };
});

import { SessionTools } from '@/features/shell/immersive/SessionTools';
afterEach(() => { vi.restoreAllMocks(); rendered.actions.clear(); });

describe('VR turn recovery controls', () => {
  it.each(['light', 'dark'] as const)('shows recovery scope and uses the shared confirmation owner in %s', (theme) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // React DOM sees the Three group in this bounded render.
    const recovery = { busy: false, confirming: false, checkpoint: {
      id: crypto.randomUUID(), messageId: crypto.randomUUID(), createdAt: new Date().toISOString(), expiresAt: '2026-10-08T00:00:00.000Z',
      state: 'ready' as const, changedFiles: 2,
    }, onAsk: vi.fn(), onDismiss: vi.fn(), onConfirm: vi.fn() };
    const controls = { machines: [], creating: false, status: 'Completed', permissions: [], results: {}, online: true,
      checkouts: [], needsRepository: false, canAttach: false, canCancel: false, canArchive: true, canRetry: true,
      recovery, onCreate: vi.fn(), onAttach: vi.fn(), onDecide: vi.fn(), onRefresh: vi.fn(), onCancel: vi.fn(),
      onArchive: vi.fn(), onRetry: vi.fn(), onRevoke: vi.fn(),
    } satisfies ImmersiveSessionControls;
    const render = () => renderToStaticMarkup(createElement(SessionTools, { controls, theme, enabled: true, onController: vi.fn(), onArchived: vi.fn() }));
    expect(render()).toContain('Undo this turn');
    // The scope can span details pages; confirmation still uses the same shared owner as desktop.
    rendered.actions.get('session:undo')!(); expect(recovery.onAsk).toHaveBeenCalledOnce();
    recovery.confirming = true;
    expect(render()).toContain('Confirm Undo');
    rendered.actions.get('session:confirm-undo')!(); expect(recovery.onConfirm).toHaveBeenCalledOnce();
    rendered.actions.get('session:keep-changes')!(); expect(recovery.onDismiss).toHaveBeenCalledOnce();
    recovery.confirming = false; recovery.busy = true;
    expect(render()).toContain('data-action="session:undo" disabled');
  });
});
