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
  ChangedFileStatus,
} from '../types';
import {
  includeToGraphTypes,
  applyGraphLayout,
  groupIncludesByDirectory,
  filterIncludesToEntryPoints,
} from '../utils';
import './IncludesHierarchy.css';

type LensId = 'overview' | 'review' | 'feature' | 'impact';
type OverviewMode = 'full' | 'entry' | 'directory';
type ReviewMode = 'diff' | 'branch';

type GraphNodeKind = 'file' | 'module';

type GraphNodeMeta = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  reasonLabels: string[];
  isChanged: boolean;
  changeStatus?: ChangedFileStatus;
  isDeleted: boolean;
  canOpenFile: boolean;
};

const LENSES: Array<{
  id: LensId;
  label: string;
  shortDescription: string;
  implemented: boolean;
}> = [
  {
    id: 'overview',
    label: 'Overview',
    shortDescription: 'Start broad with module-level architecture context.',
    implemented: true,
  },
  {
    id: 'review',
    label: 'Review current changes',
    shortDescription: 'Center the map on changed files and direct context.',
    implemented: true,
  },
  {
    id: 'feature',
    label: 'Feature focus',
    shortDescription: 'Seed the graph from key entry points. (Coming soon)',
    implemented: false,
  },
  {
    id: 'impact',
    label: 'Impact investigation',
    shortDescription: 'Trace callers/importers around one symbol. (Coming soon)',
    implemented: false,
  },
];

const MAX_ITEMS_TO_SHOW = 3;
const SUMMARY_FILE_LIMIT = 8;

const edgeLabel = (items: string[]) => {
  if (items.length <= MAX_ITEMS_TO_SHOW) return items.join(', ');
  const extra = items.length - MAX_ITEMS_TO_SHOW;
  return `${items.slice(0, MAX_ITEMS_TO_SHOW).join(', ')}... ${extra} more`;
};

const countUniqueNodes = (includes: FileIncludeInfo[]): number =>
  new Set(includes.flatMap((i) => [i.from, i.to])).size;

const toNodeId = (value: string) => value.replace(/-/g, '_');

const isWithinDirectory = (filename: string, directory: string): boolean => {
  if (directory === '.') return !filename.includes('/');
  return filename.startsWith(`${directory}/`);
};

const titleCaseStatus = (status: ChangedFileStatus): string =>
  status.charAt(0).toUpperCase() + status.slice(1);

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

