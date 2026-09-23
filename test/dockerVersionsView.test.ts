import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { dockerUpdateText, DockerVersionsView } from '@/features/arena/DockerVersions';
import type { DockerUpdateOperation, DockerVersionsStatus } from '@/shared/types';

const STATUS: DockerVersionsStatus = {
  providers: {
    claude: { version: '2.1.226', minimum: '2.1.226', latest: { version: '2.1.280', downgrade: false } },
    codex: { version: '0.156.1', minimum: '0.152.0', previous: { version: '0.152.0', downgrade: true } },
  },
  releases: { checkedAt: '2026-09-23T12:00:00.000Z' },
};

function render(status?: DockerVersionsStatus, options: { busy?: 'check' | 'start'; error?: string } = {}) {
  return renderToStaticMarkup(createElement(DockerVersionsView, { status, ...options, onUpdate: vi.fn(), onCheck: vi.fn() }))
    .replace(/<!-- -->/g, '');
}

function rows(markup: string) {
  return [...markup.matchAll(/<div class="arena-docker-version">([\s\S]*?)<\/span><\/div>/g)].map(([row]) => row
    .replace(/<button([^>]*)>([^<]*)<\/button>/g, (_, attributes: string, text) => ` [${text}${attributes.includes('disabled') ? ' (disabled)' : ''}]`)
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function operation(state: DockerUpdateOperation['state'], extra: Partial<DockerUpdateOperation> = {}): DockerUpdateOperation {
  return { id: 'operation', provider: 'claude', version: '2.1.280', state, startedAt: '2026-09-23T12:00:00.000Z', ...extra };
}

describe('Arena Docker CLI rows', () => {
  it('shows each recorded version with its update or rollback, and Check for updates', () => {
    const markup = render(STATUS);
    expect(rows(markup)).toEqual([
      'Claude 2.1.226 2.1.280 available [Update]',
      'Codex 0.156.1 up to date [Roll back to 0.152.0]',
    ]);
    expect(markup).toContain('>Check for updates</button>');
    expect(markup).not.toContain('Couldn’t check');
  });

  it('says it could not check for updates without hiding the versions or rollback', () => {
    const failed = { ...STATUS, releases: { checkedAt: STATUS.releases.checkedAt, failed: true as const },
      providers: { ...STATUS.providers, claude: { version: '2.1.226', minimum: '2.1.226' } } };
    const markup = render(failed);
    expect(markup).toContain('Couldn’t check for updates.');
    expect(rows(markup)).toEqual(['Claude 2.1.226', 'Codex 0.156.1 [Roll back to 0.152.0]']);
  });

  it.each(['building', 'checking', 'switching'] as const)('disables every action while an update is %s', (state) => {
    const markup = render({ ...STATUS, operation: operation(state) });
    expect(rows(markup)).toEqual([
      'Claude 2.1.226 2.1.280 available [Update (disabled)]',
      'Codex 0.156.1 up to date [Roll back to 0.152.0 (disabled)]',
    ]);
    expect(markup).toMatch(/<button type="button" disabled="">Check for updates<\/button>/);
    expect(markup).toContain(`<p role="status">${dockerUpdateText(operation(state))}</p>`);
  });

  it('names an upward previous version a return rather than a rollback', () => {
    const returned = { ...STATUS, providers: { ...STATUS.providers, claude: { version: '2.1.226', minimum: '2.1.226', previous: { version: '2.1.280', downgrade: false } } } };
    expect(rows(render(returned))[0]).toBe('Claude 2.1.226 up to date [Return to 2.1.280]');
  });

  it('disables actions while a request is starting or checking', () => {
    expect(rows(render(STATUS, { busy: 'start' }))[0]).toBe('Claude 2.1.226 2.1.280 available [Update (disabled)]');
    expect(render(STATUS, { busy: 'check' })).toContain('>Checking…</button>');
  });

  it('names each step and outcome', () => {
    expect(dockerUpdateText(operation('building'))).toBe('Building Claude 2.1.280…');
    expect(dockerUpdateText(operation('checking'))).toBe('Checking Claude 2.1.280 offline…');
    expect(dockerUpdateText(operation('switching'))).toBe('Switching to Claude 2.1.280…');
    expect(dockerUpdateText(operation('switched', { message: 'Claude 2.1.280 replaced 2.1.226. New turns use it.' })))
      .toBe('Claude 2.1.280 replaced 2.1.226. New turns use it.');
    expect(dockerUpdateText(operation('failed', { check: 'claude-flags', message: 'claude --help does not document --effort, which CodeAI requires.' })))
      .toBe('The Claude flag check failed: claude --help does not document --effort, which CodeAI requires. Nothing changed.');
    expect(dockerUpdateText(operation('in-use', { message: 'Claude is in use by a turn. Try again when it finishes.' })))
      .toBe('Claude is in use by a turn. Try again when it finishes.');
  });

  it('shows a finished outcome with the actions enabled again, and a request error', () => {
    const markup = render({ ...STATUS, operation: operation('in-use', { message: 'Claude is in use by a turn. Try again when it finishes.' }) },
      { error: 'Another Docker CLI update is running on this machine.' });
    expect(rows(markup)[0]).toBe('Claude 2.1.226 2.1.280 available [Update]');
    expect(markup).toContain('<p role="status">Claude is in use by a turn. Try again when it finishes.</p>');
    expect(markup).toContain('<p role="alert">Another Docker CLI update is running on this machine.</p>');
  });
});
