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
  type ReactFlowInstance,
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
  EntityKind,
  Arrangement,
  Entity,
  FocusedDeclarationInfo,
  FocusedDeclarationReason,
  FocusedFileInfo,
  FocusedReviewOptions,
  FocusedReviewMap,
  RelatedReason,
  Relation,
  ReviewArrangementResult,
  ChangedFileStatus,
  CommitSummary,
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
  type LayoutCluster,
} from '../graphLayout';
import { useFullscreenEdgePan } from '../hooks/useFullscreenEdgePan';
import './IncludesHierarchy.css';

type LensId = 'overview' | 'review' | 'feature' | 'impact';
type OverviewMode = 'full' | 'entry' | 'directory';
type ReviewMode = 'diff' | 'branch' | 'commit';
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
  if (
    className.includes('overview-declaration-node') ||
    className.includes('focused-declaration-node')
  ) {
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

// Padded bounding box around a set of positioned flow nodes — the geometry
// shared by every soft-band region overlay (overview groupings and the LLM
// arrangement's editorial regions). Returns null for an empty set.
const regionBoundingBox = (
  nodes: FlowNode<any>[],
  padding: number
): {
  position: { x: number; y: number };
  style: { width: number; height: number };
} | null => {
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
    position: { x: minX - padding, y: minY - padding },
    style: { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 },
  };
};