const uniqueLabels = (items: string[]): string[] => Array.from(new Set(items));

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
  const moduleIncludes = useMemo(
    () => groupIncludesByDirectory(includes),
    [includes]
  );
  const moduleCount = useMemo(
    () => countUniqueNodes(moduleIncludes),
    [moduleIncludes]
  );

  const [activeLens, setActiveLens] = useState<LensId>('overview');
  const [overviewMode, setOverviewMode] = useState<OverviewMode>('directory');
  const [reviewMode, setReviewMode] = useState<ReviewMode>('diff');
  const [entryDepth, setEntryDepth] = useState(2);
  const [expandedDirectory, setExpandedDirectory] = useState<string | null>(
    null
  );

  const [focusedReview, setFocusedReview] = useState<FocusedReviewMap | null>(
    null
  );
  const [focusedLoading, setFocusedLoading] = useState(false);
  const [focusedError, setFocusedError] = useState<string | null>(null);
  const [showFocusedContext, setShowFocusedContext] = useState(true);

  const [showMenu, setShowMenu] = useState<{
    anchor: HTMLElement | null;
    node: Node;
  } | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const isReviewLens = activeLens === 'review';
  const focusedSource = useMemo<ChangeSourceRequest | null>(() => {
    if (!isReviewLens) return null;
    if (reviewMode === 'diff') return { mode: 'diff' };
    return { mode: 'branch' };
  }, [isReviewLens, reviewMode]);

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
    if (isReviewLens) {
      if (!focusedReview) return [];

      const visibleFiles = new Set(focusedFilesByName.keys());
      return focusedReview.includes.filter(
        (incl) => visibleFiles.has(incl.from) && visibleFiles.has(incl.to)
      );
    }

    if (overviewMode === 'entry') {
      return filterIncludesToEntryPoints(includes, entryDepth);
    }

    if (overviewMode === 'directory') {
      if (!expandedDirectory) return moduleIncludes;

      return includes.filter(
        (incl) =>
          isWithinDirectory(incl.from, expandedDirectory) ||
          isWithinDirectory(incl.to, expandedDirectory)
      );
    }

    return includes;
  }, [
    isReviewLens,
    focusedReview,
    focusedFilesByName,
    overviewMode,
    includes,
    entryDepth,
    expandedDirectory,
    moduleIncludes,
  ]);

  const directoryOverview =
    !isReviewLens && overviewMode === 'directory' && !expandedDirectory;

  const { initialNodes, edgesElements, nodeMetaById } = useMemo(() => {
    const { nodes, edges } = includeToGraphTypes(activeIncludes);

    if (isReviewLens && focusedReview) {
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

    const nodeMetaById = new Map<string, GraphNodeMeta>();

    const initialNodes = (nodes as PositionedNode[]).map((node) => {
      const { id, x, y } = node;
      const focusedInfo = isReviewLens
        ? focusedFilesByName.get(node.label)
        : null;
      const isDeleted = focusedInfo?.changeStatus === 'deleted';
      const reasonLabels = focusedInfo
        ? uniqueLabels(focusedInfo.reasons.map((r) => reasonLabel(r, focusedInfo)))
        : directoryOverview
          ? ['module dependency overview']
          : overviewMode === 'entry'
            ? [`entry-point neighborhood (depth ${entryDepth})`]
            : expandedDirectory
              ? isWithinDirectory(node.label, expandedDirectory)
                ? [`inside module ${expandedDirectory}`]
                : [`linked to module ${expandedDirectory}`]
              : ['full project navigation'];

      const kind: GraphNodeKind = directoryOverview ? 'module' : 'file';
      const canOpenFile = kind === 'file' && !isDeleted;

      nodeMetaById.set(id, {
        id,
        label: node.label,
        kind,
        reasonLabels,
        isChanged: !!focusedInfo?.isChanged,
        changeStatus: focusedInfo?.changeStatus,
        isDeleted,
        canOpenFile,
      });

      return {
        id,
        className: focusedInfo
          ? focusedInfo.isChanged
            ? 'focused-node focused-node-changed'
            : 'focused-node focused-node-context'
          : directoryOverview
            ? 'overview-node overview-module-node'
            : 'overview-node overview-file-node',
        data: {
          label: focusedInfo ? (
            <FocusedFileView info={focusedInfo} />
          ) : directoryOverview ? (
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

    return { initialNodes, edgesElements, nodeMetaById };
  }, [
    activeIncludes,
    focusedFilesByName,
    focusedReview,
    isReviewLens,
    directoryOverview,
    entryDepth,
    overviewMode,
    expandedDirectory,
  ]);

  useEffect(() => {
    setShowMenu(null);
  }, [activeLens, overviewMode, reviewMode, showFocusedContext, expandedDirectory]);

  useEffect(() => {
    if (initialNodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }

    if (!selectedNodeId || !nodeMetaById.has(selectedNodeId)) {
      setSelectedNodeId(initialNodes[0].id);
    }
  }, [initialNodes, nodeMetaById, selectedNodeId]);

  const selectedNode = selectedNodeId ? nodeMetaById.get(selectedNodeId) : null;

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode) return { incoming: 0, outgoing: 0, relatedFiles: [] as string[] };

    let incoming = 0;
    let outgoing = 0;
    const related = new Set<string>();

    for (const edge of activeIncludes) {
      if (edge.from === selectedNode.label) {
        outgoing++;
        related.add(edge.to);
      }
      if (edge.to === selectedNode.label) {
        incoming++;
        related.add(edge.from);
      }
    }

    return {
      incoming,
      outgoing,
      relatedFiles: Array.from(related).sort((a, b) => a.localeCompare(b)),
    };
  }, [activeIncludes, selectedNode]);

  const projectionKey = `${activeLens}|${overviewMode}|${reviewMode}|${showFocusedContext ? 'context' : 'changed'}|${expandedDirectory || ''}`;
  const previousProjectionRef = useRef<string>(projectionKey);

  const [nodesElements, setNodesElements] = useState<FlowNode<any>[]>(
    initialNodes as FlowNode<any>[]
  );

  useEffect(() => {
    setNodesElements((previousNodes) => {
      const nextNodes = initialNodes as FlowNode<any>[];

      // Reset layout when changing projection, preserve manual placement for refreshes.
      if (previousProjectionRef.current !== projectionKey) {
        previousProjectionRef.current = projectionKey;
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
  }, [initialNodes, projectionKey]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodesElements((nds) => applyNodeChanges(changes, nds));
  }, []);

  const visibleCount = useMemo(() => {
    if (isReviewLens) return focusedFilesByName.size;
    return initialNodes.length;
  }, [isReviewLens, focusedFilesByName, initialNodes]);

  const changedCount = focusedReview?.changeSet.files.length || 0;
  const focusedTotalCount = focusedReview?.files.length || 0;
  const branchBaseRef =
    reviewMode === 'branch' && focusedReview?.changeSet.source.mode === 'branch'
      ? focusedReview.changeSet.source.baseRef
      : null;

  const showFocusedNoChanges =
    isReviewLens &&
    !focusedLoading &&
    !focusedError &&
    !!focusedReview &&
    changedCount === 0;

  const showFocusedState =
    isReviewLens && (focusedLoading || !!focusedError || showFocusedNoChanges);

  const activeLensMeta = LENSES.find((lens) => lens.id === activeLens) || LENSES[0];

  const headerScopeText = isReviewLens
    ? reviewMode === 'diff'
      ? 'Reviewing local working-tree changes'
      : `Reviewing branch changes${branchBaseRef ? ` vs ${branchBaseRef}` : ''}`
    : overviewMode === 'directory'
      ? expandedDirectory
        ? `Overview expanded for ${expandedDirectory}`
        : 'Overview by module dependency'
      : overviewMode === 'entry'
        ? `Overview from entry points (depth ${entryDepth})`
        : 'Overview of full project dependency graph';

  const topChanged = focusedReview?.changeSet.files.slice(0, SUMMARY_FILE_LIMIT) || [];
  const omittedChanged = Math.max(0, changedCount - topChanged.length);

  const canExpandSelectedModule =
    !!selectedNode &&
    selectedNode.kind === 'module' &&
    !isReviewLens &&
    overviewMode === 'directory' &&
    !expandedDirectory;

  const openLens = (lensId: LensId) => {
    const lens = LENSES.find((item) => item.id === lensId);
    if (!lens || !lens.implemented) return;
    setActiveLens(lensId);
  };

  return (
    <div className="mapper-workbench">
      <div className="workbench-topbar">
        <div className="workbench-title-wrap">
          <div className="workbench-title">Code Map Workbench</div>
          <div className="workbench-subtitle">
            What part of the codebase are you trying to understand right now?
          </div>
        </div>
        <div className="workbench-topbar-stats">
          <span>{fileCount} files</span>
          <span>{visibleCount} visible nodes</span>
          <span>{edgesElements.length} edges</span>
        </div>
      </div>

      <div className="workbench-body">
        <aside className="workbench-sidebar">
          <div className="panel-heading">Lenses</div>
          <div className="lens-list">
            {LENSES.map((lens) => (
              <button
                key={lens.id}
                className={`lens-button${activeLens === lens.id ? ' active' : ''}`}
                onClick={() => openLens(lens.id)}
                disabled={!lens.implemented}
                title={lens.shortDescription}
              >
                <span className="lens-button-title">{lens.label}</span>
                {!lens.implemented && <span className="lens-pill">Soon</span>}
                <span className="lens-button-description">
                  {lens.shortDescription}
                </span>
              </button>
            ))}
          </div>

          {activeLens === 'overview' && (
            <div className="panel-group">
              <div className="panel-group-title">Overview controls</div>
              <div className="segmented-control">
                <button
                  className={`segment-btn${overviewMode === 'directory' ? ' active' : ''}`}
                  onClick={() => {
                    setOverviewMode('directory');
                  }}
                >
                  Modules ({moduleCount})
                </button>
                <button
                  className={`segment-btn${overviewMode === 'entry' ? ' active' : ''}`}
                  onClick={() => {
                    setExpandedDirectory(null);
                    setOverviewMode('entry');
                  }}
                >
                  Entry points
                </button>
                <button
                  className={`segment-btn${overviewMode === 'full' ? ' active' : ''}`}
                  onClick={() => {
                    setExpandedDirectory(null);
                    setOverviewMode('full');
                  }}
                >
                  All files
                </button>
              </div>

              {overviewMode === 'entry' && (
                <div className="depth-control">
                  <span className="depth-label">Depth</span>
                  <button
                    className="depth-btn"
                    onClick={() => setEntryDepth((d) => Math.max(1, d - 1))}
                  >
                    -
                  </button>
                  <span className="depth-value">{entryDepth}</span>
                  <button
                    className="depth-btn"
                    onClick={() => setEntryDepth((d) => d + 1)}
                  >
                    +
                  </button>
                </div>
              )}

              {overviewMode === 'directory' && expandedDirectory && (
                <div className="expansion-banner">
                  <div className="expansion-title">Expanded module</div>
                  <div className="expansion-path">{expandedDirectory}</div>
                  <button
                    className="inline-btn"
                    onClick={() => setExpandedDirectory(null)}
                  >
                    Collapse back to modules
                  </button>
                </div>
              )}
            </div>
          )}

          {activeLens === 'review' && (
            <div className="panel-group">
              <div className="panel-group-title">Review controls</div>
              <div className="segmented-control">
                <button
                  className={`segment-btn${reviewMode === 'diff' ? ' active' : ''}`}
                  onClick={() => setReviewMode('diff')}
                >
                  Diff
                </button>
                <button
                  className={`segment-btn${reviewMode === 'branch' ? ' active' : ''}`}
                  onClick={() => setReviewMode('branch')}
                >
                  Branch / PR
                </button>
              </div>

              <div className="segmented-control">
                <button
                  className={`segment-btn${!showFocusedContext ? ' active' : ''}`}
                  onClick={() => setShowFocusedContext(false)}
                  disabled={focusedLoading || !!focusedError}
                >
                  Changed only
                </button>
                <button
                  className={`segment-btn${showFocusedContext ? ' active' : ''}`}
                  onClick={() => setShowFocusedContext(true)}
                  disabled={focusedLoading || !!focusedError}
                >
                  + Context
                </button>
              </div>
            </div>
          )}

          <div className="panel-group compact">
            <div className="panel-group-title">Notes</div>
            <div className="sidebar-note">
              File hierarchy is still available via <strong>Overview -&gt; All files</strong>,
              but the homepage now starts from investigation lenses.
            </div>
          </div>
        </aside>

        <main className="workbench-main">
          <div className="workbench-main-header">
            <div>
              <div className="workbench-main-title">{activeLensMeta.label}</div>
              <div className="workbench-main-description">{headerScopeText}</div>
            </div>
            <div className="workbench-main-meta">
              {!isReviewLens && (
                <span>
                  showing {visibleCount} of {fileCount} files
                </span>
              )}
              {isReviewLens && (
                <span>
                  changed {changedCount}, showing {visibleCount}
                  {showFocusedContext ? ` of ${focusedTotalCount}` : ''} files
                  {branchBaseRef ? ` vs ${branchBaseRef}` : ''}
                </span>
              )}
            </div>
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
                const meta = nodeMetaById.get(el.id);
                setSelectedNodeId(el.id);

                if (meta && meta.canOpenFile) {
                  setShowMenu({
                    anchor: e.currentTarget as HTMLElement,
                    node: el.data.node,
                  });
                  return;
                }

                setShowMenu(null);
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
                  (reviewMode === 'diff'
                    ? 'No local changes.'
                    : `No changes against ${branchBaseRef || 'the base branch'}.`)}
              </div>
            )}
            {!!showMenu &&
              renderNodeMenu(showMenu.node.label, showMenu.anchor, () =>
                setShowMenu(null)
              )}
          </div>

          <div className="workbench-summary">
            {activeLens === 'review' ? (
              <>
                <div className="summary-title">Change summary</div>
                {focusedLoading && <div className="summary-note">Loading changes...</div>}
                {!focusedLoading && focusedError && (
                  <div className="summary-warning">Unable to load review scope.</div>
                )}
                {!focusedLoading && !focusedError && changedCount === 0 && (
                  <div className="summary-note">No changed files detected for this source.</div>
                )}
                {!focusedLoading && !focusedError && changedCount > 0 && (
                  <>
                    <div className="changed-list">
                      {topChanged.map((file) => (
                        <div key={`${file.status}-${file.filename}`} className="changed-item">
                          <span className={`status-pill status-${file.status}`}>
                            {titleCaseStatus(file.status)}
                          </span>
                          <span className="changed-file">{file.filename}</span>
                        </div>
                      ))}
                    </div>
                    {omittedChanged > 0 && (
                      <div className="summary-note">+ {omittedChanged} more changed files</div>
                    )}
                    {!showFocusedContext && (
                      <div className="summary-warning">
                        Context is hidden. Enable <strong>+ Context</strong> to include one-hop
                        import neighbors.
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="summary-title">Overview summary</div>
                <div className="summary-note">
                  Start broad with modules, then expand into file-level scope only where needed.
                </div>
                {overviewMode === 'directory' && !expandedDirectory && (
                  <div className="summary-note">
                    Select a module node and use <strong>Expand module into files</strong> from
                    the details panel.
                  </div>
                )}
                {overviewMode === 'entry' && (
                  <div className="summary-note">
                    Entry view starts from likely entry points and follows imports by depth.
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        <aside className="workbench-details">
          <div className="panel-heading">Node details</div>
          {!selectedNode && (
            <div className="details-placeholder">Select a node to inspect why it is visible.</div>
          )}

          {!!selectedNode && (
            <>
              <div className="details-node-name">
                {selectedNode.kind === 'module' ? (
                  <div className="module-name">{selectedNode.label}</div>
                ) : (
                  <FilenamePrettyView filename={selectedNode.label} />
                )}
              </div>

              <div className="details-grid">
                <span>Kind</span>
                <strong>{selectedNode.kind}</strong>

                <span>Inbound</span>
                <strong>{selectedNodeConnections.incoming}</strong>

                <span>Outbound</span>
                <strong>{selectedNodeConnections.outgoing}</strong>

                {selectedNode.changeStatus && (
                  <>
                    <span>Change status</span>
                    <strong>{selectedNode.changeStatus}</strong>
                  </>
                )}
              </div>

              <div className="details-subtitle">Why this node is shown</div>
              <div className="details-reasons">
                {selectedNode.reasonLabels.map((label) => (
                  <span key={label} className="reason-chip">
                    {label}
                  </span>
                ))}
              </div>

              {canExpandSelectedModule && (
                <button
                  className="inline-btn"
                  onClick={() => setExpandedDirectory(selectedNode.label)}
                >
                  Expand module into files
                </button>
              )}

              {selectedNode.canOpenFile && (
                <div className="details-hint">
                  Click this node in the graph to open file-level or logic-map navigation.
                </div>
              )}

              {selectedNodeConnections.relatedFiles.length > 0 && (
                <>
                  <div className="details-subtitle">Connected nodes</div>
                  <div className="related-list">
                    {selectedNodeConnections.relatedFiles
                      .slice(0, SUMMARY_FILE_LIMIT)
                      .map((item) => (
                        <div key={item} className="related-item">
                          {item}
                        </div>
                      ))}
                  </div>
                  {selectedNodeConnections.relatedFiles.length > SUMMARY_FILE_LIMIT && (
                    <div className="details-hint">
                      +
                      {selectedNodeConnections.relatedFiles.length -
                        SUMMARY_FILE_LIMIT}{' '}
                      more connections
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </aside>
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
  const parentPath = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
  return (
    <div className="node">
      <div className="file-path">{parentPath}</div>
      <div className="file-name">{name}/</div>
    </div>
  );
};
