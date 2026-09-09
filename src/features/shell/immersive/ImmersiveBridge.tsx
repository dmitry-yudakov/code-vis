'use client';

import { useThree } from '@react-three/fiber';
import { createXRStore, XR } from '@react-three/xr';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setImmersiveSessionActive } from '@/features/diagram/spatial/resourceLedger';
import type {
  ImmersiveAvailability, ImmersiveController, ImmersiveSessionAdapter,
  ImmersiveSemanticAction, ImmersiveWorkspaceProps,
} from '@/features/diagram/spatial/immersiveTypes';
import { ImmersiveWorkspace } from './ImmersiveWorkspace';

if (typeof window !== 'undefined') {
  window.__CODEAI_XR_BUNDLE_EVALUATIONS__ = (window.__CODEAI_XR_BUNDLE_EVALUATIONS__ || 0) + 1;
}

export interface ImmersiveBridgeProps extends ImmersiveWorkspaceProps {
  active: boolean;
  onController(controller?: ImmersiveController): void;
  onAvailability(availability: ImmersiveAvailability, reason?: string): void;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Immersive entry was denied. Focus this page, allow headset access, and try again.';
  }
  if (error instanceof DOMException && error.name === 'InvalidStateError') {
    return 'Immersive entry needs this page to be focused and activated by the Enter VR button.';
  }
  return error instanceof Error ? error.message : 'The immersive session could not start.';
}

