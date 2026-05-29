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
  Position,
  applyNodeChanges,
  NodeChange,
} from 'react-flow-renderer';
import { FilenamePrettyView } from '../atoms';
import {
  Node,
  CodeMapScope,
  CodeMapScopeNode,
  FileIncludeInfo,
  FileMapDetailed,
  FunctionCallInfo,
  FunctionDeclarationInfo,
  ChangeSourceRequest,
  FocusedDeclarationInfo,
  FocusedDeclarationReason,
  FocusedFileInfo,
  FocusedReviewOptions,
  FocusedReviewMap,
  RelatedReason,
  ChangedFileStatus,
} from '../types';
import {
  includeToGraphTypes,
  groupIncludesByDirectory,
  filterIncludesToEntryPoints,
} from '../utils';
import {
  layoutCodeGraph,
  layoutCodeGraphAsync,
  type CodeLayoutEdge,
  type CodeLayoutInput,
  type CodeLayoutNode,
  type CodeLayoutNodeKind,
  type CodeLayoutNodeRole,
  type CodeLayoutStrategy,
} from '../graphLayout';
import './IncludesHierarchy.css';

type LensId = 'overview' | 'review' | 'feature' | 'impact';
type OverviewMode = 'full' | 'entry' | 'directory';
type ReviewMode = 'diff' | 'branch';
type ReviewGranularity = 'files' | 'declarations';

type GraphNodeKind = CodeMapScopeNode['kind'];

type GraphNodeMeta = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  filename?: string;
  pos?: number;
  end?: number;
  startLine?: number;
  endLine?: number;
  reasonLabels: string[];
  isChanged: boolean;
  isTest: boolean;
  changeStatus?: ChangedFileStatus;
  isDeleted: boolean;
  canOpenFile: boolean;
};

type GraphConnection = {
  source: string;
  target: string;
};

type OverviewDeclarationNode = FunctionDeclarationInfo & {
  id: string;
  startLine: number;
  endLine: number;
};

type GraphEdgePresentation = GraphConnection & {
  id: string;
  label?: string;
  animated?: boolean;
  style?: React.CSSProperties;
  weight?: number;
};

type FlowConnectionPosition = {
  sourcePosition?: Position;
  targetPosition?: Position;
};

type WorkbenchGraphData = {
  initialNodes: Array<FlowNode<any>>;
  edgesElements: GraphEdgePresentation[];
  nodeMetaById: Map<string, GraphNodeMeta>;
  connectionEdges: GraphConnection[];
  asyncLayoutInput: CodeLayoutInput | null;
  asyncLayoutConnections: GraphConnection[];
};

const OVERVIEW_REGION_PADDING = 58;

const estimateFlowNodeSize = (
  node: FlowNode<any>
): { width: number; height: number } => {
  const className = String(node.className || '');
  if (className.includes('overview-declaration-node')) {
    return { width: 300, height: 140 };
  }
  return { width: 250, height: 180 };
};

const oppositePosition = (position: Position): Position => {
  switch (position) {
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    case Position.Top:
      return Position.Bottom;
    case Position.Bottom:
    default:
      return Position.Top;
  }
};

const getEdgeSourcePosition = (
  source?: { x: number; y: number },
  target?: { x: number; y: number }
): Position => {
  if (!source || !target) return Position.Right;

  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left;
  }

  return dy >= 0 ? Position.Bottom : Position.Top;
};

const getMostCommonPosition = (
  votes: Position[] | undefined
): Position | undefined => {
  if (!votes || votes.length === 0) return undefined;

  const counts = votes.reduce(
    (acc, position) => ({
      ...acc,
      [position]: (acc[position] || 0) + 1,
    }),
    {} as Partial<Record<Position, number>>
  );

  return [...votes].sort((left, right) => {
    const countDiff = (counts[right] || 0) - (counts[left] || 0);
    if (countDiff !== 0) return countDiff;
    return left.localeCompare(right);
  })[0];
};

const buildConnectionPositions = (
  positions: Record<string, { x: number; y: number }>,
  edges: GraphConnection[]
): Record<string, FlowConnectionPosition> => {
  const sourceVotes = new Map<string, Position[]>();
  const targetVotes = new Map<string, Position[]>();

  for (const edge of edges) {
    const sourcePosition = getEdgeSourcePosition(
      positions[edge.source],
      positions[edge.target]
    );
    sourceVotes.set(edge.source, [
      ...(sourceVotes.get(edge.source) || []),
      sourcePosition,
    ]);
    targetVotes.set(edge.target, [
      ...(targetVotes.get(edge.target) || []),
      oppositePosition(sourcePosition),
    ]);
  }

  const nodeIds = new Set([...sourceVotes.keys(), ...targetVotes.keys()]);
  const result: Record<string, FlowConnectionPosition> = {};

  for (const nodeId of nodeIds) {
    result[nodeId] = {
      sourcePosition: getMostCommonPosition(sourceVotes.get(nodeId)),
      targetPosition: getMostCommonPosition(targetVotes.get(nodeId)),
    };
  }

  return result;
};

const buildOverviewRegionNode = (
  id: string,
  nodes: FlowNode<any>[],
  className: string
): FlowNode<any> | null => {
  if (nodes.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const size = estimateFlowNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  return {
    id,
    className: `overview-region-node ${className}`,
    data: { label: '' },
    position: {
      x: minX - OVERVIEW_REGION_PADDING,
      y: minY - OVERVIEW_REGION_PADDING,
    },
    draggable: false,
    selectable: false,
    connectable: false,
    style: {
      width: maxX - minX + OVERVIEW_REGION_PADDING * 2,
      height: maxY - minY + OVERVIEW_REGION_PADDING * 2,
    },
  };
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

const overviewDeclarationId = (decl: FunctionDeclarationInfo): string =>
  `decl:${decl.filename}->${decl.name}:${decl.pos}`;

const buildLineStarts = (content: string): number[] => {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
};

const getLineNumber = (lineStarts: number[], offset: number): number => {
  let low = 0;
  let high = lineStarts.length - 1;
  let best = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best + 1;
};

const findContainingDeclaration = (
  declarations: FunctionDeclarationInfo[],
  call: FunctionCallInfo
): FunctionDeclarationInfo | null => {
  let match: FunctionDeclarationInfo | null = null;

  for (const decl of declarations) {
    if (decl.pos <= call.pos && call.end <= decl.end) {
      if (!match || decl.end - decl.pos < match.end - match.pos) {
        match = decl;
      }
    }
  }

  return match;
};

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
    case 'related-test':
      return reason.via
        ? `related test (${reason.via})`
        : 'related test';
    default:
      return reason.type;
  }
};

