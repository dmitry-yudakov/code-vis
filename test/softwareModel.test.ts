import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { entityId, relationId, isSoftwareModelRequest, MAX_MODEL_EMISSION_BYTES } from '@/shared/softwareModel';
import { parseAgentModel, readModelEmission } from '@/server/model/agentEmission';
import { RepositoryModelStore } from '@/server/model/repositoryModelStore';
import { buildConversationPrompt } from '@/server/conversation/prompt';
import { parseAssistantResponse } from '@/server/conversation/responseParser';
import type { AssistantBlock } from '@/shared/types';

const entity = (key: string, name = key, startLine = 10) => ({
  key, kind: 'function', name, location: { filename: 'src/db.ts', startLine },
  confidence: 0.8, description: `Suggested role of ${name}`,
});
const envelope = (entities: Record<string, unknown>[] = [entity('getUser'), entity('saveUser', 'saveUser', 20)], relations: Record<string, unknown>[] = [
  { kind: 'calls', source: 'saveUser', target: 'getUser', confidence: 0.6 },
]) => ({ schema: 'codeai.software-model.v1', entities, relations });
function accepted(value: unknown) {
  const parsed = parseAgentModel(JSON.stringify(value));
  expect(parsed.status).toBe('accepted');
  if (parsed.status !== 'accepted') throw new Error('Expected accepted model');
  return parsed.emission;
}
const blocks = (value: unknown): AssistantBlock[] => [{ kind: 'code', language: 'codeai-model', source: JSON.stringify(value) }];

describe('software-model identity', () => {
  it('retains reference ids, containers and ordinals without source positions', () => {
    expect(entityId({ kind: 'function', file: 'src/db.ts', name: 'getUser' })).toBe('function:src/db.ts#getUser');
    expect(entityId({ kind: 'method', file: 'src/db.ts', container: 'Repo', name: 'getUser', ordinal: 1 })).toBe('method:src/db.ts#Repo.getUser$1');
    expect(entityId({ kind: 'db-table', name: 'public.users' })).toBe('db-table:public%2Eusers');
    expect(relationId('calls', 'function:f#a', 'function:f#b')).toBe('calls:function:f#a->function:f#b');
  });

  it('prevents separator collisions between names, containers, ordinals and paths', () => {
    const id = (name: string, container?: string, ordinal?: number) => entityId({ kind: 'method', file: 'a.ts', name, container, ordinal });
    expect(id('A.run')).not.toBe(id('run', 'A'));
    expect(id('run$1')).not.toBe(id('run', undefined, 1));
    expect(id('a#b')).not.toBe(id('a%23b'));
    expect(entityId({ kind: 'function', file: 'a#b.ts', name: 'c' })).not.toBe(entityId({ kind: 'function', file: 'a', name: 'b.ts#c' }));
  });

  it('assigns sibling ordinals by source order independent of emission order or edits above', () => {
    const first = accepted(envelope([entity('late', 'run', 40), entity('early', 'run', 10)], []));
    const shifted = accepted(envelope([entity('earlier', 'run', 15), entity('later', 'run', 45)], []));
    expect(first.entities.map((item) => item.id)).toEqual(shifted.entities.map((item) => item.id));
    expect(first.entities.map((item) => item.id)).toEqual(['function:src/db.ts#run', 'function:src/db.ts#run$1']);
    expect(shifted.entities[0].location?.startLine).toBe(15);
  });
});

