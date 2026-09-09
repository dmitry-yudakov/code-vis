import { palette, type ThemeName } from '@/shared/design/tokens';

/** Presentation only: work panels do not depend on the opaque VR environment. */
export function ImmersiveEnvironment({ theme }: { theme: ThemeName }) {
  return <>
    <color attach="background" args={[palette[theme].shellSunk]} />
    <ambientLight intensity={1.7} />
    <directionalLight position={[3, 6, 4]} intensity={1.1} />
  </>;
}
