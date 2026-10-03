import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runConversation } from '@/server/conversation/conversationService';
import { RepositoryModelStore } from '@/server/model/repositoryModelStore';
import { SessionStore } from '@/server/storage/sessionStore';
import { getConfig } from '@/server/config';
import type { AgentEvent, AgentProcessRunner } from '@/shared/types';

const stores: SessionStore[] = [];
afterEach(async () => { await Promise.all(stores.splice(0).map((store) => store.close())); });

function response(name = 'load', startLine = 1, confidence = 0.8) {
  return `Suggested facts.\n\n\`\`\`codeai-model\n${JSON.stringify({
    schema: 'codeai.software-model.v1',
    entities: [{ key: name, kind: 'function', name, location: { filename: 'db.ts', startLine }, confidence }],
    relations: [],
  })}\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\`\nDone.`;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-model-turn-'));
  const checkoutPath = path.join(root, 'repo');
  await mkdir(checkoutPath);
  const store = new SessionStore(path.join(root, 'data'));
  stores.push(store);
  const models = new RepositoryModelStore();
  const config = { ...getConfig(), dataDir: path.join(root, 'data') };
  const spy = vi.spyOn(store, 'completeAssistantMessage');
  async function turn(finalText: string, options: { text?: string; runner?: AgentProcessRunner; storeFailure?: boolean } = {}) {
    const session = await store.createSession({ provider: 'claude' });
    const user = {
      id: crypto.randomUUID(), role: 'user' as const, authorId: session.participants.find((p) => p.kind === 'human')!.id,
      addressedParticipantId: session.primaryAgentId, text: options.text ?? '/model\nExplore db.ts',
      createdAt: new Date().toISOString(), status: 'sending' as const, diagramAttachments: [],
    };
    await store.appendUserMessage(session.id, user);
    const events: AgentEvent[] = [];
    if (options.storeFailure) spy.mockRejectedValueOnce(new Error('disk full'));
    const prompts: string[] = [];
    const run = runConversation({
      runId: crypto.randomUUID(), session: await store.getSession(session.id),
      request: { sessionId: session.id, participantId: session.primaryAgentId, messageId: user.id, text: user.text, diagramAttachments: [], mode: 'ask' },
      checkout: { id: 'checkout', name: 'Repo', relativePath: 'repo', realPath: checkoutPath },
      config, sessionStore: store, transcriptDelta: '', signal: new AbortController().signal, modelStore: models,
      emit: (event) => {
        if (event.type === 'assistant-message') expect(spy).toHaveBeenCalledWith(session.id, session.primaryAgentId, user.id, event.message);
        events.push(event);
      },
      runner: options.runner ?? { run: async (input) => {
        prompts.push(input.prompt);
        return { finalText, sessionId: 'provider', durationMs: 1, outputBytes: Buffer.byteLength(finalText) };
      } },
    });
    return { run, events, sessionId: session.id, prompts };
  }
  return { store, models, checkoutPath, turn };
}

describe('software-model producer in completed conversations', () => {
  it('captures suggestions alongside prose/Mermaid after durable completion and refreshes across sessions', async () => {
    const { store, models, checkoutPath, turn } = await fixture();
    const first = await turn(response());
    await first.run;
    const saved = await store.getSession(first.sessionId);
    expect(saved.messages[0].status).toBe('sent');
    const answer = saved.messages[1];
    expect(answer.role).toBe('assistant');
    if (answer.role !== 'assistant') throw new Error('Missing assistant');
    expect(answer.blocks.map((b) => b.kind)).toEqual(['markdown', 'code', 'markdown', 'diagram', 'markdown']);
    expect(answer.blocks[1]).toMatchObject({ warning: expect.stringContaining('LLM') });
    expect(first.prompts[0]).toContain('codeai-model');
    expect(first.events.at(-1)).toMatchObject({ type: 'done', cancelled: false });
    const second = await turn(response('load', 5, 0.4));
    await second.run;
    expect(models.get(checkoutPath).entities).toEqual([expect.objectContaining({
      id: 'function:db.ts#load', origin: 'llm', location: { filename: 'db.ts', startLine: 5 }, confidence: 0.4,
    })]);
  });

  it.each([
    ['Hello', 'Ordinary answer', 0],
    ['/model\nExplore', 'No structured facts found.', 0],
    ['Hello', response(), 0],
    ['/model\nExplore', 'Before\n```codeai-model\n{invalid}\n```\nAfter', 0],
    ['/model\nExplore', `${response()}\n\`\`\`codeai-model\n{}`, 0],
  ])('completes %s with missing or rejected model output', async (text, finalText, count) => {
    const { models, checkoutPath, turn, store } = await fixture();
    const result = await turn(finalText, { text });
    await result.run;
    expect(models.get(checkoutPath).entities).toHaveLength(count);
    expect((await store.getSession(result.sessionId)).messages[1].status).toBe('complete');
    expect(result.events.at(-1)?.type).toBe('done');
  });

  it('leaves accumulation unchanged when provider execution or answer persistence fails', async () => {
    const { models, checkoutPath, turn } = await fixture();
    await (await turn(response())).run;
    const before = models.get(checkoutPath);
    const failedSave = await turn(response('other'), { storeFailure: true });
    await expect(failedSave.run).rejects.toThrow('disk full');
    expect(failedSave.events.some((event) => event.type === 'assistant-message')).toBe(false);
    expect(models.get(checkoutPath)).toEqual(before);
    const failedProvider = await turn('', { runner: { run: async () => { throw new Error('cancelled'); } } });
    await expect(failedProvider.run).rejects.toThrow('cancelled');
    expect(models.get(checkoutPath)).toEqual(before);
  });

  it('completes rejected output with an oversized diagnostic instead of exceeding the durable warning bound', async () => {
    const { models, checkoutPath, turn, store } = await fixture();
    const json = JSON.stringify({ schema: 'codeai.software-model.v1', entities: [], relations: [], ['x'.repeat(5000)]: true });
    const result = await turn(`Before\n\`\`\`codeai-model\n${json}\n\`\`\`\nOrdinary answer complete.`);
    await result.run;
    const saved = await store.getSession(result.sessionId);
    expect(saved.messages[1].status).toBe('complete');
    expect(models.get(checkoutPath).entities).toHaveLength(0);
    const answer = saved.messages[1];
    if (answer.role !== 'assistant') throw new Error('Missing assistant');
    const code = answer.blocks.find((block) => block.kind === 'code');
    expect(code?.warning).toContain('Software model rejected');
    expect(code?.warning?.length).toBeLessThan(4096);
    expect(code?.source).toBe(json);
  });

  it('merges independently completed concurrent read turns without losing either discovery', async () => {
    const { models, checkoutPath, turn } = await fixture();
    const one = await turn(response('one'));
    const two = await turn(response('two'));
    await Promise.all([one.run, two.run]);
    expect(models.get(checkoutPath).entities.map((item) => item.name).sort()).toEqual(['one', 'two']);
  });
});
