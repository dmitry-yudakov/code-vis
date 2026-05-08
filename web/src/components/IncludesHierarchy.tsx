import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import ReactFlow, {
  Controls,
  MarkerType,
  Node as FlowNode,
  Edge as FlowEdge,
  applyNodeChanges,
  NodeChange,
} from 'react-flow-renderer';
import { FilenamePrettyView } from '../atoms';
import {
  Node,
  FileIncludeInfo,
  PositionedNode,
  ChangeSourceRequest,
  FocusedFileInfo,
  FocusedReviewMap,
  RelatedReason,
} from '../types';
import {
  includeToGraphTypes,
  applyGraphLayout,
  groupIncludesByDirectory,
  filterIncludesToEntryPoints,
} from '../utils';
import './IncludesHierarchy.css';

type ViewMode = 'full' | 'entry' | 'directory' | 'diff' | 'branch';

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

const toNodeId = (value: string) => value.replace(/-/g, '_');

const reasonLabel = (reason: RelatedReason, info: FocusedFileInfo): string => {
  switch (reason.type) {
    case 'changed':
      return info.changeStatus ? `changed: ${info.changeStatus}` : 'changed';
    case 'imports-changed':
      return reason.via
        ? `imports changed file (${reason.via})`
        : 'imports changed file';
    case 'imported-by-changed':
      return reason.via
        ? `imported by changed file (${reason.via})`
        : 'imported by changed file';
    case 'function-neighbor':
      return reason.via
        ? `function neighbor (${reason.via})`
        : 'function neighbor';
    default:
      return reason.type;
  }
};

