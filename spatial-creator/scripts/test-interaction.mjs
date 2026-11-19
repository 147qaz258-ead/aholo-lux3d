/**
 * 交互功能验收测试（真实鼠标事件驱动，不 mock 内部函数）
 * 覆盖：基础几何体创建 / 空中绘制笔迹对象化 / 局部凹陷形变 / 抓取移动
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
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
};

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(800);
await page.getByRole("button", { name: "鼠标模式" }).click();
await page.waitForTimeout(1200);

/* ---------- 1. 基础几何体 ---------- */
await page.getByRole("button", { name: "球体" }).click();
await page.waitForTimeout(900);
let n = await page.evaluate(() => window.__spatial.useApp.getState().objects.length);
check("创建基础几何体", n === 1, `objects=${n}`);

/* 把球体摆到视口正前方，便于精确命中 */
await page.evaluate(() => {
  const s = window.__spatial.useApp.getState();
  const id = s.objects[0].id;
  s.setTransform(id, { position: [0, 0.75, 0], scale: [1, 1, 1] });
});
await page.waitForTimeout(500);
await page.screenshot({ path: "test-artifacts/10-sphere.png" });

/* ---------- 2. 空中绘制 ---------- */
await page.keyboard.press("2");
const canvas = await page.locator(".viewport canvas").boundingBox();
const cx = canvas.x + canvas.width * 0.36;
const cy = canvas.y + canvas.height * 0.5;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 0; i <= 24; i++) {
  const t = i / 24;
  await page.mouse.move(cx + t * 120, cy - Math.sin(t * Math.PI) * 110);
  await page.waitForTimeout(20);
}
await page.mouse.up();
await page.waitForTimeout(700);

const afterDraw = await page.evaluate(() => {
  const objs = window.__spatial.useApp.getState().objects;
  const stroke = objs.find((o) => o.kind === "stroke");
  return { total: objs.length, strokePoints: stroke?.points?.length || 0, hasMesh: !!stroke };
});
check("空中绘制造出独立笔迹对象", afterDraw.strokePoints >= 2, `points=${afterDraw.strokePoints}`);

/* ---------- 3. 局部凹陷形变 ---------- */
await page.keyboard.press("3");
await page.waitForTimeout(300);
const target = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const id = useApp.getState().objects.find((o) => o.kind === "primitive").id;
  const obj = objectRegistry.get(id);
  return { id, world: obj.position.toArray() };
});

// 用页面内 THREE 投影得到球心屏幕坐标
const screenPos = await page.evaluate(([x, y, z]) => {
  const cam = window.__three.camera;
  const vec = { x, y, z };
  const p = cam.position.clone().set(x, y, z).project(cam);
  return { x: (p.x * 0.5 + 0.5) * 100, y: (-p.y * 0.5 + 0.5) * 100 };
}, target.world);

const px = canvas.x + (canvas.width * screenPos.x) / 100;
const py = canvas.y + (canvas.height * screenPos.y) / 100;

const before = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const id = useApp.getState().objects.find((o) => o.kind === "primitive").id;
  const g = objectRegistry.get(id).children.find((c) => c.isMesh && c.geometry?.attributes?.position?.count > 100);
  const arr = g.geometry.attributes.position.array;
  let s = 0;
  for (let i = 0; i < arr.length; i += 3) s += Math.abs(arr[i]) + Math.abs(arr[i + 1]) + Math.abs(arr[i + 2]);
  return { sum: s, count: arr.length };
});

await page.mouse.move(px, py);
await page.mouse.down();
for (let i = 0; i < 18; i++) {
  await page.mouse.move(px + Math.sin(i) * 2, py + Math.cos(i) * 2);
  await page.waitForTimeout(70);
}
await page.mouse.up();
await page.waitForTimeout(500);

const after = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const id = useApp.getState().objects.find((o) => o.kind === "primitive").id;
  const g = objectRegistry.get(id).children.find((c) => c.isMesh && c.geometry?.attributes?.position?.count > 100);
  const arr = g.geometry.attributes.position.array;
  let s = 0;
  for (let i = 0; i < arr.length; i += 3) s += Math.abs(arr[i]) + Math.abs(arr[i + 1]) + Math.abs(arr[i + 2]);
  return { sum: s, count: arr.length };
});
const delta = Math.abs(after.sum - before.sum);
check("局部凹陷形变生效", delta > 0.05, `顶点位置总和变化 ${delta.toFixed(4)} (${before.count / 3} 顶点)`);

await page.screenshot({ path: "test-artifacts/11-sculpted.png" });

/* ---------- 4. 撤销形变 ---------- */
await page.keyboard.press("Control+z");
await page.waitForTimeout(500);
const undone = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const id = useApp.getState().objects.find((o) => o.kind === "primitive").id;
  const g = objectRegistry.get(id).children.find((c) => c.isMesh && c.geometry?.attributes?.position?.count > 100);
  const arr = g.geometry.attributes.position.array;
  let s = 0;
  for (let i = 0; i < arr.length; i += 3) s += Math.abs(arr[i]) + Math.abs(arr[i + 1]) + Math.abs(arr[i + 2]);
  return s;
});
check("撤销恢复原始几何", Math.abs(undone - before.sum) < 1e-3, `还原差 ${Math.abs(undone - before.sum).toFixed(6)}`);

/* ---------- 5. 抓取移动 ---------- */
await page.keyboard.press("1");
await page.waitForTimeout(300);
const posBefore = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const id = useApp.getState().objects.find((o) => o.kind === "primitive").id;
  return objectRegistry.get(id).position.toArray();
});
await page.mouse.move(px, py);
await page.mouse.down();
await page.mouse.move(px + 160, py - 60, { steps: 8 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(400);
const posAfter = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const id = useApp.getState().objects.find((o) => o.kind === "primitive").id;
  return { world: objectRegistry.get(id).position.toArray(), stored: useApp.getState().objects.find((o) => o.kind === "primitive").transform.position };
});
const moved = Math.hypot(posAfter.world[0] - posBefore[0], posAfter.world[1] - posBefore[1]);
check("捏合抓取并移动对象", moved > 0.05, `位移 ${moved.toFixed(3)} · 已写回状态 ${JSON.stringify(posAfter.stored.map((v) => +v.toFixed(2)))}`);

await page.screenshot({ path: "test-artifacts/12-final.png" });

console.log("\n=== 控制台错误 ===");
console.log(errors.length ? errors.slice(0, 10).join("\n") : "(无)");

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n结果：${results.length - failed}/${results.length} 通过`);
process.exit(failed || errors.length ? 1 : 0);
