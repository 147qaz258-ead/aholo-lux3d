import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useApp } from "../store";
import type { SceneObject } from "../types";
import { objectRegistry } from "./runtime";
import { idb } from "../lib/idb";
import { disposeObject, parseGlb } from "../lib/glb";
import { buildExtrusionGeometry, buildStrokeGeometry, buildSurfaceGeometry, prepareContour } from "../lib/stroke";
import { restoreGeometry } from "../lib/deformation";

function primitiveGeometry(p: SceneObject) {
  const t = p.primitive?.type || "box";
  const q = p.primitive?.params || {};
  switch (t) {
    case "sphere":
      return new THREE.SphereGeometry(q.r ?? 0.42, 64, 48);
    case "cylinder":
      return new THREE.CylinderGeometry(q.rt ?? 0.3, q.rb ?? 0.3, q.h ?? 0.8, 64, 1);
    case "torus":
      return new THREE.TorusGeometry(q.r ?? 0.34, q.tube ?? 0.1, 32, 96);
    case "cone":
      return new THREE.ConeGeometry(q.r ?? 0.34, q.h ?? 0.8, 64);
    default:
      return new THREE.BoxGeometry(q.w ?? 0.6, q.h ?? 0.6, q.d ?? 0.6, 24, 24, 24);
  }
}

export function ObjectNode({ obj }: { obj: SceneObject }) {
  const group = useRef<THREE.Group>(null);
  const selected = useApp((s) => s.selectedIds.includes(obj.id));
  const [content, setContent] = useState<THREE.Group | null>(null);
  const [texture,setTexture]=useState<THREE.Texture|null>(null);
  useEffect(()=>{
    setTexture(null);if(!obj.material?.texture)return;
    let alive=true,loaded:THREE.Texture|null=null;
    new THREE.TextureLoader().load(obj.material.texture.dataUrl,t=>{loaded=t;t.colorSpace=THREE.SRGBColorSpace;t.flipY=obj.kind!=="model";if(alive)setTexture(t);else t.dispose();});
    return()=>{alive=false;loaded?.dispose();};
  },[obj.material?.texture?.dataUrl,obj.kind]);
  const originalMaterials=useRef(new Map<THREE.MeshStandardMaterial,THREE.MeshStandardMaterial>());
  useEffect(()=>{
    if(!content)return;
    content.traverse(node=>{
      const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;
      for(const raw of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        const material=raw as THREE.MeshStandardMaterial;if(!material.isMeshStandardMaterial)return;
        if(!originalMaterials.current.has(material))originalMaterials.current.set(material,material.clone());
        const original=originalMaterials.current.get(material)!;
        material.copy(original);
        if(obj.material){const m=obj.material;material.roughness=m.roughness;material.metalness=m.metalness;material.opacity=m.opacity;material.transparent=m.opacity<1;material.depthWrite=m.opacity>=1;material.emissive.set(obj.color);material.emissiveIntensity=m.emissiveIntensity;material.color.set(obj.color);if(texture)material.map=texture;}
        material.needsUpdate=true;
      }
    });
  },[content,obj.material,obj.color,texture]);
  useEffect(()=>()=>{for(const m of originalMaterials.current.values())m.dispose();originalMaterials.current.clear();},[content]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.userData.objectId = obj.id;
    objectRegistry.set(obj.id, g);
    return () => {
      objectRegistry.delete(obj.id);
    };
  }, [obj.id]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.position.fromArray(obj.transform.position);
    g.rotation.set(...obj.transform.rotation);
    g.scale.fromArray(obj.transform.scale);
    g.updateMatrixWorld();
  }, [
    obj.transform.position[0],
    obj.transform.position[1],
    obj.transform.position[2],
    obj.transform.rotation[0],
    obj.transform.rotation[1],
    obj.transform.rotation[2],
    obj.transform.scale[0],
    obj.transform.scale[1],
    obj.transform.scale[2],
  ]);

  useEffect(() => {
    if (group.current) group.current.visible = obj.visible;
  }, [obj.visible]);

  /* 模型资产异步加载 */
  useEffect(() => {
    setContent(null);
    if (obj.kind !== "model" || !obj.assetId) return;
    let alive = true;
    let loaded: THREE.Group | null = null;
    (async () => {
      try {
        const blob = await idb.getAsset(obj.assetId!);
        if (!blob) throw new Error("资产缺失");
        const buf = await blob.arrayBuffer();
        loaded = await parseGlb(buf);
        if (alive) setContent(loaded); else disposeObject(loaded);
      } catch (e) {
        if (alive) useApp.getState().toast(`模型「${obj.name}」加载失败：${(e as Error).message}`, "err");
      }
    })();
    return () => {
      alive = false;
      if (loaded) disposeObject(loaded);
    };
  }, [obj.kind, obj.assetId]);

  const geom = useMemo(() => {
    if (obj.kind === "primitive") return primitiveGeometry(obj);
    if (obj.kind === "extrusion" && obj.extrusion) {
      const { contour, normal, thickness } = obj.extrusion;
      return buildExtrusionGeometry(prepareContour(contour, new THREE.Vector3(...normal)), thickness);
    }
    if (obj.kind === "stroke" && obj.points && obj.points.length > 1 && obj.visible) {
      return obj.geometryType === "surface" ? buildSurfaceGeometry(obj.points) : buildStrokeGeometry(obj.points, obj.geometryType === "curve" ? 0.004 : obj.width ?? 0.012);
    }
    return null;
  }, [obj.kind, obj.primitive?.type, JSON.stringify(obj.primitive?.params), obj.points, obj.width, obj.visible, obj.geometryType, obj.extrusion]);

  useEffect(() => () => geom?.dispose(), [geom]);

  useEffect(() => {
    if (!group.current) return;
    try { restoreGeometry(group.current, obj.geometryEdits); }
    catch (e) { useApp.getState().toast((e as Error).message, "err"); }
  }, [content, geom, obj.geometryEdits]);

  const accent = obj.color || "#7cf7e3";

  return (
    <group ref={group} name={obj.name}>
      {obj.kind === "model" && content && <primitive object={content} />}

      {geom && (obj.kind === "primitive" || obj.kind === "extrusion") && (
        <>
          <mesh geometry={geom} castShadow receiveShadow>
            <meshStandardMaterial
              color={accent}
              roughness={obj.material?.roughness??0.34}
              metalness={obj.material?.metalness??0.24}
              emissive={accent} emissiveIntensity={obj.material?.emissiveIntensity??.14}
              opacity={obj.material?.opacity??1} transparent={(obj.material?.opacity??1)<1} depthWrite={(obj.material?.opacity??1)>=1} map={texture}
            />
          </mesh>
          <mesh geometry={geom} scale={1.002} raycast={() => null}>
            <meshBasicMaterial color={accent} wireframe transparent opacity={0.14} depthWrite={false} />
          </mesh>
        </>
      )}

      {geom && obj.kind === "stroke" && (
        <mesh geometry={geom}>
          {obj.material?<meshStandardMaterial color={accent} roughness={obj.material.roughness} metalness={obj.material.metalness} opacity={obj.material.opacity} transparent={obj.material.opacity<1} emissive={accent} emissiveIntensity={obj.material.emissiveIntensity} map={texture} side={THREE.DoubleSide}/>:<meshBasicMaterial
            color={selected ? "#ffffff" : accent}
            transparent
            opacity={0.95}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />}
        </mesh>
      )}
    </group>
  );
}
