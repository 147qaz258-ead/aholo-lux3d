import { useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { useApp } from "../store";

const backdropVert = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const backdropFrag = /* glsl */ `
  varying vec3 vPos;
  void main() {
    float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
    vec3 low  = vec3(0.035, 0.098, 0.125);
    vec3 mid  = vec3(0.012, 0.030, 0.052);
    vec3 high = vec3(0.006, 0.010, 0.020);
    vec3 c = mix(low, mid, smoothstep(0.35, 0.55, h));
    c = mix(c, high, smoothstep(0.55, 0.95, h));
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** 生成一张径向渐变贴图，作为地面柔光池 */
function useGlowTexture() {
  return useMemo(() => {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(52,200,196,0.42)");
    grad.addColorStop(0.35, "rgba(34,104,164,0.16)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

export function Environment({ light }: { light: boolean }) {
  const showGrid = useApp((s) => s.settings.showGrid);
  const particles = useRef<THREE.Points>(null);
  const rings = useRef<THREE.Group>(null);
  const glow = useGlowTexture();
  useEffect(() => () => glow.dispose(), [glow]);

  const positions = useMemo(() => {
    const n = 1100;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 7 + Math.random() * 13;
      const theta = Math.random() * Math.PI * 2;
      arr[i * 3] = Math.cos(theta) * r;
      arr[i * 3 + 1] = (Math.random() - 0.3) * 10;
      arr[i * 3 + 2] = Math.sin(theta) * r;
    }
    return arr;
  }, []);

  useFrame((state, dt) => {
    if (particles.current) particles.current.rotation.y += dt * 0.012;
    if (rings.current) {
      rings.current.rotation.z += dt * 0.04;
      rings.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.1;
    }
  });

  return (
    <>
      <fog attach="fog" args={["#050a12", 10, 34]} />

      {/* 天幕：垂直渐变，制造空间纵深而不是一片死黑 */}
      <mesh scale={[60, 60, 60]} frustumCulled={false}>
        <sphereGeometry args={[1, 24, 24]} />
        <shaderMaterial
          vertexShader={backdropVert}
          fragmentShader={backdropFrag}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      <ambientLight intensity={0.42} color="#8fd8ff" />
      <directionalLight position={[4, 8, 5]} intensity={1.45} color="#e6f8ff" castShadow={!light}>
        <orthographicCamera attach="shadow-camera" args={[-11, 11, 11, -11, 0.5, 34]} />
      </directionalLight>
      <directionalLight position={[-6, 3, -4]} intensity={1.0} color="#4f6bff" />
      {!light && <pointLight position={[0, 1.3, 1.4]} intensity={9} distance={7} color="#39f5d4" />}

      {/* 地面柔光池 */}
      {!light && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshBasicMaterial map={glow} transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={!light}>
        <planeGeometry args={[80, 80]} />
        {light ? <meshBasicMaterial color="#0b1520" /> : <meshStandardMaterial color="#060c15" roughness={0.86} metalness={0.12} />}
      </mesh>

      {showGrid && (
        <Grid
          position={[0, 0.004, 0]}
          args={[40, 40]}
          cellSize={0.5}
          cellThickness={0.6}
          cellColor="#24566b"
          sectionSize={2.5}
          sectionThickness={1.1}
          sectionColor="#2ee8c8"
          fadeDistance={26}
          fadeStrength={1.2}
          infiniteGrid
        />
      )}

      {!light && <group ref={rings} position={[0, 0.02, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[5.2, 0.004, 6, 200]} />
          <meshBasicMaterial color="#2ee8c8" transparent opacity={0.28} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0.4, 0]}>
          <torusGeometry args={[7.2, 0.003, 6, 200]} />
          <meshBasicMaterial color="#4f6bff" transparent opacity={0.2} />
        </mesh>
      </group>}

      {!light && <points ref={particles}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.028} color="#9fe9ff" transparent opacity={0.42} sizeAttenuation depthWrite={false} />
      </points>}
    </>
  );
}
