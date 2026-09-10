import { useEffect, useRef, useState, type RefObject } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Vector3, type Group } from 'three';
import { dragPanelPlacement, startPanelDrag } from './panelDrag';
import type { PanelPlacement } from './workspaceLayout';

export function usePanelDrag(group: RefObject<Group | null>, active: boolean, disabled: boolean,
  onStart: () => void, onFinish: (placement?: PanelPlacement) => void) {
  const [preview, setPreview] = useState<PanelPlacement>();
  const canvas = useThree((state) => state.gl.domElement);
  const drag = useRef<{
    pointerId: number;
    capture: Pick<Element, 'hasPointerCapture' | 'releasePointerCapture'>;
    start: ReturnType<typeof startPanelDrag>;
    placement?: PanelPlacement;
  } | undefined>(undefined);

  const release = () => {
    const current = drag.current;
    drag.current = undefined;
    if (current?.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
  };
  useEffect(() => {
    if (!active && drag.current) { release(); setPreview(undefined); }
  }, [active]);
  useEffect(() => release, []);

  const finish = (event: Pick<PointerEvent, 'pointerId' | 'stopPropagation'>, cancelled = false) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const placement = cancelled ? undefined : drag.current.placement;
    release();
    setPreview(undefined);
    onFinish(placement);
  };
  useEffect(() => {
    if (!active) return;
    // R3F clears desktop captures without forwarding these events to mesh handlers.
    // Native listeners cover that path; XR sends onPointerCancel to the captured mesh.
    const cancel = (event: PointerEvent) => finish(event, true);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('lostpointercapture', cancel);
    return () => {
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', cancel);
    };
  }, [active, canvas]);
  return {
    preview,
    handlers: {
      onPointerDown(event: ThreeEvent<PointerEvent>) {
        event.stopPropagation();
        const panel = group.current;
        if (disabled || drag.current || event.button !== 0 || !panel?.parent) return;
        panel.updateWorldMatrix(true, false);
        const capture = event.target as Element;
        capture.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, capture,
          start: startPanelDrag(event.ray, event.point, panel.getWorldPosition(new Vector3()), panel.parent.matrixWorld) };
        onStart();
      },
      onPointerMove(event: ThreeEvent<PointerEvent>) {
        if (drag.current?.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const placement = dragPanelPlacement(drag.current.start, event.ray);
        drag.current.placement = placement;
        setPreview(placement);
      },
      onPointerUp: (event: ThreeEvent<PointerEvent>) => finish(event),
      onPointerCancel: (event: ThreeEvent<PointerEvent>) => finish(event, true),
      onLostPointerCapture: (event: ThreeEvent<PointerEvent>) => finish(event, true),
    },
  };
}
