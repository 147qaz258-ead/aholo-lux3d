/**
 * 验证图生 3D 产物（126k 顶点 / 14.3 MB）能在系统内载入并接受形变，
 * 同时记录载入耗时与渲染帧率。
 */
import { pathToFileURL } from "node:url";

const PW = process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js";
const mod = await import(pathToFileURL(PW).href);
const chromium = mod.chromium || mod.default?.chromium;

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(900);
await page.getByRole("button", { name: /鼠标模式|启用摄像头并进入/ }).first().click();
await page.waitForTimeout(1500);

const t0 = Date.now();
await page.getByRole("button", { name: /图生3D 青瓷/ }).click();
await page.waitForTimeout(1500);

// 轮询直到 model 顶点数 > 0
let info = null;
for (let i = 0; i < 60; i++) {
  info = await page.evaluate(() => {
    const { useApp, objectRegistry } = window.__spatial;
    const o = useApp.getState().objects.find((x) => x.kind === "model");
    if (!o) return null;
    const g = objectRegistry.get(o.id);
    if (!g) return null;
    let verts = 0, meshes = 0, bvh = 0;
    g.traverse((c) => {
      if (c.isMesh) { meshes++; verts += c.geometry?.attributes?.position?.count || 0; if (c.geometry?.boundsTree) bvh++; }
    });
    return { verts, meshes, bvh, name: o.name };
  });
  if (info?.verts) break;
  await page.waitForTimeout(500);
}
const loadMs = Date.now() - t0;
console.log("载入结果：", JSON.stringify(info), `耗时 ${(loadMs / 1000).toFixed(1)}s`);
if (!info?.verts) { console.log("❌ 图生模型未载入"); await browser.close(); process.exit(1); }

// 帧率采样 2 秒
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t = performance.now();
  const tick = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t) / 1000))); };
  requestAnimationFrame(tick);
}));
console.log(`渲染帧率：${fps} FPS（headless 软件光栅）`);

// 形变：切到雕刻工具，在模型中心按压
const canvas = await page.locator(".viewport canvas").boundingBox();
await page.evaluate(() => window.__spatial.useApp.getState().setTool("sculpt"));
await page.waitForTimeout(300);
const tool = await page.evaluate(() => window.__spatial.useApp.getState().tool);
console.log("当前工具：", tool);
const spot = await page.evaluate(([w, h]) => {
  const { useApp, objectRegistry } = window.__spatial;
  const o = useApp.getState().objects.find((x) => x.kind === "model");
  const g = objectRegistry.get(o.id);
  const cam = window.__three.camera;
  const THREE = window.__spatial.THREE;
  const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
  const p = c.project(cam);
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
}, [canvas.width, canvas.height]);

const before = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const o = useApp.getState().objects.find((x) => x.kind === "model");
  let sum = 0;
  objectRegistry.get(o.id).traverse((c) => {
    if (c.isMesh) { const a = c.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 97) sum += a[i]; }
  });
  return sum;
});

await page.mouse.move(canvas.x + spot.x, canvas.y + spot.y);
await page.mouse.down();
for (let i = 0; i < 14; i++) { await page.mouse.move(canvas.x + spot.x + (i % 2), canvas.y + spot.y + (i % 2)); await page.waitForTimeout(80); }
await page.mouse.up();
await page.waitForTimeout(400);

const after = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const o = useApp.getState().objects.find((x) => x.kind === "model");
  let sum = 0;
  objectRegistry.get(o.id).traverse((c) => {
    if (c.isMesh) { const a = c.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 97) sum += a[i]; }
  });
  return sum;
});
console.log(`形变前后位置采样：${before.toFixed(3)} → ${after.toFixed(3)} （差 ${Math.abs(after - before).toFixed(3)}）`);
console.log(after !== before ? "✅ 图生模型可雕刻" : "❌ 图生模型未响应形变");
await page.screenshot({ path: "test-artifacts/53-img2model.png" });
console.log(errs.length ? `❌ JS 异常：${errs.slice(0, 2).join(" | ")}` : "✅ 无 JS 异常");
await browser.close();
process.exit(after !== before && errs.length === 0 ? 0 : 1);
