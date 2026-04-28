import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Controls,
  MarkerType,
  Node as FlowNode,
  Edge as FlowEdge,
  applyNodeChanges,
  NodeChange,
} from 'react-flow-renderer';
import { FilenamePrettyView } from '../atoms';
import { Node, FileIncludeInfo, PositionedNode } from '../types';
import {
  includeToGraphTypes,
  applyGraphLayout,
  groupIncludesByDirectory,
  filterIncludesToEntryPoints,
} from '../utils';
import './IncludesHierarchy.css';

type ViewMode = 'full' | 'entry' | 'directory';

/** Auto-switch to a summary view when the graph has more nodes than this. */
const AUTO_SWITCH_THRESHOLD = 30;

const MAX_ITEMS_TO_SHOW = 3;
const edgeLabel = (items: string[]) => {
  if (items.length <= MAX_ITEMS_TO_SHOW) return items.join(', ');
  const extra = items.length - MAX_ITEMS_TO_SHOW;
  return `${items.slice(0, MAX_ITEMS_TO_SHOW).join(', ')}... ${extra} more`;
};

const countUniqueNodes = (includes: FileIncludeInfo[]): number =>
  new Set(includes.flatMap((i) => [i.from, i.to])).size;

export const IncludesHierarchy: React.FC<{
  includes: FileIncludeInfo[];
  renderNodeMenu: (
    filename: string,
    anchor: HTMLElement | null,
    onClose: () => void
  ) => React.ReactElement;
}> = React.memo(({ includes, renderNodeMenu }) => {
  const fileCount = useMemo(() => countUniqueNodes(includes), [includes]);

  const [mode, setMode] = useState<ViewMode>(() =>
    fileCount > AUTO_SWITCH_THRESHOLD ? 'entry' : 'full'
  );
  const [entryDepth, setEntryDepth] = useState(2);

  // If a new (larger) project loads after mount, switch to summary mode
  useEffect(() => {
    if (fileCount > AUTO_SWITCH_THRESHOLD && mode === 'full') {
      setMode('entry');
    }
  }, [fileCount]);

  const activeIncludes = useMemo(() => {
    if (mode === 'directory') return groupIncludesByDirectory(includes);
    if (mode === 'entry')
      return filterIncludesToEntryPoints(includes, entryDepth);
    return includes;
  }, [includes, mode, entryDepth]);

  const { initialNodes, edgesElements } = useMemo(() => {
    const { nodes, edges } = includeToGraphTypes(activeIncludes);

    applyGraphLayout(
      nodes,
      edges,
      (n, x, y) => {
        const p = n as PositionedNode;
        p.x = x;
        p.y = y;
      },
      250,
      200
    );

    const initialNodes = (nodes as PositionedNode[]).map((node) => {
      const { id, x, y } = node;
      return {
        id,
        data: {
          label:
            mode === 'directory' ? (
              <DirView label={node.label} />
            ) : (
              <FileView node={node} />
            ),
          node,
        },
        position: { x, y },
      };
    });

    const edgesElements = edges.map(({ source, target }, idx) => {
      const items = activeIncludes[idx].items;
      const label = edgeLabel(items);
      return {
        id: `${source}-${target}-${idx}`,
        markerEnd: { type: MarkerType.Arrow },
        source,
        target,
        label,
      };
    });

    return { initialNodes, edgesElements };
  }, [activeIncludes, mode]);

  const [showMenu, setShowMenu] = useState<{
    anchor: HTMLElement | null;
    node: Node;
  } | null>(null);

  const [nodesElements, setNodesElements] = useState(initialNodes);

  useEffect(() => {
    setNodesElements(initialNodes);
  }, [initialNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodesElements((nds) => applyNodeChanges(changes, nds));
  }, []);

  const visibleCount = useMemo(
    () => countUniqueNodes(activeIncludes),
    [activeIncludes]
  );

  return (
    <div className="mapper">
      <div className="view-mode-toolbar">
        <span className="view-mode-label">View:</span>
        <button
          className={`view-mode-btn${mode === 'full' ? ' active' : ''}`}
          onClick={() => setMode('full')}
          title="Show every file"
        >
          All files ({fileCount})
        </button>
        <button
          className={`view-mode-btn${mode === 'entry' ? ' active' : ''}`}
          onClick={() => setMode('entry')}
          title="Show entry-point files and their dependencies up to the selected depth"
        >
          Entry points
        </button>
        {mode === 'entry' && (
          <span className="depth-control">
            <span className="depth-label">Depth:</span>
            <button
              className="depth-btn"
              onClick={() => setEntryDepth((d) => Math.max(1, d - 1))}
            >
              −
            </button>
            <span className="depth-value">{entryDepth}</span>
            <button
              className="depth-btn"
              onClick={() => setEntryDepth((d) => d + 1)}
            >
              +
            </button>
          </span>
        )}
        <button
          className={`view-mode-btn${mode === 'directory' ? ' active' : ''}`}
          onClick={() => setMode('directory')}
          title="Collapse files into their parent directories"
        >
          Directories
        </button>
        {mode !== 'full' && (
          <span className="view-mode-count">
            showing {visibleCount} of {fileCount} nodes
          </span>
        )}
      </div>
      <div className="mapper-canvas">
        <ReactFlow
          nodes={nodesElements}
          edges={edgesElements}
          onNodesChange={onNodesChange}
          nodesConnectable={false}
          nodesDraggable={true}
          minZoom={0.01}
          onNodeClick={(e: any, el: any) => {
            if (el.data && mode !== 'directory') {
              setShowMenu({
                anchor: e.currentTarget as HTMLElement,
                node: el.data.node,
              });
            }
          }}
        >
          <Controls />
        </ReactFlow>
        {!!showMenu &&
          renderNodeMenu(showMenu.node.label, showMenu.anchor, () =>
            setShowMenu(null)
          )}
      </div>
    </div>
  );
});

const FileView: React.FC<{ node: Node }> = ({ node }) => (
  <FilenamePrettyView filename={node.label} />
);

const DirView: React.FC<{ label: string }> = ({ label }) => {
  const parts = label.split('/');
  const name = parts[parts.length - 1] || label;
  const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
  return (
    <div className="node">
      <div className="file-path">{parentPath}</div>
      <div className="file-name">{name}/</div>
    </div>
  );
};
