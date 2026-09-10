import type { ThemeName } from '@/shared/design/tokens';
import type { CanvasTarget, SessionSnapshot } from '@/shared/types';
import type { GitFileDiff, GitWorkingTree } from '@/shared/types';
import type { ImmersiveLayout, PanelAction, PanelCommand, PanelEditing, PanelPlacement, WorkspacePanelId } from '@/features/shell/immersive/workspaceLayout';

export const MAX_IMMERSIVE_CHAT_ENTRIES = 12;
export const MAX_IMMERSIVE_CHAT_CHARS = 12_000;
export const MAX_IMMERSIVE_TEXTURE_PIXELS = 4_194_304;
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
  author: string;
  meta: string;
  text: string;
  state?: string;
}

export interface ImmersiveConversationProjection {
  sessionTitle: string;
  addressedAgent?: string;
  entries: ImmersiveTranscriptEntry[];
  preview?: string;
  runStatus: string;
  pendingApprovals: number;
  unread: number;
}

export interface ImmersiveInstrumentation {
  sessionActive: boolean;
  frames: number;
  medianFrameMs?: number;
  p95FrameMs?: number;
  logicalTexturePixels: number;
  liveResources: number;
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
  | 'exit'
  | 'reset-workspace'
  | 'previous-file'
  | 'next-file'
  | 'previous-evidence'
  | 'next-evidence'
  | 'refresh-evidence'
  | 'previous-sessions'
  | 'next-sessions'
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
}

export interface ImmersiveWorkspaceProps {
  viewKey: string;
  layout: ImmersiveLayout;
  editing?: PanelEditing;
  onPanelAction(id: WorkspacePanelId, command: PanelCommand): void;
  onPanelPlacement(id: WorkspacePanelId, placement: PanelPlacement): void;
  onResetWorkspace(): void;
  evidence: {
    tree?: GitWorkingTree;
    selectedPath?: string;
    diff?: GitFileDiff;
    loading: boolean;
    error?: string;
    status: string;
    onSelectPath(path: string): void;
    onRefresh(): void;
  };
  session?: SessionSnapshot;
  choices: ImmersiveSessionChoice[];
  launcherPage: number;
  workspaceStatus: string;
  onOpenSession(choice: ImmersiveSessionChoice): void;
  onLauncherPage(page: number): void;
  theme: ThemeName;
  activeTarget?: CanvasTarget;
  preview: string;
  runStatus: string;
  pendingApprovals: number;
  unread: number;
  pageFromNewest: number;
  newActivity: boolean;
  onOlder(): void;
  onNewer(): void;
  onPreviousCanvas(): void;
  onNextCanvas(): void;
  onExit(): void;
  onPageCount(pageCount: number): void;
}

export interface ImmersiveTestHooks {
  adapter?: ImmersiveXRAdapter;
  onStore?(store?: import('@react-three/xr').XRStore): void;
  onWorkspace?(state?: import('@react-three/fiber').RootState): void;
  failTranscript?: boolean;
  failXRImport?: boolean;
}

declare global {
  interface Window {
    __CODEAI_XR_TEST__?: ImmersiveTestHooks;
    __CODEAI_XR_BUNDLE_EVALUATIONS__?: number;
    __CODEAI_IMMERSIVE_INSTRUMENTATION__?: ImmersiveInstrumentation;
  }
}
