import type { Entity, SoftwareModel } from '@/shared/softwareModel';
import { utf8Length } from '@/shared/limits';

interface ModelLimits {
  maxRepositories: number;
  maxEntities: number;
  maxRelations: number;
  maxBytes: number;
}

/** Disposable first-producer accumulation. Story 7 owns durable storage and invalidation. */
export class RepositoryModelStore {
  private readonly models = new Map<string, SoftwareModel>();
  private readonly limits: ModelLimits;

  constructor(limits: Partial<ModelLimits> = {}) {
    this.limits = { maxRepositories: 16, maxEntities: 2000, maxRelations: 4000, maxBytes: 2 * 1024 * 1024, ...limits };
  }

  get(checkoutPath: string): SoftwareModel {
    return structuredClone(this.models.get(checkoutPath) ?? { entities: [], relations: [] });
  }

  /** Synchronous whole-model replacement: concurrent read turns cannot interleave a partial merge. */
  merge(checkoutPath: string, emission: SoftwareModel): { ok: true } | { ok: false; error: string } {
    const current = this.models.get(checkoutPath) ?? { entities: [], relations: [] };
    // An emission-local ordinal cannot distinguish a partial sibling group from a changed one.
    // Refuse both growth and shrinkage of a known group; otherwise old edges can change meaning.
    const groupCounts = (items: Entity[]) => {
      const counts = new Map<string, number>();
      for (const item of items) {
        const base = item.id.replace(/\$\d+$/, '');
        counts.set(base, (counts.get(base) ?? 0) + 1);
      }
      return counts;
    };
    const known = groupCounts(current.entities);
    for (const [base, count] of groupCounts(emission.entities)) {
      if (known.has(base) && known.get(base) !== count) {
        return { ok: false, error: 'Same-name sibling coverage changed; this emission was not merged because existing identities and relations would be ambiguous.' };
      }
    }
    const entities = new Map(current.entities.map((item) => [item.id, item]));
    const relations = new Map(current.relations.map((item) => [item.id, item]));
    for (const item of emission.entities) entities.set(item.id, item);
    for (const item of emission.relations) relations.set(item.id, item);
    const merged = { entities: [...entities.values()], relations: [...relations.values()] };
    if (entities.size > this.limits.maxEntities || relations.size > this.limits.maxRelations
      || utf8Length(JSON.stringify(merged)) > this.limits.maxBytes) {
      return { ok: false, error: 'The temporary repository model is full; this emission was not merged.' };
    }
    this.models.delete(checkoutPath);
    this.models.set(checkoutPath, structuredClone(merged));
    if (this.models.size > this.limits.maxRepositories) this.models.delete(this.models.keys().next().value!);
    return { ok: true };
  }
}

// Next route bundles share the executing machine's single process-local accumulator.
const scope = globalThis as typeof globalThis & { __codeAiRepositoryModels?: RepositoryModelStore };
export const repositoryModels = (scope.__codeAiRepositoryModels ??= new RepositoryModelStore());
