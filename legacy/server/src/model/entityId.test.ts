import jsAnalyzer from '../analyzers/js';
import { createOrdinalAssigner, entityId, relationId } from './entityId';

describe('entityId scheme', () => {
  test('formats each kind per the settled scheme', () => {
    expect(entityId({ kind: 'function', file: 'src/db.ts', name: 'getUser' })).toBe(
      'function:src/db.ts#getUser'
    );
    expect(
      entityId({
        kind: 'method',
        file: 'src/db.ts',
        container: 'Repo',
        name: 'getUser',
      })
    ).toBe('method:src/db.ts#Repo.getUser');
    expect(entityId({ kind: 'class', file: 'src/db.ts', name: 'Repo' })).toBe(
      'class:src/db.ts#Repo'
    );
    expect(
      entityId({ kind: 'constant', file: 'src/config.ts', name: 'API_BASE' })
    ).toBe('constant:src/config.ts#API_BASE');
  });

  test('kind prefixes the id so same-name class and function never collide', () => {
    const asFunction = entityId({ kind: 'function', file: 'f.ts', name: 'Foo' });
    const asClass = entityId({ kind: 'class', file: 'f.ts', name: 'Foo' });
    expect(asFunction).not.toBe(asClass);
  });

  test('a same-named method in two classes gets two distinct ids via container', () => {
    const aRun = entityId({
      kind: 'method',
      file: 'f.ts',
      container: 'A',
      name: 'run',
    });
    const bRun = entityId({
      kind: 'method',
      file: 'f.ts',
      container: 'B',
      name: 'run',
    });
    expect(aRun).toBe('method:f.ts#A.run');
    expect(bRun).toBe('method:f.ts#B.run');
    expect(aRun).not.toBe(bRun);
    // No pos in either.
    expect(aRun).not.toMatch(/\d{2,}/);
    expect(bRun).not.toMatch(/\d{2,}/);
  });

  test('two same-named same-container siblings get stable source-order ordinals', () => {
    const assign = createOrdinalAssigner();
    const parts = { kind: 'function' as const, file: 'f.ts', name: 'helper' };

    const first = entityId({ ...parts, ordinal: assign(parts) });
    const second = entityId({ ...parts, ordinal: assign(parts) });

    expect(first).toBe('function:f.ts#helper');
    expect(second).toBe('function:f.ts#helper$1');
  });

  test('ordinal assigner is keyed per (kind, file, container, name) group', () => {
    const assign = createOrdinalAssigner();
    expect(assign({ kind: 'function', file: 'f.ts', name: 'a' })).toBe(0);
    expect(assign({ kind: 'function', file: 'f.ts', name: 'b' })).toBe(0);
    expect(assign({ kind: 'function', file: 'f.ts', name: 'a' })).toBe(1);
    expect(
      assign({ kind: 'method', file: 'f.ts', container: 'C', name: 'a' })
    ).toBe(0);
  });

  test('relationId derives from kind and endpoint ids', () => {
    expect(
      relationId('declares', 'class:f.ts#Repo', 'method:f.ts#Repo.getUser')
    ).toBe('declares:class:f.ts#Repo->method:f.ts#Repo.getUser');
  });
});

describe('entity id is stable across edits above a declaration', () => {
  // The id never contains pos, so inserting lines *above* a declaration shifts
  // its location but leaves the id intact (the M1 merge-key guarantee).
  const declarationId = (filename: string, content: string) => {
    const { functionDeclarations } = jsAnalyzer.extractFileMapping(
      filename,
      content
    );
    const target = functionDeclarations.find((decl) => decl.name === 'getUser');
    if (!target) throw new Error('expected getUser declaration');
    return {
      id: entityId({
        kind: target.kind || 'function',
        file: filename,
        container: target.container,
        name: target.name,
      }),
      pos: target.pos,
    };
  };

  test('id unchanged while location (pos) updates', () => {
    const before = declarationId(
      'src/db.ts',
      'function getUser() {\n  return 1;\n}\n'
    );
    const after = declarationId(
      'src/db.ts',
      '// a new comment\n// another line\nconst x = 1;\n\nfunction getUser() {\n  return 1;\n}\n'
    );

    expect(after.id).toBe(before.id);
    expect(after.id).toBe('function:src/db.ts#getUser');
    expect(after.pos).toBeGreaterThan(before.pos);
  });
});
