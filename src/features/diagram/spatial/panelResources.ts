import * as THREE from 'three';
import type { ThemeName } from '@/shared/design/tokens';
import { palette } from '@/shared/design/tokens';
import type { CanvasTarget, DrawingMark } from '@/shared/types';
import { canvasTargetId } from '@/features/conversation/sessionStore';
import { composeSvgMarkup } from '@/features/diagram/annotations/compositeExport';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';
import {
  allocateTexturePixels, spatialPanelSize, stableSpatialDigest, type TextureAllocation,
} from './spatialModel';
import { SpatialResourceLedger } from './resourceLedger';
import { immersiveTheme } from '@/features/shell/immersive/immersiveTheme';

export const SPATIAL_RENDERER_VERSION = 2;
const EMPTY_SKETCH_SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const MAX_SVG_CACHE_ENTRIES = 48;

interface PanelSnapshot {
  id: string;
  svg: string;
  viewBox: [number, number, number, number];
}

export interface PanelResource {
  id: string;
  size: [number, number];
  aspectRatio: number;
  viewBox: [number, number, number, number];
  geometry: THREE.PlaneGeometry;
  material: THREE.Material;
  frameGeometry: THREE.PlaneGeometry;
  frameMaterial: THREE.Material;
  status: 'ready' | 'omitted' | 'error';
  detail?: string;
}

type RenderedDiagram = Pick<PanelSnapshot, 'svg' | 'viewBox'>;

const svgCache = new Map<string, Promise<RenderedDiagram>>();

// Mermaid is the slow step, runs in a global queue that cannot be cancelled, and depends on the
// source alone. Its promise is cached so a stroke composes marks over the finished render and a
// restarted generation joins the queued one. A failure is forgotten so it can be retried.
function renderDiagram(id: string, source: string, theme: ThemeName): Promise<RenderedDiagram> {
  const cacheKey = `${id}:${stableSpatialDigest(source)}:${theme}:v${SPATIAL_RENDERER_VERSION}`;
  const cached = svgCache.get(cacheKey);
  const rendered = cached || renderMermaid(`spatial-${id.replaceAll('-', '')}`, source, theme);
  if (!cached) rendered.catch(() => { if (svgCache.get(cacheKey) === rendered) svgCache.delete(cacheKey); });
  svgCache.delete(cacheKey);
  svgCache.set(cacheKey, rendered);
  while (svgCache.size > MAX_SVG_CACHE_ENTRIES) svgCache.delete(svgCache.keys().next().value!);
  return rendered;
}

export function sanitizeImmersiveSvg(svg: string): string {
  return svg.replaceAll(/var\([^)]+\)/g, 'system-ui, sans-serif')
    .replaceAll(/(?<!sans-)\b(?:ui-)?serif\b/g, 'system-ui');
}

async function snapshotTarget(target: CanvasTarget, marks: DrawingMark[], theme: ThemeName, immersive: boolean): Promise<PanelSnapshot> {
  const id = canvasTargetId(target);
  if (target.kind === 'diagram' && target.artifact.status !== 'ready') {
    throw new Error(target.artifact.error || `Status: ${target.artifact.status}`);
  }
  const rendered = target.kind === 'diagram'
    ? await renderDiagram(id, target.artifact.source, theme)
    : { svg: EMPTY_SKETCH_SVG, viewBox: target.sketch.viewBox };
  return {
    id,
    svg: composeSvgMarkup(immersive ? sanitizeImmersiveSvg(rendered.svg) : rendered.svg, marks, rendered.viewBox,
      immersive ? immersiveTheme[theme].raised : palette[theme].sheet),
    viewBox: rendered.viewBox,
  };
}

