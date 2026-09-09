import type { ThemeName } from '@/shared/design/tokens';
import type { CanvasTarget, SessionSnapshot } from '@/shared/types';

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
  readonly visibilityState?: string;
  end(): Promise<void>;
  addEventListener?(type: 'end' | 'visibilitychange', listener: () => void): void;
  removeEventListener?(type: 'end' | 'visibilitychange', listener: () => void): void;
}

export interface ImmersiveXRAdapter {
  isSessionSupported(mode: 'immersive-vr'): Promise<boolean>;
  /** When present, replaces native session entry while retaining the real R3F projection. */
  enterVR?(): Promise<ImmersiveSessionAdapter | undefined>;
  destroy?(): void;
}

export type ImmersiveSemanticAction =
  | 'exit'
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
