import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ThemeName } from '@/shared/design/tokens';
import { immersiveTheme } from './immersiveTheme';

/** Presentation only: work panels do not depend on the opaque VR environment. */
export function ImmersiveEnvironment({ theme }: { theme: ThemeName }) {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const previous = scene.background;
    scene.background = new THREE.Color(immersiveTheme[theme].environment);
    return () => { scene.background = previous; };
  }, [scene, theme]);
  return <>
    <ambientLight intensity={1.7} />
    <directionalLight position={[3, 6, 4]} intensity={1.1} />
  </>;
}
