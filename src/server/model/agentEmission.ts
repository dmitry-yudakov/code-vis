import { z } from 'zod';
import type { AssistantBlock } from '@/shared/types';
import {
  ENTITY_KINDS, RELATION_KINDS, MODEL_SCHEMA, MODEL_FENCE_LANGUAGE,
  MAX_MODEL_EMISSION_BYTES, MAX_MODEL_EMISSION_ENTITIES, MAX_MODEL_EMISSION_RELATIONS,
  entityId, relationId, type SoftwareModel, type Entity,
} from '@/shared/softwareModel';
import { truncateTextHeadTail, utf8Length } from '@/shared/limits';

export type ModelEmissionResult =
  | { status: 'absent' }
  | { status: 'rejected'; error: string }
  | { status: 'accepted'; emission: SoftwareModel };

const name = z.string().min(1).max(256).refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value), 'Use a canonical name without surrounding whitespace or control characters.');
const filename = z.string().min(1).max(1024).refine((value) =>
  !/[\\:\u0000-\u001f\u007f]/.test(value)
  && value === value.trim()
  && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
'Use a canonical repository-relative path with / separators.');
const location = z.strictObject({
  filename, startLine: z.number().int().min(1).max(10_000_000), endLine: z.number().int().min(1).max(10_000_000).optional(),
}).refine((value) => value.endLine === undefined || value.endLine >= value.startLine, 'endLine precedes startLine.');
const fact = { confidence: z.number().min(0).max(1), description: z.string().max(2000).optional() };
const emissionSchema = z.strictObject({
  schema: z.literal(MODEL_SCHEMA),
  entities: z.array(z.strictObject({
    key: name, kind: z.enum(ENTITY_KINDS), name, container: name.optional(), location: location.optional(), ...fact,
  })).max(MAX_MODEL_EMISSION_ENTITIES),
  relations: z.array(z.strictObject({
    kind: z.enum(RELATION_KINDS), source: name, target: name, ...fact,
  })).max(MAX_MODEL_EMISSION_RELATIONS),
});

// Zod includes unknown field names in diagnostics. Keep untrusted names within the message schema.
const rejected = (error: string): ModelEmissionResult => ({ status: 'rejected', error: truncateTextHeadTail(error, 1000) });

/** Validate and construct every fact before exposing any of them to the accumulator. */
export function parseAgentModel(source: string): ModelEmissionResult {
  if (utf8Length(source) > MAX_MODEL_EMISSION_BYTES) return rejected('Model JSON exceeds 128 KiB.');
  let value: unknown;
  try { value = JSON.parse(source); } catch { return rejected('Model output is not valid JSON.'); }
  const parsed = emissionSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return rejected(`Invalid model at ${issue.path.join('.') || 'root'}: ${issue.message}`);
  }

  const entities: Entity[] = [];
  const idsByKey = new Map<string, string>();
  const groups = new Map<string, typeof parsed.data.entities>();
  for (const item of parsed.data.entities) {
    if (idsByKey.has(item.key)) return rejected(`Duplicate entity key: ${item.key}.`);
    idsByKey.set(item.key, '');
    if (ENTITY_KINDS.slice(0, 6).some((kind) => kind === item.kind) && !item.location) {
      return rejected(`Structural entity ${item.key} requires a location.`);
    }
    if (item.kind === 'method' && !item.container) return rejected(`Method ${item.key} requires its owning container.`);
    const base = entityId({ ...item, file: item.location?.filename });
    const group = groups.get(base) ?? [];
    group.push(item);
    groups.set(base, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => (left.location?.startLine ?? 0) - (right.location?.startLine ?? 0));
    for (const [ordinal, item] of group.entries()) {
      if (ordinal && (!item.location || item.location.startLine === group[ordinal - 1].location?.startLine)) {
        return rejected(`Ambiguous same-name entity locations: ${item.name}.`);
      }
      const id = entityId({ ...item, file: item.location?.filename, ordinal });
      idsByKey.set(item.key, id);
      const { key: _key, ...fields } = item;
      entities.push({ ...fields, id, origin: 'llm' });
    }
  }
  const relations: SoftwareModel['relations'] = [];
  const relationIds = new Set<string>();
  for (const item of parsed.data.relations) {
    const source = idsByKey.get(item.source);
    const target = idsByKey.get(item.target);
    if (!source || !target) return rejected('A relation endpoint is missing from this emission.');
    const id = relationId(item.kind, source, target);
    if (relationIds.has(id)) return rejected('Duplicate relation.');
    relationIds.add(id);
    relations.push({ ...item, id, source, target, origin: 'llm' });
  }
  return { status: 'accepted', emission: { entities, relations } };
}

/** The JSON stays an ordinary copyable code block; its warning explains suggested provenance. */
export function readModelEmission(blocks: AssistantBlock[], requested: boolean): ModelEmissionResult {
  const modelBlocks = blocks.filter((block): block is Extract<AssistantBlock, { kind: 'code' }> => (
    block.kind === 'code' && block.language === MODEL_FENCE_LANGUAGE
  ));
  if (!modelBlocks.length) return { status: 'absent' };
  const result = !requested ? rejected('Start the request with /model on its own line to capture suggestions.')
    : modelBlocks.length !== 1 ? rejected('Emit exactly one model block per turn.')
      : modelBlocks[0].warning ? rejected('The model fence was not closed.')
        : parseAgentModel(modelBlocks[0].source);
  for (const block of modelBlocks) {
    block.warning = result.status === 'rejected'
      ? `Software model rejected: ${result.error}`
      : 'Software-model suggestions (LLM). Confidence is an estimate, including descriptions. Accumulation is bounded and temporary; restart or repository eviction clears it.';
  }
  return result;
}
