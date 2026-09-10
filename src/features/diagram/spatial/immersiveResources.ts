import * as THREE from 'three';
import { workspaceTextLines } from '@/features/shell/immersive/workspaceText';
import { palette } from '@/shared/design/tokens';
import type { ThemeName } from '@/shared/design/tokens';
import {
  MAX_IMMERSIVE_TEXTURE_EDGE,
  type ImmersiveConversationProjection, type ImmersiveSemanticAction,
} from './immersiveTypes';
import { SpatialResourceLedger } from './resourceLedger';

const CHAT_TEXTURE_SIZE = 1_024;
const CONTROL_TEXTURE_WIDTH = 256;
const CONTROL_TEXTURE_HEIGHT = 64;

export type ImmersiveAction = Exclude<ImmersiveSemanticAction, `panel:${string}`>;

export const IMMERSIVE_ACTION_LABELS: Readonly<Record<ImmersiveAction, string>> = {
  exit: 'Exit VR',
  'reset-workspace': 'Reset workspace',
  'previous-file': 'Previous file',
  'next-file': 'Next file',
  'previous-evidence': 'Previous page',
  'next-evidence': 'Next page',
  'refresh-evidence': 'Refresh changes',
  'previous-sessions': 'Previous sessions',
  'next-sessions': 'Next sessions',
  'previous-canvas': 'Previous canvas',
  'next-canvas': 'Next canvas',
  larger: 'Larger',
  smaller: 'Smaller',
  'reset-view': 'Reset view',
  older: 'Older',
  newer: 'Newer',
};

export interface ImmersiveTexturePanel {
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
  width: number;
  height: number;
  status: 'ready' | 'error';
  detail?: string;
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  if (width > MAX_IMMERSIVE_TEXTURE_EDGE || height > MAX_IMMERSIVE_TEXTURE_EDGE) {
    throw new Error('Generated immersive texture exceeds the 2,048-pixel edge limit.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas text rasterization is unavailable.');
  return { canvas, context };
}

function trackedTexture(canvas: HTMLCanvasElement, ledger: SpatialResourceLedger): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return ledger.trackTexture(texture, canvas.width * canvas.height);
}

export function texturePanel(
  canvas: HTMLCanvasElement,
  worldSize: readonly [number, number],
  ledger: SpatialResourceLedger,
  status: ImmersiveTexturePanel['status'] = 'ready',
  detail?: string,
): ImmersiveTexturePanel {
  const texture = trackedTexture(canvas, ledger);
  return {
    geometry: ledger.trackGeometry(new THREE.PlaneGeometry(worldSize[0], worldSize[1])),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      transparent: true,
    })),
    width: worldSize[0],
    height: worldSize[1],
    status,
    detail,
  };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
  context.stroke();
}

function wrappedLines(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of value.replaceAll('\t', '  ').split('\n')) {
    if (!paragraph) {
      result.push('');
      continue;
    }
    const words = paragraph.split(/\s+/u);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) result.push(line);
      if (context.measureText(word).width <= maxWidth) {
        line = word;
        continue;
      }
      let fragment = '';
      for (const point of word) {
        if (fragment && context.measureText(`${fragment}${point}`).width > maxWidth) {
          result.push(fragment);
          fragment = point;
        } else fragment += point;
      }
      line = fragment;
    }
    if (line) result.push(line);
  }
  return result;
}

