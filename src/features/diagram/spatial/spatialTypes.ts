import type { ThemeName } from '@/shared/design/tokens';
import type { SessionSnapshot } from '@/shared/types';
import type { SpatialPose, SpatialViewState } from '@/features/shell/workspaceViews';

export interface SpatialRoomProps {
  session: SessionSnapshot;
  theme: ThemeName;
  activeId: string;
  immersiveAuthorized: boolean;
  preview: string;
  runStatus: string;
  pendingApprovals: number;
  unread: number;
  spatial?: SpatialViewState;
  onSelect(id: string): void;
  onOpenFlat(): void;
  onViewChange(spatial: SpatialViewState): void;
  onReset(): void;
  onFailure(message: string): void;
}

export interface SpatialSceneHandle {
  focus(id: string): void;
  reset(): void;
  moveCamera(kind: 'orbit-left' | 'orbit-right' | 'orbit-up' | 'orbit-down' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'dolly-in' | 'dolly-out'): void;
  nudgePanel(id: string, delta: SpatialPose): void;
}
