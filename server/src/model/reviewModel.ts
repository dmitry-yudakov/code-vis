import {
  ChangeStatus,
  ChangedFileStatus,
  Entity,
  EntityKind,
  FileIncludeInfo,
  FocusedDeclarationCallInfo,
  FocusedDeclarationInfo,
  FocusedFileInfo,
  Relation,
} from '../types';
import { entityId, relationId } from './entityId';

/**
 * Adapter: maps the existing analyzer/projection output to the shared
 * Entity/Relation model (M1, static only). Additive over the legacy
 * FocusedReviewMap fields — no LLM, only in-grammar edges.
 *
 * Change status stays diff-driven: it is read from the (unchanged) FocusedFile/
 * FocusedDeclaration `isChanged` + `changeStatus` logic, never inferred from ids.
 */
export interface ReviewEntityModelInput {
  declarations: FocusedDeclarationInfo[];
  declarationCalls: FocusedDeclarationCallInfo[];
  includes: FileIncludeInfo[];
  files: FocusedFileInfo[];
}

const basename = (filename: string): string =>
  filename.slice(filename.lastIndexOf('/') + 1);

const fileEntityId = (filename: string): string =>
  entityId({ kind: 'file', file: filename, name: basename(filename) });

const toEntityChangeStatus = (
  status?: ChangedFileStatus
): ChangeStatus | undefined => {
  switch (status) {
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'modified':
    case 'renamed': // no rename identity in M1 — surfaced as a plain modification
      return 'modified';
    default:
      return undefined;
  }
};

export const buildReviewEntityModel = (
  input: ReviewEntityModelInput
): { entities: Entity[]; relations: Relation[] } => {
  const entities: Entity[] = [];
  const entityIdsSeen = new Set<string>();

  const addEntity = (entity: Entity): void => {
    if (entityIdsSeen.has(entity.id)) return;
    entityIdsSeen.add(entity.id);
    entities.push(entity);
  };

  const relations: Relation[] = [];
  const relationIdsSeen = new Set<string>();

  const addRelation = (relation: Relation): void => {
    if (relationIdsSeen.has(relation.id)) return;
    relationIdsSeen.add(relation.id);
    relations.push(relation);
  };

  // File entities for every file visible in the review.
  const fileIdByName = new Map<string, string>();
  for (const file of input.files) {
    const id = fileEntityId(file.filename);
    fileIdByName.set(file.filename, id);
    addEntity({
      id,
      kind: 'file',
      name: basename(file.filename),
      location: { filename: file.filename },
      origin: 'static',
      changeStatus: file.isChanged
        ? toEntityChangeStatus(file.changeStatus)
        : undefined,
    });
  }

  // Declaration entities (class / function / method / variable / constant).
  const classIdByFileAndName = new Map<string, string>();
  for (const decl of input.declarations) {
    const kind: EntityKind = decl.kind || 'function';
    addEntity({
      id: decl.id,
      kind,
      name: decl.name,
      container: decl.container,
      location: {
        filename: decl.filename,
        pos: decl.pos,
        end: decl.end,
        startLine: decl.startLine,
        endLine: decl.endLine,
      },
      origin: 'static',
      changeStatus: decl.isChanged
        ? toEntityChangeStatus(decl.changeStatus)
        : undefined,
    });
    if (kind === 'class') {
      classIdByFileAndName.set(`${decl.filename}::${decl.name}`, decl.id);
    }
  }

  // contains: file -> top-level entity; declares: class -> method.
  for (const decl of input.declarations) {
    if (decl.container) {
      const classId = classIdByFileAndName.get(
        `${decl.filename}::${decl.container}`
      );
      if (classId) {
        addRelation({
          id: relationId('declares', classId, decl.id),
          kind: 'declares',
          source: classId,
          target: decl.id,
          origin: 'static',
        });
        continue; // owned by its class, not directly by the file
      }
    }

    const fileId = fileIdByName.get(decl.filename);
    if (fileId) {
      addRelation({
        id: relationId('contains', fileId, decl.id),
        kind: 'contains',
        source: fileId,
        target: decl.id,
        origin: 'static',
      });
    }
  }

  // imports: file(to) -> file(from), both visible (from FileIncludeInfo).
  for (const include of input.includes) {
    const sourceId = fileIdByName.get(include.to);
    const targetId = fileIdByName.get(include.from);
    if (!sourceId || !targetId) continue;
    addRelation({
      id: relationId('imports', sourceId, targetId),
      kind: 'imports',
      source: sourceId,
      target: targetId,
      origin: 'static',
    });
  }

  // calls: declaration -> declaration (reshaped from FunctionCallInfo edges).
  for (const call of input.declarationCalls) {
    if (!entityIdsSeen.has(call.from) || !entityIdsSeen.has(call.to)) continue;
    addRelation({
      id: relationId('calls', call.from, call.to),
      kind: 'calls',
      source: call.from,
      target: call.to,
      origin: 'static',
    });
  }

  return { entities, relations };
};