function drawTextLines(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  bottom: number,
): number {
  for (const line of (lineHeight === 44 ? workspaceTextLines(value) : wrappedLines(context, value, maxWidth))) {
    if (y + lineHeight > bottom) return bottom;
    context.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function drawConversation(
  context: CanvasRenderingContext2D,
  projection: ImmersiveConversationProjection,
  theme: ThemeName,
  pageLabel: string,
  newActivity: boolean,
): void {
  context.scale(CHAT_TEXTURE_SIZE / 1_280, CHAT_TEXTURE_SIZE / 1_280);
  const colors = palette[theme];
  context.fillStyle = colors.raised;
  context.fillRect(0, 0, 1_280, 1_280);
  context.fillStyle = colors.plot;
  context.fillRect(0, 0, 1_280, 18);
  context.fillStyle = colors.ink;
  context.font = '700 48px system-ui, sans-serif';
  context.fillText(projection.sessionTitle, 54, 82, 800);
  context.fillStyle = colors.muted;
  context.font = '600 25px ui-monospace, monospace';
  const agent = projection.addressedAgent ? `@${projection.addressedAgent}` : 'Session conversation';
  context.fillText(`${agent}  ·  ${projection.runStatus}`, 56, 126, 900);
  context.textAlign = 'right';
  context.fillStyle = projection.pendingApprovals ? colors.wait : colors.muted;
  context.fillText(projection.pendingApprovals ? `${projection.pendingApprovals} approval waiting` : pageLabel, 1_224, 82);
  context.fillStyle = newActivity ? colors.live : colors.muted;
  context.fillText(newActivity ? 'New activity' : projection.unread ? `${projection.unread} unread` : pageLabel, 1_224, 126);
  context.textAlign = 'left';
  context.strokeStyle = colors.lineStrong;
  context.beginPath();
  context.moveTo(54, 154);
  context.lineTo(1_226, 154);
  context.stroke();

  let y = 198;
  const bottom = 1_226;
  for (const entry of projection.entries) {
    if (y >= bottom) break;
    context.fillStyle = colors.plotInk;
    context.font = '700 25px system-ui, sans-serif';
    context.fillText(entry.author, 56, y, 520);
    context.fillStyle = colors.muted;
    context.font = '600 19px ui-monospace, monospace';
    context.textAlign = 'right';
    context.fillText(`${entry.meta}${entry.state ? ` · ${entry.state}` : ''}`, 1_224, y, 620);
    context.textAlign = 'left';
    y += 34;
    context.fillStyle = colors.ink2;
    context.font = '34px ui-monospace, monospace';
    y = drawTextLines(context, entry.text, 56, y, 1_168, 44, bottom - 26);
    y += 27;
  }
  if (projection.preview && y < bottom) {
    context.fillStyle = colors.liveInk;
    context.font = '700 22px ui-monospace, monospace';
    context.fillText('STREAMING', 56, y);
    y += 32;
    context.fillStyle = colors.ink2;
    context.font = '34px ui-monospace, monospace';
    drawTextLines(context, projection.preview, 56, y, 1_168, 44, bottom);
  }
  context.strokeStyle = colors.line;
  context.strokeRect(1, 1, 1_278, 1_278);
}

export function createImmersiveConversationResource(
  projection: ImmersiveConversationProjection,
  theme: ThemeName,
  pageLabel: string,
  newActivity: boolean,
  ledger: SpatialResourceLedger,
): ImmersiveTexturePanel {
  try {
    if (window.__CODEAI_XR_TEST__?.failTranscript) throw new Error('Injected transcript raster failure.');
    const { canvas, context } = canvas2d(CHAT_TEXTURE_SIZE, CHAT_TEXTURE_SIZE);
    drawConversation(context, projection, theme, pageLabel, newActivity);
    return texturePanel(canvas, [2.2, 2.2], ledger);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Transcript could not be rasterized.';
    const { canvas, context } = canvas2d(CHAT_TEXTURE_SIZE, CHAT_TEXTURE_SIZE);
    context.fillStyle = palette[theme].stopWash;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = palette[theme].stopInk;
    context.font = '700 48px system-ui, sans-serif';
    context.fillText('Conversation unavailable', 60, 110);
    context.font = '26px ui-monospace, monospace';
    drawTextLines(context, detail, 60, 175, canvas.width - 120, 36, canvas.height - 60);
    return texturePanel(canvas, [2.2, 2.2], ledger, 'error', detail);
  }
}

export function createImmersiveControlResources(
  theme: ThemeName,
  ledger: SpatialResourceLedger,
): Record<ImmersiveAction, ImmersiveTexturePanel> {
  return Object.fromEntries(Object.entries(IMMERSIVE_ACTION_LABELS).map(([action, label]) => {
    const { canvas, context } = canvas2d(CONTROL_TEXTURE_WIDTH, CONTROL_TEXTURE_HEIGHT);
    context.fillStyle = palette[theme].raised;
    context.strokeStyle = action === 'exit' ? palette[theme].stop : palette[theme].plot;
    context.lineWidth = 5;
    roundedRect(context, 3, 3, canvas.width - 6, canvas.height - 6, 17);
    context.fillStyle = action === 'exit' ? palette[theme].stopInk : palette[theme].plotInkDeep;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 22px system-ui, sans-serif';
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 1, canvas.width - 34);
    return [action, texturePanel(canvas, [0.62, 0.155], ledger)];
  })) as Record<ImmersiveAction, ImmersiveTexturePanel>;
}
