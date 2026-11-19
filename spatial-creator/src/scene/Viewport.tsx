import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useState } from "react";
import { useApp } from "../store";
import { Environment } from "./Environment";
import { ObjectNode } from "./ObjectNode";
import { Interaction, PointerCursor, SelectionOverlay } from "./Interaction";
import { HandRig } from "./HandRig";
import { AssemblyOverlay } from "./AssemblyOverlay";
import { WorkPlane } from "./WorkPlane";
import { CameraController, ProjectionCamera } from "./CameraController";
import { HoverOverlay } from "./HoverOverlay";
import { isSoftwareRenderer, renderInfo, webGlRenderer } from "../lib/renderInfo";

const GL_OPTIONS = { antialias: false, powerPreference: "high-performance", alpha: false } as const;

function RenderDiagnostics() {
  const dpr = useThree(s => s.viewport.dpr);
  useEffect(() => { renderInfo.pixelRatio = dpr; }, [dpr]);
  return null;
}

function Objects() {
  const objects = useApp((s) => s.objects);
  return (
    <>
      {objects.map((o) => (
        <ObjectNode key={o.id} obj={o} />
      ))}
    </>
  );
}

export function Viewport() {
  const tool = useApp((s) => s.tool);
  const cameraReady = useApp(s => s.cameraReady);
  const [software, setSoftware] = useState(false);
  const light = cameraReady || software;

  return (
    <div className="viewport" data-tool={tool}>
      <Canvas
        dpr={software ? .65 : cameraReady ? .85 : [1, 1.25]}
        shadows={!light}
        gl={GL_OPTIONS}
        camera={{ fov: 45, position: [0, 1.6, 4.8], near: 0.05, far: 120 }}
        onCreated={({ gl, scene, camera }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          scene.matrixWorldAutoUpdate = true;
          renderInfo.renderer = webGlRenderer(gl.getContext());
          setSoftware(isSoftwareRenderer(renderInfo.renderer));
          if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__three = { gl, scene, camera };
          }
        }}
      >
        <Suspense fallback={null}>
          <ProjectionCamera />
          <Environment light={light} />
          <Objects />
          <AssemblyOverlay />
          <Interaction />
          <WorkPlane />
          <HandRig />
          <PointerCursor />
          <SelectionOverlay />
          <HoverOverlay />
          <RenderDiagnostics />
          <OrbitControls
            makeDefault
            target={[0, 0.9, 0]}
            enableDamping
            dampingFactor={0.08}
            minDistance={1.2}
            maxDistance={14}
            maxPolarAngle={Math.PI}
            mouseButtons={{
              LEFT: undefined,
              MIDDLE: THREE.MOUSE.PAN,
              RIGHT: THREE.MOUSE.ROTATE,
            }}
          />
          <CameraController />
        </Suspense>
      </Canvas>
    </div>
  );
}
