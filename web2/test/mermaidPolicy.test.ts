import { describe, expect, it } from 'vitest';
import { normalizeMermaidSource, validateMermaidSource } from '@/lib/diagram/mermaidPolicy';

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

  it.each([
    '---\ntitle: no',
    '%%{init: {"securityLevel":"loose"}}%%\ngraph LR',
    'graph LR\nclick A call evil',
    'graph LR\nclick A "https://example.com"',
    'graph LR\nA[<img src=x>]',
    'graph LR\nA["line<br class=evil>other"]',
    'graph LR\nA["line<br onmouseover=evil>other"]',
    'graph LR\nA[javascript:alert(1)]',
  ])('rejects active content: %s', (source) => expect(validateMermaidSource(source).ok).toBe(false));
});
