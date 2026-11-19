import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

let installed = false;

/** 全局安装 BVH 加速射线检测：Lux3D 生成的模型面数高，普通 raycast 会卡住主线程 */
export function setupBVH() {
  if (installed) return;
  const proto = THREE.BufferGeometry.prototype as unknown as Record<string, unknown>;
  proto.computeBoundsTree = computeBoundsTree;
  proto.disposeBoundsTree = disposeBoundsTree;
  (THREE.Mesh.prototype as unknown as Record<string, unknown>).raycast = acceleratedRaycast;
  installed = true;
}

/** 解析 GLB，归一化到统一尺寸并居中，便于手势直接操作 */
export async function parseGlb(buffer: ArrayBuffer, targetSize = 1.2): Promise<THREE.Group> {
  setupBVH();
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, "");

  const root = gltf.scene;
  try {
  let vertices = 0;
  let visibleMeshes = 0;
  root.traverse(o => {
    if ([...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].some(n => !Number.isFinite(n))) throw new Error("模型变换含非有限数值");
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let visible = true;
    for (let node: THREE.Object3D | null = o; node; node = node.parent) visible = visible && node.visible;
    if (visible) visibleMeshes++;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos || !pos.count) throw new Error("模型含空网格");
    vertices += pos.count;
    if (vertices > 2000000) throw new Error("模型超过 200 万顶点限制，请先简化");
    for (const n of pos.array) if (!Number.isFinite(n)) throw new Error("模型顶点含 NaN 或 Infinity");
    const idx = mesh.geometry.index;
    if (idx) for (const i of idx.array) if (!Number.isInteger(i) || i < 0 || i >= pos.count) throw new Error("模型索引越界");
  });
  if (!vertices) throw new Error("模型没有可编辑网格");
  if (!visibleMeshes) throw new Error("模型没有可见网格");
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const geo = mesh.geometry as THREE.BufferGeometry;
      const normal = geo.getAttribute("normal");
      if (!normal || normal.count !== geo.getAttribute("position").count || Array.from(normal.array).some(n => !Number.isFinite(n))) geo.computeVertexNormals();
      if (!geo.boundsTree) geo.computeBoundsTree();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => {
          m.side = THREE.FrontSide;
          m.needsUpdate = true;
        });
      } else if (mesh.material) {
        mesh.material.side = THREE.FrontSide;
        mesh.material.needsUpdate = true;
      }
    }
  });

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty() || [...box.min.toArray(), ...box.max.toArray()].some(n => !Number.isFinite(n)) || box.min.distanceTo(box.max) <= 1e-8) throw new Error("模型包围盒无效");
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize > 0 ? targetSize / maxDim : 1;
  root.scale.setScalar(scale);

  const box2 = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  root.position.sub(center);
  root.position.y += (box2.max.y - box2.min.y) / 2;

  // 用一个外层 Group 承载，保证归一化后子节点变换不会再被打乱
  const wrapper = new THREE.Group();
  wrapper.add(root);
  wrapper.updateMatrixWorld(true);
  return wrapper;
  } catch (error) {
    disposeObject(root);
    throw error;
  }
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose?.();
      const mat = m.material;
      for (const material of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    }
  });
}
