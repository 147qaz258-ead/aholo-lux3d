import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* 极简 .env 读取：避免为一行配置引入 dotenv 依赖 */
const here = dirname(fileURLToPath(import.meta.url));
for (const name of [".env", ".env.local"]) {
  const p = join(here, "..", name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const LUX3D = {
  base: process.env.LUX3D_BASE_URL || "https://api.aholo3d.cn",
  key: process.env.LUX3D_API_KEY || "",
};

function headers(extra = {}) {
  return { Authorization: LUX3D.key, ...extra };
}

async function call(path, init = {}) {
  if (!LUX3D.key) throw new ApiError("未配置 LUX3D_API_KEY，请在服务端 .env 设置后重启", 503, "KEY_NOT_CONFIGURED");
  const res = await fetch(`${LUX3D.base}${path}`, {
    ...init,
    headers: headers(init.headers),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(`Lux3D 返回非 JSON 响应 (HTTP ${res.status})`, res.status, text.slice(0, 300));
  }
  if (!res.ok) {
    throw new ApiError(json?.m || `HTTP ${res.status}`, res.status, json?.c);
  }
  if (json.c !== undefined && json.c !== "0") {
    throw new ApiError(json.m || "Lux3D 业务错误", 200, json.c);
  }
  return json;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** 文生 3D */
export async function createTextTo3D({ prompt, style = "photorealistic", faceCount = 200000, version = "G1" }) {
  const json = await call("/lux3d/v1/generate/text-to-3d/task/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      style,
      version,
      faceCount,
      outputFormat: ["glb"],
    }),
  });
  return { taskId: json.d };
}

/** 图生 3D（单图或多图 URL） */
export async function createImgTo3D({ imageUrls, faceCount = 200000, version = "G1-Turbo" }) {
  const body = { faceCount, outputFormat: ["glb"], version };
  if (imageUrls.length === 1) {
    body.img = imageUrls[0];
    if (version !== "G1") body.version = version;
  } else {
    body.imgs = imageUrls;
    body.version = version;
  }
  const json = await call("/lux3d/v1/generate/img-to-3d/task/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { taskId: json.d };
}

/** 查询任务。status: 0 排队 1 运行 3 成功 4 失败（实测 0/1/3/4） */
export async function getTask(taskId) {
  const json = await call(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`);
  const d = json.d || {};
  const outputs = Array.isArray(d.outputs)
    ? d.outputs
        .filter(Boolean)
        .map((o) => (typeof o === "string" ? o : o.content || o.url))
        .filter(Boolean)
    : [];
  return {
    taskId: d.taskId ?? taskId,
    status: d.status,
    outputs,
    raw: d,
  };
}

/* ------------------------------- OUS 上传 ------------------------------- */

async function ousToken() {
  const json = await call("/asset/v1/token");
  // 实测：该接口不走 {c,d} 信封，凭证直接在顶层
  const tok = json.d ?? json;
  if (!tok?.ousToken || !tok?.globalDomain) {
    throw new ApiError("上传凭证结构异常", 502, "BAD_TOKEN_SHAPE");
  }
  return tok;
}

/** 把本地图片上传到 OUS，返回可公开访问的 URL */
export async function uploadImage(buffer, filename = "image.png") {
  const tok = await ousToken();
  const md5 = (await import("node:crypto")).createHash("md5").update(buffer).digest("hex");

  const form = new FormData();
  form.append("md5", md5);
  form.append("file", new Blob([buffer], { type: "application/octet-stream" }), filename);

  const upRes = await fetch(`${tok.globalDomain}/ous/api/v2/single/upload`, {
    method: "POST",
    headers: { "ous-token-v2": tok.ousToken },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  const upJson = await upRes.json();
  if (!upRes.ok || upJson.c !== "0") {
    throw new ApiError(upJson?.m || "OUS 上传失败", upRes.status, upJson?.c);
  }

  // 轮询上传状态直到 status === 5
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const stRes = await fetch(`${tok.globalDomain}/ous/api/v2/upload/status`, {
      headers: { "ous-token-v2": tok.ousToken },
      signal: AbortSignal.timeout(30000),
    });
    const stJson = await stRes.json();
    const d = stJson.d || {};
    if (d.status === 5 && (d.url || d.fileUrl || d.downloadUrl)) {
      return d.url || d.fileUrl || d.downloadUrl;
    }
    if (d.status === 6 || d.status === -1) {
      throw new ApiError("OUS 上传任务失败", 200, String(d.status));
    }
  }
  throw new ApiError("OUS 上传超时", 200, "UPLOAD_TIMEOUT");
}

/** 下载远端产物（绕过浏览器 CORS） */
export async function fetchBinary(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new ApiError(`下载产物失败 HTTP ${res.status}`, res.status);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
