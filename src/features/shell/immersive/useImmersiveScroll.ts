import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { Matrix4, Plane, Vector3, type Mesh } from 'three';

// Allow the small ray movement caused by squeezing a tracked controller's trigger.
const DRAG_THRESHOLD = 24;

/** Shared continuous scroll input for a fixed plane, with activation suppressed after a drag. */
export function useImmersiveScroll(mesh: RefObject<Mesh | null>, {
  enabled, focused, offset, pageSize, pixelsPerUnit, onOffset, onActivate,
}: {
  enabled: boolean;
  focused: boolean;
  offset: number;
  pageSize: number;
  pixelsPerUnit: number;
  onOffset(value: number): void;
  onActivate?(point: Vector3, start: Vector3): void;
}) {
  const canvas = useThree((state) => state.gl.domElement);
  const controllers = useXR((state) => state.inputSourceStates.filter((source) => source.type === 'controller'));
  const drag = useRef<{
    pointerId: number; start: Vector3; startWorld: Vector3; moved: boolean; offset: number; inverse: Matrix4; plane: Plane;
    capture: Pick<Element, 'hasPointerCapture' | 'releasePointerCapture'>;
  } | undefined>(undefined);
  const release = useCallback(() => {
    const value = drag.current;
    drag.current = undefined;
    if (value?.capture.hasPointerCapture(value.pointerId)) value.capture.releasePointerCapture(value.pointerId);
  }, []);
  useEffect(() => { if (!enabled) release(); }, [enabled, release]);
  useEffect(() => {
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.pointerId) release();
    };
    const blur = () => release();
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('lostpointercapture', cancel);
    window.addEventListener('blur', blur);
    return () => {
      release();
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', blur);
    };
  }, [canvas, release]);
  useFrame((_state, delta) => {
    if (!enabled || !focused || drag.current) return;
    for (const source of controllers) {
      if (source.type !== 'controller') continue;
      const axis = source.gamepad['xr-standard-thumbstick']?.yAxis || 0;
      if (Math.abs(axis) < 0.18) continue;
      onOffset(offset + Math.sign(axis) * ((Math.abs(axis) - 0.18) / 0.82) * 1_050 * Math.min(delta, 0.05));
      break;
    }
  });
  const finish = (event: ThreeEvent<PointerEvent>, cancelled = false) => {
    const value = drag.current;
    if (!value || value.pointerId !== event.pointerId || (!cancelled && event.button !== 0)) return;
    event.stopPropagation();
    const point = event.ray.intersectPlane(value.plane, new Vector3());
    const moved = !point || point.clone().applyMatrix4(value.inverse).distanceTo(value.start) * pixelsPerUnit > DRAG_THRESHOLD;
    release();
    // XR's synthesized click expires after 300ms. A stationary trigger release is still
    // an activation, and captured XR event.point is not necessarily on the panel plane.
    if (enabled && !cancelled && !value.moved && !moved && point) onActivate?.(point, value.startWorld);
  };
  return {
    onWheel(event: ThreeEvent<WheelEvent>) {
      if (!enabled) return;
      event.stopPropagation();
      if (drag.current) drag.current.moved = true;
      onOffset(offset + event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? pageSize : 1));
    },
    onPointerDown(event: ThreeEvent<PointerEvent>) {
      if (!enabled || drag.current || event.button !== 0 || !mesh.current) return;
      event.stopPropagation();
      const panel = mesh.current;
      panel.updateWorldMatrix(true, false);
      const inverse = panel.matrixWorld.clone().invert();
      const capture = event.target as Element;
      capture.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, start: event.point.clone().applyMatrix4(inverse),
        startWorld: event.point.clone(), moved: false, offset, inverse,
        plane: new Plane(new Vector3(0, 0, 1), 0).applyMatrix4(panel.matrixWorld), capture };
    },
    onPointerMove(event: ThreeEvent<PointerEvent>) {
      const value = drag.current;
      if (!value || value.pointerId !== event.pointerId || !enabled) return;
      event.stopPropagation();
      const point = event.ray.intersectPlane(value.plane, new Vector3());
      if (!point) return;
      const local = point.applyMatrix4(value.inverse);
      if (local.distanceTo(value.start) * pixelsPerUnit > DRAG_THRESHOLD) value.moved = true;
      if (value.moved) onOffset(value.offset + (local.y - value.start.y) * pixelsPerUnit);
    },
    onPointerUp: (event: ThreeEvent<PointerEvent>) => finish(event),
    onPointerCancel: (event: ThreeEvent<PointerEvent>) => finish(event, true),
    onLostPointerCapture: (event: ThreeEvent<PointerEvent>) => finish(event, true),
    onClick(event: ThreeEvent<MouseEvent>) {
      event.stopPropagation();
    },
  };
}
