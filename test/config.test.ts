import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '@/server/config';

const MANAGED = [
  'CODEAI_PROJECTS_DEPTH', 'CODEAI_WEB2_PROJECTS_DEPTH',
  'CODEAI_CODEX_AGENT', 'CODEAI_WEB2_CODEX_AGENT',
  'CODEAI_CLAUDE_BIN', 'CODEAI_WEB2_CLAUDE_BIN',
  'CODEAI_CLAUDE_MODEL', 'CODEAI_WEB2_CLAUDE_MODEL',
] as const;

const original = new Map(MANAGED.map((name) => [name, process.env[name]]));

describe.sequential('config', () => {
  afterEach(() => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('reads project discovery depth from the neutral variable', () => {
    process.env.CODEAI_PROJECTS_DEPTH = '3';
    expect(getConfig().projectDiscoveryDepth).toBe(3);
  });

  it.each(['0', '1.5', '11'])('rejects invalid project discovery depth %s', (value) => {
    process.env.CODEAI_PROJECTS_DEPTH = value;
    expect(() => getConfig()).toThrow('CODEAI_PROJECTS_DEPTH');
  });

  it('keeps Codex Agent behind an explicit configuration gate', () => {
    delete process.env.CODEAI_CODEX_AGENT;
    delete process.env.CODEAI_WEB2_CODEX_AGENT;
    expect(getConfig().codexAgentEnabled).toBe(false);
    process.env.CODEAI_CODEX_AGENT = 'yes';
    expect(getConfig().codexAgentEnabled).toBe(true);
  });

  describe('web2 compatibility', () => {
    it('still accepts the former CODEAI_WEB2_ names', () => {
      delete process.env.CODEAI_PROJECTS_DEPTH;
      delete process.env.CODEAI_CLAUDE_BIN;
      delete process.env.CODEAI_CODEX_AGENT;
      process.env.CODEAI_WEB2_PROJECTS_DEPTH = '4';
      process.env.CODEAI_WEB2_CLAUDE_BIN = '/legacy/claude';
      process.env.CODEAI_WEB2_CODEX_AGENT = '1';
      const config = getConfig();
      expect(config.projectDiscoveryDepth).toBe(4);
      expect(config.claudeBin).toBe('/legacy/claude');
      expect(config.codexAgentEnabled).toBe(true);
    });

    it('prefers the neutral name when both are set', () => {
      process.env.CODEAI_PROJECTS_DEPTH = '2';
      process.env.CODEAI_WEB2_PROJECTS_DEPTH = '7';
      process.env.CODEAI_CLAUDE_BIN = '/neutral/claude';
      process.env.CODEAI_WEB2_CLAUDE_BIN = '/legacy/claude';
      const config = getConfig();
      expect(config.projectDiscoveryDepth).toBe(2);
      expect(config.claudeBin).toBe('/neutral/claude');
    });

    it('fails on an invalid neutral value instead of using a valid legacy one', () => {
      process.env.CODEAI_PROJECTS_DEPTH = '99';
      process.env.CODEAI_WEB2_PROJECTS_DEPTH = '2';
      expect(() => getConfig()).toThrow('CODEAI_PROJECTS_DEPTH must be an integer between 1 and 10');
    });

    it('names the legacy variable when the legacy value is the invalid one', () => {
      delete process.env.CODEAI_PROJECTS_DEPTH;
      process.env.CODEAI_WEB2_PROJECTS_DEPTH = '99';
      expect(() => getConfig()).toThrow('CODEAI_WEB2_PROJECTS_DEPTH must be an integer between 1 and 10');
    });

    it('treats an empty assignment as unset on either name', () => {
      process.env.CODEAI_CLAUDE_MODEL = '';
      process.env.CODEAI_WEB2_CLAUDE_MODEL = 'legacy-model';
      expect(getConfig().claudeModel).toBe('legacy-model');
      process.env.CODEAI_WEB2_CLAUDE_MODEL = '';
      expect(getConfig().claudeModel).toBeUndefined();
    });
  });
});
