import {
  compareLayoutNodes,
  layoutCodeGraphAsync,
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
  test('filters edges that reference hidden nodes before layout', () => {
    const visibleOnly = layoutCodeGraph({
      strategy: 'fallback',
      nodes: [
        node({ id: 'visible-a', label: 'visibleA' }),
        node({ id: 'visible-b', label: 'visibleB' }),
      ],
      edges: [
        {
          id: 'visible-edge',
          source: 'visible-a',
          target: 'visible-b',
          kind: 'imports',
        },
      ],
    });
    const result = layoutCodeGraph({
      strategy: 'fallback',
      nodes: [
        node({ id: 'visible-a', label: 'visibleA' }),
        node({ id: 'visible-b', label: 'visibleB' }),
      ],
      edges: [
        {
          id: 'visible-edge',
          source: 'visible-a',
          target: 'visible-b',
          kind: 'imports',
        },
        {
          id: 'hidden-source',
          source: 'hidden-source-node',
          target: 'visible-a',
          kind: 'imports',
        },
        {
          id: 'hidden-target',
          source: 'visible-b',
          target: 'hidden-target-node',
          kind: 'imports',
        },
      ],
    });

    expect(Object.keys(result.positions).sort()).toEqual([
      'visible-a',
      'visible-b',
    ]);
    expect(result.positions).toEqual(visibleOnly.positions);
  });

  test('preserves previous positions when requested', () => {
    const previousPositions = {
      changed: { x: 1234, y: 5678 },
      importer: { x: -345, y: 90 },
    };
    const result = layoutCodeGraph({
      strategy: 'review-files',
      preservePrevious: true,
      previousPositions,
      nodes: [
        node({ id: 'changed', label: 'src/changed.ts', role: 'changed' }),
        node({ id: 'importer', label: 'src/importer.ts' }),
        node({ id: 'dependency', label: 'src/dependency.ts' }),
      ],
      edges: [
        {
          id: 'importer-changed',
          source: 'importer',
          target: 'changed',
          kind: 'imports',
        },
        {
          id: 'changed-dependency',
          source: 'changed',
          target: 'dependency',
          kind: 'imports',
        },
      ],
    });

    expect(result.positions.changed).toEqual(previousPositions.changed);
    expect(result.positions.importer).toEqual(previousPositions.importer);
    expect(result.positions.dependency).toBeDefined();
    expect(result.positions.dependency).not.toEqual(previousPositions.changed);
  });

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

  test('keeps expanded overview module files central with neighbors on predictable sides', () => {
    const result = layoutCodeGraph({
      strategy: 'overview',
      nodes: [
        node({
          id: 'core-a',
          label: 'src/core/a.ts',
          role: 'expanded',
          filename: 'src/core/a.ts',
        }),
        node({
          id: 'core-b',
          label: 'src/core/b.ts',
          role: 'expanded',
          filename: 'src/core/b.ts',
        }),
        node({
          id: 'importer',
          label: 'src/app.ts',
          role: 'context',
          filename: 'src/app.ts',
        }),
        node({
          id: 'dependency',
          label: 'src/lib.ts',
          role: 'context',
          filename: 'src/lib.ts',
        }),
      ],
      edges: [
        {
          id: 'importer-core-a',
          source: 'importer',
          target: 'core-a',
          kind: 'imports',
        },
        {
          id: 'core-a-dependency',
          source: 'core-a',
          target: 'dependency',
          kind: 'imports',
        },
      ],
    });

    expect(result.positions.importer.x).toBeLessThan(
      result.positions['core-a'].x
    );
    expect(result.positions.dependency.x).toBeGreaterThan(
      result.positions['core-a'].x
    );
    expect(result.positions['core-b'].x).toBe(result.positions['core-a'].x);
    expect(result.positions['core-b'].y).toBeGreaterThan(
      result.positions['core-a'].y
    );
  });

  test('uses overview edge weights when placing mixed expanded context', () => {
    const result = layoutCodeGraph({
      strategy: 'overview',
      nodes: [
        node({
          id: 'core',
          label: 'src/core.ts',
          role: 'expanded',
          filename: 'src/core.ts',
        }),
        node({
          id: 'mixed',
          label: 'src/mixed.ts',
          role: 'context',
          filename: 'src/mixed.ts',
        }),
      ],
      edges: [
        {
          id: 'mixed-core-light',
          source: 'mixed',
          target: 'core',
          kind: 'imports',
          weight: 1,
        },
        {
          id: 'core-mixed-heavy',
          source: 'core',
          target: 'mixed',
          kind: 'imports',
          weight: 4,
        },
      ],
    });

    expect(result.positions.mixed.x).toBeGreaterThan(
      result.positions.core.x
    );
  });

  test('keeps expanded overview declarations near their file sorted by source line', () => {
    const result = layoutCodeGraph({
      strategy: 'overview',
      nodes: [
        node({
          id: 'file',
          label: 'src/core/a.ts',
          role: 'expanded',
          filename: 'src/core/a.ts',
        }),
        node({
          id: 'decl-l20',
          label: 'later',
          kind: 'declaration',
          role: 'expanded',
          filename: 'src/core/a.ts',
          startLine: 20,
        }),
        node({
          id: 'decl-l5',
          label: 'earlier',
          kind: 'declaration',
          role: 'expanded',
          filename: 'src/core/a.ts',
          startLine: 5,
        }),
      ],
      edges: [
        {
          id: 'file-decl-l20',
          source: 'file',
          target: 'decl-l20',
          kind: 'declares',
        },
        {
          id: 'file-decl-l5',
          source: 'file',
          target: 'decl-l5',
          kind: 'declares',
        },
      ],
    });

    expect(result.positions['decl-l5'].x).toBeGreaterThan(
      result.positions.file.x
    );
    expect(result.positions['decl-l20'].x).toBe(
      result.positions['decl-l5'].x
    );
    expect(result.positions['decl-l5'].y).toBeLessThan(
      result.positions['decl-l20'].y
    );
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
          id: 'importer-changed',
          source: 'importer',
          target: 'changed',
          kind: 'imports',
        },
        {
          id: 'changed-dependency',
          source: 'changed',
          target: 'dependency',
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

  test('spreads related changed files into a central cluster', () => {
    const result = layoutCodeGraph({
      strategy: 'review-files',
      nodes: [
        node({ id: 'changed-a', label: 'src/changed-a.ts', role: 'changed' }),
        node({ id: 'changed-b', label: 'src/changed-b.ts', role: 'changed' }),
      ],
      edges: [
        {
          id: 'changed-a-changed-b',
          source: 'changed-a',
          target: 'changed-b',
          kind: 'imports',
        },
      ],
    });

    expect(result.positions['changed-b'].x).toBeGreaterThan(
      result.positions['changed-a'].x
    );
    expect(result.positions['changed-b'].y).toBe(
      result.positions['changed-a'].y
    );
  });

  test('anchors review file context near the related changed file', () => {
    const result = layoutCodeGraph({
      strategy: 'review-files',
      nodes: [
        node({ id: 'changed-a', label: 'src/a.ts', role: 'changed' }),
        node({ id: 'changed-z', label: 'src/z.ts', role: 'changed' }),
        node({ id: 'z-importer', label: 'src/z-importer.ts' }),
      ],
      edges: [
        {
          id: 'z-importer-changed-z',
          source: 'z-importer',
          target: 'changed-z',
          kind: 'imports',
        },
      ],
    });

    const matchingDistance = Math.abs(
      result.positions['z-importer'].y - result.positions['changed-z'].y
    );
    const unrelatedDistance = Math.abs(
      result.positions['z-importer'].y - result.positions['changed-a'].y
    );

    expect(result.positions['z-importer'].x).toBeLessThan(
      result.positions['changed-z'].x
    );
    expect(matchingDistance).toBeLessThan(unrelatedDistance);
  });

  test('places review declaration callers left and callees right', () => {
    const result = layoutCodeGraph({
      strategy: 'review-declarations',
      nodes: [
        node({
          id: 'changed',
          label: 'changedDeclaration',
          kind: 'declaration',
          role: 'changed',
        }),
        node({
          id: 'caller',
          label: 'callerDeclaration',
          kind: 'declaration',
        }),
        node({
          id: 'callee',
          label: 'calleeDeclaration',
          kind: 'declaration',
        }),
      ],
      edges: [
        {
          id: 'caller-changed',
          source: 'caller',
          target: 'changed',
          kind: 'calls',
        },
        {
          id: 'changed-callee',
          source: 'changed',
          target: 'callee',
          kind: 'calls',
        },
      ],
    });

    expect(result.positions.caller.x).toBeLessThan(
      result.positions.changed.x
    );
    expect(result.positions.callee.x).toBeGreaterThan(
      result.positions.changed.x
    );
  });

  test('spreads same-file changed declarations by call flow', () => {
    const result = layoutCodeGraph({
      strategy: 'review-declarations',
      nodes: [
        node({
          id: 'changed-a',
          label: 'changedA',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/changed.ts',
          startLine: 10,
        }),
        node({
          id: 'changed-b',
          label: 'changedB',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/changed.ts',
          startLine: 30,
        }),
      ],
      edges: [
        {
          id: 'changed-a-changed-b',
          source: 'changed-a',
          target: 'changed-b',
          kind: 'calls',
        },
      ],
    });

    expect(result.positions['changed-b'].x).toBeGreaterThan(
      result.positions['changed-a'].x
    );
    expect(result.positions['changed-b'].y).toBe(
      result.positions['changed-a'].y
    );
  });

  test('uses heuristic declaration calls for same-file flow ranking', () => {
    const result = layoutCodeGraph({
      strategy: 'review-declarations',
      nodes: [
        node({
          id: 'changed-a',
          label: 'changedA',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/changed.ts',
          startLine: 10,
        }),
        node({
          id: 'changed-b',
          label: 'changedB',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/changed.ts',
          startLine: 30,
        }),
      ],
      edges: [
        {
          id: 'changed-a-changed-b',
          source: 'changed-a',
          target: 'changed-b',
          kind: 'heuristic',
          isHeuristic: true,
        },
      ],
    });

    expect(result.positions['changed-b'].x).toBeGreaterThan(
      result.positions['changed-a'].x
    );
  });

  test('keeps same-rank same-file declarations in source order', () => {
    const result = layoutCodeGraph({
      strategy: 'review-declarations',
      nodes: [
        node({
          id: 'changed-a',
          label: 'changedA',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/changed.ts',
          startLine: 10,
        }),
        node({
          id: 'changed-b',
          label: 'changedB',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/changed.ts',
          startLine: 30,
        }),
      ],
      edges: [],
    });

    expect(result.positions['changed-b'].x).toBe(
      result.positions['changed-a'].x
    );
    expect(result.positions['changed-b'].y).toBeGreaterThan(
      result.positions['changed-a'].y
    );
  });

  test('places bridge declarations between changed declaration clusters', () => {
    const result = layoutCodeGraph({
      strategy: 'review-declarations',
      nodes: [
        node({
          id: 'changed-a',
          label: 'changedA',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/a.ts',
          startLine: 10,
        }),
        node({
          id: 'bridge',
          label: 'bridgeDeclaration',
          kind: 'declaration',
          role: 'bridge',
          filename: 'src/bridge.ts',
          startLine: 20,
        }),
        node({
          id: 'changed-b',
          label: 'changedB',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/b.ts',
          startLine: 30,
        }),
      ],
      edges: [
        {
          id: 'changed-a-bridge',
          source: 'changed-a',
          target: 'bridge',
          kind: 'bridge',
        },
        {
          id: 'bridge-changed-b',
          source: 'bridge',
          target: 'changed-b',
          kind: 'bridge',
        },
      ],
    });

    expect(result.positions.bridge.x).toBe(result.positions['changed-a'].x);
    expect(result.positions.bridge.y).toBeGreaterThan(
      result.positions['changed-a'].y
    );
    expect(result.positions.bridge.y).toBeLessThan(
      result.positions['changed-b'].y
    );
  });

  test('keeps review declaration side lanes near matching center file bands', () => {
    const result = layoutCodeGraph({
      strategy: 'review-declarations',
      nodes: [
        node({
          id: 'changed-a',
          label: 'changedA',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/a.ts',
          startLine: 10,
        }),
        node({
          id: 'changed-z',
          label: 'changedZ',
          kind: 'declaration',
          role: 'changed',
          filename: 'src/z.ts',
          startLine: 10,
        }),
        node({
          id: 'z-caller',
          label: 'zCaller',
          kind: 'declaration',
          filename: 'src/z.ts',
          startLine: 1,
        }),
        node({
          id: 'm-caller',
          label: 'mCaller',
          kind: 'declaration',
          filename: 'src/m.ts',
          startLine: 1,
        }),
      ],
      edges: [
        {
          id: 'z-caller-changed-z',
          source: 'z-caller',
          target: 'changed-z',
          kind: 'calls',
        },
        {
          id: 'm-caller-changed-z',
          source: 'm-caller',
          target: 'changed-z',
          kind: 'calls',
        },
      ],
    });

    const matchingFileDistance = Math.abs(
      result.positions['z-caller'].y - result.positions['changed-z'].y
    );
    const unrelatedFileDistance = Math.abs(
      result.positions['m-caller'].y - result.positions['changed-z'].y
    );

    expect(result.positions['z-caller'].x).toBeLessThan(
      result.positions['changed-z'].x
    );
    expect(matchingFileDistance).toBeLessThan(unrelatedFileDistance);
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

  test('spaces logic map rows by declaration node height', () => {
    const result = layoutCodeGraph({
      strategy: 'logic-map',
      nodes: [
        node({
          id: 'large',
          label: 'large',
          kind: 'declaration',
          role: 'context',
          filename: 'src/a.ts',
          startLine: 1,
          height: 620,
        }),
        node({
          id: 'after-large',
          label: 'afterLarge',
          kind: 'declaration',
          role: 'context',
          filename: 'src/a.ts',
          startLine: 200,
          height: 170,
        }),
      ],
      edges: [],
    });

    expect(result.positions['after-large'].y).toBeGreaterThan(
      result.positions.large.y + 620
    );
  });

  test('can layout a graph with the elk engine through the async entry point', async () => {
    const result = await layoutCodeGraphAsync({
      engine: 'elk',
      strategy: 'logic-map',
      nodes: [
        node({
          id: 'source',
          label: 'source',
          kind: 'declaration',
          filename: 'source.ts',
        }),
        node({
          id: 'target',
          label: 'target',
          kind: 'declaration',
          filename: 'target.ts',
        }),
      ],
      edges: [
        {
          id: 'source-target',
          source: 'source',
          target: 'target',
          kind: 'imports',
        },
      ],
    });

    expect(Object.keys(result.positions).sort()).toEqual(['source', 'target']);
    expect(result.positions.target.x).toBeGreaterThan(result.positions.source.x);
    expect(result.edgeRoutes?.['source-target']?.length).toBeGreaterThan(1);
    expect(result.bounds?.width).toBeGreaterThan(0);
  });

  test('preserves previous positions when using the elk engine', async () => {
    const previousPositions = {
      source: { x: 1000, y: 1000 },
    };
    const result = await layoutCodeGraphAsync({
      engine: 'elk',
      strategy: 'fallback',
      preservePrevious: true,
      previousPositions,
      nodes: [
        node({ id: 'source', label: 'source.ts' }),
        node({ id: 'target', label: 'target.ts' }),
      ],
      edges: [
        {
          id: 'source-target',
          source: 'source',
          target: 'target',
          kind: 'imports',
        },
      ],
    });

    expect(result.positions.source).toEqual(previousPositions.source);
    expect(result.positions.target).toBeDefined();
  });
});
