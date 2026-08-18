import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '@/lib/server/config';

const originalDepth = process.env.CODEAI_WEB2_PROJECTS_DEPTH;
const originalCodexAgent = process.env.CODEAI_WEB2_CODEX_AGENT;

describe.sequential('web2 config', () => {
  afterEach(() => {
    if (originalDepth === undefined) delete process.env.CODEAI_WEB2_PROJECTS_DEPTH;
    else process.env.CODEAI_WEB2_PROJECTS_DEPTH = originalDepth;
    if (originalCodexAgent === undefined) delete process.env.CODEAI_WEB2_CODEX_AGENT;
    else process.env.CODEAI_WEB2_CODEX_AGENT = originalCodexAgent;
  });

  it('reads project discovery depth from config', () => {
    process.env.CODEAI_WEB2_PROJECTS_DEPTH = '3';
    expect(getConfig().projectDiscoveryDepth).toBe(3);
  });

  it.each(['0', '1.5', '11'])('rejects invalid project discovery depth %s', (value) => {
    process.env.CODEAI_WEB2_PROJECTS_DEPTH = value;
    expect(() => getConfig()).toThrow('CODEAI_WEB2_PROJECTS_DEPTH');
  });

  it('keeps Codex Agent behind an explicit configuration gate', () => {
    delete process.env.CODEAI_WEB2_CODEX_AGENT;
    expect(getConfig().codexAgentEnabled).toBe(false);
    process.env.CODEAI_WEB2_CODEX_AGENT = 'yes';
    expect(getConfig().codexAgentEnabled).toBe(true);
  });
});
