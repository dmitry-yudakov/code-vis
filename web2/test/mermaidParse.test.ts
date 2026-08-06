import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import { normalizeMermaidSource } from '@/lib/diagram/mermaidPolicy';

// Guards the compatibility normalizations against the actually installed Mermaid parser.
describe('normalizeMermaidSource against mermaid.parse', () => {
  it('makes sequence messages with semicolons and quoted-label backticks parseable', async () => {
    const source = [
      'sequenceDiagram',
      '    participant Relay as Top-level relay<br/>/embed-auth/relay',
      '    Iframe->>Relay: window.open("/embed-auth/relay?request=<id>"), retain relayWindow',
      '    Relay->>Relay: Clear token refs, attempt window.close()<br/>(no wait for ack; if refused, show "return to club tab")',
      '    note over Iframe: May be suspended (iOS); queued message runs on resume',
    ].join('\n');
    await expect(mermaid.parse(source)).rejects.toThrow();
    await expect(mermaid.parse(normalizeMermaidSource(source))).resolves.toBeTruthy();
  });
});