export function ImmersiveBridge({
  active, onController, onAvailability, onExit, ...workspaceProps
}: ImmersiveBridgeProps) {
  const gl = useThree((state) => state.gl);
  const store = useMemo(() => createXRStore({
    offerSession: false,
    emulate: false,
    enterGrantedSession: false,
    anchors: false,
    handTracking: false,
    bodyTracking: false,
    layers: false,
    meshDetection: false,
    planeDetection: false,
    hitTest: false,
    domOverlay: false,
    customSessionInit: { optionalFeatures: ['local-floor'] },
    controller: {
      model: false,
      grabPointer: false,
      rayPointer: { rayModel: { color: '#7d9df5' } },
    },
    hand: false,
    transientPointer: false,
    gaze: false,
    screenInput: false,
    frameBufferScaling: 'mid',
  }), []);
  const sessionRef = useRef<ImmersiveSessionAdapter | undefined>(undefined);
  const enteringRef = useRef<Promise<void> | undefined>(undefined);
  const entryEpoch = useRef(0);
  const endingRef = useRef<Promise<void> | undefined>(undefined);
  const mountedRef = useRef(true);
  const [floorBased, setFloorBased] = useState(false);
  const actionRef = useRef<((action: ImmersiveSemanticAction) => void) | undefined>(undefined);

  const bindSession = useCallback((session: ImmersiveSessionAdapter) => {
    sessionRef.current = session;
    let requestedOutcome: { availability: ImmersiveAvailability; reason?: string } | undefined;
    const ended = () => finishSession(
      requestedOutcome?.availability || 'available',
      requestedOutcome?.reason,
    );
    const visibilityChanged = () => {
      if (session.visibilityState === 'hidden') void endSession('available', 'The headset hid the immersive session; enter again when ready.');
    };
    const cleanupListeners = () => {
      session.removeEventListener?.('end', ended);
      session.removeEventListener?.('visibilitychange', visibilityChanged);
    };
    const finishSession = (availability: ImmersiveAvailability, reason?: string) => {
      if (sessionRef.current !== session) return;
      cleanupListeners();
      sessionRef.current = undefined;
      endingRef.current = undefined;
      setImmersiveSessionActive(false);
      setFloorBased(false);
      if (mountedRef.current) onAvailability(availability, reason);
    };
    const endSession = (availability: ImmersiveAvailability, reason?: string) => {
      if (sessionRef.current !== session) return Promise.resolve();
      if (!endingRef.current) {
        requestedOutcome = { availability, reason };
        // Assign the operation before invoking `end()`: test adapters and some runtimes dispatch
        // the end event synchronously, and that event must not leave a settled promise behind.
        const operation = Promise.resolve()
          .then(() => session.end())
          .catch((error) => {
            requestedOutcome = { availability: 'failed', reason: errorMessage(error) };
          })
          .finally(() => finishSession(
            requestedOutcome?.availability || availability,
            requestedOutcome?.reason || reason,
          ));
        endingRef.current = operation;
      }
      return endingRef.current;
    };
    session.addEventListener?.('end', ended);
    session.addEventListener?.('visibilitychange', visibilityChanged);
    return { finishSession, endSession, cleanupListeners };
  }, [onAvailability]);

  const lifecycleRef = useRef<ReturnType<typeof bindSession> | undefined>(undefined);
  const enter = useCallback(() => {
    if (sessionRef.current || enteringRef.current || endingRef.current) return Promise.resolve();
    const epoch = entryEpoch.current;
    const operation = (async () => {
      onAvailability('entering');
      setFloorBased(false);
      try {
        let session: ImmersiveSessionAdapter | undefined;
        let nativeSession: XRSession | undefined;
        const injected = window.__CODEAI_XR_TEST__?.adapter;
        if (injected?.enterVR) {
          session = await injected.enterVR();
        } else {
          // `local` is universally available. Promote to local-floor after entry when the headset
          // grants it, which gives a safe fallback without making floor support session-fatal.
          gl.xr.setReferenceSpaceType('local');
          nativeSession = await store.enterVR();
          session = nativeSession as unknown as ImmersiveSessionAdapter | undefined;
        }
        if (!session) throw new Error('The browser did not create an immersive VR session.');
        if (!mountedRef.current || entryEpoch.current !== epoch) {
          await Promise.resolve(session.end()).catch(() => undefined);
          return;
        }
        lifecycleRef.current = bindSession(session);
        if (nativeSession) {
          try {
            const floor = await nativeSession.requestReferenceSpace('local-floor');
            if (mountedRef.current && sessionRef.current === session) {
              gl.xr.setReferenceSpace(floor);
              setFloorBased(true);
            }
          } catch {
            // The local reference space selected above remains active.
          }
        }
        if (!mountedRef.current) {
          await lifecycleRef.current?.endSession('available');
          return;
        }
        if (sessionRef.current !== session) return;
        setImmersiveSessionActive(true);
        onAvailability('active');
      } catch (error) {
        setImmersiveSessionActive(false);
        if (mountedRef.current) onAvailability('failed', errorMessage(error));
      }
    })();
    enteringRef.current = operation;
    void operation.finally(() => {
      if (enteringRef.current === operation) enteringRef.current = undefined;
    });
    return operation;
  }, [bindSession, gl.xr, onAvailability, store]);

  const exit = useCallback(async () => {
    entryEpoch.current += 1;
    if (!sessionRef.current) {
      onAvailability('available');
      return;
    }
    await lifecycleRef.current?.endSession('available');
  }, [onAvailability]);

  useEffect(() => {
    onController({ enter, exit, perform: (action) => {
      if (action === 'exit' && !actionRef.current) void exit();
      else actionRef.current?.(action);
    } });
    return () => onController(undefined);
  }, [enter, exit, onController]);

  useEffect(() => {
    const contextLost = (event: Event) => {
      if (!sessionRef.current) return;
      event.preventDefault();
      const reason = 'The WebGL context was lost. Immersive VR ended; your desktop workspace is still available.';
      void lifecycleRef.current?.endSession('failed', reason);
    };
    const leaving = () => { void exit(); };
    gl.domElement.addEventListener('webglcontextlost', contextLost);
    window.addEventListener('pagehide', leaving);
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', contextLost);
      window.removeEventListener('pagehide', leaving);
    };
  }, [exit, gl.domElement]);

  useEffect(() => {
    let sawController = false;
    return store.subscribe((state, previous) => {
      const controllerCount = state.inputSourceStates.filter((source) => source.type === 'controller').length;
      const previousCount = previous.inputSourceStates.filter((source) => source.type === 'controller').length;
      if (controllerCount > 0) sawController = true;
      if (!sawController || controllerCount >= previousCount || !sessionRef.current) return;
      void lifecycleRef.current?.endSession(
        'failed',
        'A headset controller disconnected. Immersive VR ended; reconnect it and enter again.',
      );
    });
  }, [store]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // React development mode verifies effect cleanup by immediately mounting again. Deferring
      // irreversible store destruction keeps that check from ending a real session spuriously.
      queueMicrotask(() => {
        if (mountedRef.current) return;
        const finish = async () => {
          const pendingEntry = enteringRef.current;
          const activeLifecycle = lifecycleRef.current;
          await activeLifecycle?.endSession('available');
          await pendingEntry?.catch(() => undefined);
          if (lifecycleRef.current !== activeLifecycle) {
            await lifecycleRef.current?.endSession('available');
          }
          setImmersiveSessionActive(false);
          store.destroy();
          window.__CODEAI_XR_TEST__?.adapter?.destroy?.();
        };
        void finish();
      });
    };
  }, [store]);

  return (
    <XR store={store}>
      {active && (
        <group position-y={floorBased ? 1.45 : 0}>
          <ImmersiveWorkspace
            {...workspaceProps}
            onExit={() => { onExit(); void exit(); }}
            onActionController={(perform) => { actionRef.current = perform; }}
          />
        </group>
      )}
    </XR>
  );
}
