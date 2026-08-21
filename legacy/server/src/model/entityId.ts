import { EntityKind, RelationKind } from '../types';

/**
 * Inputs for the stable entity id / merge key.
 *
 * The id is the key that identifies and merges entities *within* the model. It
 * deliberately does NOT contain `pos` — position lives in `location` and is
 * refreshed on every extraction, so edits *above* a declaration update its
 * location but leave its id intact. See the Identity section of
 * STORY-20260603-static-entity-relation-model.md.
 */
export interface EntityIdParts {
  kind: EntityKind;
  /** Project-relative filename the entity lives in. */
  file: string;
  /** Owning class/module (free for methods, one parent hop for field arrows). */
  container?: string;
  name: string;
  /**
   * Disambiguates genuine same-`(kind,file,container,name)` collisions. Assigned
   * by source order (deterministic + free, the declaration list is pos-sorted).
   * `0` (the default) contributes nothing to the id.
   */
  ordinal?: number;
}

/**
 * Builds the stable entity id / merge key:
 *
 *   `${kind}:${file}#${container ? container + '.' : ''}${name}${ordinal > 0 ? '$' + ordinal : ''}`
 *
 * Examples:
 *   - function:src/db.ts#getUser
 *   - method:src/db.ts#Repo.getUser
 *   - class:src/db.ts#Repo
 *   - constant:src/config.ts#API_BASE
 *   - method:src/db.ts#Repo.getUser$1   (second same-named sibling)
 *
 * `kind` prefixes the id so a `class:file#Foo` and a `function:file#Foo` cannot
 * collide; `container` is included when present; `pos` is never included.
 */
export const entityId = ({
  kind,
  file,
  container,
  name,
  ordinal = 0,
}: EntityIdParts): string => {
  const containerPart = container ? `${container}.` : '';
  const ordinalPart = ordinal > 0 ? `$${ordinal}` : '';
  return `${kind}:${file}#${containerPart}${name}${ordinalPart}`;
};

/**
 * Deterministically assigns the source-order ordinal for each id-part group.
 *
 * Call once per entity, in source (pos-sorted) order: the first entity of a
 * given `(kind, file, container, name)` gets ordinal `0`, the next `1`, etc.
 * Stateful by design — keep a single assigner per extraction pass.
 */
export const createOrdinalAssigner = () => {
  const counts = new Map<string, number>();
  return (parts: Omit<EntityIdParts, 'ordinal'>): number => {
    const key = `${parts.kind}|${parts.file}|${parts.container || ''}|${parts.name}`;
    const ordinal = counts.get(key) || 0;
    counts.set(key, ordinal + 1);
    return ordinal;
  };
};

/** Stable id for a relation, derived from its kind and endpoint entity ids. */
export const relationId = (
  kind: RelationKind,
  source: string,
  target: string
): string => `${kind}:${source}->${target}`;
