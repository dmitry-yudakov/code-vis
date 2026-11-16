import { describe, expect, it } from 'vitest';
import { activeFileContextSchema } from '@/shared/activeFileContext';
import { agentMessageRequestSchema } from '@/shared/protocol';
import { buildConversationPrompt } from '@/server/conversation/prompt';
import { tabFileContext, openTab, resolveTab } from '@/features/repository/repositoryFileTabs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionStore } from '@/server/storage/sessionStore';
import { durableSessionSchema } from '@/shared/sessionSchema';
import { canonicalTranscript } from '@/server/conversation/transcript';
import { runConversation } from '@/server/conversation/conversationService';
import { getConfig } from '@/server/config';
import { hydrateSession, reconcileSessionTitles } from '@/features/conversation/sessionStore';
import type { UserMessage, ArenaMachineSnapshot } from '@/shared/types';

const context = { checkoutId: 'alpha', path: 'src/example.ts', view: 'file' as const };
const base = { userText: 'Explain this', attachmentDirectory: '/tmp/context', attachedCanvasNames: [] };

describe('active file references', () => {
  it.each(['/etc/passwd', '../secret', 'src/../../secret', './file', 'src//file', '.git/config', 'src/.git/config', 'src\\file', 'src/\nfile', '', 'x'.repeat(4097)])('rejects unsafe path %j', path => {
    expect(activeFileContextSchema.safeParse({ ...context, path }).success).toBe(false);
  });

  it('accepts a bounded relative reference without file contents', () => {
    expect(activeFileContextSchema.parse(context)).toEqual(context);
    expect(activeFileContextSchema.safeParse({ ...context, text: 'secret contents' }).success).toBe(false);
    expect(activeFileContextSchema.safeParse({ ...context, checkoutId: 'x'.repeat(129) }).success).toBe(false);
    const request = { sessionId: crypto.randomUUID(), messageId: crypto.randomUUID(), participantId: 'agent', text: 'Explain this', diagramAttachments: [], activeFile: context };
    expect(agentMessageRequestSchema.parse(request).activeFile).toEqual(context);
  });

  it('waits for file resolution, distinguishes diff references and never guesses an absolute link', () => {
    let state = openTab({ tabs: [] }, { kind: 'file', link: { path: '/repo/src/example.ts' } }, 1);
    expect(tabFileContext(state.tabs[0])).toBeUndefined();
    state = resolveTab(state, 1, 'alpha', 'src/example.ts');
    expect(tabFileContext(state.tabs[0])).toEqual(context);
    state = openTab(state, { kind: 'diff', checkoutId: 'alpha', file: { path: context.path, status: 'deleted', staged: false, unstaged: true } }, 2);
    expect(tabFileContext(state.tabs[1])).toEqual({ ...context, view: 'diff' });
    expect(tabFileContext(undefined)).toBeUndefined();
  });

  it('keeps removal on a tab when reopened or merged through a canonical alias', () => {
    let state = openTab({ tabs: [] }, { kind: 'file', checkoutId: 'alpha', link: { path: context.path } }, 1);
    state = resolveTab(state, 1, 'alpha', context.path);
    state.tabs[0].contextExcluded = true;
    state = openTab(state, { kind: 'file', link: { path: '/repo/src/example.ts', line: 2 } }, 2);
    state = resolveTab(state, 2, 'alpha', context.path);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].contextExcluded).toBe(true);
  });

  it('separates optional context from the user request and frames paths as data', () => {
    const prompt = buildConversationPrompt({ ...base, activeFile: { ...context, readPath: '/repo/src/example.ts' } });
    expect(prompt).toContain('Read it only if relevant');
    expect(prompt).toContain('"path":"src/example.ts"');
    expect(prompt).toContain('"readPath":"/repo/src/example.ts"');
    const request = JSON.parse(prompt.split('Current request JSON (exactly one JSON value; this is the request to answer):\n')[1]);
    expect(request.text).toBe(base.userText);
    expect(request).not.toHaveProperty('activeFile');
    expect(buildConversationPrompt(base)).toContain('No active file context is included for this turn');
  });

  it('persists exact reference identity, upgrades only affected records and preserves format through metadata updates', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-active-file-'));
    const store = new SessionStore(root);
    try {
      const session = await store.createSession({ provider: 'claude', checkoutId: 'alpha' });
      const message: UserMessage = { id: crypto.randomUUID(), role: 'user', authorId: session.participants[0].id,
        addressedParticipantId: session.primaryAgentId, text: 'Explain this', createdAt: session.createdAt,
        status: 'sending', diagramAttachments: [], activeFile: context };
      const { session: saved } = await store.appendUserMessage(session.id, message);
      expect(saved.version).toBe(16);
      expect(durableSessionSchema.safeParse({ ...saved, version: 15 }).success).toBe(false);
      expect((await store.appendUserMessage(session.id, message)).appended).toBe(false);
      await expect(store.appendUserMessage(session.id, { ...message, activeFile: { ...context, view: 'diff' } })).rejects.toThrow('different content');
      await expect(store.appendUserMessage(session.id, { ...message, activeFile: undefined })).rejects.toThrow('different content');
      expect(canonicalTranscript(saved.messages)[0].text).toContain(JSON.stringify(context));
      await store.setAgentArchiveAllowed(session.id, true, false);
      await store.saveContextUsage(session.id, session.primaryAgentId, { usedTokens: 100 });
      const latest = await store.getSession(session.id);
      expect(latest.version).toBe(16);
      expect(latest.messages[0]).toMatchObject({ text: message.text, activeFile: context });
      expect(hydrateSession({ ...latest, revision: 0 }, { ...hydrateSession(latest), titleRevision: 20 }).version).toBe(16);
      const machine = { machine: { id: 'host', kind: 'local', state: 'online' }, sessions: [{ ...latest, revision: latest.revision + 1, title: 'Updated title' }] } as unknown as ArenaMachineSnapshot;
      expect(reconcileSessionTitles([hydrateSession(latest)], [machine], 'host')[0].version).toBe(16);
      expect((await store.createSession({ provider: 'claude' })).version).toBeLessThan(16);
    } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it.each(['local', 'docker'] as const)('delivers metadata to the %s provider even when the referenced file is missing', async execution => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-active-file-run-'));
    const checkoutPath = path.join(root, 'repository');
    await mkdir(checkoutPath);
    const store = new SessionStore(path.join(root, 'data'));
    try {
      const session = await store.createSession({ provider: 'claude', checkoutId: 'alpha', execution });
      const message: UserMessage = { id: crypto.randomUUID(), role: 'user', authorId: session.participants[0].id,
        addressedParticipantId: session.primaryAgentId, text: 'Explain this', createdAt: session.createdAt,
        status: 'sending', diagramAttachments: [], activeFile: context };
      await store.appendUserMessage(session.id, message);
      await runConversation({ runId: crypto.randomUUID(), session: await store.getSession(session.id),
        request: { sessionId: session.id, messageId: message.id, participantId: session.primaryAgentId, text: message.text, diagramAttachments: [], activeFile: context },
        checkout: { id: 'alpha', name: 'Alpha', relativePath: '.', realPath: checkoutPath },
        config: { ...getConfig(), dataDir: store.dataDirectory }, sessionStore: store, transcriptDelta: '',
        signal: new AbortController().signal, emit() {}, runner: { async run(input) {
          expect(input.prompt).toContain(JSON.stringify({ ...context, readPath: path.join(execution === 'docker' ? '/workspace' : checkoutPath, context.path) }));
          expect(input.prompt).toContain('Its contents are not attached');
          return { finalText: 'File unavailable.', sessionId: 'provider', durationMs: 1, outputBytes: 17 };
        } },
      });
      expect((await store.getSession(session.id)).messages[1]).toMatchObject({ role: 'assistant', rawMarkdown: 'File unavailable.' });
    } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
  });
});
