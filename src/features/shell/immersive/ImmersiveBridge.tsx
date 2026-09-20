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
import { recordImmersiveDiagnostic } from './immersiveDiagnostics';
import { noteImmersiveError } from './immersiveReport';
import { immersiveTheme } from './immersiveTheme';

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
  const themeRef = useRef(workspaceProps.theme);
  themeRef.current = workspaceProps.theme;
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
      rayPointer: {
        rayModel: { color: (pointer) => pointer.getButtonsDown().size ? immersiveTheme[themeRef.current].link : immersiveTheme[themeRef.current].text },
        cursorModel: {
          color: (pointer) => pointer.getButtonsDown().size ? immersiveTheme[themeRef.current].link : immersiveTheme[themeRef.current].text,
          opacity: (pointer) => pointer.getButtonsDown().size ? 0.9 : 0.55,
        },
      },
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
  const teardownPendingRef = useRef(false);
  const [floorBased, setFloorBased] = useState(false);
  const actionRef = useRef<((action: ImmersiveSemanticAction) => void) | undefined>(undefined);

  useEffect(() => {
    window.__CODEAI_XR_TEST__?.onStore?.(store);
    return () => window.__CODEAI_XR_TEST__?.onStore?.();
  }, [store]);

  const bindSession = useCallback((session: ImmersiveSessionAdapter) => {
    sessionRef.current = session;
    const peaks = { textures: 0, geometries: 0, programs: 0, heapBytes: 0 };
    const record = (event: Parameters<typeof recordImmersiveDiagnostic>[0]) => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      peaks.textures = Math.max(peaks.textures, gl.info.memory.textures);
      peaks.geometries = Math.max(peaks.geometries, gl.info.memory.geometries);
      peaks.programs = Math.max(peaks.programs, gl.info.programs?.length || 0);
      peaks.heapBytes = Math.max(peaks.heapBytes, memory?.usedJSHeapSize || 0);
      recordImmersiveDiagnostic(event, {
        visibility: session.visibilityState,
        controllers: session.inputSources && Array.from(session.inputSources).filter((source) => source.targetRayMode === 'tracked-pointer' && !source.hand).length,
        textures: gl.info.memory.textures, geometries: gl.info.memory.geometries,
        programs: gl.info.programs?.length, heapBytes: memory?.usedJSHeapSize,
        peakTextures: peaks.textures, peakGeometries: peaks.geometries, peakPrograms: peaks.programs,
        ...(peaks.heapBytes ? { peakHeapBytes: peaks.heapBytes } : {}),
      });
    };
    let requestedOutcome: { availability: ImmersiveAvailability; reason?: string } | undefined;
    const ended = () => finishSession(
      requestedOutcome?.availability || 'available',
      requestedOutcome ? requestedOutcome.reason : 'The headset or browser ended VR. Enter again when ready.',
    );
    // Hidden/blurred sessions are paused by the runtime and may resume. Missing controllers
    // likewise recover through XR input-source updates; neither event should terminate VR.
    const visibilityChanged = () => record('visibility-changed');
    const inputsChanged = () => record('controllers-changed');
    const sampleTimer = window.setInterval(() => record('sample'), 10_000);
    // The diagnostic event stays message-free; the exception text is forwarded to the home machine.
    const windowError = (event: ErrorEvent) => { record('window-error'); noteImmersiveError('window-error', event); };
    const unhandledRejection = (event: PromiseRejectionEvent) => {
      record('unhandled-rejection'); noteImmersiveError('unhandled-rejection', event);
    };
    window.addEventListener('error', windowError);
    window.addEventListener('unhandledrejection', unhandledRejection);
    const cleanupListeners = () => {
      window.clearInterval(sampleTimer);
      window.removeEventListener('error', windowError);
      window.removeEventListener('unhandledrejection', unhandledRejection);
      session.removeEventListener?.('end', ended);
      session.removeEventListener?.('visibilitychange', visibilityChanged);
      session.removeEventListener?.('inputsourceschange', inputsChanged);
    };
    const finishSession = (availability: ImmersiveAvailability, reason?: string) => {
      if (sessionRef.current !== session) return;
      cleanupListeners();
      sessionRef.current = undefined;
      endingRef.current = undefined;
      setImmersiveSessionActive(false);
      record('session-ended');
      setFloorBased(false);
      if (mountedRef.current) {
        teardownPendingRef.current = true;
        onAvailability(availability, reason);
      }
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
            record('end-failed');
            noteImmersiveError('end-failed', error);
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
    session.addEventListener?.('inputsourceschange', inputsChanged);
    return { endSession, record };
  }, [gl, onAvailability]);

  useEffect(() => {
    if (active || !teardownPendingRef.current) return;
    teardownPendingRef.current = false;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    recordImmersiveDiagnostic('teardown-sample', {
      textures: gl.info.memory.textures,
      geometries: gl.info.memory.geometries,
      programs: gl.info.programs?.length,
      heapBytes: memory?.usedJSHeapSize,
    });
  }, [active, gl]);

  const lifecycleRef = useRef<ReturnType<typeof bindSession> | undefined>(undefined);
  const enter = useCallback(() => {
    if (sessionRef.current || enteringRef.current || endingRef.current) return Promise.resolve();
    const epoch = entryEpoch.current;
    const operation = (async () => {
      onAvailability('entering');
      recordImmersiveDiagnostic('entry-requested');
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
          recordImmersiveDiagnostic('entry-abandoned');
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
        lifecycleRef.current.record('session-started');
        onAvailability('active');
      } catch (error) {
        recordImmersiveDiagnostic('entry-failed');
        noteImmersiveError('entry-failed', error);
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
    recordImmersiveDiagnostic('exit-requested');
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
      lifecycleRef.current?.record('webgl-context-lost');
      const reason = 'The WebGL context was lost. Immersive VR ended; your desktop workspace is still available.';
      noteImmersiveError('webgl-context-lost', reason);
      void lifecycleRef.current?.endSession('failed', reason);
    };
    const restored = () => recordImmersiveDiagnostic('webgl-context-restored');
    const leaving = () => {
      recordImmersiveDiagnostic('pagehide');
      entryEpoch.current += 1;
      void lifecycleRef.current?.endSession('available');
    };
    gl.domElement.addEventListener('webglcontextlost', contextLost);
    gl.domElement.addEventListener('webglcontextrestored', restored);
    window.addEventListener('pagehide', leaving);
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', contextLost);
      gl.domElement.removeEventListener('webglcontextrestored', restored);
      window.removeEventListener('pagehide', leaving);
    };
  }, [gl.domElement]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // React development mode verifies effect cleanup by immediately mounting again. Deferring
      // irreversible store destruction keeps that check from ending a real session spuriously.
      queueMicrotask(() => {
        if (mountedRef.current) return;
        if (sessionRef.current || enteringRef.current) recordImmersiveDiagnostic('renderer-unmounted');
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
