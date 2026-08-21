/**
 * `arrangeReview()` — the M2 LLM arrangement pass (docs/vision.md "Arrangement",
 * MVP Milestone 2 step 5). Given the static review slice (`entities`/`relations`
 * from buildReviewEntityModel), it asks the provider-agnostic LLM client for an
 * editorial `Arrangement`: what to show vs. collapse/hide first, an editorial
 * grouping into labeled regions, and reading order / emphasis.
 *
 * The discipline the vision mandates, all enforced here so the consumer stays
 * a one-liner:
 *  - opt-in        — null client (feature unconfigured) → returns undefined.
 *  - scoped        — only the already-small review slice is sent.
 *  - fail-safe     — any throw / timeout / unparseable / id-less output →
 *                    undefined, so the caller renders via the geometry engine
 *                    unchanged. This layer NEVER throws.
 *  - validated     — output is intersected with the slice: unknown ids are
 *                    dropped, and every CHANGED entity is forced `shown` (a
 *                    changed declaration must never be hidden from its own
 *                    review). The LLM cannot widen the node set or coordinates.
 *  - cached        — per (client, slice-signature), in-memory / per-process for
 *                    now (the vision's durable store comes with persistence).
 *
 * Pure-transport `complete()` returns raw text; provenance (`origin: 'llm'`) is
 * assigned here, exactly as the client contract intends.
 */
import { Arrangement, ArrangementRegion, Entity, Relation, Visibility } from '../types';
import { LlmClient } from '../llm';

export interface ReviewSlice {
  entities: Entity[];
  relations: Relation[];
}

export interface ArrangeOptions {
  /**
   * Per-call timeout override. Left unset by normal callers so the client
   * adapter's own configured timeout governs — which already honors
   * `CODEAI_LLM_TIMEOUT_MS`. (Passing a value here would shadow that env, the
   * bug that made arrangement time out at a fixed 30s despite the env.)
   */
  timeoutMs?: number;
}

const VISIBILITY_VALUES: ReadonlySet<string> = new Set<Visibility>([
  'shown',
  'collapsed',
  'hidden',
]);

const SYSTEM_PROMPT = [
  'You are an editorial director for a software code-review diagram. You are given',
  'a small set of code entities (files, classes, functions, methods, variables) and',
  'the relations between them, all drawn from a single git change under review. Your',
  'job is to make the change comprehensible at a glance by deciding INITIAL',
  'VISIBILITY and an editorial GROUPING — not geometry.',
  '',
  'Rules:',
  '- Respond with ONLY a single JSON object. No prose, no markdown code fences.',
  '- Never invent ids. Use only entity ids that appear in the input.',
  '- Do not emit coordinates, sizes, or x/y — a layout engine handles placement.',
  '- Every entity with a "changed" field MUST be "shown".',
  '- Fold or drop pure context that is not needed to understand the change:',
  '  "collapsed" keeps an entity but folded; "hidden" drops it initially (the user',
  '  can still reveal it). Prefer revealing the few entities that tell the change\'s',
  '  story and hiding the noise.',
  '- Group entities that form one sub-story into a labeled region.',
  '',
  'JSON schema (all fields optional — omit what you do not use):',
  '{',
  '  "visibility": { "<entityId>": "shown" | "collapsed" | "hidden" },',
  '  "order": ["<entityId>", ...],        // reading order, most important first',
  '  "emphasis": ["<entityId>", ...],     // entities to lead with',
  '  "regions": [',
  '    { "id": "<slug>", "label": "<short label>", "entityIds": ["<entityId>", ...] }',
  '  ]',
  '}',
].join('\n');

/**
 * In-memory arrangement cache, keyed by (client id + slice signature). Cleared
 * wholesale by clearArrangementCache() — wired to the file watch later so a
 * re-extraction re-asks. Capped to bound a long-lived process.
 */
const cache = new Map<string, Arrangement>();
const CACHE_CAP = 64;

/** Drop the whole cache. For tests today; the file-watch invalidation hook later. */
export function clearArrangementCache(): void {
  cache.clear();
}

