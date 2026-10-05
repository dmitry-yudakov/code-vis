import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImmersiveConversationControls } from '@/features/shell/immersive/conversationControls';

const buttons = vi.hoisted(() => new Map<string, { disabled: boolean; onAction(): void }>());
vi.mock('@/features/shell/immersive/useTextureResource', () => ({ useTextureResource: () => undefined }));
vi.mock('@/features/conversation/useVoiceDraft', () => ({ useVoiceDraft: () => ({
  phase: 'idle', configured: false, status: '', result: '', activity: { level: 0, seconds: 0 },
}) }));
vi.mock('@/features/shell/immersive/WorkspacePanel', async () => {
  const { createElement } = await import('react');
  return { ControlGroupSurface: () => null, WorkspacePager: () => null,
    WorldButton: (props: { action: string; label: string; disabled: boolean; onAction(): void }) => {
      buttons.set(props.action, props);
      return createElement('button', { disabled: props.disabled }, props.label);
    },
  };
});
import { ConversationTools } from '@/features/shell/immersive/ConversationTools';
afterEach(() => { buttons.clear(); vi.restoreAllMocks(); });

describe('mode controls in a working VR conversation', () => {
  it.each(['light', 'dark'] as const)('renders supported modes and sends changes while running in %s', (theme) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controls: ImmersiveConversationControls = {
      draft: '', target: 'Agent', attachments: [], canSend: false, running: true, runStatus: 'Waiting for approval',
      runId: 'running', busy: false, agents: [], providers: [], mode: 'agent', unsupportedModes: ['edits', 'full'],
      onDraft: vi.fn(), onSend: vi.fn(), onCancel: vi.fn(), onMode: vi.fn(), onSelectAgent: vi.fn(),
      onAddAgent: vi.fn(), onMakePrimary: vi.fn(),
    };
    renderToStaticMarkup(createElement(ConversationTools, {
      controls, theme, enabled: true, tab: 'agents', atBottom: true, renderHistory: () => null,
      onTab: vi.fn(), onLatest: vi.fn(), onVoicePending: vi.fn(), onController: vi.fn(),
    }));
    for (const mode of ['ask', 'plan', 'agent', 'auto']) expect(buttons.get(`conversation:${mode}`)?.disabled).toBe(false);
    expect(buttons.has('conversation:full')).toBe(false);
    buttons.get('conversation:plan')!.onAction();
    expect(controls.onMode).toHaveBeenCalledWith('plan');
  });
});