describe('whole-emission validation and provenance', () => {
  it('assigns llm origin and retains confidence and suggested descriptions on every fact', () => {
    const model = accepted(envelope());
    expect(model.entities[0]).toMatchObject({ origin: 'llm', confidence: 0.8, description: 'Suggested role of getUser' });
    expect(model.relations[0]).toMatchObject({ origin: 'llm', confidence: 0.6, source: 'function:src/db.ts#saveUser', target: 'function:src/db.ts#getUser' });
    expect(model.entities[0]).not.toHaveProperty('key');
    const resource = accepted(envelope([{ key: 'users', kind: 'db-table', name: 'public.users', confidence: 0.7 }], []));
    expect(resource.entities[0].id).toBe('db-table:public%2Eusers');
  });

  it.each([
    { ...envelope(), schema: 'wrong' },
    envelope([{ ...entity('a'), id: 'invented' }], []),
    envelope([{ ...entity('a'), origin: 'static' }], []),
    envelope([{ ...entity('a'), kind: 'unknown' }], []),
    envelope([{ ...entity('a'), confidence: 1.1 }], []),
    envelope([{ ...entity('a'), confidence: -0.1 }], []),
    envelope([{ ...entity('a'), confidence: undefined }], []),
    envelope([{ ...entity('a'), location: undefined }], []),
    envelope([{ ...entity('a'), kind: 'method' }], []),
    envelope([{ ...entity('a'), location: { filename: 'src/db.ts', startLine: 5, endLine: 4 } }], []),
    envelope([entity('same'), entity('same', 'other', 20)], []),
    envelope([entity('a', 'run'), entity('b', 'run')], []),
    envelope([entity('a')], [{ kind: 'calls', source: 'a', target: 'missing', confidence: 0.8 }]),
    envelope(undefined, [{ kind: 'calls', source: 'saveUser', target: 'getUser', confidence: 0.8, origin: 'user' }]),
    envelope(undefined, [{ kind: 'calls', source: 'saveUser', target: 'getUser', confidence: 0.8 }, { kind: 'calls', source: 'saveUser', target: 'getUser', confidence: 0.9 }]),
  ])('rejects the whole malformed emission %#', (value) => {
    expect(parseAgentModel(JSON.stringify(value))).toMatchObject({ status: 'rejected', error: expect.any(String) });
  });

  it.each(['/etc/passwd', '../secret', 'src/../db.ts', './src/db.ts', 'src//db.ts', 'C:/secret', 'src\\db.ts', 'src/db.ts\u0000'])
    ('rejects noncanonical paths %s', (filename) => {
      expect(parseAgentModel(JSON.stringify(envelope([{ ...entity('a'), location: { filename, startLine: 1 } }], []))).status).toBe('rejected');
    });

  it('bounds JSON bytes, arrays and text', () => {
    expect(parseAgentModel('{').status).toBe('rejected');
    expect(parseAgentModel(' '.repeat(MAX_MODEL_EMISSION_BYTES + 1)).status).toBe('rejected');
    expect(parseAgentModel(JSON.stringify(envelope(Array.from({ length: 257 }, (_, i) => entity(`e${i}`, `e${i}`, i + 1)), []))).status).toBe('rejected');
    expect(parseAgentModel(JSON.stringify(envelope([{ ...entity('a'), description: 'x'.repeat(2001) }], []))).status).toBe('rejected');
  });
});

describe('opt-in output alongside ordinary answers', () => {
  it('uses an exact first-line command and adds the contract only when opted in', () => {
    expect(isSoftwareModelRequest('/model\nExplore db')).toBe(true);
    expect(isSoftwareModelRequest('/model\r\nExplore db')).toBe(true);
    for (const text of ['hi', 'Explain /model', '/models', '/model Explore', 'hi\n/model']) expect(isSoftwareModelRequest(text)).toBe(false);
    const base = { attachmentDirectory: '/context', attachedCanvasNames: [] };
    expect(buildConversationPrompt({ ...base, userText: 'hi' })).not.toContain('codeai-model');
    const prompt = buildConversationPrompt({ ...base, userText: '/model\nExplore db' });
    expect(prompt).toContain('codeai-model');
    expect(prompt).toContain('codeai.software-model.v1');
    expect(prompt).toContain('source order');
  });

  it('preserves copyable suggestions and rejects unsolicited, multiple or unclosed output', async () => {
    expect(readModelEmission([{ kind: 'markdown', markdown: 'Hello' }], true)).toEqual({ status: 'absent' });
    const unsolicited = blocks(envelope());
    expect(readModelEmission(unsolicited, false).status).toBe('rejected');
    expect(unsolicited[0]).toMatchObject({ warning: expect.stringContaining('/model') });
    expect(readModelEmission([...blocks(envelope()), ...blocks(envelope())], true).status).toBe('rejected');
    const unclosed = await parseAssistantResponse('Before\n```codeai-model\n{}', {
      sessionId: 's', messageId: 'm', repositoryRoot: '/tmp', derivedFromDiagramIds: [], maxMermaidBytes: 10_000, maxDiagrams: 8,
    });
    expect(readModelEmission([...blocks(envelope()), ...unclosed], true).status).toBe('rejected');
    const good = blocks(envelope());
    expect(readModelEmission(good, true).status).toBe('accepted');
    expect(good[0]).toMatchObject({ kind: 'code', source: JSON.stringify(envelope()), warning: expect.stringContaining('LLM') });
  });

  it('rejects a valid prefix followed by an unclosed model opener at EOF without a newline', async () => {
    const markdown = `\`\`\`codeai-model\n${JSON.stringify(envelope())}\n\`\`\`\n\`\`\`codeai-model`;
    const parsed = await parseAssistantResponse(markdown, {
      sessionId: 's', messageId: 'm', repositoryRoot: '/tmp', derivedFromDiagramIds: [], maxMermaidBytes: 10_000, maxDiagrams: 8,
    });
    expect(readModelEmission(parsed, true).status).toBe('rejected');
  });
});

