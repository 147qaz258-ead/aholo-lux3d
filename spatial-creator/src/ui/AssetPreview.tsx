import { useEffect, useState } from "react";
import { PreviewCanvas } from "./PreviewCanvas";
import type { Group } from "three";
import { idb } from "../lib/idb";
import { disposeObject, parseGlb } from "../lib/glb";
import { Modal } from "./Modal";
import { ObjectComparison } from "./ObjectComparison";

export function AssetPreview({ assetId, title, detail, onAccept, onReject, compareTargetId }: { assetId: string; title: string; detail: string; onAccept: () => void; onReject: () => void; compareTargetId?:string }) {
  const [model, setModel] = useState<Group | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true; let loaded: Group | null = null;
    setModel(null); setError("");
    void (async () => {
      try {
        const blob = await idb.getAsset(assetId); if (!blob) throw new Error("模型资产缺失");
        loaded = await parseGlb(await blob.arrayBuffer());
        if (alive) setModel(loaded); else disposeObject(loaded);
      } catch (e) { if (alive) setError((e as Error).message); }
    })();
    return () => { alive = false; if (loaded) disposeObject(loaded); };
  }, [assetId]);
  return <Modal label={title} onClose={onReject}>
    <section className={`review-card panel${compareTargetId?" comparison-card":""}`}>
      <h2 className="title-3">{title}</h2><p className="caption-5">{detail}</p>
      <div className={compareTargetId?"comparison-grid":""}>
      {compareTargetId&&<div><h3 className="title-4">当前目标</h3><ObjectComparison targetId={compareTargetId}/></div>}
      <div>{compareTargetId&&<h3 className="title-4">生成候选</h3>}<div className="asset-preview">
        {error ? <p role="alert">模型校验失败：{error}</p> : !model ? <div className="preview-skeleton">正在校验并加载三维预览…</div> : <PreviewCanvas model={model}/>}
      </div>
      </div></div>
      <div className="review-actions"><button autoFocus className="btn" onClick={onReject}>拒绝 / 取消</button><button className="btn primary" disabled={!model || !!error} onClick={onAccept}>接受并写入场景</button></div>
    </section>
  </Modal>;
}
