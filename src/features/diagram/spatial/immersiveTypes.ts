import type { ImmersiveSessionControls, SessionAction } from '@/features/shell/immersive/sessionControls';
import type { ThemeName } from '@/shared/design/tokens';
import type { CanvasTarget, SessionSnapshot } from '@/shared/types';
import type { GitFileDiff, GitWorkingTree } from '@/shared/types';
import type { ImmersiveLayout, PanelAction, PanelCommand, PanelEditing, PanelPlacement, WorkspacePanelId } from '@/features/shell/immersive/workspaceLayout';
import type { ConversationAction, ImmersiveConversationControls } from '@/features/shell/immersive/conversationControls';
import type { CanvasReviewAction, ImmersiveCanvasReviewControls } from '@/features/shell/immersive/canvasReviewControls';

export const MAX_IMMERSIVE_TEXTURE_PIXELS = 5_592_405;
export const MAX_IMMERSIVE_TEXTURE_EDGE = 2_048;

export type ImmersiveAvailability =
  | 'checking'
  | 'available'
  | 'insecure'
  | 'unsupported'
  | 'entering'
  | 'active'
  | 'failed';

export interface ImmersiveTranscriptEntry {
  id: string;
  role?: 'user' | 'assistant';
  author: string;
  meta: string;
  text: string;
  state?: string;
}

export interface ImmersiveInstrumentation {
  sessionActive: boolean;
  frames: number;
  medianFrameMs?: number;
  p95FrameMs?: number;
  maxFrameMs?: number;
  logicalTexturePixels: number;
  liveResources: number;
  peakLogicalTexturePixels?: number;
  peakLiveResources?: number;
}

/** The deliberately small surface required by automated XR adapters. */
export interface ImmersiveSessionAdapter {
  readonly visibilityState?: XRVisibilityState;
  readonly inputSources?: Iterable<Pick<XRInputSource, 'targetRayMode' | 'hand'>>;
  end(): Promise<void>;
  addEventListener?(type: 'end' | 'visibilitychange' | 'inputsourceschange', listener: () => void): void;
  removeEventListener?(type: 'end' | 'visibilitychange' | 'inputsourceschange', listener: () => void): void;
}

export interface ImmersiveXRAdapter {
  isSessionSupported(mode: 'immersive-vr'): Promise<boolean>;
  /** When present, replaces native session entry while retaining the real R3F projection. */
  enterVR?(): Promise<ImmersiveSessionAdapter | undefined>;
  destroy?(): void;
}

export type ImmersiveSemanticAction =
  | PanelAction
  | SessionAction
  | ConversationAction
  | CanvasReviewAction
  | 'exit'
  | 'reset-workspace'
  | 'previous-file'
  | 'next-file'
  | 'previous-checkout'
  | 'next-checkout'
  | 'previous-evidence'
  | 'next-evidence'
  | 'refresh-evidence'
  | 'load-more-sessions'
  | 'previous-canvas'
  | 'next-canvas'
  | 'larger'
  | 'smaller'
  | 'reset-view'
  | 'older'
  | 'newer';

export interface ImmersiveController {
  enter(): Promise<void>;
  exit(): Promise<void>;
  perform(action: ImmersiveSemanticAction): void;
}

export interface ImmersiveSessionChoice {
  machineId: string;
  projectId?: string;
  sessionId: string;
  title: string;
  detail: string;
  updatedAt?: string;
}

export interface ImmersiveWorkspaceProps {
  conversation?: ImmersiveConversationControls;
  canvasReview?: ImmersiveCanvasReviewControls;
  sessionControls?: ImmersiveSessionControls;
  viewKey: string;
  layout: ImmersiveLayout;
  editing?: PanelEditing;
  onPanelAction(id: WorkspacePanelId, command: PanelCommand): void;
  onPanelPlacement(id: WorkspacePanelId, placement: PanelPlacement): void;
  onResetWorkspace(): void;
  evidence: {
    machineLabel: string;
    checkoutId?: string;
    checkoutName?: string;
    checkouts: Array<{ id: string; name: string }>;
    tree?: GitWorkingTree;
    selectedPath?: string;
    diff?: GitFileDiff;
    loading: boolean;
    error?: string;
    status: string;
    onSelectPath(path: string): void;
    onSelectCheckout(id: string): void;
    onRefresh(): void;
  };
  session?: SessionSnapshot;
  choices: ImmersiveSessionChoice[];
  workspaceStatus: string;
  onOpenSession(choice: ImmersiveSessionChoice): void;
  theme: ThemeName;
  activeTarget?: CanvasTarget;
  preview: string;
  runStatus: string;
  pendingApprovals: number;
  unread: number;
  onConversationScroll(state: { offset: number; maxOffset: number; atBottom: boolean; newActivity: boolean }): void;
  onPreviousCanvas(): void;
  onNextCanvas(): void;
  onExit(): void;
}

export interface ImmersiveTestHooks {
  adapter?: ImmersiveXRAdapter;
  onStore?(store?: import('@react-three/xr').XRStore): void;
  onWorkspace?(state?: import('@react-three/fiber').RootState): void;
  failTranscript?: boolean;
  failXRImport?: boolean;
  uikitSpike?: boolean;
}

export interface UikitSpikeDiagnostics {
  enabled: true;
  atlasBytes: number;
  fonts: Array<{ family: string; weight: string; glyphs: number; pages: number; width: number; height: number; encodedBytes: number }>;
  renderer: { textures: number; geometries: number; programs: number };
  transparentSortInstalled: boolean;
}

declare global {
  interface Window {
    __CODEAI_XR_TEST__?: ImmersiveTestHooks;
    __CODEAI_XR_BUNDLE_EVALUATIONS__?: number;
    __CODEAI_IMMERSIVE_INSTRUMENTATION__?: ImmersiveInstrumentation;
    __CODEAI_UIKIT_SPIKE__?: () => UikitSpikeDiagnostics;
  }
}