describe('bounded repository-local accumulation', () => {
  it('refreshes whole facts by id and retains absent facts, with independent checkout state', () => {
    const store = new RepositoryModelStore();
    expect(store.merge('/repo/a', accepted(envelope())).ok).toBe(true);
    const refreshed = accepted(envelope([{ ...entity('new-key', 'getUser', 15), confidence: 0.4, description: 'Refreshed suggestion' }], []));
    expect(store.merge('/repo/a', refreshed).ok).toBe(true);
    expect(store.get('/repo/a')).toMatchObject({ entities: [
      { id: 'function:src/db.ts#getUser', confidence: 0.4, description: 'Refreshed suggestion', location: { startLine: 15 } },
      { id: 'function:src/db.ts#saveUser' },
    ], relations: [{ kind: 'calls' }] });
    expect(store.get('/repo/b')).toEqual({ entities: [], relations: [] });
    const copy = store.get('/repo/a');
    copy.entities[0].name = 'mutated';
    expect(store.get('/repo/a').entities[0].name).toBe('getUser');
  });

  it('refuses cumulative bounds atomically and evicts the least recently updated repository', () => {
    const store = new RepositoryModelStore({ maxRepositories: 2, maxEntities: 2, maxRelations: 2, maxBytes: 10_000 });
    const initial = accepted(envelope());
    store.merge('/a', initial);
    expect(store.merge('/a', accepted(envelope([entity('extra')], []))).ok).toBe(false);
    expect(store.get('/a')).toEqual(initial);
    store.merge('/b', initial);
    store.merge('/a', initial);
    store.merge('/c', initial);
    expect(store.get('/b').entities).toHaveLength(0);
    expect(store.get('/a').entities).toHaveLength(2);
    expect(new RepositoryModelStore({ maxBytes: 10 }).merge('/a', initial).ok).toBe(false);
  });

  it('rejects a partial same-name sibling group without overwriting a sibling or redirecting relations', () => {
    const store = new RepositoryModelStore();
    const relation = [{ kind: 'calls', source: 'late', target: 'helper', confidence: 0.8 }];
    const full = accepted(envelope([entity('early', 'run', 10), entity('late', 'run', 40), entity('helper', 'helper', 60)], relation));
    store.merge('/repo', full);
    const partial = accepted(envelope([entity('late', 'run', 40), entity('helper', 'helper', 60)], relation));
    expect(store.merge('/repo', partial)).toMatchObject({ ok: false, error: expect.stringContaining('sibling') });
    expect(store.get('/repo')).toEqual(full);
  });

  it('rejects a later larger sibling group rather than redirecting an edge from an earlier partial pass', () => {
    const store = new RepositoryModelStore();
    const partial = accepted(envelope([entity('late', 'run', 40), entity('helper', 'helper', 60)], [
      { kind: 'calls', source: 'late', target: 'helper', confidence: 0.8 },
    ]));
    store.merge('/repo', partial);
    const full = accepted(envelope([entity('early', 'run', 10), entity('late', 'run', 40)], []));
    expect(store.merge('/repo', full)).toMatchObject({ ok: false, error: expect.stringContaining('sibling') });
    expect(store.get('/repo')).toEqual(partial);
  });
});

it('merges the three recorded independent real-Claude passes without identity churn', async () => {
  const expectedEntities = [
    'class:src/server/model/repositoryModelStore.ts#RepositoryModelStore',
    'function:src/server/conversation/responseParser.ts#parseAssistantResponse',
    'function:src/server/conversation/responseParser.ts#scanFences',
    'method:src/server/model/repositoryModelStore.ts#RepositoryModelStore.get',
    'method:src/server/model/repositoryModelStore.ts#RepositoryModelStore.merge',
  ];
  const store = new RepositoryModelStore();
  let previousRelations: string[] | undefined;
  for (let pass = 1; pass <= 3; pass++) {
    const markdown = await readFile(new URL(`./fixtures/software-model/claude-pass-${pass}.txt`, import.meta.url), 'utf8');
    const parsed = readModelEmission(await parseAssistantResponse(markdown, {
      sessionId: 'probe', messageId: `pass-${pass}`, repositoryRoot: '/tmp', derivedFromDiagramIds: [],
      maxMermaidBytes: 100_000, maxDiagrams: 8,
    }), true);
    expect(parsed.status).toBe('accepted');
    if (parsed.status !== 'accepted') throw new Error('Recorded pass was rejected');
    expect(parsed.emission.entities.map((item) => item.id).sort()).toEqual(expectedEntities);
    const relationIds = parsed.emission.relations.map((item) => item.id).sort();
    expect(relationIds).toHaveLength(3);
    if (previousRelations) expect(relationIds).toEqual(previousRelations);
    previousRelations = relationIds;
    expect(store.merge('/codeai', parsed.emission).ok).toBe(true);
    expect(store.get('/codeai').entities).toHaveLength(5);
    expect(store.get('/codeai').relations).toHaveLength(3);
  }
});
