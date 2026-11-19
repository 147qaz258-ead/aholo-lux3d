/**
 * 端到端集成测试（真实调用 Lux3D，不 mock）
 * 用法：node scripts/e2e-lux3d.mjs [port]
 * 流程：启动服务 → 建任务 → 轮询 → 代理下载 GLB → 校验魔数
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = Number(process.argv[2] || 8790);
const base = `http://127.0.0.1:${PORT}`;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const srv = spawn(process.execPath, ["server/index.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
srv.stdout.on("data", (d) => process.env.VERBOSE && process.stdout.write(d));
srv.stderr.on("data", (d) => process.stderr.write(d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {}
    await wait(250);
  }
  const health = await (await fetch(`${base}/api/health`)).json();
  log("health", JSON.stringify(health));

  const prompt = process.env.PROMPT || "一把悬浮的白色陶瓷椅子，极简主义，边缘发光";
  const style = process.env.STYLE || "photorealistic";
  log("创建文生 3D 任务:", prompt);
  const created = await (
    await fetch(`${base}/api/lux3d/text-to-3d`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, style, faceCount: 120000 }),
    })
  ).json();
  log("任务返回", JSON.stringify(created));
  if (!created.taskId) throw new Error("未取得 taskId");

  let outputs = null;
  for (let i = 0; i < 200; i++) {
    const snap = await (await fetch(`${base}/api/lux3d/task/${created.taskId}`)).json();
    if (i % 5 === 0) log("状态", snap.status, "outputs:", snap.outputs?.length || 0);
    if (snap.status === 3) {
      outputs = snap.outputs;
      break;
    }
    if (snap.status === 4) throw new Error("任务失败 status=4");
    await wait(3000);
  }
  if (!outputs?.length) throw new Error("超时未取得产物");
  log("产物", outputs);

  const glb = outputs.find((u) => /\.glb(\?|$)/i.test(u)) || outputs[0];
  log("下载", glb.slice(0, 90) + "…");
  const res = await fetch(`${base}/api/asset?url=${encodeURIComponent(glb)}`);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const magic = buf.subarray(0, 4).toString("ascii");
  log("下载完成", buf.length, "bytes, magic =", magic);
  if (magic !== "glTF") throw new Error("不是合法 GLB");

  mkdirSync("test-artifacts", { recursive: true });
  writeFileSync(`test-artifacts/lux3d-${created.taskId}.glb`, buf);
  log("✅ 通过：真实 Lux3D 生成 → 代理下载 → GLB 校验");
  srv.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ 失败:", e.message);
  srv.kill();
  process.exit(1);
});
