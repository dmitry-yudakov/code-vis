import { Matrix4, Ray, Vector3 } from 'three';
import { PANEL_BOUNDS, type PanelPlacement } from './workspaceLayout';

export const PANEL_DEPTH_GAIN = 4;

/** Transient pointer state; only the resulting bounded placement is saved. */
export function startPanelDrag(ray: Ray, point: Vector3, center: Vector3, origin: Matrix4) {
  const inverseOrigin = origin.clone().invert();
  const localCenter = center.clone().applyMatrix4(inverseOrigin);
  const angle = Math.atan2(localCenter.x, -localCenter.z);
  return {
    distance: ray.origin.distanceTo(point),
    offset: point.clone().applyMatrix4(inverseOrigin).sub(localCenter).applyAxisAngle(new Vector3(0, 1, 0), angle),
    inverseOrigin,
    pointerOrigin: ray.origin.clone().applyMatrix4(inverseOrigin),
    depthDirection: new Vector3(localCenter.x, 0, localCenter.z).normalize(),
  };
}

export function dragPanelPlacement(drag: ReturnType<typeof startPanelDrag>, ray: Ray): PanelPlacement {
  // A fixed ray length follows both controller rotation and physical push/pull. Intersecting
  // the old panel plane instead would prevent depth movement and jump at oblique angles.
  const point = ray.at(drag.distance, new Vector3()).applyMatrix4(drag.inverseOrigin);
  // Keep the grabbed point under the ray as the panel turns to face the workspace origin.
  // Its horizontal offset forms a right triangle with the panel's forward distance.
  const forward = Math.sqrt(Math.max(0, point.x ** 2 + point.z ** 2 - drag.offset.x ** 2));
  // Amplify deliberate push/pull along the starting panel direction, independently of
  // pointing, height, and lateral motion. This transient controller pose is never persisted.
  const depthChange = ray.origin.clone().applyMatrix4(drag.inverseOrigin).sub(drag.pointerOrigin).dot(drag.depthDirection);
  const clamp = (value: number, bounds: readonly [number, number]) => Math.max(bounds[0], Math.min(bounds[1], value));
  return {
    angle: clamp((Math.atan2(point.x, -point.z) - Math.atan2(drag.offset.x, forward)) * 180 / Math.PI, PANEL_BOUNDS.angle),
    height: clamp(point.y - drag.offset.y, PANEL_BOUNDS.height),
    distance: clamp(forward + drag.offset.z + depthChange * (PANEL_DEPTH_GAIN - 1), PANEL_BOUNDS.distance),
  };
}