export const IncludesHierarchy: React.FC<{
  includes: FileIncludeInfo[];
  requestFocusedReview: (
    source: ChangeSourceRequest
  ) => Promise<FocusedReviewMap>;
  renderNodeMenu: (
    filename: string,
    anchor: HTMLElement | null,
    onClose: () => void
  ) => React.ReactElement;
}> = React.memo(({ includes, requestFocusedReview, renderNodeMenu }) => {
  const fileCount = useMemo(() => countUniqueNodes(includes), [includes]);

  const [mode, setMode] = useState<ViewMode>(() =>
    fileCount > AUTO_SWITCH_THRESHOLD ? 'entry' : 'full'
  );
  const [entryDepth, setEntryDepth] = useState(2);
  const [focusedReview, setFocusedReview] = useState<FocusedReviewMap | null>(
    null
  );
  const [focusedLoading, setFocusedLoading] = useState(false);
  const [focusedError, setFocusedError] = useState<string | null>(null);
  const [showFocusedContext, setShowFocusedContext] = useState(false);

  const isFocusedMode = mode === 'diff' || mode === 'branch';
  const focusedSource = useMemo<ChangeSourceRequest | null>(() => {
    if (mode === 'diff') return { mode: 'diff' };
    if (mode === 'branch') return { mode: 'branch' };
    return null;
  }, [mode]);

  // If a new (larger) project loads after mount, switch to summary mode
  useEffect(() => {
    if (fileCount > AUTO_SWITCH_THRESHOLD && mode === 'full') {
      setMode('entry');
    }
  }, [fileCount]);

  useEffect(() => {
    if (!focusedSource) return;

    let canceled = false;
    setFocusedLoading(true);
    setFocusedError(null);

    requestFocusedReview(focusedSource)
      .then((result) => {
        if (canceled) return;
        setFocusedReview(result);
      })
      .catch((error: any) => {
        if (canceled) return;
        setFocusedReview(null);
        setFocusedError(error?.message || 'Failed to load change-focused map');
      })
      .finally(() => {
        if (!canceled) {
          setFocusedLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [focusedSource, includes, requestFocusedReview]);

  const focusedFilesByName = useMemo(() => {
    if (!focusedReview) return new Map<string, FocusedFileInfo>();

    const visibleFiles = showFocusedContext
      ? focusedReview.files
      : focusedReview.files.filter((file) => file.isChanged);

    return new Map(visibleFiles.map((file) => [file.filename, file]));
  }, [focusedReview, showFocusedContext]);

  const activeIncludes = useMemo(() => {
    if (isFocusedMode) {
      if (!focusedReview) return [];

      const visibleFiles = new Set(focusedFilesByName.keys());
      return focusedReview.includes.filter(
        (incl) => visibleFiles.has(incl.from) && visibleFiles.has(incl.to)
      );
    }
    if (mode === 'directory') return groupIncludesByDirectory(includes);
    if (mode === 'entry')
      return filterIncludesToEntryPoints(includes, entryDepth);
    return includes;
  }, [
    includes,
    mode,
    entryDepth,
    isFocusedMode,
    focusedReview,
    focusedFilesByName,
  ]);

  const { initialNodes, edgesElements } = useMemo(() => {
    const { nodes, edges } = includeToGraphTypes(activeIncludes);

    if (isFocusedMode && focusedReview) {
      const presentLabels = new Set(nodes.map((node) => node.label));
      for (const file of focusedFilesByName.values()) {
        if (!presentLabels.has(file.filename)) {
          nodes.push({ id: toNodeId(file.filename), label: file.filename });
          presentLabels.add(file.filename);
        }
      }
    }

    if (nodes.length > 0) {
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
    }

    const initialNodes = (nodes as PositionedNode[]).map((node) => {
      const { id, x, y } = node;
      const focusedInfo = isFocusedMode
        ? focusedFilesByName.get(node.label)
        : null;
      const isDeleted = focusedInfo?.changeStatus === 'deleted';

      return {
        id,
        className: focusedInfo
          ? focusedInfo.isChanged
            ? 'focused-node focused-node-changed'
            : 'focused-node focused-node-context'
          : undefined,
        data: {
          label: focusedInfo ? (
            <FocusedFileView info={focusedInfo} />
          ) : mode === 'directory' ? (
            <DirView label={node.label} />
          ) : (
            <FileView node={node} />
          ),
          node,
          isDeleted,
        },
        position: { x: x || 0, y: y || 0 },
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
  }, [activeIncludes, mode, focusedFilesByName, focusedReview, isFocusedMode]);

  const [showMenu, setShowMenu] = useState<{
    anchor: HTMLElement | null;
    node: Node;
  } | null>(null);

  const previousModeRef = useRef<ViewMode>(mode);

  const [nodesElements, setNodesElements] = useState<FlowNode<any>[]>(
    initialNodes as FlowNode<any>[]
  );

  useEffect(() => {
    setNodesElements((previousNodes) => {
      const nextNodes = initialNodes as FlowNode<any>[];

      // Reset layout when mode changes, but preserve manual node positions
      // during data refreshes within the same mode.
      if (previousModeRef.current !== mode) {
        previousModeRef.current = mode;
        return nextNodes;
      }

      const previousById = new Map(
        previousNodes.map((node) => [node.id, node])
      );
      return nextNodes.map((node) => {
        const previous = previousById.get(node.id);
        if (!previous) return node;
        return {
          ...node,
          position: previous.position,
        };
      });
    });
  }, [initialNodes, mode]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodesElements((nds) => applyNodeChanges(changes, nds));
  }, []);

  const visibleCount = useMemo(() => {
    if (isFocusedMode) return focusedFilesByName.size;
    return countUniqueNodes(activeIncludes);
  }, [activeIncludes, focusedFilesByName, isFocusedMode]);

  const changedCount = focusedReview?.changeSet.files.length || 0;
  const focusedTotalCount = focusedReview?.files.length || 0;
  const branchBaseRef =
    mode === 'branch' && focusedReview?.changeSet.source.mode === 'branch'
      ? focusedReview.changeSet.source.baseRef
      : null;
  const showFocusedNoChanges =
    isFocusedMode &&
    !focusedLoading &&
    !focusedError &&
    !!focusedReview &&
    changedCount === 0;
  const showFocusedState =
    isFocusedMode && (focusedLoading || !!focusedError || showFocusedNoChanges);

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
          className={`view-mode-btn${mode === 'diff' ? ' active' : ''}`}
          onClick={() => setMode('diff')}
          title="Show local uncommitted changes and one-hop file neighbors"
        >
          Diff
        </button>
        <button
          className={`view-mode-btn${mode === 'branch' ? ' active' : ''}`}
          onClick={() => setMode('branch')}
          title="Show changes between current branch and base ref with one-hop neighbors"
        >
          Branch / PR
        </button>
        {isFocusedMode && (
          <>
            <button
              className={`view-mode-btn${!showFocusedContext ? ' active' : ''}`}
              onClick={() => setShowFocusedContext(false)}
              title="Show only changed files"
              disabled={focusedLoading || !!focusedError}
            >
              Changed only
            </button>
            <button
              className={`view-mode-btn${showFocusedContext ? ' active' : ''}`}
              onClick={() => setShowFocusedContext(true)}
              title="Show changed files with one-hop context"
              disabled={focusedLoading || !!focusedError}
            >
              + Context
            </button>
          </>
        )}
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
        {isFocusedMode ? (
          <span className="view-mode-count">
            {focusedLoading && 'loading changes...'}
            {!focusedLoading && focusedError && 'failed to load changes'}
            {!focusedLoading && !focusedError && (
              <>
                changed {changedCount}, showing {visibleCount}
                {showFocusedContext ? ` of ${focusedTotalCount}` : ''} files
                {branchBaseRef ? ` vs ${branchBaseRef}` : ''}
              </>
            )}
          </span>
        ) : mode !== 'full' ? (
          <span className="view-mode-count">
            showing {visibleCount} of {fileCount} nodes
          </span>
        ) : null}
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
            if (el.data && mode !== 'directory' && !el.data.isDeleted) {
              setShowMenu({
                anchor: e.currentTarget as HTMLElement,
                node: el.data.node,
              });
            }
          }}
        >
          <Controls />
        </ReactFlow>
        {showFocusedState && (
          <div
            className={`focused-state-overlay${focusedError ? ' focused-state-error' : ''}`}
          >
            {focusedLoading && 'Loading change-focused map...'}
            {!focusedLoading &&
              focusedError &&
              `Unable to load changes: ${focusedError}`}
            {showFocusedNoChanges &&
              (mode === 'diff'
                ? 'No local changes.'
                : `No changes against ${branchBaseRef || 'the base branch'}.`)}
          </div>
        )}
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

const FocusedFileView: React.FC<{ info: FocusedFileInfo }> = ({ info }) => (
  <div className="focused-file-node">
    <FilenamePrettyView filename={info.filename} />
    <div className="focused-reasons">
      {info.reasons.map((reason, idx) => (
        <span
          key={`${reason.type}-${reason.via || idx}`}
          className="focused-reason-chip"
          title={reasonLabel(reason, info)}
        >
          {reasonLabel(reason, info)}
        </span>
      ))}
    </div>
  </div>
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
