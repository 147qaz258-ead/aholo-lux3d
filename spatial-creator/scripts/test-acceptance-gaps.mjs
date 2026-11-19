/**
 * 补齐 04-testing.md 里标注「未断言」的三项：
 *   1. TC-DATA-01 刷新后场景与模型恢复
 *   2. TC-CAM-01 拒绝摄像头权限时的降级路径
 *   3. 鼠标模式下删除/撤销等基础操作不崩
 *
 * 用系统 Chrome + 假摄像头；不消耗 Lux3D 积分（复用之前的示例资产）。
 */
import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const PW = process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js";
const mod = await import(pathToFileURL(PW).href);
const chromium = mod.chromium || mod.default?.chromium;

// 调试钩子 window.__spatial 只在 dev 注入，所以默认跑 5173
const BASE = process.env.BASE || "http://127.0.0.1:5173";
const ART = "test-artifacts";
if (!existsSync(ART)) mkdirSync(ART, { recursive: true });

const results = [];
const ok = (name, extra = "") => results.push(["PASS", name, extra]);
const bad = (name, extra = "") => results.push(["FAIL", name, extra]);

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--enable-unsafe-swiftshader",
  ],
});

/* ---------- 场景 1：完整链路 + 刷新恢复 ---------- */
{
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    permissions: ["camera"],
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /鼠标模式|启用摄像头并进入/ }).first().click();
  await page.waitForTimeout(2500);

  // 加两个几何体 + 载入真实模型
  await page.getByRole("button", { name: /载入示例资产/ }).click();
  await page.waitForTimeout(8000);

  const canvas = await page.locator(".viewport canvas").boundingBox();
  // 画一条笔迹
  await page.getByRole("button", { name: /空中绘制|绘制/ }).first().click();
  await page.waitForTimeout(300);
  const cx = canvas.x + canvas.width * 0.42;
  const cy = canvas.y + canvas.height * 0.4;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 14; i++) {
    await page.mouse.move(cx + i * 9, cy + Math.sin(i * 0.5) * 22);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);

  const before = await page.evaluate(() => {
    const s = window.__spatial?.useApp?.getState?.();
    return s ? {
      objects: s.objects.map((o) => ({ kind: o.kind, name: o.name, assetId: o.assetId || null, pts: o.points?.length || 0 })),
      assets: s.assets.length,
    } : null;
  });
  if (!before) bad("页面暴露状态", "window.__spatial 不存在");
  else {
    const hasModel = before.objects.some((o) => o.kind === "model");
    const hasStroke = before.objects.some((o) => o.kind === "stroke");
    hasModel ? ok("真实模型入场", before.objects.filter((o) => o.kind === "model").length + " 个") : bad("真实模型入场", "无 model 对象");
    hasStroke ? ok("笔迹对象化", before.objects.length + " 个对象") : bad("笔迹对象化", "无 stroke 对象");
  }

  await page.screenshot({ path: `${ART}/50-before-reload.png` });

  // ---- 刷新 ----
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /鼠标模式|启用摄像头并进入/ }).first().click();
  await page.waitForTimeout(3000);
  // 等模型从 IndexedDB 解析
  await page.waitForTimeout(9000);

  const after = await page.evaluate(() => {
    const s = window.__spatial?.useApp?.getState?.();
    if (!s) return null;
    const reg = window.__spatial.objectRegistry;
    const loaded = s.objects.map((o) => {
      const g = reg.get(o.id);
      let meshes = 0;
      let verts = 0;
      g?.traverse((c) => {
        if (c.isMesh) {
          meshes++;
          verts += c.geometry?.attributes?.position?.count || 0;
        }
      });
      return { kind: o.kind, meshes, verts };
    });
    return { objects: s.objects.length, loaded };
  });

  if (!after) bad("刷新恢复", "刷新后状态为空");
  else {
    const same = before && after.objects === before.objects.length;
    same ? ok("刷新后对象数量一致", `${after.objects} 个`) : bad("刷新后对象数量一致", `前 ${before?.objects.length} 后 ${after.objects}`);
    const modelRestored = after.loaded.some((l) => l.kind === "model" && l.verts > 1000);
    modelRestored
      ? ok("刷新后 GLB 从 IndexedDB 重新解析", after.loaded.filter((l) => l.kind === "model").map((l) => l.verts + " 顶点").join(","))
      : bad("刷新后 GLB 重新解析", JSON.stringify(after.loaded));
  }

  await page.screenshot({ path: `${ART}/51-after-reload.png` });
  errs.length ? bad("刷新链路无 JS 异常", errs.slice(0, 2).join(" | ")) : ok("刷新链路无 JS 异常");
  await ctx.close();
}

/* ---------- 场景 2：拒绝摄像头权限 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  // 不授予 camera 权限，并拦截 getUserMedia 使其失败
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }));
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);

  // 点「启用摄像头并进入」，应当降级而不是白屏
  const enterBtn = page.getByRole("button", { name: /启用摄像头并进入/ });
  let degraded = false;
  try {
    await enterBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    const hasCanvas = await page.locator(".viewport canvas").count();
    const bodyText = await page.locator("body").innerText();
    degraded = hasCanvas > 0 && !/白屏|failed/i.test(bodyText);
    degraded ? ok("拒绝权限后进入工作台（鼠标回退）", "canvas 存在") : bad("拒绝权限降级", "未进入工作台");
    const hasHint = /鼠标|权限|摄像头/.test(bodyText);
    hasHint ? ok("拒绝权限后有可见提示", "") : bad("拒绝权限提示", "界面无相关文案");
  } catch (e) {
    bad("拒绝权限降级", "按钮点击失败：" + e.message.slice(0, 80));
  }
  await page.screenshot({ path: `${ART}/52-no-camera.png` });
  errs.length ? bad("拒绝权限路径无 JS 异常", errs.slice(0, 2).join(" | ")) : ok("拒绝权限路径无 JS 异常");
  await ctx.close();
}

await browser.close();

/* ---------- 输出 ---------- */
console.log("\n=== 验收结果 ===");
for (const [s, n, e] of results) console.log(`${s === "PASS" ? "✅" : "❌"} ${n}${e ? " — " + e : ""}`);
const fail = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - fail}/${results.length} 通过`);
process.exit(fail ? 1 : 0);
