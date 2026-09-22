import type { ImmersiveTexturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { ThemeName } from '@/shared/design/tokens';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import {
  IMMERSIVE_CARD_RADIUS, IMMERSIVE_CONTROL_HEIGHT, IMMERSIVE_GLYPH_MASK, dpToWorld, immersiveFont, immersiveLineHeight, immersiveTheme,
} from './immersiveTheme';
import { createWorkspaceIconResource } from './workspaceIcons';

export const WORKSPACE_HEADER_WORLD_SIZE = [1.25, 0.16] as const;
export const WORKSPACE_HEADER_RASTER_SIZE = [640, 82] as const;

export function createWorkspaceTextResource(title: string, detail: string, theme: ThemeName, ledger: SpatialResourceLedger, headerActions = false, headerBack = false) {
  const canvas = document.createElement('canvas');
  canvas.width = WORKSPACE_HEADER_RASTER_SIZE[0];
  canvas.height = WORKSPACE_HEADER_RASTER_SIZE[1];
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace text rasterization is unavailable.');
  const colors = immersiveTheme[theme];
  const [width, height] = WORKSPACE_HEADER_WORLD_SIZE;
  const pixelsPerMeter = canvas.height / height;
  context.fillStyle = colors.text;
  context.font = immersiveFont('title', pixelsPerMeter);
  const left = Math.round(dpToWorld(headerBack ? 86 : 14) * pixelsPerMeter);
  const right = Math.round((headerActions ? dpToWorld(250) : width - dpToWorld(14)) * pixelsPerMeter);
  const titleWidth = right - left;
  const titleHitWidth = Math.min(titleWidth / pixelsPerMeter,
    Math.max(dpToWorld(32), (context.measureText(title).width + 12) / pixelsPerMeter));
  context.fillText(title, left, 36, titleWidth);
  context.fillStyle = colors.secondaryText;
  context.font = immersiveFont('label', pixelsPerMeter);
  context.fillText(detail, left, 70, canvas.width - Math.round(dpToWorld(14) * pixelsPerMeter) - left);
  return {
    ...texturePanel(canvas, WORKSPACE_HEADER_WORLD_SIZE, ledger),
    titleHit: {
      width: titleHitWidth,
      height: 0.08,
      offset: [-width / 2 + left / pixelsPerMeter + titleHitWidth / 2, 0.04, 0] as [number, number, number],
    },
  };
}

function createWorkspaceLabel(label: string, theme: ThemeName, ledger: SpatialResourceLedger, type: 'button' | 'label') {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panel controls unavailable.');
  const pixelsPerMeter = canvas.height / IMMERSIVE_CONTROL_HEIGHT;
  context.font = immersiveFont(type, pixelsPerMeter);
  const measured = context.measureText(label).width + dpToWorld(32) * pixelsPerMeter;
  canvas.width = Math.max(80, Math.min(320, Math.ceil(measured)));
  context.fillStyle = IMMERSIVE_GLYPH_MASK;
  context.font = immersiveFont(type, pixelsPerMeter);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 16);
  const resource = texturePanel(canvas, [canvas.width / pixelsPerMeter, IMMERSIVE_CONTROL_HEIGHT], ledger);
  resource.presentation = 'text-mask';
  resource.material.color.set(immersiveTheme[theme].text);
  return resource;
}

export function createWorkspaceButtonResource(label: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  return createWorkspaceLabel(label, theme, ledger, 'button');
}

export function createWorkspaceLabelResource(label: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  return createWorkspaceLabel(label, theme, ledger, 'label');
}

export function createConversationTextResource(title: string, lines: readonly string[], theme: ThemeName, ledger: SpatialResourceLedger,
  status = false, compactStatus = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = status ? compactStatus ? 72 : 144 : 640;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Conversation text unavailable.');
  const pixelsPerMeter = canvas.width / 1.32;
  context.fillStyle = immersiveTheme[theme].raised;
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, IMMERSIVE_CARD_RADIUS * pixelsPerMeter);
  context.fill();
  context.fillStyle = immersiveTheme[theme].text;
  context.font = immersiveFont('heading', pixelsPerMeter);
  if (title) context.fillText(title, 24, 35, 976);
  context.font = immersiveFont(status ? 'label' : 'reading', pixelsPerMeter);
  const lineHeight = immersiveLineHeight(status ? 'label' : 'reading', pixelsPerMeter);
  lines.forEach((line, i) => context.fillText(line, 24, (status ? (title ? 78 : 34) : 92) + i * lineHeight, 976));
  return texturePanel(canvas, [1.32, canvas.height / 1024 * 1.32], ledger);
}

export interface PanelControlResources {
  buttons: Record<'drag' | 'resize' | 'close', ImmersiveTexturePanel>;
  pager: {
    previous: ImmersiveTexturePanel;
    next: ImmersiveTexturePanel;
  };
}

export function createPanelControlResources(theme: ThemeName, ledger: SpatialResourceLedger): PanelControlResources {
  return {
    buttons: {
      drag: createWorkspaceIconResource('panel:drag', theme, ledger),
      resize: createWorkspaceIconResource('panel:resize', theme, ledger),
      close: createWorkspaceIconResource('panel:close', theme, ledger),
    },
    pager: {
      previous: createWorkspaceIconResource('pager:previous', theme, ledger),
      next: createWorkspaceIconResource('pager:next', theme, ledger),
    },
  };
}

export function createEvidenceResource(lines: readonly string[], theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Evidence text unavailable.');
  const colors = immersiveTheme[theme];
  const pixelsPerMeter = canvas.width / 1.32;
  context.fillStyle = colors.raised;
  context.fillRect(0, 0, 1024, 768);
  context.fillStyle = colors.text;
  context.font = immersiveFont('code', pixelsPerMeter);
  lines.forEach((line, index) => {
    context.fillStyle = line.startsWith('+') ? colors.positive : line.startsWith('-') ? colors.negative : colors.text;
    context.fillText(line, 28, 54 + index * immersiveLineHeight('code', pixelsPerMeter));
  });
  return texturePanel(canvas, [1.32, 0.99], ledger);
}

export const REPORT_PREVIEW_WORLD_SIZE = [0.5, 0.375] as const;
const REPORT_PREVIEW_RASTER_SIZE = [512, 384] as const;

/** A bounded, letterboxed copy of a report screenshot; the decoded source is not retained. */
export function createReportPreviewResource(image: ImageBitmap, theme: ThemeName, ledger: SpatialResourceLedger) {
  const [width, height] = REPORT_PREVIEW_RASTER_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Report preview unavailable.');
  context.fillStyle = immersiveTheme[theme].raised;
  context.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.width, height / image.height);
  context.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
  return texturePanel(canvas, REPORT_PREVIEW_WORLD_SIZE, ledger);
}