async function rasterize(
  snapshot: PanelSnapshot,
  allocation: TextureAllocation,
  ledger: SpatialResourceLedger,
  theme: ThemeName,
  immersive: boolean,
): Promise<THREE.Texture> {
  if (window.__CODEAI_SPATIAL_TEST__?.failTextureId === snapshot.id) throw new Error('Injected texture conversion failure.');
  const image = new Image();
  image.decoding = 'sync';
  const url = ledger.trackObjectUrl(URL.createObjectURL(new Blob([snapshot.svg], { type: 'image/svg+xml' })), image);
  try {
    image.src = url;
    await image.decode();
    if (ledger.isDisposed()) throw new Error('Spatial texture generation was superseded.');
    const canvas = document.createElement('canvas');
    canvas.width = allocation.width;
    canvas.height = allocation.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas texture conversion is unavailable.');
    context.fillStyle = immersive ? immersiveTheme[theme].raised : palette.light.sheet;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = immersive;
    texture.minFilter = immersive ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = immersive ? 4 : 1;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return ledger.trackTexture(texture, allocation.pixels, immersive);
  } finally {
    ledger.releaseObjectUrl(url);
  }
}

export async function createPanelResources(
  targets: readonly CanvasTarget[],
  annotations: Readonly<Record<string, { marks: DrawingMark[] }>>,
  activeId: string,
  theme: ThemeName,
  ledger: SpatialResourceLedger,
  maxTexturePixels?: number,
  immersive = false,
): Promise<Record<string, PanelResource>> {
  const snapshots = new Map<string, PanelSnapshot>();
  const errors = new Map<string, string>();
  await Promise.all(targets.map(async (target) => {
    const id = canvasTargetId(target);
    try {
      snapshots.set(id, await snapshotTarget(target, annotations[id]?.marks || [], theme, immersive));
    } catch (error) {
      errors.set(id, error instanceof Error ? error.message : 'Preview could not be rendered.');
    }
  }));
  if (ledger.isDisposed()) return {};
  const allocations = new Map(allocateTexturePixels(
    [...snapshots.values()].map(({ id, viewBox }) => ({ id, viewBox })),
    activeId,
    maxTexturePixels,
  ).map((allocation) => [allocation.id, allocation]));
  const resources: Record<string, PanelResource> = {};
  for (const target of targets) {
    if (ledger.isDisposed()) return {};
    const id = canvasTargetId(target);
    const snapshot = snapshots.get(id);
    const allocation = allocations.get(id);
    const viewBox = snapshot?.viewBox || (target.kind === 'sketch' ? target.sketch.viewBox : [0, 0, 1_600, 1_000]);
    const size = spatialPanelSize(viewBox);
    const geometry = ledger.trackGeometry(new THREE.PlaneGeometry(size[0], size[1]));
    const frameGeometry = ledger.trackGeometry(new THREE.PlaneGeometry(size[0] + 0.14, size[1] + 0.14));
    const frameMaterial = ledger.trackMaterial(new THREE.MeshBasicMaterial({
      color: immersive ? immersiveTheme[theme].raised : id === activeId ? palette[theme].plot : palette[theme].lineStrong,
      depthWrite: !immersive,
    }));
    let status: PanelResource['status'] = errors.has(id) ? 'error' : allocation?.omitted ? 'omitted' : 'ready';
    let detail = errors.get(id);
    let material: THREE.Material;
    if (status === 'ready' && snapshot && allocation) {
      try {
        const texture = await rasterize(snapshot, allocation, ledger, theme, immersive);
        material = ledger.trackMaterial(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, depthWrite: !immersive }));
      } catch (error) {
        status = 'error';
        detail = error instanceof Error ? error.message : 'Preview could not be converted.';
        material = ledger.trackMaterial(new THREE.MeshStandardMaterial({ color: immersive ? immersiveTheme[theme].negative : palette[theme].stopWash, depthWrite: !immersive }));
      }
    } else {
      material = ledger.trackMaterial(new THREE.MeshStandardMaterial({
        color: immersive ? status === 'error' ? immersiveTheme[theme].negative : immersiveTheme[theme].raised
          : status === 'error' ? palette[theme].stopWash : palette[theme].neutralWashStrong,
        depthWrite: !immersive,
      }));
    }
    resources[id] = { id, size, aspectRatio: viewBox[2] / Math.max(1, viewBox[3]), viewBox, geometry, material, frameGeometry, frameMaterial, status, detail };
  }
  return resources;
}
