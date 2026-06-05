/**
 * Dev smoke check for the M2 arrangement pass (docs/vision.md "Arrangement").
 *
 *   yarn arrange:smoke   # from server/, with CODEAI_LLM_* env configured
 *
 * Runs arrangeReview() over a hand-built review slice and prints the validated
 * Arrangement JSON — so you can eyeball the model's editorial choices (what it
 * shows vs. collapses/hides, how it groups, its reading order) without the web.
 * In the app the same pass is triggered on demand by the "Arrange with AI"
 * button; this script is the headless equivalent for quick model checks.
 *
 * The fixture mimics a small review: a changed `getUser` that gains a new helper
 * and calls into a db layer, plus a context util and a test — enough structure
 * for the model to actually triage.
 */
import { getLlmClient } from '../llm';
import { arrangeReview } from './arrangeReview';
import { Entity, Relation } from '../types';

const entities: Entity[] = [
  {
    id: 'file:src/api.ts',
    kind: 'file',
    name: 'api.ts',
    location: { filename: 'src/api.ts' },
    origin: 'static',
    changeStatus: 'modified',
  },
  {
    id: 'function:src/api.ts#getUser',
    kind: 'function',
    name: 'getUser',
    location: { filename: 'src/api.ts' },
    origin: 'static',
    changeStatus: 'modified',
  },
  {
    id: 'function:src/api.ts#buildUserKey',
    kind: 'function',
    name: 'buildUserKey',
    location: { filename: 'src/api.ts' },
    origin: 'static',
    changeStatus: 'added',
  },
  {
    id: 'file:src/db.ts',
    kind: 'file',
    name: 'db.ts',
    location: { filename: 'src/db.ts' },
    origin: 'static',
  },
  {
    id: 'function:src/db.ts#query',
    kind: 'function',
    name: 'query',
    location: { filename: 'src/db.ts' },
    origin: 'static',
  },
  {
    id: 'file:src/log.ts',
    kind: 'file',
    name: 'log.ts',
    location: { filename: 'src/log.ts' },
    origin: 'static',
  },
  {
    id: 'function:src/log.ts#debug',
    kind: 'function',
    name: 'debug',
    location: { filename: 'src/log.ts' },
    origin: 'static',
  },
  {
    id: 'file:src/api.test.ts',
    kind: 'file',
    name: 'api.test.ts',
    location: { filename: 'src/api.test.ts' },
    origin: 'static',
  },
];

const relations: Relation[] = [
  rel('contains', 'file:src/api.ts', 'function:src/api.ts#getUser'),
  rel('contains', 'file:src/api.ts', 'function:src/api.ts#buildUserKey'),
  rel('contains', 'file:src/db.ts', 'function:src/db.ts#query'),
  rel('contains', 'file:src/log.ts', 'function:src/log.ts#debug'),
  rel('imports', 'file:src/api.ts', 'file:src/db.ts'),
  rel('imports', 'file:src/api.ts', 'file:src/log.ts'),
  rel('calls', 'function:src/api.ts#getUser', 'function:src/api.ts#buildUserKey'),
  rel('calls', 'function:src/api.ts#getUser', 'function:src/db.ts#query'),
  rel('calls', 'function:src/api.ts#getUser', 'function:src/log.ts#debug'),
];

function rel(
  kind: Relation['kind'],
  source: string,
  target: string
): Relation {
  return { id: `${kind}:${source}->${target}`, kind, source, target, origin: 'static' };
}

async function main(): Promise<void> {
  const client = getLlmClient();
  if (!client) {
    console.log(
      'no client configured — set CODEAI_LLM_BASE_URL + CODEAI_LLM_MODEL (or CODEAI_LLM_PROVIDER=claude-code|codex)'
    );
    return;
  }

  console.log(`arranging ${entities.length} entities via ${client.id} …`);
  const arrangement = await arrangeReview({ entities, relations }, client);

  if (!arrangement) {
    console.log(
      'no arrangement produced — the geometry-engine fallback path (see any [arrange] warning above)'
    );
    return;
  }
  console.log(JSON.stringify(arrangement, null, 2));
}

main();
