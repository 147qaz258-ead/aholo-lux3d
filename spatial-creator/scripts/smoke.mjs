/**
 * 视觉与集成冒烟：启动 → 载入真实 Lux3D 资产 → 雕刻高面数模型 → 截图
 */
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PW = process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js";
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium || pw.default?.chromium;

const URL = process.env.APP_URL || "http://127.0.0.1:5173";
mkdirSync("test-artifacts", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: process.env.PW_CHANNEL || "chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ["camera"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: "test-artifacts/20-boot.png" });

await page.getByRole("button", { name: "启用摄像头并进入" }).click();
await page.waitForTimeout(7000);
await page.screenshot({ path: "test-artifacts/21-workbench.png" });

const t0 = Date.now();
await page.getByRole("button", { name: /载入示例资产/ }).click();
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() =>
    window.__spatial?.useApp.getState().objects.some((o) => o.kind === "model"),
  );
  if (ok) break;
  await page.waitForTimeout(500);
}
// 等几何真正解析进场景
await page.waitForTimeout(4000);
const modelInfo = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const o = useApp.getState().objects.find((x) => x.kind === "model");
  const g = objectRegistry.get(o.id);
  let verts = 0;
  let meshes = 0;
  g.traverse((c) => {
    if (c.isMesh) {
      meshes++;
      verts += c.geometry.attributes.position.count;
    }
  });
  return { verts, meshes, ms: 0 };
});
console.log(`模型解析完成：${modelInfo.meshes} mesh / ${modelInfo.verts} 顶点，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.screenshot({ path: "test-artifacts/22-model.png" });

/* 雕刻高面数模型 */
await page.keyboard.press("3");
await page.waitForTimeout(400);
const canvas = await page.locator(".viewport canvas").boundingBox();

const before = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const o = useApp.getState().objects.find((x) => x.kind === "model");
  const g = objectRegistry.get(o.id);
  let sum = 0;
  g.traverse((c) => {
    if (c.isMesh) {
      const a = c.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 97) sum += a[i];
    }
  });
  return sum;
});

const px = await page.evaluate(([w, h]) => {
  const { useApp, objectRegistry, THREE } = window.__spatial;
  const cam = window.__three.camera;
  const o = useApp.getState().objects.find((x) => x.kind === "model");
  const g = objectRegistry.get(o.id);
  const rc = new THREE.Raycaster();
  // 扫描视口中心区域，找到真正能命中模型表面的点（椅面是镂空的，投影中心不一定有面）
  for (let ny = 0.6; ny >= -0.4; ny -= 0.06) {
    for (let nx = -0.5; nx <= 0.5; nx += 0.06) {
      rc.setFromCamera(new THREE.Vector2(nx, ny), cam);
      const hits = rc.intersectObjects([g], true);
      if (hits.length) {
        return { x: (nx * 0.5 + 0.5) * w, y: (-ny * 0.5 + 0.5) * h };
      }
    }
  }
  return null;
}, [canvas.width, canvas.height]);

if (!px) throw new Error("在整个视口内都找不到模型表面");
const sx = canvas.x + px.x;
const sy = canvas.y + px.y;
console.log(`目标屏幕坐标 ${sx.toFixed(0)},${sy.toFixed(0)}`);
const ts = Date.now();
await page.mouse.move(sx, sy);
await page.mouse.down();
for (let i = 0; i < 16; i++) {
  await page.mouse.move(sx + Math.sin(i * 0.7) * 3, sy + Math.cos(i * 0.7) * 3);
  await page.waitForTimeout(70);
}
await page.mouse.up();
const sculptMs = Date.now() - ts;
await page.waitForTimeout(600);

const after = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const o = useApp.getState().objects.find((x) => x.kind === "model");
  const g = objectRegistry.get(o.id);
  let sum = 0;
  g.traverse((c) => {
    if (c.isMesh) {
      const a = c.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 97) sum += a[i];
    }
  });
  return sum;
});
console.log(`高面数模型雕刻：位置采样变化 ${Math.abs(after - before).toFixed(3)}，交互耗时 ${sculptMs}ms`);
await page.screenshot({ path: "test-artifacts/23-sculpted-model.png" });

/* 拉远看整体氛围 */
await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
await page.mouse.wheel(0, 320);
await page.waitForTimeout(900);
await page.screenshot({ path: "test-artifacts/24-zoomout.png" });

console.log("\n=== 控制台错误 ===");
console.log(errors.length ? errors.slice(0, 10).join("\n") : "(无)");
await browser.close();
process.exit(errors.length ? 1 : 0);
