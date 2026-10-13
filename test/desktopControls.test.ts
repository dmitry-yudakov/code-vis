import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LayoutToggles } from '@/features/shell/LayoutToggles';
import { DrawingToolbar } from '@/features/diagram/components/DrawingToolbar';
import { ToastStack } from '@/features/shell/ToastStack';

describe('desktop layout controls', () => {
  it('uses MUI icon buttons while retaining layout and attention semantics', () => {
    const markup = renderToStaticMarkup(createElement(LayoutToggles, {
      canvasShown: true, canvasToggleable: true, conversationShown: false,
      approvals: 2, unread: 3, onToggleCanvas: vi.fn(), onToggleConversation: vi.fn(),
    }));
    expect(markup).toContain('MuiIconButton-root');
    expect(markup).toContain('aria-label="Canvas"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Conversation, 2 actions waiting for your approval');
  });

  it('uses library drawing toggles without losing tool selection or disabled recovery', () => {
    const markup = renderToStaticMarkup(createElement(DrawingToolbar, {
      tool: 'pen', canUndo: false, canRedo: false, onTool: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onClear: vi.fn(),
    }));
    expect(markup).toContain('MuiToggleButton-root');
    expect(markup).toContain('aria-label="Pen (P)"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('uses an Alert for toast presentation while preserving its live-region role', () => {
    const markup = renderToStaticMarkup(createElement(ToastStack, {
      toasts: [{ key: 'fixture', serial: 1, tone: 'info', message: 'Saved.', count: 1 }], onRemove: vi.fn(),
    }));
    expect(markup).toContain('MuiAlert-root');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Saved.');
  });
});
