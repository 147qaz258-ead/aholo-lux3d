import { idb } from "../lib/idb";
import { useApp, makeObject } from "../store";

/**
 * 示例资产全部由本项目通过 Aholo Lux3D 真实生成并落盘，不是外部下载的素材。
 *   ceramic-chair  text-to-3D（task 7094988，8.4 MB / 64,707 顶点）
 *   celadon-cat    img-to-3D（task 7137496，14.3 MB / 126,059 顶点）
 */
export const SAMPLES = [
  {
    url: "/samples/ceramic-chair.glb",
    assetId: "asset_sample_chair",
    name: "示例 · 文生3D 陶瓷椅",
    hint: "text-to-3D",
    color: "#b06bff",
  },
  {
    url: "/samples/celadon-cat.glb",
    assetId: "asset_sample_cat",
    name: "示例 · 图生3D 青瓷",
    hint: "img-to-3D",
    color: "#5fd2ff",
  },
];

export type Sample = (typeof SAMPLES)[number];

export async function loadSample(sample: Sample) {
  const st = useApp.getState();
  const dup = useApp.getState().objects.find((o) => o.assetId === sample.assetId);
  if (dup) {
    st.select(dup.id);
    st.toast("已在场景中", "info");
    return;
  }

  const exists = await idb.getAsset(sample.assetId);
  if (!exists) {
    st.toast(`正在载入 ${sample.hint} 示例…`, "info");
    const res = await fetch(sample.url);
    if (!res.ok) throw new Error("示例资产缺失");
    const buf = await res.arrayBuffer();
    await idb.putAsset(sample.assetId, new Blob([buf], { type: "model/gltf-binary" }));
  }

  const n = useApp.getState().objects.length;
  const obj = makeObject("model", sample.name, {
    assetId: sample.assetId,
    color: sample.color,
    transform: {
      position: [(n % 2) * 1.1 - 0.55, 0.72, (n % 2) * -0.4],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  });
  st.addObject(obj);
  st.toast(`${sample.name} 已进入场景`, "ok");
}

/** 兼容旧调用：主示例 */
export async function loadSampleModel() {
  await loadSample(SAMPLES[0]);
}