const declarationReasonLabel = (
  reason: FocusedDeclarationReason,
  info: FocusedDeclarationInfo
): string => {
  switch (reason.type) {
    case 'changed':
      return info.changeStatus
        ? `changed declaration: ${info.changeStatus}`
        : 'changed declaration';
    case 'calls-changed':
      return reason.via
        ? `calls changed declaration (${reason.via})`
        : 'calls changed declaration';
    case 'called-by-changed':
      return reason.via
        ? `called by changed declaration (${reason.via})`
        : 'called by changed declaration';
    case 'bridge-between-changes':
      return reason.via
        ? `bridge between changes (${reason.via})`
        : 'bridge between changes';
    default:
      return reason.type;
  }
};

const uniqueLabels = (items: string[]): string[] => Array.from(new Set(items));

const writeTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the older DOM copy path below.
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textArea);

  if (!copied) {
    throw new Error('Clipboard copy failed');
  }
};

export const IncludesHierarchy: React.FC<{
  includes: FileIncludeInfo[];
  filesMappings: Record<string, FileMapDetailed>;
  requestFileMap: (
    filename: string,
    includeRelated?: boolean
  ) => Promise<FileMapDetailed[]>;
  requestFocusedReview: (
    source: ChangeSourceRequest,
    options?: FocusedReviewOptions
  ) => Promise<FocusedReviewMap>;
  renderNodeMenu: (
    filename: string,
    anchor: HTMLElement | null,
    onClose: () => void,
    codeMapScope: CodeMapScope
  ) => React.ReactElement;
}> = React.memo(
  ({
    includes,
    filesMappings,
    requestFileMap,
    requestFocusedReview,
    renderNodeMenu,
  }) => {
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
  const [reviewGranularity, setReviewGranularity] =
    useState<ReviewGranularity>('files');
  const [entryDepth, setEntryDepth] = useState(2);
  const [expandedDirectory, setExpandedDirectory] = useState<string | null>(
    null
  );
  const [expandedOverviewFile, setExpandedOverviewFile] = useState<
    string | null
  >(null);
  const [overviewDeclarationLoading, setOverviewDeclarationLoading] =
    useState(false);
  const [overviewDeclarationError, setOverviewDeclarationError] = useState<
    string | null
  >(null);

  const [focusedReview, setFocusedReview] = useState<FocusedReviewMap | null>(
    null
  );
  const [focusedLoading, setFocusedLoading] = useState(false);
  const [focusedError, setFocusedError] = useState<string | null>(null);
  const [showFocusedContext, setShowFocusedContext] = useState(true);
  const [includeFocusedTests, setIncludeFocusedTests] = useState(true);
  const [scopeCopyStatus, setScopeCopyStatus] = useState<
    'idle' | 'copied' | 'error'
  >('idle');

  const [showMenu, setShowMenu] = useState<{
    anchor: HTMLElement | null;
    node: Node;
  } | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [layoutResetVersion, setLayoutResetVersion] = useState(0);

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

    requestFocusedReview(focusedSource, { includeTests: includeFocusedTests })
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
  }, [focusedSource, includeFocusedTests, includes, requestFocusedReview]);

  const expandedOverviewFileMapping = expandedOverviewFile
    ? filesMappings[expandedOverviewFile]
    : null;

  useEffect(() => {
    if (activeLens !== 'overview' || !expandedOverviewFile) {
      setOverviewDeclarationLoading(false);
      setOverviewDeclarationError(null);
      return;
    }

    if (expandedOverviewFileMapping) {
      setOverviewDeclarationLoading(false);
      setOverviewDeclarationError(null);
      return;
    }

    let canceled = false;
    setOverviewDeclarationLoading(true);
    setOverviewDeclarationError(null);

    requestFileMap(expandedOverviewFile, true)
      .catch((error: any) => {
        if (canceled) return;
        setOverviewDeclarationError(
          error?.message || 'Failed to load declaration expansion'
        );
      })
      .finally(() => {
        if (!canceled) {
          setOverviewDeclarationLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [
    activeLens,
    expandedOverviewFile,
    expandedOverviewFileMapping,
    requestFileMap,
  ]);

  const focusedFilesByName = useMemo(() => {
    if (!focusedReview) return new Map<string, FocusedFileInfo>();

    const visibleFiles = showFocusedContext
      ? focusedReview.files
      : focusedReview.files.filter((file) => file.isChanged);

    return new Map(visibleFiles.map((file) => [file.filename, file]));
  }, [focusedReview, showFocusedContext]);

  const focusedDeclarations = useMemo(() => {
    if (!focusedReview) return [];
    if (showFocusedContext) return focusedReview.declarations || [];
    return (focusedReview.declarations || []).filter((decl) => decl.isChanged);
  }, [focusedReview, showFocusedContext]);

  const focusedDeclarationIds = useMemo(
    () => new Set(focusedDeclarations.map((decl) => decl.id)),
    [focusedDeclarations]
  );

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

  const declarationReview =
    isReviewLens && reviewGranularity === 'declarations';

  const overviewDeclarationExpansion = useMemo(() => {
    if (
      isReviewLens ||
      !expandedOverviewFile ||
      !expandedOverviewFileMapping
    ) {
      return null;
    }

    const lineStarts = buildLineStarts(expandedOverviewFileMapping.content);
    const declarations: OverviewDeclarationNode[] =
      expandedOverviewFileMapping.mapping.functionDeclarations.map((decl) => ({
        ...decl,
        id: overviewDeclarationId(decl),
        startLine: getLineNumber(lineStarts, decl.pos),
        endLine: getLineNumber(lineStarts, Math.max(decl.pos, decl.end - 1)),
      }));

    return {
      filename: expandedOverviewFile,
      fileDetails: expandedOverviewFileMapping,
      declarations,
    };
  }, [
    expandedOverviewFile,
    expandedOverviewFileMapping,
    isReviewLens,
  ]);

  const {
    initialNodes,
    edgesElements,
    nodeMetaById,
    connectionEdges,
    asyncLayoutInput,
    asyncLayoutConnections,
  } = useMemo<WorkbenchGraphData>(() => {
    if (declarationReview && focusedReview) {
      const declarationEdges = (focusedReview.declarationCalls || []).filter(
        (edge) =>
          focusedDeclarationIds.has(edge.from) &&
          focusedDeclarationIds.has(edge.to)
      );
      const layoutNodes: CodeLayoutNode[] = focusedDeclarations.map((decl) => {
        const isBridge = decl.reasons.some(
          (reason) => reason.type === 'bridge-between-changes'
        );
        return {
          id: decl.id,
          label: decl.name,
          kind: 'declaration',
          role: decl.isChanged ? 'changed' : isBridge ? 'bridge' : 'context',
          filename: decl.filename,
          startLine: decl.startLine,
          endLine: decl.endLine,
          width: 300,
          height: 140,
          sortKey: `${decl.filename}:${String(decl.startLine || 0).padStart(
            8,
            '0'
          )}:${decl.name}:${decl.id}`,
        };
      });
      const layoutEdges: CodeLayoutEdge[] = declarationEdges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        kind: edge.reasons.some(
          (reason) => reason.type === 'bridge-between-changes'
        )
          ? 'bridge'
          : 'calls',
        label: edge.name,
        isHeuristic: edge.isHeuristic,
      }));
      const layoutResult = layoutCodeGraph({
        strategy: 'review-declarations',
        nodes: layoutNodes,
        edges: layoutEdges,
      });
      const connectionPositions = buildConnectionPositions(
        layoutResult.positions,
        declarationEdges.map((edge) => ({
          source: edge.from,
          target: edge.to,
        }))
      );
      const nodeMetaById = new Map<string, GraphNodeMeta>();
      const initialNodes = focusedDeclarations.map((decl) => {
        const positioned = layoutResult.positions[decl.id];
        const isBridge = decl.reasons.some(
          (reason) => reason.type === 'bridge-between-changes'
        );
        const reasonLabels = uniqueLabels(
          decl.reasons.map((reason) => declarationReasonLabel(reason, decl))
        );

        nodeMetaById.set(decl.id, {
          id: decl.id,
          label: decl.name,
          kind: 'declaration',
          filename: decl.filename,
          pos: decl.pos,
          end: decl.end,
          startLine: decl.startLine,
          endLine: decl.endLine,
          reasonLabels,
          isChanged: decl.isChanged,
          isTest: false,
          changeStatus: decl.changeStatus,
          isDeleted: false,
          canOpenFile: true,
        });

        return {
          id: decl.id,
          className: decl.isChanged
            ? 'focused-declaration-node focused-declaration-changed'
            : isBridge
              ? 'focused-declaration-node focused-declaration-bridge'
              : 'focused-declaration-node focused-declaration-context',
          data: {
            label: <FocusedDeclarationView info={decl} />,
            node: { id: decl.id, label: decl.filename },
            isDeleted: false,
          },
          position: {
            x: positioned?.x || 0,
            y: positioned?.y || 0,
          },
          ...connectionPositions[decl.id],
        };
      });

      const edgesElements = declarationEdges.map((edge, idx) => {
        const isBridge = edge.reasons.some(
          (reason) => reason.type === 'bridge-between-changes'
        );

        return {
          id: edge.id || `${edge.from}-${edge.to}-${idx}`,
          markerEnd: { type: MarkerType.Arrow },
          source: edge.from,
          target: edge.to,
          label: edge.name,
          animated: edge.reasons.some((reason) => reason.type === 'calls-changed'),
          style: isBridge
            ? { stroke: '#ad7028', strokeDasharray: '6 4', strokeWidth: 2 }
            : edge.isHeuristic
              ? { strokeDasharray: '5 4' }
              : undefined,
        };
      });

      const connectionEdges: GraphConnection[] = declarationEdges.map((edge) => ({
        source: edge.from,
        target: edge.to,
      }));

      return {
        initialNodes: initialNodes as Array<FlowNode<any>>,
        edgesElements,
        nodeMetaById,
        connectionEdges,
        asyncLayoutInput: null,
        asyncLayoutConnections: [],
      };
    }

    const { nodes, edges } = includeToGraphTypes(activeIncludes);
    const graphEdges: GraphEdgePresentation[] = edges.map(
      ({ source, target }, idx) => ({
        id: `${source}-${target}-${idx}`,
        source,
        target,
        label: edgeLabel(activeIncludes[idx].items),
        weight: Math.max(1, activeIncludes[idx].items.length),
      })
    );

    if (isReviewLens && focusedReview) {
      const presentLabels = new Set(nodes.map((node) => node.label));
      for (const file of focusedFilesByName.values()) {
        if (!presentLabels.has(file.filename)) {
          nodes.push({ id: toNodeId(file.filename), label: file.filename });
          presentLabels.add(file.filename);
        }
      }
    }

    const overviewDeclarationsById = new Map<string, OverviewDeclarationNode>();

    if (overviewDeclarationExpansion) {
      const presentNodeIds = new Set(nodes.map((node) => node.id));
      const expandedFileId = toNodeId(overviewDeclarationExpansion.filename);

      if (!presentNodeIds.has(expandedFileId)) {
        nodes.push({
          id: expandedFileId,
          label: overviewDeclarationExpansion.filename,
        });
        presentNodeIds.add(expandedFileId);
      }

      for (const decl of overviewDeclarationExpansion.declarations) {
        overviewDeclarationsById.set(decl.id, decl);
        if (!presentNodeIds.has(decl.id)) {
          nodes.push({ id: decl.id, label: decl.name });
          presentNodeIds.add(decl.id);
        }

        graphEdges.push({
          id: `${expandedFileId}-${decl.id}-contains`,
          source: expandedFileId,
          target: decl.id,
          label: 'declares',
          style: { stroke: '#8ba796', strokeDasharray: '4 4' },
        });
      }

      const declarationsByName = new Map(
        overviewDeclarationExpansion.declarations.map((decl) => [
          decl.name,
          decl,
        ])
      );
      const addedDeclarationEdges = new Set<string>();
      const addDeclarationEdge = (
        source: string,
        target: string,
        label: string,
        style?: React.CSSProperties
      ) => {
        const key = `${source}->${target}:${label}`;
        if (source === target || addedDeclarationEdges.has(key)) return;
        addedDeclarationEdges.add(key);
        graphEdges.push({
          id: `${key}-${graphEdges.length}`,
          source,
          target,
          label,
          animated: true,
          style,
        });
      };

      const { mapping } = overviewDeclarationExpansion.fileDetails;
      for (const call of mapping.functionCalls) {
        if (call.isBuiltin) continue;

        const sourceDecl = findContainingDeclaration(
          mapping.functionDeclarations,
          call
        );
        if (!sourceDecl) continue;

        const sourceId = overviewDeclarationId(sourceDecl);
        const localTarget = declarationsByName.get(call.name);
        if (localTarget) {
          addDeclarationEdge(sourceId, localTarget.id, call.name, {
            stroke: '#52759b',
          });
          continue;
        }

        const importedFrom = mapping.includes.find((incl) =>
          incl.items.includes(call.name)
        )?.from;
        const importedFileId = importedFrom ? toNodeId(importedFrom) : null;
        if (importedFileId && presentNodeIds.has(importedFileId)) {
          addDeclarationEdge(sourceId, importedFileId, call.name, {
            stroke: '#6f8797',
            strokeDasharray: '6 4',
          });
        }
      }

      for (const [filename, fileDetails] of Object.entries(filesMappings)) {
        if (filename === overviewDeclarationExpansion.filename) continue;
        if (!presentNodeIds.has(toNodeId(filename))) continue;

        const importsExpandedFile = fileDetails.mapping.includes.some(
          (incl) => incl.from === overviewDeclarationExpansion.filename
        );
        if (!importsExpandedFile) continue;

        for (const call of fileDetails.mapping.functionCalls) {
          if (call.isBuiltin) continue;
          const targetDecl = declarationsByName.get(call.name);
          if (!targetDecl) continue;

          addDeclarationEdge(toNodeId(filename), targetDecl.id, call.name, {
            stroke: '#6f8797',
            strokeDasharray: '6 4',
          });
        }
      }
    }

    const layoutStrategy: CodeLayoutStrategy = isReviewLens
      ? 'review-files'
      : 'overview';
    const layoutNodes: CodeLayoutNode[] = nodes.map((node) => {
      const focusedInfo = isReviewLens
        ? focusedFilesByName.get(node.label)
        : null;
      const overviewDeclaration = overviewDeclarationsById.get(node.id);
      const layoutKind: CodeLayoutNodeKind = overviewDeclaration
        ? 'declaration'
        : focusedInfo?.isTest
          ? 'test'
          : directoryOverview
            ? 'module'
            : 'file';
      const layoutRole: CodeLayoutNodeRole = overviewDeclaration
        ? 'expanded'
        : focusedInfo?.isChanged
          ? 'changed'
          : focusedInfo?.isTest
            ? 'test'
            : isReviewLens
              ? 'context'
              : expandedOverviewFile === node.label ||
                  (expandedDirectory &&
                    isWithinDirectory(node.label, expandedDirectory))
                ? 'expanded'
                : expandedDirectory
                  ? 'context'
                : 'overview';
      const filename =
        layoutKind === 'file' || layoutKind === 'test'
          ? node.label
          : overviewDeclaration?.filename;

      return {
        id: node.id,
        label: node.label,
        kind: layoutKind,
        role: layoutRole,
        filename,
        startLine: overviewDeclaration?.startLine,
        endLine: overviewDeclaration?.endLine,
        width: overviewDeclaration ? 300 : 250,
        height: overviewDeclaration ? 140 : focusedInfo ? 150 : 180,
        sortKey: overviewDeclaration
          ? `${overviewDeclaration.filename}:${String(
              overviewDeclaration.startLine
            ).padStart(8, '0')}:${overviewDeclaration.name}:${node.id}`
          : node.label,
      };
    });
    const layoutEdges: CodeLayoutEdge[] = graphEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind:
        edge.label === 'declares'
          ? 'declares'
          : edge.style?.strokeDasharray
            ? 'heuristic'
            : 'imports',
      label: edge.label,
      weight: edge.weight,
    }));
    const layoutInput: CodeLayoutInput = {
      strategy: layoutStrategy,
      nodes: layoutNodes,
      edges: layoutEdges,
    };
    const layoutResult = layoutCodeGraph(layoutInput);
    const connectionPositions = buildConnectionPositions(
      layoutResult.positions,
      graphEdges
    );

    const nodeMetaById = new Map<string, GraphNodeMeta>();

    const initialNodes = nodes.map((node) => {
      const { id } = node;
      const positioned = layoutResult.positions[id];
      const overviewDeclaration = overviewDeclarationsById.get(id);

      if (overviewDeclaration) {
        const reasonLabels = [
          `declared in ${overviewDeclaration.filename}`,
          'expanded from Overview file',
        ];

        nodeMetaById.set(id, {
          id,
          label: overviewDeclaration.name,
          kind: 'declaration',
          filename: overviewDeclaration.filename,
          pos: overviewDeclaration.pos,
          end: overviewDeclaration.end,
          startLine: overviewDeclaration.startLine,
          endLine: overviewDeclaration.endLine,
          reasonLabels,
          isChanged: false,
          isTest: false,
          isDeleted: false,
          canOpenFile: true,
        });

        return {
          id,
          className: 'overview-node overview-declaration-node',
          data: {
            label: <OverviewDeclarationView info={overviewDeclaration} />,
            node: { id, label: overviewDeclaration.filename },
            isDeleted: false,
          },
          position: { x: positioned?.x || 0, y: positioned?.y || 0 },
          ...connectionPositions[id],
        };
      }

      const focusedInfo = isReviewLens
        ? focusedFilesByName.get(node.label)
        : null;
      const isDeleted = focusedInfo?.changeStatus === 'deleted';
      const baseReasonLabels = focusedInfo
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
      const reasonLabels =
        expandedOverviewFile === node.label
          ? uniqueLabels([...baseReasonLabels, 'expanded into declarations'])
          : baseReasonLabels;

      const kind: GraphNodeKind = focusedInfo?.isTest
        ? 'test'
        : directoryOverview
          ? 'module'
          : 'file';
      const canOpenFile = (kind === 'file' || kind === 'test') && !isDeleted;

      nodeMetaById.set(id, {
        id,
        label: node.label,
        kind,
        filename: kind === 'file' || kind === 'test' ? node.label : undefined,
        reasonLabels,
        isChanged: !!focusedInfo?.isChanged,
        isTest: !!focusedInfo?.isTest,
        changeStatus: focusedInfo?.changeStatus,
        isDeleted,
        canOpenFile,
      });

      const focusedClassName = focusedInfo
        ? [
            'focused-node',
            focusedInfo.isChanged
              ? 'focused-node-changed'
              : focusedInfo.isTest
                ? 'focused-node-test'
                : 'focused-node-context',
            focusedInfo.isTest ? 'focused-node-is-test' : '',
          ]
            .filter(Boolean)
            .join(' ')
        : '';

      return {
        id,
        className: focusedInfo
          ? focusedClassName
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
        position: { x: positioned?.x || 0, y: positioned?.y || 0 },
        ...connectionPositions[id],
      };
    });

    const edgesElements = graphEdges.map(
      ({ id, source, target, label, animated, style }) => ({
        id,
        markerEnd: { type: MarkerType.Arrow },
        source,
        target,
        label,
        animated,
        style,
      })
    );
    const connectionEdges: GraphConnection[] = graphEdges.map(
      ({ source, target }) => ({
        source,
        target,
      })
    );

    return {
      initialNodes: initialNodes as Array<FlowNode<any>>,
      edgesElements,
      nodeMetaById,
      connectionEdges,
      asyncLayoutInput: isReviewLens ? layoutInput : null,
      asyncLayoutConnections: connectionEdges,
    };
  }, [
    activeIncludes,
    declarationReview,
    expandedOverviewFile,
    focusedDeclarationIds,
    focusedDeclarations,
    focusedFilesByName,
    focusedReview,
    filesMappings,
    isReviewLens,
    overviewDeclarationExpansion,
    reviewGranularity,
    directoryOverview,
    entryDepth,
    overviewMode,
    expandedDirectory,
  ]);

  useEffect(() => {
    setShowMenu(null);
  }, [
    activeLens,
    overviewMode,
    reviewMode,
    reviewGranularity,
    showFocusedContext,
    includeFocusedTests,
    expandedDirectory,
    expandedOverviewFile,
  ]);

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

    for (const edge of connectionEdges) {
      if (edge.source === selectedNode.id) {
        outgoing++;
        related.add(nodeMetaById.get(edge.target)?.label || edge.target);
      }
      if (edge.target === selectedNode.id) {
        incoming++;
        related.add(nodeMetaById.get(edge.source)?.label || edge.source);
      }
    }

    return {
      incoming,
      outgoing,
      relatedFiles: Array.from(related).sort((a, b) => a.localeCompare(b)),
    };
  }, [connectionEdges, nodeMetaById, selectedNode]);

  const projectionKey = `${activeLens}|${overviewMode}|${reviewMode}|${reviewGranularity}|${showFocusedContext ? 'context' : 'changed'}|${includeFocusedTests ? 'tests' : 'no-tests'}|${expandedDirectory || ''}|${expandedOverviewFile || ''}`;
  const currentScope = useMemo<CodeMapScope>(() => {
    const nodes: CodeMapScopeNode[] = Array.from(nodeMetaById.values())
      .map((meta) => ({
        id: meta.id,
        kind: meta.kind,
        label: meta.label,
        filename: meta.filename,
        pos: meta.pos,
        end: meta.end,
        startLine: meta.startLine,
        endLine: meta.endLine,
        reasons: meta.reasonLabels,
        isChanged: meta.isChanged,
        isTest: meta.isTest,
        isDeleted: meta.isDeleted,
        changeStatus: meta.changeStatus,
      }))
      .sort(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          (left.filename || left.label).localeCompare(
            right.filename || right.label
          ) ||
          (left.startLine || 0) - (right.startLine || 0)
      );
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = edgesElements
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === 'string' ? edge.label : undefined,
      }));
    const files = uniqueLabels(
      nodes.flatMap((node) => (node.filename ? [node.filename] : []))
    );
    const declarations = nodes.filter((node) => node.kind === 'declaration');

    return {
      scopeId: `${projectionKey}|selected:${selectedNode?.id || ''}`,
      lens: activeLens,
      mode: isReviewLens ? reviewMode : overviewMode,
      granularity:
        declarationReview || !!expandedOverviewFile ? 'declarations' : 'files',
      selectedNodeId: selectedNode?.id,
      source: isReviewLens ? focusedReview?.changeSet.source : undefined,
      includeContext: isReviewLens ? showFocusedContext : undefined,
      includeTests: isReviewLens ? includeFocusedTests : undefined,
      expandedDirectory: expandedDirectory || undefined,
      expandedFile: expandedOverviewFile || undefined,
      files,
      declarations,
      nodes,
      edges,
    };
  }, [
    activeLens,
    declarationReview,
    edgesElements,
    expandedDirectory,
    expandedOverviewFile,
    focusedReview,
    includeFocusedTests,
    isReviewLens,
    nodeMetaById,
    overviewMode,
    projectionKey,
    reviewMode,
    selectedNode,
    showFocusedContext,
  ]);
  const previousProjectionRef = useRef<string>(projectionKey);
  const previousLayoutResetRef = useRef(layoutResetVersion);

  const [nodesElements, setNodesElements] = useState<FlowNode<any>[]>(
    initialNodes as FlowNode<any>[]
  );
  const [asyncLayoutLoading, setAsyncLayoutLoading] = useState(false);

  useEffect(() => {
    setScopeCopyStatus('idle');
  }, [currentScope.scopeId]);

  const copyCurrentScope = useCallback(async () => {
    const handoffScope: CodeMapScope = {
      ...currentScope,
      generatedAt: new Date().toISOString(),
    };

    try {
      await writeTextToClipboard(JSON.stringify(handoffScope, null, 2));
      setScopeCopyStatus('copied');
    } catch {
      setScopeCopyStatus('error');
    }
  }, [currentScope]);

  useEffect(() => {
    setNodesElements((previousNodes) => {
      const nextNodes = initialNodes as FlowNode<any>[];

      // Reset layout when changing projection, preserve manual placement for refreshes.
      if (
        previousProjectionRef.current !== projectionKey ||
        previousLayoutResetRef.current !== layoutResetVersion
      ) {
        previousProjectionRef.current = projectionKey;
        previousLayoutResetRef.current = layoutResetVersion;
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
  }, [initialNodes, layoutResetVersion, projectionKey]);

  useEffect(() => {
    if (!asyncLayoutInput) {
      setAsyncLayoutLoading(false);
      return;
    }

    let canceled = false;
    setAsyncLayoutLoading(true);

    layoutCodeGraphAsync({
      ...asyncLayoutInput,
      engine: 'elk',
    })
      .then((layoutResult) => {
        if (canceled) return;

        const connectionPositions = buildConnectionPositions(
          layoutResult.positions,
          asyncLayoutConnections
        );

        setNodesElements(
          initialNodes.map((node) => {
            const positioned = layoutResult.positions[node.id];
            return {
              ...node,
              position: positioned || node.position,
              ...connectionPositions[node.id],
            };
          })
        );
      })
      .catch((error) => {
        if (!canceled) {
          console.warn('ELK layout failed, keeping semantic layout', error);
        }
      })
      .finally(() => {
        if (!canceled) {
          setAsyncLayoutLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [
    asyncLayoutConnections,
    asyncLayoutInput,
    initialNodes,
    layoutResetVersion,
    projectionKey,
  ]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodesElements((nds) => applyNodeChanges(changes, nds));
  }, []);

  const overviewRegionNodes = useMemo<FlowNode<any>[]>(() => {
    if (activeLens !== 'overview') return [];

    const regions: FlowNode<any>[] = [];

    if (expandedDirectory) {
      const moduleNodes = nodesElements.filter((node) => {
        const meta = nodeMetaById.get(node.id);
        return (
          meta?.kind === 'file' &&
          !!meta.filename &&
          isWithinDirectory(meta.filename, expandedDirectory)
        );
      });
      const region = buildOverviewRegionNode(
        'overview-region-expanded-module',
        moduleNodes,
        'overview-region-module'
      );
      if (region) regions.push(region);
    }

    if (expandedOverviewFile) {
      const fileNodes = nodesElements.filter((node) => {
        const meta = nodeMetaById.get(node.id);
        return (
          meta?.filename === expandedOverviewFile &&
          (meta.kind === 'file' || meta.kind === 'declaration')
        );
      });
      const region = buildOverviewRegionNode(
        'overview-region-expanded-file',
        fileNodes,
        'overview-region-file'
      );
      if (region) regions.push(region);
    }

    return regions;
  }, [
    activeLens,
    expandedDirectory,
    expandedOverviewFile,
    nodeMetaById,
    nodesElements,
  ]);

  const renderedNodes = useMemo(
    () => [...overviewRegionNodes, ...nodesElements],
    [nodesElements, overviewRegionNodes]
  );

  const visibleCount = useMemo(() => {
    if (declarationReview) return focusedDeclarations.length;
    if (isReviewLens) return focusedFilesByName.size;
    return initialNodes.length;
  }, [
    declarationReview,
    focusedDeclarations,
    isReviewLens,
    focusedFilesByName,
    initialNodes,
  ]);
  const denseGraph = edgesElements.length > 24 || initialNodes.length > 18;
  const renderedEdges = useMemo(
    () =>
      edgesElements.map((edge) => {
        const isSelectedNeighbor =
          !!selectedNodeId &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId);
        const baseStyle = edge.style || {};

        return {
          ...edge,
          label: denseGraph && !isSelectedNeighbor ? undefined : edge.label,
          style: selectedNodeId
            ? {
                ...baseStyle,
                opacity: isSelectedNeighbor ? 1 : 0.24,
                strokeWidth: isSelectedNeighbor
                  ? Math.max(Number(baseStyle.strokeWidth || 1), 2.5)
                  : baseStyle.strokeWidth,
              }
            : baseStyle,
          className: isSelectedNeighbor ? 'selected-neighborhood-edge' : '',
        };
      }),
    [denseGraph, edgesElements, selectedNodeId]
  );

  const changedCount = focusedReview?.changeSet.files.length || 0;
  const focusedTotalCount = focusedReview?.files.length || 0;
  const focusedRelatedTestCount =
    focusedReview?.files.filter(
      (file) =>
        file.isTest &&
        file.reasons.some((reason) => reason.type === 'related-test')
    ).length || 0;
  const visibleTestCount = Array.from(focusedFilesByName.values()).filter(
    (file) => file.isTest
  ).length;
  const focusedDeclarationTotalCount = focusedReview?.declarations?.length || 0;
  const changedDeclarationCount =
    focusedReview?.declarations?.filter((decl) => decl.isChanged).length || 0;
  const bridgeDeclarationCount =
    focusedReview?.declarations?.filter(
      (decl) =>
        !decl.isChanged &&
        decl.reasons.some((reason) => reason.type === 'bridge-between-changes')
    ).length || 0;
  const bridgeCallCount =
    focusedReview?.declarationCalls?.filter((edge) =>
      edge.reasons.some((reason) => reason.type === 'bridge-between-changes')
    ).length || 0;
  const overviewDeclarationCount =
    overviewDeclarationExpansion?.declarations.length || 0;
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

  const showFocusedNoDeclarations =
    declarationReview &&
    !focusedLoading &&
    !focusedError &&
    !!focusedReview &&
    changedCount > 0 &&
    focusedDeclarationTotalCount === 0;

  const showFocusedState =
    isReviewLens &&
    (focusedLoading ||
      !!focusedError ||
      showFocusedNoChanges ||
      showFocusedNoDeclarations);

  const activeLensMeta = LENSES.find((lens) => lens.id === activeLens) || LENSES[0];
  const reviewScopeText =
    reviewMode === 'diff'
      ? 'Reviewing local working-tree changes'
      : `Reviewing branch changes${branchBaseRef ? ` vs ${branchBaseRef}` : ''}`;

  const headerScopeText = isReviewLens
    ? `${reviewScopeText} at ${
        reviewGranularity === 'declarations' ? 'declaration' : 'file'
      } level`
    : expandedOverviewFile
      ? `Overview declarations for ${expandedOverviewFile}`
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
  const canExpandSelectedFile =
    !!selectedNode &&
    selectedNode.kind === 'file' &&
    !isReviewLens &&
    activeLens === 'overview' &&
    selectedNode.canOpenFile &&
    selectedNode.filename !== expandedOverviewFile;
  const showOverviewDeclarationState =
    activeLens === 'overview' &&
    !!expandedOverviewFile &&
    (overviewDeclarationLoading || !!overviewDeclarationError);

  const openLens = (lensId: LensId) => {
    const lens = LENSES.find((item) => item.id === lensId);
    if (!lens || !lens.implemented) return;
    setActiveLens(lensId);
    if (lensId !== 'overview') {
      setExpandedOverviewFile(null);
    }
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
                    setExpandedOverviewFile(null);
                    setOverviewMode('directory');
                  }}
                >
                  Modules ({moduleCount})
                </button>
                <button
                  className={`segment-btn${overviewMode === 'entry' ? ' active' : ''}`}
                  onClick={() => {
                    setExpandedOverviewFile(null);
                    setExpandedDirectory(null);
                    setOverviewMode('entry');
                  }}
                >
                  Entry points
                </button>
                <button
                  className={`segment-btn${overviewMode === 'full' ? ' active' : ''}`}
                  onClick={() => {
                    setExpandedOverviewFile(null);
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
                    onClick={() => {
                      setExpandedOverviewFile(null);
                      setExpandedDirectory(null);
                    }}
                  >
                    Collapse back to modules
                  </button>
                </div>
              )}

              {expandedOverviewFile && (
                <div className="expansion-banner">
                  <div className="expansion-title">Expanded file</div>
                  <div className="expansion-path">{expandedOverviewFile}</div>
                  <button
                    className="inline-btn"
                    onClick={() => setExpandedOverviewFile(null)}
                  >
                    Collapse declarations
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
                  className={`segment-btn${reviewGranularity === 'files' ? ' active' : ''}`}
                  onClick={() => setReviewGranularity('files')}
                  disabled={focusedLoading || !!focusedError}
                >
                  Files
                </button>
                <button
                  className={`segment-btn${reviewGranularity === 'declarations' ? ' active' : ''}`}
                  onClick={() => setReviewGranularity('declarations')}
                  disabled={focusedLoading || !!focusedError}
                >
                  Declarations
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

              <label
                className={`check-control${includeFocusedTests ? ' active' : ''}`}
                title="Include test files that import changed code or match changed filenames"
              >
                <input
                  type="checkbox"
                  checked={includeFocusedTests}
                  onChange={(event) =>
                    setIncludeFocusedTests(event.currentTarget.checked)
                  }
                  disabled={focusedLoading}
                />
                <span>Related tests</span>
              </label>
            </div>
          )}

          <div className="panel-group compact">
            <div className="panel-group-title">Working scope</div>
            <div className="scope-stats">
              <span>{currentScope.files.length} files</span>
              <span>{currentScope.declarations.length} declarations</span>
              <span>{currentScope.nodes.length} nodes</span>
            </div>
            <button
              className="inline-btn scope-copy-btn"
              onClick={copyCurrentScope}
              disabled={currentScope.nodes.length === 0}
            >
              Copy scope JSON
            </button>
            {scopeCopyStatus === 'copied' && (
              <div className="scope-copy-status">Scope copied.</div>
            )}
            {scopeCopyStatus === 'error' && (
              <div className="scope-copy-status error">
                Clipboard copy failed.
              </div>
            )}
          </div>

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
                  {expandedOverviewFile
                    ? `showing ${visibleCount} visible nodes across ${fileCount} files`
                    : `showing ${visibleCount} of ${fileCount} files`}
                </span>
              )}
              {isReviewLens && (
                <span>
                  changed {changedCount} files
                  {declarationReview
                    ? `, ${changedDeclarationCount} changed declarations, showing ${visibleCount}${
                        showFocusedContext
                          ? ` of ${focusedDeclarationTotalCount}`
                          : ''
                      } declarations`
                    : `, showing ${visibleCount}${
                        showFocusedContext ? ` of ${focusedTotalCount}` : ''
                      } files${
                        showFocusedContext && visibleTestCount > 0
                          ? `, ${visibleTestCount} tests`
                          : ''
                      }`}
                  {branchBaseRef ? ` vs ${branchBaseRef}` : ''}
                </span>
              )}
            </div>
          </div>

          <div className="mapper-canvas">
            <div className="layout-actions">
              <button
                className="inline-btn"
                onClick={() => setLayoutResetVersion((version) => version + 1)}
                disabled={initialNodes.length === 0}
              >
                Reset layout
              </button>
            </div>
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              onNodesChange={onNodesChange}
              nodesConnectable={false}
              nodesDraggable={true}
              minZoom={0.01}
              onNodeClick={(e: any, el: any) => {
                const meta = nodeMetaById.get(el.id);
                if (!meta) return;
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
            {asyncLayoutLoading && (
              <div className="layout-state-overlay">Building ELK layout...</div>
            )}
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
                {showFocusedNoDeclarations &&
                  'No changed declarations could be mapped for this change set.'}
              </div>
            )}
            {showOverviewDeclarationState && (
              <div
                className={`focused-state-overlay${overviewDeclarationError ? ' focused-state-error' : ''}`}
              >
                {overviewDeclarationLoading &&
                  `Loading declarations for ${expandedOverviewFile}...`}
                {!overviewDeclarationLoading &&
                  overviewDeclarationError &&
                  `Unable to load declarations: ${overviewDeclarationError}`}
              </div>
            )}
            {!!showMenu &&
              renderNodeMenu(
                showMenu.node.label,
                showMenu.anchor,
                () => setShowMenu(null),
                currentScope
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
                    <div className="summary-note">
                      {changedDeclarationCount} changed declarations mapped
                      {showFocusedContext
                        ? `, ${focusedDeclarationTotalCount} declarations with direct call context`
                        : ''}
                      .
                    </div>
                    {showFocusedContext && focusedRelatedTestCount > 0 && (
                      <div className="summary-note">
                        {focusedRelatedTestCount} related test file
                        {focusedRelatedTestCount === 1 ? '' : 's'} included in the review scope.
                      </div>
                    )}
                    {showFocusedContext && !includeFocusedTests && (
                      <div className="summary-note">
                        Related tests are hidden for this review scope.
                      </div>
                    )}
                    {declarationReview &&
                      showFocusedContext &&
                      bridgeDeclarationCount > 0 && (
                        <div className="summary-note">
                          {bridgeDeclarationCount} bridge declarations connect changed declarations
                          across {bridgeCallCount} call edges.
                        </div>
                      )}
                    {declarationReview && focusedDeclarationTotalCount === 0 && (
                      <div className="summary-warning">
                        Declaration focus needs changed hunks that overlap analyzer-visible
                        functions, methods, or arrow declarations.
                      </div>
                    )}
                    {!showFocusedContext && (
                      <div className="summary-warning">
                        Context is hidden. Enable <strong>+ Context</strong> to include direct
                        {declarationReview ? ' declaration callers and callees.' : ' import neighbors.'}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="summary-title">Overview summary</div>
                <div className="summary-note">
                  {expandedOverviewFile
                    ? `Expanded ${expandedOverviewFile} into ${overviewDeclarationCount} analyzer-visible declarations.`
                    : 'Start broad with modules, then expand into file-level scope only where needed.'}
                </div>
                {expandedOverviewFile &&
                  !overviewDeclarationLoading &&
                  !overviewDeclarationError &&
                  overviewDeclarationCount === 0 && (
                    <div className="summary-warning">
                      No function, method, or arrow declarations were found in this file.
                    </div>
                  )}
                {expandedOverviewFile && overviewDeclarationError && (
                  <div className="summary-warning">
                    Unable to load declaration expansion for this file.
                  </div>
                )}
                {overviewMode === 'directory' && !expandedDirectory && (
                  <div className="summary-note">
                    Select a module node and use <strong>Expand module into files</strong> from
                    the details panel.
                  </div>
                )}
                {!expandedOverviewFile && (overviewMode !== 'directory' || expandedDirectory) && (
                  <div className="summary-note">
                    Select a file node and use <strong>Expand file into declarations</strong> from
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
                ) : selectedNode.kind === 'declaration' ? (
                  <div className="declaration-name">
                    <strong>{selectedNode.label}</strong>
                    {selectedNode.filename && (
                      <span>{selectedNode.filename}</span>
                    )}
                  </div>
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

                {selectedNode.isTest && (
                  <>
                    <span>Test file</span>
                    <strong>yes</strong>
                  </>
                )}

                {selectedNode.changeStatus && (
                  <>
                    <span>Change status</span>
                    <strong>{selectedNode.changeStatus}</strong>
                  </>
                )}

                {selectedNode.startLine && selectedNode.endLine && (
                  <>
                    <span>Lines</span>
                    <strong>
                      {selectedNode.startLine}-{selectedNode.endLine}
                    </strong>
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
                  onClick={() => {
                    setExpandedOverviewFile(null);
                    setExpandedDirectory(selectedNode.label);
                  }}
                >
                  Expand module into files
                </button>
              )}

              {canExpandSelectedFile && selectedNode.filename && (
                <button
                  className="inline-btn"
                  onClick={() =>
                    setExpandedOverviewFile(selectedNode.filename || null)
                  }
                >
                  Expand file into declarations
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
          className={`focused-reason-chip reason-${reason.type}`}
          title={reasonLabel(reason, info)}
        >
          {reasonLabel(reason, info)}
        </span>
      ))}
    </div>
  </div>
);

const FocusedDeclarationView: React.FC<{ info: FocusedDeclarationInfo }> = ({
  info,
}) => (
  <div className="focused-declaration-view">
    <div className="declaration-node-title">
      <strong>{info.name}</strong>
      <span>{info.args.length > 0 ? `(${info.args.join(', ')})` : '()'}</span>
    </div>
    <div className="declaration-node-file">
      {info.filename}
      {info.startLine && info.endLine
        ? `:${info.startLine}-${info.endLine}`
        : ''}
    </div>
    <div className="focused-reasons">
      {info.reasons.map((reason, idx) => (
        <span
          key={`${reason.type}-${reason.via || idx}`}
          className={`focused-reason-chip reason-${reason.type}`}
          title={declarationReasonLabel(reason, info)}
        >
          {declarationReasonLabel(reason, info)}
        </span>
      ))}
    </div>
  </div>
);

const OverviewDeclarationView: React.FC<{ info: OverviewDeclarationNode }> = ({
  info,
}) => (
  <div className="overview-declaration-view">
    <div className="declaration-node-title">
      <strong>{info.name}</strong>
      <span>{info.args.length > 0 ? `(${info.args.join(', ')})` : '()'}</span>
    </div>
    <div className="declaration-node-file">
      {info.filename}:{info.startLine}-{info.endLine}
    </div>
    <div className="focused-reasons">
      <span className="focused-reason-chip">overview declaration</span>
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
