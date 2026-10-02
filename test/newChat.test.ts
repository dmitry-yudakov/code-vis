import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationDrawer } from '@/features/conversation/ConversationDrawer';
import type { AgentParticipant, SessionSnapshot } from '@/shared/types';

const agent: AgentParticipant = {
  id: 'agent', kind: 'agent', displayName: 'Codex', provider: 'codex', role: 'tester', defaultMode: 'ask',
};
const session = { id: 'source', title: 'Source chat', participants: [agent], primaryAgentId: agent.id,
  messages: [], repositories: [], annotations: {}, sketches: [], pinnedDiagramIds: [],
} as unknown as SessionSnapshot;

type Props = ComponentProps<typeof ConversationDrawer>;
function header(overrides: Partial<Props> = {}) {
  const actions = {
    onSelectDiagram: vi.fn(), onRetry: vi.fn(), onComposer: vi.fn(), onModeChange: vi.fn(),
    onModelSelectionChange: vi.fn(), onSelectAgent: vi.fn(), onMakePrimary: vi.fn(), onAddAgent: vi.fn(),
    onHandoff: vi.fn(), onSend: vi.fn(), onCancel: vi.fn(), onRemoveAttachment: vi.fn(),
    onRemoveReport: vi.fn(), onAddImages: vi.fn(), onRemoveImage: vi.fn(), onOpenImage: vi.fn(),
    onDecidePermission: vi.fn(), onExecutePlan: vi.fn(), onContinue: vi.fn(), onNewChat: vi.fn(),
    onToggleAttachment: vi.fn(), onOpenHistory: vi.fn(), onNewSketch: vi.fn(),
  };
  const props: Props = {
    ...actions,
    open: true, session, theme: 'light', agents: [agent], activeAgent: agent, healthyProviders: ['codex'],
    participantBusy: false, preview: '', toolActivity: [], permissions: [], running: false,
    cancelReady: false, continuing: false, status: '', composer: '', mode: 'plan', unsupportedModes: [],
    modelSelection: {}, attached: [], reports: [], images: [], markCounts: {}, ...overrides,
  };
  return renderToStaticMarkup(createElement(ConversationDrawer, props)).match(/<header>[\s\S]*?<\/header>/)?.[0] || '';
}

describe('conversation New chat', () => {
  it('puts an accessible icon button beside the title in an idle chat', () => {
    const markup = header();
    expect(markup).toContain('aria-label="New chat"');
    expect(markup).toContain('title="New chat with the same project and settings"');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('disabled=""');
  });

  it.each<Partial<Props>>([
    { running: true }, { continuing: true }, { participantBusy: true },
    { recovery: { busy: true } as Props['recovery'] }, { session: undefined }, { activeAgent: undefined },
  ])('disables the action when the current chat cannot be replaced: %j', (overrides) => {
    expect(header(overrides)).toMatch(/<button[^>]*aria-label="New chat"[^>]*disabled=""/);
  });
});