const buildOverviewRegionNode = (
  id: string,
  nodes: FlowNode<any>[],
  className: string
): FlowNode<any> | null => {
  const box = regionBoundingBox(nodes, OVERVIEW_REGION_PADDING);
  if (!box) return null;

  return {
    id,
    className: `overview-region-node ${className}`,
    data: { label: '' },
    draggable: false,
    selectable: false,
    connectable: false,
    ...box,
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
    label: 'Review changes',
    shortDescription: 'Center the map on a diff, branch, PR, or commit.',
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
const INITIAL_COMMIT_LIMIT = 5;
const MORE_COMMIT_LIMIT = 10;

const edgeLabel = (items: string[]) => {
  if (items.length <= MAX_ITEMS_TO_SHOW) return items.join(', ');
  const extra = items.length - MAX_ITEMS_TO_SHOW;
  return `${items.slice(0, MAX_ITEMS_TO_SHOW).join(', ')}... ${extra} more`;
};

const countUniqueNodes = (includes: FileIncludeInfo[]): number =>
  new Set(includes.flatMap((i) => [i.from, i.to])).size;

const toNodeId = (value: string) => value.replace(/-/g, '_');

// One editorial region translated into the web's node-id space. `webIds` holds
// every member (visible or not); the band is drawn from whichever members are
// actually on-canvas, so it composes with hide / collapse / reveal for free.
interface ProjectedRegion {
  id: string;
  label?: string;
  webIds: Set<string>;
}

interface ArrangementProjection {
  active: boolean;
  hiddenDeclIds: Set<string>;
  hiddenFilenames: Set<string>;
  collapsedIds: Set<string>;
  emphasisIds: Set<string>;
  regions: ProjectedRegion[];
}

const ARRANGED_REGION_PADDING = 40;

/** A soft, labeled band around the members of one editorial region. Drawn from
 *  the members currently on-canvas; needs ≥2 to be a meaningful grouping.
 *  Non-interactive and rendered behind the real nodes — a corner chip carries
 *  the label so the grouping reads as a suggestion, never a relation edge. */
const buildArrangementRegionNode = (
  region: ProjectedRegion,
  members: FlowNode<any>[]
): FlowNode<any> | null => {
  if (members.length < 2) return null;

  const box = regionBoundingBox(members, ARRANGED_REGION_PADDING);
  if (!box) return null;

  return {
    id: `arranged-region:${region.id}`,
    className: 'arranged-region-node',
    data: {
      label: region.label ? (
        <span className="arranged-region-label">{region.label}</span>
      ) : (
        ''
      ),
    },
    draggable: false,
    selectable: false,
    connectable: false,
    ...box,
  };
};

/** Translate the active arrangement's regions into layout clusters for the elk
 *  engine, scoped to the nodes actually present at this granularity (a region's
 *  file members exist in the file graph, its declaration members in the
 *  declaration graph). This is what makes elk place a region's members together
 *  so the soft band wraps a tight area instead of sprawling. Clusters with <2
 *  present members are dropped — a lone node needs no band. */
const buildLayoutClusters = (
  projection: ArrangementProjection,
  presentIds: Set<string>
): LayoutCluster[] => {
  if (!projection.active) return [];
  return projection.regions
    .map((region) => ({
      id: region.id,
      label: region.label,
      nodeIds: [...region.webIds].filter((id) => presentIds.has(id)),
    }))
    .filter((cluster) => cluster.nodeIds.length >= 2);
};

/** Emphasis / collapsed CSS classes for a node, in the web's own id space.
 *  Empty when arrangement is off — leaves the node's class list untouched. */
const arrangementClassFor = (
  projection: ArrangementProjection,
  webId: string
): string => {
  if (!projection.active) return '';
  return [
    projection.emphasisIds.has(webId) ? 'arranged-emphasis' : '',
    projection.collapsedIds.has(webId) ? 'arranged-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');
};

/** The sub-slice of the review model the LLM arrangement pass reasons over for
 *  one granularity. The user views files OR declarations at a time, so sending
 *  both halves makes the model split its attention across two unrelated editorial
 *  questions and roughly doubles the prompt. We send only the current
 *  granularity's nodes plus the relations whose endpoints both survive — which
 *  keeps `imports` for files, `calls`/`declares` for declarations, and drops the
 *  cross-granularity `contains` (file→decl) that neither single view shows. Each
 *  entity still carries its own change status, so the diff signal stays intact. */
const sliceForGranularity = (
  entities: Entity[],
  relations: Relation[],
  granularity: ReviewGranularity
): { entities: Entity[]; relations: Relation[] } => {
  const wantFiles = granularity === 'files';
  const scoped = entities.filter((entity) =>
    wantFiles ? entity.kind === 'file' : entity.kind !== 'file'
  );
  const ids = new Set(scoped.map((entity) => entity.id));
  const scopedRelations = relations.filter(
    (relation) => ids.has(relation.source) && ids.has(relation.target)
  );
  return { entities: scoped, relations: scopedRelations };
};

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

// Static entity kinds slot into the existing layout `kind` dimension (no
// bespoke per-kind geometry); 'function' keeps the legacy 'declaration' kind.
// The narrow return union is assignable to both CodeLayoutNodeKind and
// CodeMapScopeNodeKind (which lack each other's extra members).
type DeclarationNodeKind =
  | 'declaration'
  | 'class'
  | 'method'
  | 'variable'
  | 'constant';
const declarationLayoutKind = (kind?: EntityKind): DeclarationNodeKind => {
  switch (kind) {
    case 'class':
      return 'class';
    case 'method':
      return 'method';
    case 'variable':
      return 'variable';
    case 'constant':
      return 'constant';
    default:
      return 'declaration';
  }
};

// All entity kinds that render as a code declaration (vs. file/module/test).
const DECLARATION_NODE_KINDS: ReadonlySet<string> = new Set([
  'declaration',
  'class',
  'method',
  'variable',
  'constant',
]);
const isDeclarationNodeKind = (kind: string): boolean =>
  DECLARATION_NODE_KINDS.has(kind);

// Short badge shown on the card for non-function kinds.
const declarationKindBadge = (kind?: EntityKind): string | null => {
  switch (kind) {
    case 'class':
      return 'class';
    case 'method':
      return 'method';
    case 'variable':
      return 'let';
    case 'constant':
      return 'const';
    default:
      return null;
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
  requestReviewArrangement: (
    entities: Entity[],
    relations: Relation[]
  ) => Promise<ReviewArrangementResult>;
  requestCommits: (options?: {
    limit?: number;
    skip?: number;
  }) => Promise<CommitSummary[]>;
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
    requestReviewArrangement,
    requestCommits,
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
  // M2 arrangement: the LLM editorial pass is fetched on demand (the "Arrange
  // with AI" button) and held here, not shipped with the review. `useArrangement`
  // toggles the fetched overlay on/off for A/B vs. the deterministic elk view;
  // `revealHidden` brings back the entities the arrangement folded out.
  //
  // Held per granularity: files vs declarations are two different editorial
  // questions, each asked (and server-cached) on its own slice, so switching the
  // granularity surfaces that granularity's own arrangement — or the elk view +
  // "Arrange with AI" button if it hasn't been asked for yet.
  const [arrangements, setArrangements] = useState<
    Partial<Record<ReviewGranularity, Arrangement>>
  >({});
  const arrangement = arrangements[reviewGranularity] ?? null;
  const [arrangeLoading, setArrangeLoading] = useState(false);
  const [arrangeError, setArrangeError] = useState<string | null>(null);
  const [useArrangement, setUseArrangement] = useState(true);
  const [revealHidden, setRevealHidden] = useState(false);
  const [commitSearch, setCommitSearch] = useState('');
  const [selectedCommitRef, setSelectedCommitRef] = useState('');
  const [recentCommits, setRecentCommits] = useState<CommitSummary[]>([]);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitHasMore, setCommitHasMore] = useState(false);
  const [scopeCopyStatus, setScopeCopyStatus] = useState<
    'idle' | 'copied' | 'error'
  >('idle');

  const [showMenu, setShowMenu] = useState<{
    anchor: HTMLElement | null;
    node: Node;
  } | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [layoutResetVersion, setLayoutResetVersion] = useState(0);
  const {
    containerRef: graphCanvasRef,
    viewportControllerRef: flowInstanceRef,
    isFullscreen: graphFullscreen,
    toggleFullscreen: toggleGraphFullscreen,
  } = useFullscreenEdgePan<HTMLDivElement, ReactFlowInstance<any, any>>({
    ignoredTargetSelector: '.layout-actions',
    onBeforeEnter: () => setShowMenu(null),
  });

  const isReviewLens = activeLens === 'review';
  const loadCommits = useCallback(
    async (reset = false) => {
      const limit = reset ? INITIAL_COMMIT_LIMIT : MORE_COMMIT_LIMIT;
      const skip = reset ? 0 : recentCommits.length;

      setCommitLoading(true);
      setCommitError(null);
      try {
        const commits = await requestCommits({ limit, skip });
        setRecentCommits((current) => (reset ? commits : [...current, ...commits]));
        setCommitHasMore(commits.length === limit);
        if (reset && commits.length > 0 && !selectedCommitRef) {
          setSelectedCommitRef(commits[0].hash);
        }
      } catch (error: any) {
        setCommitError(error?.message || 'Failed to load commits');
      } finally {
        setCommitLoading(false);
      }
    },
    [recentCommits.length, requestCommits, selectedCommitRef]
  );

  useEffect(() => {
    if (!isReviewLens || reviewMode !== 'commit' || recentCommits.length > 0) {
      return;
    }

    loadCommits(true);
  }, [isReviewLens, loadCommits, recentCommits.length, reviewMode]);

  const focusedSource = useMemo<ChangeSourceRequest | null>(() => {
    if (!isReviewLens) return null;
    if (reviewMode === 'diff') return { mode: 'diff' };
    if (reviewMode === 'commit') {
      const ref = selectedCommitRef.trim();
      return ref ? { mode: 'commit', ref } : null;
    }
    return { mode: 'branch' };
  }, [isReviewLens, reviewMode, selectedCommitRef]);

  useEffect(() => {
    if (!focusedSource) {
      if (isReviewLens) setFocusedReview(null);
      return;
    }

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
  }, [
    focusedSource,
    includeFocusedTests,
    includes,
    isReviewLens,
    requestFocusedReview,
  ]);

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

  // Translate the server's editorial Arrangement (keyed by Entity id) into the
  // web's own node-id space, gated by the `Arranged` toggle. Declaration nodes
  // already use the entity id; file nodes use toNodeId(filename) — both derived
  // from focusedReview.entities so no id logic is duplicated here. Fail-safe: no
  // arrangement / toggle off → every set empty → the elk view is untouched.
  const arrangementProjection = useMemo(() => {
    const active = useArrangement && !!arrangement;
    const hiddenDeclIds = new Set<string>();
    const hiddenFilenames = new Set<string>();
    const collapsedIds = new Set<string>();
    const emphasisIds = new Set<string>();
    const regions: ProjectedRegion[] = [];

    if (active && arrangement) {
      const entities = focusedReview?.entities || [];
      const webIdOf = (entity: Entity): string =>
        entity.kind === 'file'
          ? toNodeId(entity.location?.filename || '')
          : entity.id;
      const entityById = new Map(entities.map((entity) => [entity.id, entity]));

      for (const entity of entities) {
        const visibility = arrangement.visibility?.[entity.id];
        // Guard: a changed entity is never hidden from its own review (the
        // server enforces this too — belt and suspenders).
        if (visibility === 'hidden' && !entity.changeStatus) {
          if (entity.kind === 'file') {
            if (entity.location?.filename) {
              hiddenFilenames.add(entity.location.filename);
            }
          } else {
            hiddenDeclIds.add(entity.id);
          }
        } else if (visibility === 'collapsed') {
          collapsedIds.add(webIdOf(entity));
        }
      }
      for (const id of arrangement.emphasis || []) {
        const entity = entityById.get(id);
        if (entity) emphasisIds.add(webIdOf(entity));
      }
      for (const region of arrangement.regions || []) {
        const webIds = new Set<string>();
        for (const entityId of region.entityIds) {
          const entity = entityById.get(entityId);
          if (entity) webIds.add(webIdOf(entity));
        }
        // A 1-member band is just a ring around a single node — let emphasis
        // cover that case; only group two or more.
        if (webIds.size >= 2) {
          regions.push({ id: region.id, label: region.label, webIds });
        }
      }
    }

    return {
      active,
      hiddenDeclIds,
      hiddenFilenames,
      collapsedIds,
      emphasisIds,
      regions,
    };
  }, [arrangement, focusedReview, useArrangement]);

  const focusedFilesByName = useMemo(() => {
    if (!focusedReview) return new Map<string, FocusedFileInfo>();

    const visibleFiles = showFocusedContext
      ? focusedReview.files
      : focusedReview.files.filter((file) => file.isChanged);

    const arranged =
      arrangementProjection.active && !revealHidden
        ? visibleFiles.filter(
            (file) => !arrangementProjection.hiddenFilenames.has(file.filename)
          )
        : visibleFiles;

    return new Map(arranged.map((file) => [file.filename, file]));
  }, [focusedReview, showFocusedContext, arrangementProjection, revealHidden]);

  const focusedDeclarations = useMemo(() => {
    if (!focusedReview) return [];
    const base = showFocusedContext
      ? focusedReview.declarations || []
      : (focusedReview.declarations || []).filter((decl) => decl.isChanged);

    if (arrangementProjection.active && !revealHidden) {
      return base.filter(
        (decl) => !arrangementProjection.hiddenDeclIds.has(decl.id)
      );
    }
    return base;
  }, [focusedReview, showFocusedContext, arrangementProjection, revealHidden]);

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

  // How many entities the arrangement folded out of the current granularity —
  // drives the "Reveal N hidden" control.
  const arrangementHiddenCount = declarationReview
    ? arrangementProjection.hiddenDeclIds.size
    : arrangementProjection.hiddenFilenames.size;

  // A fetched arrangement is tied to one review slice; drop both granularities'
  // arrangements when a new review payload arrives (commit / source / tests
  // change) so a stale overlay never applies to a different change.
  useEffect(() => {
    setArrangements({});
    setArrangeError(null);
    setRevealHidden(false);
  }, [focusedReview]);

  // Switching granularity surfaces a different arrangement (or none); don't leak
  // the other granularity's transient error / reveal state across the toggle.
  useEffect(() => {
    setArrangeError(null);
    setRevealHidden(false);
  }, [reviewGranularity]);

  const handleArrangeReview = useCallback(async () => {
    if (!focusedReview?.entities?.length) return;
    // Only send the granularity the user is actually looking at — half the prompt
    // and one focused editorial question instead of two interleaved ones.
    const granularity = reviewGranularity;
    const slice = sliceForGranularity(
      focusedReview.entities,
      focusedReview.relations || [],
      granularity
    );
    if (!slice.entities.length) {
      setArrangeError(`Nothing to arrange at the ${granularity} granularity.`);
      return;
    }
    setArrangeLoading(true);
    setArrangeError(null);
    try {
      const result = await requestReviewArrangement(
        slice.entities,
        slice.relations
      );
      if (!result.available) {
        setArrangeError('No LLM is configured on the server.');
        return;
      }
      if (!result.arrangement) {
        setArrangeError('The model returned no usable arrangement.');
        return;
      }
      // Store under the granularity that was active when the request started, so
      // a toggle mid-flight can't file the result under the wrong view.
      const next = result.arrangement;
      setArrangements((prev) => ({ ...prev, [granularity]: next }));
      setUseArrangement(true);
      setRevealHidden(false);
    } catch (error) {
      setArrangeError(
        error instanceof Error ? error.message : 'Arrangement request failed.'
      );
    } finally {
      setArrangeLoading(false);
    }
  }, [focusedReview, reviewGranularity, requestReviewArrangement]);

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
      // `declares` edges (class -> method) anchor methods to their class in the
      // layout; only in-grammar relations between visible entities are drawn.
      const declaresEdges = (focusedReview.relations || []).filter(
        (relation) =>
          relation.kind === 'declares' &&
          focusedDeclarationIds.has(relation.source) &&
          focusedDeclarationIds.has(relation.target)
      );
      const layoutNodes: CodeLayoutNode[] = focusedDeclarations.map((decl) => {
        const isBridge = decl.reasons.some(
          (reason) => reason.type === 'bridge-between-changes'
        );
        return {
          id: decl.id,
          label: decl.name,
          kind: declarationLayoutKind(decl.kind),
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
      const layoutEdges: CodeLayoutEdge[] = [
        ...declarationEdges.map((edge) => ({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          kind: edge.reasons.some(
            (reason) => reason.type === 'bridge-between-changes'
          )
            ? ('bridge' as const)
            : ('calls' as const),
          label: edge.name,
          isHeuristic: edge.isHeuristic,
        })),
        ...declaresEdges.map((relation) => ({
          id: relation.id,
          source: relation.source,
          target: relation.target,
          kind: 'declares' as const,
          label: 'declares',
        })),
      ];
      const layoutConnections: GraphConnection[] = [
        ...declarationEdges.map((edge) => ({
          source: edge.from,
          target: edge.to,
        })),
        ...declaresEdges.map((relation) => ({
          source: relation.source,
          target: relation.target,
        })),
      ];
      const layoutResult = layoutCodeGraph({
        strategy: 'review-declarations',
        nodes: layoutNodes,
        edges: layoutEdges,
      });
      const connectionPositions = buildConnectionPositions(
        layoutResult.positions,
        layoutConnections
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
          kind: declarationLayoutKind(decl.kind),
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

        const roleClass = decl.isChanged
          ? 'focused-declaration-changed'
          : isBridge
            ? 'focused-declaration-bridge'
            : 'focused-declaration-context';
        const arrangeClass = arrangementClassFor(arrangementProjection, decl.id);

        return {
          id: decl.id,
          className: `focused-declaration-node ${roleClass} decl-kind-${declarationLayoutKind(
            decl.kind
          )}${arrangeClass ? ` ${arrangeClass}` : ''}`,
          data: {
            label: <FocusedDeclarationView info={decl} />,
            node: { id: decl.id, label: decl.filename },
            isDeleted: false,
          },
          style: { width: 300 },
          position: {
            x: positioned?.x || 0,
            y: positioned?.y || 0,
          },
          ...connectionPositions[decl.id],
        };
      });

      const callEdgeElements = declarationEdges.map((edge, idx) => {
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

      const declaresEdgeElements = declaresEdges.map((relation, idx) => ({
        id: relation.id || `declares-${relation.source}-${relation.target}-${idx}`,
        markerEnd: { type: MarkerType.Arrow },
        source: relation.source,
        target: relation.target,
        label: 'declares',
        style: { stroke: '#8ba796', strokeDasharray: '4 4' },
      }));

      const edgesElements = [...callEdgeElements, ...declaresEdgeElements];

      return {
        initialNodes: initialNodes as Array<FlowNode<any>>,
        edgesElements,
        nodeMetaById,
        connectionEdges: layoutConnections,
        asyncLayoutInput: {
          strategy: 'review-declarations',
          nodes: layoutNodes,
          edges: layoutEdges,
          clusters: buildLayoutClusters(
            arrangementProjection,
            new Set(layoutNodes.map((node) => node.id))
          ),
        },
        asyncLayoutConnections: layoutConnections,
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
      // Region clustering only applies to the review lens (the elk path);
      // ignored by the synchronous layout below and by the overview strategy.
      clusters: isReviewLens
        ? buildLayoutClusters(
            arrangementProjection,
            new Set(layoutNodes.map((node) => node.id))
          )
        : undefined,
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

      const arrangeClass = arrangementClassFor(arrangementProjection, id);
      const focusedClassName = focusedInfo
        ? [
            'focused-node',
            focusedInfo.isChanged
              ? 'focused-node-changed'
              : focusedInfo.isTest
                ? 'focused-node-test'
                : 'focused-node-context',
            focusedInfo.isTest ? 'focused-node-is-test' : '',
            arrangeClass,
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
        ...(focusedInfo ? { style: { width: 250 } } : {}),
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
    arrangementProjection,
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

  const focusedSourceKey = focusedReview
    ? JSON.stringify(focusedReview.changeSet.source)
    : `${reviewMode}:${selectedCommitRef}`;
  const projectionKey = `${activeLens}|${overviewMode}|${reviewMode}|${focusedSourceKey}|${reviewGranularity}|${showFocusedContext ? 'context' : 'changed'}|${includeFocusedTests ? 'tests' : 'no-tests'}|${expandedDirectory || ''}|${expandedOverviewFile || ''}|${arrangementProjection.active ? 'arr' : 'noarr'}|${revealHidden ? 'reveal' : 'hide'}`;
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
    const declarations = nodes.filter((node) =>
      isDeclarationNodeKind(node.kind)
    );

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

  // Review lens: a soft band per editorial region from the LLM arrangement,
  // drawn from the members currently placed on-canvas (so it tracks hide /
  // collapse / reveal and manual drags). Empty unless the Arranged overlay is on.
  const reviewRegionNodes = useMemo<FlowNode<any>[]>(() => {
    if (!isReviewLens || !arrangementProjection.active) return [];

    return arrangementProjection.regions
      .map((region) => {
        const members = nodesElements.filter((node) =>
          region.webIds.has(node.id)
        );
        return buildArrangementRegionNode(region, members);
      })
      .filter((node): node is FlowNode<any> => node !== null);
  }, [isReviewLens, arrangementProjection, nodesElements]);

  const renderedNodes = useMemo(
    () => [...overviewRegionNodes, ...reviewRegionNodes, ...nodesElements],
    [nodesElements, overviewRegionNodes, reviewRegionNodes]
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
  const commitSource =
    reviewMode === 'commit' && focusedReview?.changeSet.source.mode === 'commit'
      ? focusedReview.changeSet.source
      : null;
  const selectedCommit = recentCommits.find(
    (commit) =>
      commit.hash === selectedCommitRef || commit.shortHash === selectedCommitRef
  );
  const commitSearchTerm = commitSearch.trim().toLowerCase();
  const visibleCommits = commitSearchTerm
    ? recentCommits.filter((commit) =>
        [
          commit.hash,
          commit.shortHash,
          commit.subject,
          commit.authorName,
        ].some((value) => value.toLowerCase().includes(commitSearchTerm))
      )
    : recentCommits;
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
      ? 'Reviewing working-tree changes'
      : reviewMode === 'commit'
        ? `Reviewing commit ${
            commitSource?.ref.slice(0, 12) ||
            selectedCommit?.shortHash ||
            selectedCommitRef ||
            'selection'
          }`
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
                  Working tree
                </button>
                <button
                  className={`segment-btn${reviewMode === 'branch' ? ' active' : ''}`}
                  onClick={() => setReviewMode('branch')}
                >
                  Branch / PR
                </button>
                <button
                  className={`segment-btn${reviewMode === 'commit' ? ' active' : ''}`}
                  onClick={() => setReviewMode('commit')}
                >
                  Commit
                </button>
              </div>

              {reviewMode === 'commit' && (
                <div className="commit-picker">
                  <input
                    className="commit-search-input"
                    value={commitSearch}
                    placeholder="Search hash, message, author"
                    onChange={(event) => setCommitSearch(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      const ref = commitSearch.trim();
                      if (!ref) return;
                      setSelectedCommitRef(ref);
                    }}
                  />
                  {selectedCommitRef && (
                    <div className="commit-selected">
                      Selected{' '}
                      <span>
                        {selectedCommit?.shortHash ||
                          commitSource?.ref.slice(0, 12) ||
                          selectedCommitRef}
                      </span>
                    </div>
                  )}
                  {commitError && (
                    <div className="commit-picker-state error">{commitError}</div>
                  )}
                  {!commitError && commitLoading && recentCommits.length === 0 && (
                    <div className="commit-picker-state">Loading commits...</div>
                  )}
                  {!commitError && visibleCommits.length > 0 && (
                    <div className="commit-list">
                      {visibleCommits.map((commit) => (
                        <button
                          key={commit.hash}
                          className={`commit-option${
                            selectedCommitRef === commit.hash ? ' active' : ''
                          }`}
                          onClick={() => setSelectedCommitRef(commit.hash)}
                          title={`${commit.hash} ${commit.subject}`}
                        >
                          <span className="commit-hash">{commit.shortHash}</span>
                          <span className="commit-subject">{commit.subject}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!commitError &&
                    !commitLoading &&
                    recentCommits.length > 0 &&
                    visibleCommits.length === 0 && (
                      <div className="commit-picker-state">
                        No loaded commits match this search.
                      </div>
                    )}
                  <button
                    className="inline-btn commit-more-btn"
                    onClick={() => loadCommits(false)}
                    disabled={commitLoading || !commitHasMore}
                  >
                    {commitLoading && recentCommits.length > 0
                      ? 'Loading...'
                      : commitHasMore
                        ? 'Show more'
                        : 'No more commits'}
                  </button>
                </div>
              )}

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

              {focusedReview?.llmAvailable && (
                <div className="arrangement-controls">
                  {!arrangement ? (
                    <button
                      className="inline-btn arrange-btn"
                      onClick={handleArrangeReview}
                      disabled={
                        focusedLoading ||
                        !!focusedError ||
                        arrangeLoading ||
                        !focusedReview?.entities?.length
                      }
                      title="Ask the configured LLM to group and prioritize this review — what to show first, fold, or hide. Takes a few seconds; the elk view stays available."
                    >
                      {arrangeLoading ? 'Arranging…' : '✨ Arrange with AI'}
                    </button>
                  ) : (
                    <>
                      <div
                        className="segmented-control"
                        title="Editorial arrangement suggested by the LLM. elk is the deterministic fallback — a grouping is a suggestion, not verified structure."
                      >
                        <button
                          className={`segment-btn${useArrangement ? ' active' : ''}`}
                          onClick={() => setUseArrangement(true)}
                          disabled={focusedLoading || !!focusedError}
                        >
                          Arranged
                        </button>
                        <button
                          className={`segment-btn${!useArrangement ? ' active' : ''}`}
                          onClick={() => setUseArrangement(false)}
                          disabled={focusedLoading || !!focusedError}
                        >
                          elk only
                        </button>
                      </div>

                      {arrangementProjection.active &&
                        arrangementHiddenCount > 0 && (
                          <label
                            className={`check-control${revealHidden ? ' active' : ''}`}
                            title="Reveal the entities the arrangement folded out for initial focus"
                          >
                            <input
                              type="checkbox"
                              checked={revealHidden}
                              onChange={(event) =>
                                setRevealHidden(event.currentTarget.checked)
                              }
                              disabled={focusedLoading}
                            />
                            <span>Reveal {arrangementHiddenCount} hidden</span>
                          </label>
                        )}

                      <button
                        className="inline-btn arrange-rerun-btn"
                        onClick={handleArrangeReview}
                        disabled={focusedLoading || arrangeLoading}
                        title="Ask the model again (cached for an unchanged slice)"
                      >
                        {arrangeLoading ? 'Arranging…' : 'Re-arrange'}
                      </button>
                    </>
                  )}

                  {arrangeError && (
                    <span className="arrange-error" role="status">
                      {arrangeError}
                    </span>
                  )}
                </div>
              )}
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

          <div
            ref={graphCanvasRef}
            className={`mapper-canvas${graphFullscreen ? ' graph-fullscreen' : ''}`}
          >
            <div className="layout-actions">
              <button
                className="inline-btn"
                onClick={() => setLayoutResetVersion((version) => version + 1)}
                disabled={initialNodes.length === 0}
              >
                Reset layout
              </button>
              <button
                className="inline-btn"
                onClick={toggleGraphFullscreen}
                disabled={initialNodes.length === 0}
                title={
                  graphFullscreen
                    ? 'Exit fullscreen'
                    : 'Open the graph fullscreen'
                }
              >
                {graphFullscreen ? 'Exit full screen' : 'Full screen'}
              </button>
            </div>
            <ReactFlow
              nodes={renderedNodes}
              edges={renderedEdges}
              onNodesChange={onNodesChange}
              onInit={(instance) => {
                flowInstanceRef.current = instance;
              }}
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
                    ? 'No working-tree changes.'
                    : reviewMode === 'commit'
                      ? 'No changes detected for this commit.'
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
                ) : isDeclarationNodeKind(selectedNode.kind) ? (
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

const FocusedFileView: React.FC<{ info: FocusedFileInfo }> = ({ info }) => {
  // `changed` is promoted to the status badge, and `imports-changed` /
  // `imported-by-changed` just repeat a labeled import edge — drop them.
  // Keep relationships that the graph doesn't otherwise spell out.
  const visibleReasons = info.reasons.filter(
    (reason) =>
      reason.type === 'related-test' || reason.type === 'function-neighbor'
  );

  return (
    <div className="focused-file-node">
      <div className="focused-file-header">
        <FilenamePrettyView filename={info.filename} />
        {info.changeStatus && (
          <span className={`change-status-badge status-${info.changeStatus}`}>
            {info.changeStatus}
          </span>
        )}
      </div>
      {visibleReasons.length > 0 && (
        <div className="focused-reasons">
          {visibleReasons.map((reason, idx) => (
            <span
              key={`${reason.type}-${reason.via || idx}`}
              className={`focused-reason-chip reason-${reason.type}`}
              title={reasonLabel(reason, info)}
            >
              {reasonLabel(reason, info)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const FocusedDeclarationView: React.FC<{ info: FocusedDeclarationInfo }> = ({
  info,
}) => {
  // Only reasons not already represented by a drawn edge survive as chips.
  // `calls-changed` / `called-by-changed` duplicate a labeled arrow, and
  // `changed` is promoted to the status badge below.
  const visibleReasons = info.reasons.filter(
    (reason) => reason.type === 'bridge-between-changes'
  );
  const lineRange =
    info.startLine && info.endLine
      ? `:${info.startLine}-${info.endLine}`
      : '';
  const slash = info.filename.lastIndexOf('/');
  const dir = slash >= 0 ? info.filename.slice(0, slash + 1) : '';
  const base = slash >= 0 ? info.filename.slice(slash + 1) : info.filename;

  const kindBadge = declarationKindBadge(info.kind);

  return (
    <div className="focused-declaration-view">
      <div className="declaration-node-title">
        {kindBadge && (
          <span className={`declaration-kind-badge kind-${info.kind}`}>
            {kindBadge}
          </span>
        )}
        <strong>{info.name}</strong>
        <span>{info.args.length > 0 ? `(${info.args.join(', ')})` : '()'}</span>
        {info.changeStatus && (
          <span
            className={`change-status-badge status-${info.changeStatus}`}
          >
            {info.changeStatus}
          </span>
        )}
      </div>
      <div className="declaration-node-file" title={`${info.filename}${lineRange}`}>
        {dir && <span className="declaration-node-dir">{dir}</span>}
        <span className="declaration-node-base">
          {base}
          {lineRange}
        </span>
      </div>
      {info.summary && (
        <div className="declaration-node-summary">{info.summary}</div>
      )}
      {info.causalReason && (
        <div className="declaration-node-cause">{info.causalReason}</div>
      )}
      {visibleReasons.length > 0 && (
        <div className="focused-reasons">
          {visibleReasons.map((reason, idx) => (
            <span
              key={`${reason.type}-${reason.via || idx}`}
              className={`focused-reason-chip reason-${reason.type}`}
              title={declarationReasonLabel(reason, info)}
            >
              bridge
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

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
