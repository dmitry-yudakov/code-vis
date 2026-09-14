import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { Pointer, RayIntersector } from '@pmndrs/pointer-events';
import { useImmersiveScroll } from '@/features/shell/immersive/useImmersiveScroll';

vi.mock('@react-three/fiber', () => ({ useThree: () => ({}), useFrame: () => undefined }));
vi.mock('@react-three/xr', () => ({ useXR: () => [] }));

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function setup() {
  const scene = new Scene();
  const panel = new Mesh(new PlaneGeometry(2.2, 2.2), new MeshBasicMaterial());
  panel.scale.setScalar(0.58);
  panel.rotation.y = 0.4;
  scene.add(panel);
  scene.updateMatrixWorld(true);
  const activate = vi.fn();
  const scroll = vi.fn();
  function Harness() {
    const handlers = useImmersiveScroll({ current: panel }, {
      enabled: true, focused: true, offset: 0, pageSize: 1_232, pixelsPerUnit: 1_280 / 2.2,
      onOffset: scroll, onActivate: activate,
    });
    Object.assign(panel, { __r3f: { handlers, eventCount: Object.keys(handlers).length } });
    return null;
  }
  // Use React's real hook state, then drive the installed XR pointer implementation rather
  // than synthesizing DOM clicks (which do not have XR's 300ms click deadline).
  renderToStaticMarkup(createElement(Harness));
  const space = new PerspectiveCamera();
  space.position.set(0, 0, 2);
  const pointer = new Pointer(91, 'ray', undefined, new RayIntersector({ current: space }, {}), () => space);
  const move = (yPixels: number, timeStamp: number) => {
    space.lookAt(panel.localToWorld(new Vector3(0, yPixels * 2.2 / 1_280, 0)));
    space.updateMatrixWorld(true);
    pointer.move(scene, { timeStamp });
  };
  disposers.push(() => {
    pointer.exit({ timeStamp: 2_000 });
    globalThis.pointerEventspointerMap?.delete(pointer.id);
    panel.geometry.dispose(); panel.material.dispose();
  });
  move(0, 0);
  return { pointer, panel, space, move, activate, scroll };
}

describe('immersive scroll controller activation', () => {
  it('selects on release after a held trigger and small controller drift', () => {
    const { pointer, move, activate, scroll } = setup();
    pointer.down({ button: 0, timeStamp: 10 });
    move(12, 500);
    pointer.up({ button: 0, timeStamp: 800 });
    expect(activate).toHaveBeenCalledOnce();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('activates only once when XR also synthesizes a short click', () => {
    const { pointer, activate } = setup();
    pointer.down({ button: 0, timeStamp: 10 });
    pointer.up({ button: 0, timeStamp: 100 });
    expect(activate).toHaveBeenCalledOnce();
  });

  it('does not select after scrolling, even if the ray returns to its starting point', () => {
    const { pointer, move, activate, scroll } = setup();
    pointer.down({ button: 0, timeStamp: 10 });
    move(80, 60);
    move(0, 80);
    pointer.up({ button: 0, timeStamp: 100 });
    expect(scroll).toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('does not select a cancelled gesture or an unmatched release', () => {
    const { pointer, activate } = setup();
    pointer.down({ button: 0, timeStamp: 10 });
    pointer.cancel({ timeStamp: 50 });
    pointer.up({ button: 0, timeStamp: 100 });
    expect(activate).not.toHaveBeenCalled();
  });

  it('uses the panel-plane hit when capture reports a point in front of the panel', () => {
    const { pointer, panel, space, move, activate } = setup();
    pointer.down({ button: 0, timeStamp: 10 });
    space.position.z += 0.5;
    move(0, 50);
    expect(Math.abs(panel.worldToLocal(pointer.getIntersection()!.point.clone()).z)).toBeGreaterThan(0.1);
    pointer.up({ button: 0, timeStamp: 100 });
    expect(activate).toHaveBeenCalledOnce();
    expect(panel.worldToLocal(activate.mock.calls[0][0].clone()).length()).toBeLessThan(0.0001);
  });
});
