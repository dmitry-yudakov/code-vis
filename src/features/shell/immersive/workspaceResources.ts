import { palette, type ThemeName } from '@/shared/design/tokens';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';

export function createWorkspaceTextResource(title: string, detail: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace text rasterization is unavailable.');
  const colors = palette[theme];
  context.fillStyle = colors.raised;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = colors.plot;
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = colors.ink;
  context.font = '700 32px system-ui, sans-serif';
  context.fillText(title, 24, 47, 720);
  context.fillStyle = colors.muted;
  context.font = '24px system-ui, sans-serif';
  context.fillText(detail, 24, 94, 720);
  return texturePanel(canvas, [2.1, 0.35], ledger);
}
