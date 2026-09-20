import * as THREE from 'three';
import { MAX_IMMERSIVE_TEXTURE_EDGE, type ImmersiveSemanticAction } from './immersiveTypes';
import { SpatialResourceLedger } from './resourceLedger';

export type ImmersiveAction = Exclude<ImmersiveSemanticAction, `panel:${string}` | `conversation:${string}` | `session:${string}` | `canvas:${string}` | `arena:${string}`>;

export const IMMERSIVE_ACTION_LABELS: Readonly<Record<ImmersiveAction, string>> = {
  exit: 'Exit VR',
  'reset-workspace': 'Reset',
  report: 'Report',
  'previous-file': 'Previous file',
  'next-file': 'Next file',
  'previous-checkout': 'Previous repository',
  'next-checkout': 'Next repository',
  'previous-evidence': 'Previous page',
  'next-evidence': 'Next page',
  'refresh-evidence': 'Refresh changes',
  'load-more-sessions': 'Load more',
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
  presentation: 'precolored' | 'icon-mask' | 'text-mask';
  status: 'ready' | 'error';
  detail?: string;
}

function trackedTexture(canvas: HTMLCanvasElement, ledger: SpatialResourceLedger): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return ledger.trackTexture(texture, canvas.width * canvas.height, true);
}

export function texturePanel(
  canvas: HTMLCanvasElement,
  worldSize: readonly [number, number],
  ledger: SpatialResourceLedger,
  status: ImmersiveTexturePanel['status'] = 'ready',
  detail?: string,
): ImmersiveTexturePanel {
  if (canvas.width > MAX_IMMERSIVE_TEXTURE_EDGE || canvas.height > MAX_IMMERSIVE_TEXTURE_EDGE) {
    throw new Error('Generated immersive texture exceeds the 2,048-pixel edge limit.');
  }
  const texture = trackedTexture(canvas, ledger);
  return {
    geometry: ledger.trackGeometry(new THREE.PlaneGeometry(worldSize[0], worldSize[1])),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      transparent: true,
      depthWrite: false,
    })),
    width: worldSize[0],
    height: worldSize[1],
    presentation: 'precolored',
    status,
    detail,
  };
}
