import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  captureImmersiveFrame, encodeCapturedFrame, renderImmersiveFrame,
} from '@/features/shell/immersive/immersiveCapture';

afterEach(() => { vi.unstubAllGlobals(); });

function renderer({ presenting = true, fail = false } = {}) {
  const head = new THREE.PerspectiveCamera();
  head.position.set(1, 1.6, -2);
  head.rotateY(Math.PI / 2);
  head.updateMatrixWorld();
  const existing = new THREE.WebGLRenderTarget(4, 4);
  const calls = { targets: [] as Array<THREE.WebGLRenderTarget | null>, cameras: [] as THREE.Camera[], xrEnabled: [] as boolean[] };
  const stub = {
    outputColorSpace: THREE.SRGBColorSpace,
    xr: { enabled: true, isPresenting: presenting, getCamera: () => head },
    getRenderTarget: () => existing,
    setRenderTarget(target: THREE.WebGLRenderTarget | null) { calls.targets.push(target); },
    render(_scene: THREE.Scene, camera: THREE.Camera) {
      calls.cameras.push(camera);
      calls.xrEnabled.push(stub.xr.enabled);
      if (fail) throw new Error('context lost mid-capture');
    },
    readRenderTargetPixels(_target: unknown, _x: number, _y: number, _width: number, _height: number, buffer: Uint8Array) {
      buffer.fill(128);
    },
  };
  return { stub: stub as unknown as THREE.WebGLRenderer, head, existing, calls };
}

function canvas() {
  const written: { data: Uint8ClampedArray }[] = [];
  const element = {
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => { written.push(image); },
    }),
    toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQ',
  };
  vi.stubGlobal('document', { createElement: () => element });
  return { element, written };
}

describe('immersive view capture', () => {
  it('renders from the head pose with XR presentation suspended, then restores the renderer', () => {
    const { stub, head, existing, calls } = renderer();
    const frame = renderImmersiveFrame(stub, new THREE.Scene(), new THREE.PerspectiveCamera(), { width: 8, height: 6 });
    expect(frame).toMatchObject({ width: 8, height: 6 });
    expect(frame.pixels).toHaveLength(8 * 6 * 4);
    expect(frame.pixels.every((value) => value === 128)).toBe(true);
    // render() substitutes the XR camera unless presentation is suspended for the pass.
    expect(calls.xrEnabled).toEqual([false]);
    expect(stub.xr.enabled).toBe(true);
    const captured = calls.cameras[0] as THREE.PerspectiveCamera;
    expect(captured).not.toBe(head);
    expect(captured.position.toArray()).toEqual([1, 1.6, -2]);
    expect(captured.quaternion.angleTo(head.quaternion)).toBeLessThan(1e-6);
    expect(captured.aspect).toBeCloseTo(8 / 6);
    // The transient target is bound for the pass and the previous one is restored after it.
    expect(calls.targets).toHaveLength(2);
    expect(calls.targets[0]).not.toBe(existing);
    expect(calls.targets[1]).toBe(existing);
  });

  it('takes the captured frame shape from the view being captured, not a fixed lens', () => {
    const { stub, head } = renderer();
    head.fov = 96; head.aspect = 1.9; head.updateProjectionMatrix();
    const wide = renderImmersiveFrame(stub, new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(wide.width).toBe(1_024);
    expect(wide.width / wide.height).toBeCloseTo(1.9, 1);
    expect(wide.pixels).toHaveLength(wide.width * wide.height * 4);
    head.fov = 50; head.aspect = 4 / 3; head.updateProjectionMatrix();
    const narrow = renderImmersiveFrame(stub, new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(narrow.width / narrow.height).toBeCloseTo(4 / 3, 1);
  });

  it('uses the flat camera when no session is presenting', () => {
    const { stub, head, calls } = renderer({ presenting: false });
    const flat = new THREE.PerspectiveCamera();
    flat.position.set(0, 0, 5);
    flat.updateMatrixWorld();
    renderImmersiveFrame(stub, new THREE.Scene(), flat, { width: 4, height: 4 });
    const captured = calls.cameras[0] as THREE.PerspectiveCamera;
    expect(captured.position.toArray()).toEqual([0, 0, 5]);
    expect(captured.position.toArray()).not.toEqual(head.position.toArray());
  });

  it('restores XR presentation when the capture pass throws', () => {
    const { stub, existing, calls } = renderer({ fail: true });
    expect(() => renderImmersiveFrame(stub, new THREE.Scene(), new THREE.PerspectiveCamera(), { width: 4, height: 4 })).toThrow('context lost');
    expect(stub.xr.enabled).toBe(true);
    expect(calls.targets.at(-1)).toBe(existing);
  });

  it('flips the framebuffer rows and drops alpha, which JPEG cannot carry', () => {
    const { element, written } = canvas();
    const pixels = new Uint8Array([
      10, 10, 10, 0, 20, 20, 20, 0, // bottom row as WebGL reads it
      30, 30, 30, 0, 40, 40, 40, 0, // top row
    ]);
    expect(encodeCapturedFrame({ pixels, width: 2, height: 2 })).toBe('/9j/4AAQ');
    expect(element).toMatchObject({ width: 2, height: 2 });
    expect([...written[0].data]).toEqual([30, 30, 30, 255, 40, 40, 40, 255, 10, 10, 10, 255, 20, 20, 20, 255]);
  });

  it('returns a base64 JPEG for the current view', () => {
    canvas();
    const { stub } = renderer();
    expect(captureImmersiveFrame(stub, new THREE.Scene(), new THREE.PerspectiveCamera())).toBe('/9j/4AAQ');
  });
});
