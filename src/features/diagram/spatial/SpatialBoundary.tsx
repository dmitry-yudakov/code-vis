'use client';

import dynamic from 'next/dynamic';
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import type { SpatialRoomProps } from './spatialTypes';

const SpatialRoom = dynamic(
  () => import('./SpatialRoom').then((module) => module.SpatialRoom),
  { ssr: false, loading: () => <SpatialLoading /> },
);

function SpatialLoading() {
  return <div className="spatial-status" role="status"><strong>Opening Spatial…</strong><span>Preparing the local 3D renderer.</span></div>;
}

function webglAvailable(): boolean {
  if (window.__CODEAI_SPATIAL_TEST__?.forceUnsupported) return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

class SpatialErrorBoundary extends Component<{
  children: ReactNode;
  onError(message: string): void;
}, { error?: string }> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : 'The spatial renderer could not load.' };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.onError(error instanceof Error ? error.message : 'The spatial renderer could not load.');
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

declare global {
  interface Window {
    __CODEAI_SPATIAL_TEST__?: {
      forceUnsupported?: boolean;
      failTextureId?: string;
    };
  }
}

export function SpatialBoundary(props: SpatialRoomProps) {
  const [capability, setCapability] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    setCapability(webglAvailable() ? 'ready' : 'failed');
  }, []);

  const fail = (message: string) => {
    setFailure(message);
    props.onFailure(message);
  };

  if (capability === 'checking') return <SpatialLoading />;
  if (capability === 'failed' || failure) {
    return (
      <div className="spatial-status spatial-fallback" role="alert">
        <strong>Spatial is unavailable</strong>
        <span>{failure || 'This browser or device does not provide a usable WebGL context.'}</span>
        <button type="button" onClick={props.onOpenFlat}>Return to Flat</button>
      </div>
    );
  }
  return (
    <SpatialErrorBoundary onError={fail}>
      <SpatialRoom {...props} onFailure={fail} />
    </SpatialErrorBoundary>
  );
}
