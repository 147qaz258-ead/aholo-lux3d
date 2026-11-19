/**
 * 图生 3D 链路验证（TC-AI-02），分两步：
 *   A. 只跑 OUS 上传，验证上传契约（零积分成本）
 *   B. --full 时继续创建真实图生任务并下载 GLB（消耗 1 次生成额度）
 */
import { readFileSync } from "node:fs";

const API = process.env.API || "http://127.0.0.1:8787";
const KEY = process.env.LUX3D_API_KEY;
if (!KEY) throw new Error("请设置 LUX3D_API_KEY 后运行此脚本；可使用 node --env-file=.env 加载本地配置");
const BASE = "https://api.aholo3d.cn";
const full = process.argv.includes("--full");
const imgPath = process.argv.find((a) => a.endsWith(".png") || a.endsWith(".jpg")) || "test-artifacts/22-model.png";

const t = (ms) => `${(ms / 1000).toFixed(1)}s`;
const t0 = Date.now();

const buf = readFileSync(imgPath);
console.log(`输入图：${imgPath} (${(buf.length / 1024).toFixed(0)} KB)`);

/* ---------- A. OUS 上传 ---------- */
console.log("\n[A] OUS 上传");
const tokRes = await fetch(`${BASE}/asset/v1/token`, { headers: { Authorization: KEY } });
const tokJson = await tokRes.json();
const tok = tokJson.d ?? tokJson;
if (!tok?.ousToken) {
  console.log(`❌ 取上传凭证失败：${JSON.stringify(tokJson).slice(0, 200)}`);
  process.exit(1);
}
console.log(`  凭证 ok · domain=${tok.globalDomain} · token=${String(tok.ousToken).slice(0, 10)}…`);

const md5 = (await import("node:crypto")).createHash("md5").update(buf).digest("hex");
const form = new FormData();
form.append("md5", md5);
form.append("file", new Blob([buf], { type: "application/octet-stream" }), "input.png");

const upRes = await fetch(`${tok.globalDomain}/ous/api/v2/single/upload`, {
  method: "POST",
  headers: { "ous-token-v2": tok.ousToken },
  body: form,
});
const upText = await upRes.text();
console.log(`  上传响应 HTTP ${upRes.status}: ${upText.slice(0, 300)}`);
let upJson = {};
try { upJson = JSON.parse(upText); } catch { /* noop */ }
if (upJson.c !== "0" && upJson.c !== undefined) {
  console.log(`❌ 上传被拒：${upJson.m}`);
  process.exit(1);
}

let url = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 400));
  const st = await fetch(`${tok.globalDomain}/ous/api/v2/upload/status`, {
    headers: { "ous-token-v2": tok.ousToken },
  });
  const sj = await st.json();
  const d = sj.d || {};
  if (i === 0) console.log(`  状态字段：${JSON.stringify(d).slice(0, 300)}`);
  if (d.status === 5 && (d.url || d.fileUrl || d.downloadUrl)) {
    url = d.url || d.fileUrl || d.downloadUrl;
    break;
  }
  if (d.status === 6 || d.status === -1) {
    console.log(`❌ 上传任务失败 status=${d.status}`);
    process.exit(1);
  }
}
if (!url) {
  console.log("❌ 上传超时，未拿到 URL");
  process.exit(1);
}
console.log(`✅ 上传成功 ${t(Date.now() - t0)} → ${url.slice(0, 90)}`);

const head = await fetch(url, { method: "GET", headers: { Range: "bytes=0-15" } });
console.log(`  可访问性：HTTP ${head.status} · ${head.headers.get("content-type")}`);

if (!full) {
  console.log("\n（未加 --full，跳过任务创建）");
  process.exit(0);
}

/* ---------- B. 创建图生任务 ---------- */
console.log("\n[B] 创建图生 3D 任务");
const createRes = await fetch(`${BASE}/lux3d/v1/generate/img-to-3d/task/create`, {
  method: "POST",
  headers: { Authorization: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ img: url, version: "G1-Turbo", faceCount: 150000, outputFormat: ["glb"] }),
});
const createJson = await createRes.json();
console.log(`  ${JSON.stringify(createJson).slice(0, 300)}`);
if (createJson.c !== "0") {
  console.log(`❌ 创建失败：${createJson.m}`);
  process.exit(1);
}
const taskId = createJson.d;
console.log(`  任务 ${taskId} 已创建`);

let outputs = [];
for (let i = 0; i < 200; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await fetch(`${BASE}/lux3d/v1/generate/task/get?taskid=${taskId}`, {
    headers: { Authorization: KEY },
  });
  const j = await r.json();
  const d = j.d || {};
  if (i % 5 === 0) console.log(`  [${t(Date.now() - t0)}] status=${d.status}`);
  if (d.status === 3) {
    outputs = (d.outputs || []).map((o) => (typeof o === "string" ? o : o.content || o.url)).filter(Boolean);
    break;
  }
  if (d.status === 4) {
    console.log(`❌ 任务失败：${JSON.stringify(d).slice(0, 300)}`);
    process.exit(1);
  }
}
console.log(`  产物：${outputs.map((o) => String(o).split("/").pop()).join(", ")}`);
const glb = outputs.find((o) => String(o).toLowerCase().includes(".glb"));
if (!glb) {
  console.log("❌ 没有 glb 产物");
  process.exit(1);
}
const dl = await fetch(glb);
const ab = Buffer.from(await dl.arrayBuffer());
console.log(`✅ 下载 ${ab.length} bytes · magic=${ab.subarray(0, 4).toString("ascii")}`);
if (ab.subarray(0, 4).toString("ascii") !== "glTF") {
  console.log("❌ 魔数不对");
  process.exit(1);
}
const { writeFileSync } = await import("node:fs");
writeFileSync("test-artifacts/lux3d-img2-3d.glb", ab);
console.log(`✅ 图生 3D 全链路通过 ${t(Date.now() - t0)}，已存 test-artifacts/lux3d-img2-3d.glb`);
