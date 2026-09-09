'use client';

import { Canvas } from '@react-three/fiber';
import { ImmersiveBridge, type ImmersiveBridgeProps } from './ImmersiveBridge';

export function ImmersiveRenderer(props: ImmersiveBridgeProps) {
  return <div className="immersive-viewport" aria-hidden="true">
    <Canvas
      style={{ pointerEvents: 'none' }}
      frameloop={props.active ? 'always' : 'demand'}
      dpr={1}
      camera={{ position: [0, 0, 0], fov: 60, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    >
      <ImmersiveBridge {...props} />
    </Canvas>
  </div>;
}
