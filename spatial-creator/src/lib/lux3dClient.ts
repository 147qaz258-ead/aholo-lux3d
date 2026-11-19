export interface TaskSnapshot {
  taskId: number;
  status: number;
  outputs: string[];
}

const json = async (res: Response) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `请求失败 HTTP ${res.status}`);
  return body;
};

export async function apiHealth() {
  return json(await fetch("/api/health"));
}

export async function createTextTo3D(prompt: string, style: string, faceCount = 200000, requestId?: string) {
  return json(
    await fetch("/api/lux3d/text-to-3d", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, style, faceCount, requestId }),
    }),
  ) as Promise<{ taskId: number }>;
}

export async function createImgTo3D(images: string[], faceCount = 200000, requestId?: string) {
  return json(
    await fetch("/api/lux3d/img-to-3d", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images, faceCount, version: "G1-Turbo", requestId }),
    }),
  ) as Promise<{ taskId: number; imageUrls: string[] }>;
}

export async function getTask(taskId: number) {
  return json(await fetch(`/api/lux3d/task/${taskId}`)) as Promise<TaskSnapshot>;
}

export async function downloadGlb(url: string) {
  const res = await fetch(`/api/asset?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`模型下载失败 HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** 轮询直到终态。返回产物 URL 列表（GLB 在前，ZIP 兜底） */
export async function waitForTask(
  taskId: number,
  onTick?: (s: TaskSnapshot, elapsedMs: number) => void,
  intervalMs = 2000,
  timeoutMs = 12 * 60 * 1000,
  signal?: AbortSignal,
) {
  const t0 = Date.now();
  for (;;) {
    signal?.throwIfAborted();
    const snap = await getTask(taskId);
    onTick?.(snap, Date.now() - t0);
    if (snap.status === 3 && snap.outputs.length) {
      // G1 会同时返回 zip 与 glb，取 glb
      const sorted = [...snap.outputs].sort((a, b) => score(b) - score(a));
      return sorted;
    }
    if (snap.status === 4) throw new Error("生成任务失败（服务端返回 status=4）");
    if (Date.now() - t0 > timeoutMs) throw new Error("生成超时（超过 12 分钟）");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("已停止本地等待，上游任务可能仍在运行", "AbortError")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, intervalMs);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

const score = (url: string) => (/\.glb(\?|$)/i.test(url) ? 3 : /\.ply(\?|$)/i.test(url) ? 2 : /\.zip(\?|$)/i.test(url) ? 0 : 1);

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}
