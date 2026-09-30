import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GlobalInstructionsView } from '@/features/arena/GlobalInstructions';
import { SessionCreationForm } from '@/features/conversation/SessionPicker';
import type {
  AgentExecution, AgentProvider, ExecutionHealth, GlobalInstructionsChoice, GlobalInstructionsView as View, ProviderHealth,
} from '@/shared/types';

const NO_DOCKER = { entries: [], skipped: [] };
const VIEW: View = {
  providers: {
    claude: { enabled: true, displayPath: '~/.claude/CLAUDE.md', text: 'Claude rules.\n', imports: false, docker: { entries: ['CLAUDE.md', 'skills'], skipped: [] } },
    codex: { enabled: false, displayPath: '~/.codex/AGENTS.md', text: 'Codex rules.\n', imports: false, localAlways: true, docker: NO_DOCKER },
  },
  shared: false,
};

function render(view: View | undefined, options: { error?: string; saving?: boolean; dockerEnabled?: boolean } = {}) {
  return renderToStaticMarkup(createElement(GlobalInstructionsView, { view, ...options, onSwitch: vi.fn() })).replace(/<!-- -->/g, '');
}

/** Each row as its switch, then its text; a file view shows as `[file: …]`. */
function rows(markup: string) {
  return [...markup.matchAll(/<div class="arena-instruction">([\s\S]*?)<\/div>/g)].map(([, row]) => row
    .replace(/<input[^>]*>/, (input) => `[${input.includes('checked=""') ? 'on' : 'off'}${input.includes('disabled=""') ? ', disabled' : ''}] `)
    .replace(/<details[^>]*><summary>Show file<\/summary><pre[^>]*>([\s\S]*?)<\/pre><\/details>/, (_, text: string) => ` [file: ${text.trim()}]`)
    .replace(/<\/(code|span|label|p)>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

describe('Arena Global instructions', () => {
  it('shows each provider\'s switch, path, and file, with the local-Codex and timing notes', () => {
    const markup = render(VIEW);
    expect(markup).toContain('<section class="arena-instructions" aria-label="Global instructions">');
    expect(markup).toContain('<span>Takes effect on the next Docker Codex turn and in a Claude agent’s next provider session.</span>');
    expect(rows(markup)).toEqual([
      '[on] Claude ~/.claude/CLAUDE.md [file: Claude rules.]',
      '[off] Codex ~/.codex/AGENTS.md Local Codex always uses this file. The switch applies to Docker Codex. [file: Codex rules.]',
    ]);
    expect(markup).toContain('aria-label="Use global instructions for Claude"');
    // The file is read-only text, closed until asked for.
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('<details open');
  });

  it('shows a file both providers share once', () => {
    const shared = { displayPath: '~/.claude/CLAUDE.md → ~/.codex/AGENTS.md', text: 'One file.\n' };
    const markup = render({
      providers: { claude: { ...VIEW.providers.claude, ...shared }, codex: { ...VIEW.providers.codex, text: 'One file.\n' } },
      shared: true,
    });
    expect(rows(markup)).toEqual([
      '[on] Claude ~/.claude/CLAUDE.md → ~/.codex/AGENTS.md',
      '[off] Codex ~/.codex/AGENTS.md Local Codex always uses this file. The switch applies to Docker Codex.',
      'Claude and Codex share this file. [file: One file.]',
    ]);
    expect(markup.match(/One file\./g)).toHaveLength(1);
  });

  it('says why a file is not passed, that imports are not followed, and that a damaged setting is off', () => {
    const issue = (value: View['providers']['claude']['issue']) => rows(render({
      ...VIEW, providers: { ...VIEW.providers, claude: { enabled: true, displayPath: '~/.claude/CLAUDE.md', issue: value, imports: false, docker: NO_DOCKER } },
    }))[0];
    expect(issue('missing')).toBe('[on] Claude ~/.claude/CLAUDE.md No file yet.');
    expect(issue('too-large')).toBe('[on] Claude ~/.claude/CLAUDE.md Not passed: it is larger than 32 KiB.');
    expect(issue('not-text')).toBe('[on] Claude ~/.claude/CLAUDE.md Not passed: it is not UTF-8 text.');
    expect(issue('not-file')).toBe('[on] Claude ~/.claude/CLAUDE.md Not passed: it is not a regular file.');
    expect(issue('unreadable')).toBe('[on] Claude ~/.claude/CLAUDE.md Not passed: it cannot be read.');
    expect(issue('agent-link')).toBe('[on] Claude ~/.claude/CLAUDE.md Not passed: it is reached through a link under the repositories root or a temp directory, which an agent turn could repoint.');
    expect(issue('protected')).toBe('[on] Claude ~/.claude/CLAUDE.md Not passed: it resolves to a private file of a provider folder.');
    expect(issue('unverified')).toBe('[on] Claude ~/.claude/CLAUDE.md Not passed: it is under the repositories root or a temp directory, where this system cannot prove which file was opened.');

    const imports = render({ ...VIEW, providers: { ...VIEW.providers, claude: { ...VIEW.providers.claude, imports: true } } });
    expect(rows(imports)[0]).toBe('[on] Claude ~/.claude/CLAUDE.md Its @ imports are passed as written, not followed. [file: Claude rules.]');

    const editable = render({ ...VIEW, providers: { ...VIEW.providers, claude: { ...VIEW.providers.claude, agentEditable: true } } });
    expect(rows(editable)[0]).toBe('[on] Claude ~/.claude/CLAUDE.md This file is under the repositories root: a turn that edits its folder can change what these instructions say. [file: Claude rules.]');

    // Local Codex loads its own file whatever the setting says.
    expect(render({ ...VIEW, damaged: true })).toContain('<p role="status">This machine’s setting is damaged, so Claude and Docker Codex run without them. Set either switch to repair it.</p>');
    expect(render(VIEW)).not.toContain('damaged');
  });

  it('names what a Docker worker sees and what was left out, only where Docker is enabled', () => {
    const view: View = {
      ...VIEW,
      providers: { ...VIEW.providers, codex: { ...VIEW.providers.codex, docker: { entries: ['AGENTS.md'], skipped: ['skills/ resolves to a protected folder'] } } },
    };
    expect(rows(render(view, { dockerEnabled: true }))).toEqual([
      '[on] Claude ~/.claude/CLAUDE.md A Docker turn that uses them sees CLAUDE.md, skills read-only at /user/claude. [file: Claude rules.]',
      // Whatever the switch says: a session created with Use binds them too.
      '[off] Codex ~/.codex/AGENTS.md Local Codex always uses this file. The switch applies to Docker Codex. A Docker turn that uses them sees AGENTS.md read-only at /user/codex. Left out: skills/ resolves to a protected folder. [file: Codex rules.]',
    ]);
    expect(render(view)).not.toContain('Docker turn');
  });

  it('holds the switches while one is saved, and reports a failed read', () => {
    expect(rows(render(VIEW, { saving: true }))[0]).toMatch(/^\[on, disabled\] Claude/);
    const failed = render(undefined, { error: 'Could not read the global instructions on this machine.' });
    expect(rows(failed)).toEqual([]);
    expect(failed).toContain('<p role="alert">Could not read the global instructions on this machine.</p>');
  });
});

describe('the conversation\'s New session form', () => {
  const ready: ProviderHealth = { available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] };
  const health: ExecutionHealth = {
    local: { enabled: true, providers: { claude: ready, codex: ready } },
    docker: { enabled: true, providers: { claude: ready, codex: ready } },
  };

  function form(newProvider: AgentProvider, initialExecution: AgentExecution, preferredInstructions?: GlobalInstructionsChoice) {
    const markup = renderToStaticMarkup(createElement(SessionCreationForm, {
      initialExecution, executionHealth: health, checkouts: [{ id: 'checkout-a', name: 'alpha', relativePath: 'alpha' }], hostId: 'host',
      newProvider, preferredInstructions, creating: false, onNewProvider: vi.fn(), onNew: vi.fn(),
    }));
    const [, options] = markup.match(/<span>Global instructions<\/span><select[^>]*>([\s\S]*?)<\/select>/)!;
    return [...options.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(([, attributes, text]) => (
      `${text}${attributes.includes('selected=""') ? ' (selected)' : ''}${attributes.includes('disabled=""') ? ' (disabled)' : ''}`
        + (attributes.match(/title="([^"]*)"/)?.[1].replace(/^/, ' — ') ?? '')
    ));
  }

  it('offers Default, Use, and Isolate, and opens at the choice this device remembers', () => {
    expect(form('claude', 'local')).toEqual(['Default (selected)', 'Use', 'Isolate']);
    expect(form('claude', 'local', 'isolated')).toEqual(['Default', 'Use', 'Isolate (selected)']);
    expect(form('codex', 'docker', 'isolated')).toEqual(['Default', 'Use', 'Isolate (selected)']);
    expect(form('codex', 'local', 'global')[1]).toBe('Use (selected)');
  });

  it('disables Isolate for local Codex with the reason, and falls back to Default', () => {
    expect(form('codex', 'local', 'isolated')).toEqual([
      'Default (selected)', 'Use',
      'Isolate · Docker only for Codex (disabled) — Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex.',
    ]);
  });
});