export async function arrangeReview(
  slice: ReviewSlice,
  client: LlmClient | null,
  options: ArrangeOptions = {}
): Promise<Arrangement | undefined> {
  if (!client) return undefined;
  const { entities, relations } = slice;
  if (entities.length === 0) return undefined;

  const signature = sliceSignature(client.id, entities, relations);
  const cached = cache.get(signature);
  if (cached) return cached;

  let raw: string;
  try {
    raw = await client.complete({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(entities, relations),
      // Undefined unless a caller explicitly overrides → the adapter's own
      // timeout (CODEAI_LLM_TIMEOUT_MS, else its built-in default) applies.
      timeoutMs: options.timeoutMs,
    });
  } catch (err) {
    console.warn(
      `[arrange] ${client.id} failed — falling back to geometry engine:`,
      err instanceof Error ? err.message : err
    );
    return undefined;
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    console.warn(`[arrange] ${client.id} returned unparseable output — falling back`);
    return undefined;
  }

  const arrangement = coerceArrangement(parsed, entities);
  if (arrangement) remember(signature, arrangement);
  return arrangement;
}

function buildUserPrompt(entities: Entity[], relations: Relation[]): string {
  // Compact projection — names/kinds/paths/change-status + id-only edges. Short
  // keys keep the prompt cheap; the slice is already pinned small.
  const e = entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    path: entity.location?.filename,
    ...(entity.changeStatus ? { changed: entity.changeStatus } : {}),
  }));
  const r = relations.map((relation) => ({
    kind: relation.kind,
    from: relation.source,
    to: relation.target,
  }));
  return `Slice under review:\n${JSON.stringify({ entities: e, relations: r }, null, 2)}`;
}

/** Tolerantly extract the first top-level JSON object (handles ```json fences /
 *  leading prose some models emit). Returns a plain object or null. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Intersect the raw model output with the slice and apply the guard-rails.
 *  Returns undefined when nothing meaningful survives (→ geometry-engine path). */
function coerceArrangement(
  raw: Record<string, unknown>,
  entities: Entity[]
): Arrangement | undefined {
  const ids = new Set(entities.map((entity) => entity.id));
  const changedIds = new Set(
    entities.filter((entity) => entity.changeStatus).map((entity) => entity.id)
  );

  const result: Arrangement = { origin: 'llm' };

  const visibility = coerceVisibility(raw.visibility, ids, changedIds);
  if (visibility) result.visibility = visibility;

  const order = knownIdList(raw.order, ids);
  if (order.length) result.order = order;

  const emphasis = knownIdList(raw.emphasis, ids);
  if (emphasis.length) result.emphasis = emphasis;

  const regions = coerceRegions(raw.regions, ids);
  if (regions.length) result.regions = regions;

  const hasSignal =
    result.visibility || result.order || result.emphasis || result.regions;
  return hasSignal ? result : undefined;
}

function coerceVisibility(
  raw: unknown,
  ids: Set<string>,
  changedIds: Set<string>
): Record<string, Visibility> | undefined {
  const visibility: Record<string, Visibility> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!ids.has(id)) continue; // never widen the node set
      if (typeof value === 'string' && VISIBILITY_VALUES.has(value)) {
        visibility[id] = value as Visibility;
      }
    }
  }
  // Guard-rail: a changed entity is never hidden from its own review.
  for (const id of Array.from(changedIds)) {
    if (visibility[id] && visibility[id] !== 'shown') visibility[id] = 'shown';
  }
  return Object.keys(visibility).length ? visibility : undefined;
}

function coerceRegions(raw: unknown, ids: Set<string>): ArrangementRegion[] {
  if (!Array.isArray(raw)) return [];
  const regions: ArrangementRegion[] = [];
  const seenIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const entityIds = knownIdList(candidate.entityIds, ids);
    if (entityIds.length === 0) continue; // an empty region is noise

    let id =
      typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `region-${regions.length + 1}`;
    while (seenIds.has(id)) id = `${id}-${regions.length + 1}`;
    seenIds.add(id);

    regions.push({
      id,
      label: typeof candidate.label === 'string' ? candidate.label : undefined,
      entityIds,
    });
  }

  return regions;
}

/** Filter a value to the string ids present in the slice, de-duped, order kept. */
function knownIdList(raw: unknown, ids: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string' || !ids.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function remember(signature: string, arrangement: Arrangement): void {
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(signature, arrangement);
}

/** Stable signature of the slice: which entities (+ their change-status) and
 *  which relations are in play, per client. Sorted so it is order-independent. */
function sliceSignature(
  clientId: string,
  entities: Entity[],
  relations: Relation[]
): string {
  const e = entities
    .map((entity) => `${entity.id}#${entity.changeStatus ?? ''}`)
    .sort();
  const r = relations.map((relation) => relation.id).sort();
  return `${clientId}|${e.join(',')}|${r.join(',')}`;
}
