import {
  compareLayoutNodes,
  layoutCodeGraph,
  type CodeLayoutNode,
} from '.';

const node = (overrides: Partial<CodeLayoutNode>): CodeLayoutNode => ({
  id: overrides.id || overrides.label || 'node',
  label: overrides.label || overrides.id || 'node',
  kind: overrides.kind || 'file',
  role: overrides.role || 'context',
  ...overrides,
});

describe('graphLayout', () => {
  test('sorts declarations by file and source line deterministically', () => {
    const input = [
      node({
        id: 'b-l20',
        label: 'b',
        kind: 'declaration',
        role: 'context',
        filename: 'src/b.ts',
        startLine: 20,
      }),
      node({
        id: 'a-l30',
        label: 'a2',
        kind: 'declaration',
        role: 'context',
        filename: 'src/a.ts',
        startLine: 30,
      }),
      node({
        id: 'a-l10',
        label: 'a1',
        kind: 'declaration',
        role: 'context',
        filename: 'src/a.ts',
        startLine: 10,
      }),
    ];

    expect([...input].sort(compareLayoutNodes).map((item) => item.id)).toEqual([
      'a-l10',
      'a-l30',
      'b-l20',
    ]);
  });

  test('places review file importers left and imported files right', () => {
    const result = layoutCodeGraph({
      strategy: 'review-files',
      nodes: [
        node({ id: 'changed', label: 'src/changed.ts', role: 'changed' }),
        node({ id: 'importer', label: 'src/importer.ts' }),
        node({ id: 'dependency', label: 'src/dependency.ts' }),
      ],
      edges: [
        {
          id: 'changed-importer',
          source: 'changed',
          target: 'importer',
          kind: 'imports',
        },
        {
          id: 'dependency-changed',
          source: 'dependency',
          target: 'changed',
          kind: 'imports',
        },
      ],
    });

    expect(result.positions.importer.x).toBeLessThan(
      result.positions.changed.x
    );
    expect(result.positions.dependency.x).toBeGreaterThan(
      result.positions.changed.x
    );
  });

  test('keeps logic map declarations grouped by file while call ranks move right', () => {
    const result = layoutCodeGraph({
      strategy: 'logic-map',
      nodes: [
        node({
          id: 'a1',
          label: 'a1',
          kind: 'declaration',
          role: 'context',
          filename: 'src/a.ts',
          startLine: 1,
        }),
        node({
          id: 'a2',
          label: 'a2',
          kind: 'declaration',
          role: 'context',
          filename: 'src/a.ts',
          startLine: 20,
        }),
        node({
          id: 'b1',
          label: 'b1',
          kind: 'declaration',
          role: 'context',
          filename: 'src/b.ts',
          startLine: 1,
        }),
      ],
      edges: [{ id: 'a1-b1', source: 'a1', target: 'b1', kind: 'calls' }],
    });

    expect(result.positions.a2.y).toBeGreaterThan(result.positions.a1.y);
    expect(result.positions.b1.x).toBeGreaterThan(result.positions.a1.x);
  });
});

