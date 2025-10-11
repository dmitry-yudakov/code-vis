import './App.css';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRef, useState } from 'react';
import { Mesh } from 'three';

const Map3d = () => {
  const [hovered, setHover] = useState(false);
  const ref = useRef<Mesh>();
  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.rotation.x += hovered ? delta : delta / 5;
      // ref.current.rotation.y += delta;
      // ref.current.rotation.z += delta;
    }
  });

  return (
    <mesh
      ref={ref as any}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <boxGeometry args={[10, 5, 0.1]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
  );
};

function App() {
  return (
    // <div className="App">
    <Canvas>
      <ambientLight />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} />

      <pointLight position={[-10, -10, -10]} />
      <Map3d />
      <OrbitControls />
    </Canvas>
    // </div>
  );
}

export default App;
