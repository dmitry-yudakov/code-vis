/** The first producer's deliberately small subset of the software-model vocabulary. */
export const ENTITY_KINDS = [
  'file', 'class', 'function', 'method', 'variable', 'constant',
  'db-table', 'external-service', 'api-endpoint', 'api-call',
] as const;
export const RELATION_KINDS = [
  'contains', 'declares', 'imports', 'calls', 'exposes', 'consumes', 'queries', 'depends-on', 'bridge',
] as const;
export type EntityKind = typeof ENTITY_KINDS[number];
export type RelationKind = typeof RELATION_KINDS[number];
export type Provenance = 'static' | 'llm' | 'derived' | 'user';

export interface SourceLocation {
  filename: string;
  startLine: number;
  endLine?: number;
}

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  container?: string;
  location?: SourceLocation;
  origin: Provenance;
  confidence?: number;
  /** Suggested by the producer; never evidence of static verification. */
  description?: string;
}

export interface Relation {
  id: string;
  kind: RelationKind;
  source: string;
  target: string;
  origin: Provenance;
  confidence?: number;
  description?: string;
}

export interface SoftwareModel {
  entities: Entity[];
  relations: Relation[];
}

export const MODEL_FENCE_LANGUAGE = 'codeai-model';
export const MODEL_SCHEMA = 'codeai.software-model.v1';
export const MAX_MODEL_EMISSION_BYTES = 128 * 1024;
export const MAX_MODEL_EMISSION_ENTITIES = 256;
export const MAX_MODEL_EMISSION_RELATIONS = 512;

/** No implicit extraction: a standalone first-line command opts this turn in. */
export function isSoftwareModelRequest(text: string): boolean {
  return /^\/model(?:\r?\n|$)/.test(text);
}

function escapePart(value: string, filename = false): string {
  return value.replace(filename ? /[%#:>]/g : /[%#.$:>]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Positions refresh the fact; only same-name siblings need a source-order ordinal. */
export function entityId(parts: {
  kind: EntityKind; file?: string; container?: string; name: string; ordinal?: number;
}): string {
  const name = `${parts.container ? `${escapePart(parts.container)}.` : ''}${escapePart(parts.name)}`;
  const ordinal = parts.ordinal ? `$${parts.ordinal}` : '';
  return `${parts.kind}:${parts.file ? `${escapePart(parts.file, true)}#` : ''}${name}${ordinal}`;
}

export function relationId(kind: RelationKind, source: string, target: string): string {
  return `${kind}:${source}->${target}`;
}
