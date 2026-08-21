import { describe, expect, it } from 'vitest';
import { normalizeMermaidSource, validateMermaidSource } from '@/features/diagram/mermaid/mermaidPolicy';

describe('validateMermaidSource', () => {
  it('removes Markdown inline-code delimiters only inside quoted Mermaid labels', () => {
    const source = 'flowchart LR\nF["`.claude/settings.local.json`<br/>M · +3 / −0"]\n%% keep `comment`';
    expect(normalizeMermaidSource(source)).toBe(
      'flowchart LR\nF[".claude/settings.local.json<br/>M · +3 / −0"]\n%% keep `comment`',
    );
  });

  it('accepts multiple Mermaid grammars and benign styling', () => {
    expect(validateMermaidSource('sequenceDiagram\nA->>B: hello').ok).toBe(true);
    expect(validateMermaidSource('classDiagram\nclass A\nstyle A fill:#fff').ok).toBe(true);
    expect(validateMermaidSource('graph LR\nA["First line<br/>Second line"] --> B["Third<br>Fourth"]\nC["Fifth<BR />Sixth"]').ok).toBe(true);
  });

  it('escapes semicolons in sequence-diagram message and note text as #59;', () => {
    const source = [
      'sequenceDiagram',
      '    %%@evidence A | a/b.ts:1-2 | observed',
      '    Relay->>Relay: window.close()<br/>(no wait for ack; if refused, show "return to club tab")',
      '    note over Iframe: May be suspended (iOS); queued message runs on resume',
      '    alt Existing session',
      '    end',
    ].join('\n');
    expect(normalizeMermaidSource(source)).toBe([
      'sequenceDiagram',
      '    %%@evidence A | a/b.ts:1-2 | observed',
      '    Relay->>Relay: window.close()<br/>(no wait for ack#59; if refused, show "return to club tab")',
      '    note over Iframe: May be suspended (iOS)#59; queued message runs on resume',
      '    alt Existing session',
      '    end',
    ].join('\n'));
  });

  it('leaves semicolons in non-sequence diagrams unchanged', () => {
    const source = 'graph LR\nA["x; y"] --> B';
    expect(normalizeMermaidSource(source)).toBe(source);
  });

  it('accepts angle-bracket placeholders that are not real element names', () => {
    const source = [
      'sequenceDiagram',
      '    participant Relay as Top-level relay<br/>/embed-auth/relay',
      '    Iframe->>Relay: window.open("/embed-auth/relay?request=<id>"), retain relayWindow',
      '    Relay->>Iframe: postMessage {type, version: 1, requestId, customToken}<br/>to exact origin',
      '    Iframe->>Iframe: Validate <requestId> and <deadline>',
      '    note over Iframe: replays </id> literally',
    ].join('\n');
    expect(validateMermaidSource(source)).toEqual({ ok: true });
  });

  it.each([
    '---\ntitle: no',
    '%%{init: {"securityLevel":"loose"}}%%\ngraph LR',
    'graph LR\nclick A call evil',
    'graph LR\nclick A "https://example.com"',
    'graph LR\nA[<img src=x>]',
    'graph LR\nA["line<br class=evil>other"]',
    'graph LR\nA["line<br onmouseover=evil>other"]',
    'graph LR\nA[javascript:alert(1)]',
    'graph LR\nA[<b>bold</b>]',
    'graph LR\nA[<script>]',
    'graph LR\nA[<foreignObject>]',
    'graph LR\nA[<feGaussianBlur>]',
    'graph LR\nA[<svg>]',
    'graph LR\nA[<id attr=1>]',
    'graph LR\nA[<id/>]',
  ])('rejects active content: %s', (source) => expect(validateMermaidSource(source).ok).toBe(false));
});
