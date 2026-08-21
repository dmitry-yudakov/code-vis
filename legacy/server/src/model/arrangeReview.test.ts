import { LlmClient } from '../llm';
import { Entity, Relation } from '../types';
import { arrangeReview, clearArrangementCache } from './arrangeReview';

/** A fake LlmClient that returns canned text — exercises the pure
 *  parse/validate/guard-rail path with no real model. Unique id per call so the
 *  per-(client, slice) cache never bleeds between tests. */
let clientSeq = 0;
function fakeClient(reply: string): LlmClient {
  return {
    id: `fake-${clientSeq++}`,
    complete: async () => reply,
  };
}

function throwingClient(): LlmClient {
  return {
    id: `throwing-${clientSeq++}`,
    complete: async () => {
      throw new Error('boom');
    },
  };
}

const entities: Entity[] = [
  {
    id: 'function:src/api.ts#getUser',
    kind: 'function',
    name: 'getUser',
    location: { filename: 'src/api.ts' },
    origin: 'static',
    changeStatus: 'modified',
  },
  {
    id: 'function:src/db.ts#query',
    kind: 'function',
    name: 'query',
    location: { filename: 'src/db.ts' },
    origin: 'static',
  },
  {
    id: 'function:src/log.ts#debug',
    kind: 'function',
    name: 'debug',
    location: { filename: 'src/log.ts' },
    origin: 'static',
  },
];

const relations: Relation[] = [
  {
    id: 'calls:getUser->query',
    kind: 'calls',
    source: 'function:src/api.ts#getUser',
    target: 'function:src/db.ts#query',
    origin: 'static',
  },
];

const slice = { entities, relations };

beforeEach(() => clearArrangementCache());

describe('arrangeReview', () => {
  test('returns undefined when no client is configured (opt-in / fail-safe)', async () => {
    expect(await arrangeReview(slice, null)).toBeUndefined();
  });

  test('returns undefined when the client throws (fail-safe path)', async () => {
    expect(await arrangeReview(slice, throwingClient())).toBeUndefined();
  });

  test('returns undefined on unparseable output', async () => {
    expect(await arrangeReview(slice, fakeClient('not json at all'))).toBeUndefined();
  });

  test('parses a fenced JSON object and keeps only known ids', async () => {
    const reply = [
      'Here is the arrangement:',
      '```json',
      JSON.stringify({
        visibility: {
          'function:src/db.ts#query': 'collapsed',
          'function:src/log.ts#debug': 'hidden',
          'function:does-not-exist': 'hidden', // dropped — not in the slice
        },
        order: [
          'function:src/api.ts#getUser',
          'function:ghost', // dropped
          'function:src/db.ts#query',
        ],
      }),
      '```',
    ].join('\n');

    const arrangement = await arrangeReview(slice, fakeClient(reply));
    expect(arrangement).toEqual({
      origin: 'llm',
      visibility: {
        'function:src/db.ts#query': 'collapsed',
        'function:src/log.ts#debug': 'hidden',
      },
      order: ['function:src/api.ts#getUser', 'function:src/db.ts#query'],
    });
  });

  test('forces every changed entity to shown (guard-rail)', async () => {
    const reply = JSON.stringify({
      visibility: { 'function:src/api.ts#getUser': 'hidden' }, // changed → must flip
    });
    const arrangement = await arrangeReview(slice, fakeClient(reply));
    expect(arrangement?.visibility?.['function:src/api.ts#getUser']).toBe('shown');
  });

  test('drops empty regions and unknown members, fills missing region ids', async () => {
    const reply = JSON.stringify({
      regions: [
        { label: 'User flow', entityIds: ['function:src/api.ts#getUser', 'function:ghost'] },
        { id: 'empty', label: 'Nothing', entityIds: ['function:ghost'] }, // dropped
      ],
    });
    const arrangement = await arrangeReview(slice, fakeClient(reply));
    expect(arrangement?.regions).toEqual([
      {
        id: 'region-1',
        label: 'User flow',
        entityIds: ['function:src/api.ts#getUser'],
      },
    ]);
  });

  test('returns undefined when the model output has no usable signal', async () => {
    const reply = JSON.stringify({ visibility: { 'function:ghost': 'hidden' } });
    expect(await arrangeReview(slice, fakeClient(reply))).toBeUndefined();
  });

  test('caches per (client, slice) — the model is asked once', async () => {
    let calls = 0;
    const client: LlmClient = {
      id: `counting-${clientSeq++}`,
      complete: async () => {
        calls++;
        return JSON.stringify({ emphasis: ['function:src/api.ts#getUser'] });
      },
    };
    await arrangeReview(slice, client);
    await arrangeReview(slice, client);
    expect(calls).toBe(1);
  });
});
