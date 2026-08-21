import { useCallback, useEffect, useRef, useState } from 'react';

type GraphViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type EdgePanViewportController = {
  getViewport: () => GraphViewport;
  setViewport: (viewport: GraphViewport) => void;
};

type UseFullscreenEdgePanOptions = {
  edgeThreshold?: number;
  maxSpeed?: number;
  ignoredTargetSelector?: string;
  onBeforeEnter?: () => void;
};

const DEFAULT_EDGE_THRESHOLD = 72;
const DEFAULT_EDGE_MAX_SPEED = 760;

const getEdgePanAxisVelocity = (
  pointerPosition: number,
  viewportSize: number,
  edgeThreshold: number,
  maxSpeed: number
): number => {
  if (pointerPosition < edgeThreshold) {
    const intensity = (edgeThreshold - pointerPosition) / edgeThreshold;
    return -maxSpeed * intensity * intensity;
  }

  if (pointerPosition > viewportSize - edgeThreshold) {
    const intensity =
      (pointerPosition - (viewportSize - edgeThreshold)) / edgeThreshold;
    return maxSpeed * intensity * intensity;
  }

  return 0;
};

export const useFullscreenEdgePan = <
  ContainerElement extends HTMLElement,
  ViewportController extends EdgePanViewportController,
>({
  edgeThreshold = DEFAULT_EDGE_THRESHOLD,
  maxSpeed = DEFAULT_EDGE_MAX_SPEED,
  ignoredTargetSelector,
  onBeforeEnter,
}: UseFullscreenEdgePanOptions = {}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<ContainerElement | null>(null);
  const viewportControllerRef = useRef<ViewportController | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  const stopEdgePan = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastFrameRef.current = null;
  }, []);

  const runEdgePan = useCallback(
    (timestamp: number) => {
      const pointer = pointerRef.current;
      const viewportController = viewportControllerRef.current;

      if (!pointer || !viewportController) {
        stopEdgePan();
        return;
      }

      const velocityX = getEdgePanAxisVelocity(
        pointer.x,
        window.innerWidth,
        edgeThreshold,
        maxSpeed
      );
      const velocityY = getEdgePanAxisVelocity(
        pointer.y,
        window.innerHeight,
        edgeThreshold,
        maxSpeed
      );

      if (velocityX === 0 && velocityY === 0) {
        stopEdgePan();
        return;
      }

      const previousTimestamp = lastFrameRef.current ?? timestamp;
      const elapsedSeconds = Math.min(timestamp - previousTimestamp, 80) / 1000;
      lastFrameRef.current = timestamp;

      const viewport = viewportController.getViewport();
      viewportController.setViewport({
        ...viewport,
        x: viewport.x - velocityX * elapsedSeconds,
        y: viewport.y - velocityY * elapsedSeconds,
      });

      animationFrameRef.current = window.requestAnimationFrame(runEdgePan);
    },
    [edgeThreshold, maxSpeed, stopEdgePan]
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    onBeforeEnter?.();

    if (container.requestFullscreen) {
      try {
        await container.requestFullscreen();
        setIsFullscreen(true);
        return;
      } catch {
        // Use the CSS fixed-position fallback when browser fullscreen rejects.
      }
    }

    setIsFullscreen(true);
  }, [onBeforeEnter]);

  const exitFullscreen = useCallback(async () => {
    if (
      document.fullscreenElement === containerRef.current &&
      document.exitFullscreen
    ) {
      try {
        await document.exitFullscreen();
      } catch {
        // Keep the state-level escape path available if the browser API rejects.
      }
    }

    setIsFullscreen(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
      return;
    }

    void enterFullscreen();
  }, [enterFullscreen, exitFullscreen, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) {
      pointerRef.current = null;
      stopEdgePan();
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (
        ignoredTargetSelector &&
        (event.target as Element | null)?.closest(ignoredTargetSelector)
      ) {
        pointerRef.current = null;
        stopEdgePan();
        return;
      }

      pointerRef.current = {
        x: event.clientX,
        y: event.clientY,
      };

      if (animationFrameRef.current === null) {
        animationFrameRef.current = window.requestAnimationFrame(runEdgePan);
      }
    };

    const handleMouseLeave = () => {
      pointerRef.current = null;
      stopEdgePan();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      pointerRef.current = null;
      stopEdgePan();
    };
  }, [ignoredTargetSelector, isFullscreen, runEdgePan, stopEdgePan]);

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        document.fullscreenElement !== containerRef.current
      ) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  return {
    containerRef,
    viewportControllerRef,
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };
};
