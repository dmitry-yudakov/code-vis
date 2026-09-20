import * as THREE from 'three';

/** A mono view from the head pose: enough to review layout and legibility, not the stereo optics. */
export const IMMERSIVE_CAPTURE_WIDTH = 1_024;
export const IMMERSIVE_CAPTURE_HEIGHT = 768;
export const IMMERSIVE_CAPTURE_FOV = 70;
const JPEG_QUALITY = 0.82;

export interface CapturedFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/**
 * Reads the shape of the view being captured from its projection, so a headset's much wider
 * frustum is not cropped to a desktop lens. Bounds keep an unexpected projection sane.
 */
function capturedFrustum(view: THREE.Camera): { fov: number; aspect: number } {
  // Column-major: element 0 is the horizontal scale, element 5 the vertical one.
  const horizontal = view.projectionMatrix.elements[0];
  const vertical = view.projectionMatrix.elements[5];
  return {
    fov: vertical > 0 ? THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(1 / vertical)), 40, 130) : IMMERSIVE_CAPTURE_FOV,
    aspect: vertical > 0 && horizontal > 0
      ? THREE.MathUtils.clamp(vertical / horizontal, 0.5, 2.5) : IMMERSIVE_CAPTURE_WIDTH / IMMERSIVE_CAPTURE_HEIGHT,
  };
}

/**
 * Renders one frame into a transient target from the current head pose. The target is disposed
 * before returning, so the workspace texture budget and the resource ledger are untouched, and XR
 * presentation is restored even when the render throws.
 */
export function renderImmersiveFrame(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  size?: { width: number; height: number },
): CapturedFrame {
  const view = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const frustum = capturedFrustum(view);
  const width = size?.width ?? IMMERSIVE_CAPTURE_WIDTH;
  const height = size?.height ?? Math.round(width / frustum.aspect / 2) * 2;
  const captureCamera = new THREE.PerspectiveCamera(frustum.fov, width / height, 0.05, 100);
  captureCamera.position.setFromMatrixPosition(view.matrixWorld);
  captureCamera.quaternion.setFromRotationMatrix(view.matrixWorld);
  captureCamera.updateMatrixWorld();
  const target = new THREE.WebGLRenderTarget(width, height);
  target.texture.colorSpace = renderer.outputColorSpace;
  const previousTarget = renderer.getRenderTarget();
  const presenting = renderer.xr.enabled;
  const pixels = new Uint8Array(width * height * 4);
  try {
    // While presenting, render() substitutes the XR camera for any camera it is given.
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, captureCamera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = presenting;
    target.dispose();
  }
  return { pixels, width, height };
}

/** Flips the bottom-up framebuffer rows and drops alpha, which JPEG cannot carry anyway. */
export function encodeCapturedFrame({ pixels, width, height }: CapturedFrame): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const image = context.createImageData(width, height);
  const stride = width * 4;
  for (let row = 0; row < height; row++) {
    const source = (height - 1 - row) * stride;
    image.data.set(pixels.subarray(source, source + stride), row * stride);
    for (let column = 3; column < stride; column += 4) image.data[row * stride + column] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] || undefined;
}

/** Returns a base64 JPEG of the current view, or undefined when the frame cannot be encoded. */
export function captureImmersiveFrame(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): string | undefined {
  return encodeCapturedFrame(renderImmersiveFrame(renderer, scene, camera));
}
