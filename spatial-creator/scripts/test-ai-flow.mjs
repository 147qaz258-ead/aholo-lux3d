/**
 * AI 生成全链路 UI 测试：输入提示词 → 提交 Lux3D → 轮询 → 下载 GLB → 进入场景
 * 这是唯一一条不能被 mock 的用户路径，耗时约 4–6 分钟。
 */
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PW = process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js";
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium || pw.default?.chromium;

const URL = process.env.APP_URL || "http://127.0.0.1:5173";
const PROMPT = process.env.PROMPT || "一只低多边形的发光水母，半透明质感";
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

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(800);
await page.getByRole("button", { name: "鼠标模式" }).click();
await page.waitForTimeout(800);

await page.locator(".ai-input").fill(PROMPT);
await page.evaluate(() => {
  const sel = document.querySelector(".ai-side select");
  sel.value = "cyberpunk";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.getByRole("button", { name: "文生 3D" }).click();
console.log("已提交任务，等待 Lux3D 返回…");

const t0 = Date.now();
let done = false;
for (let i = 0; i < 130; i++) {
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => {
    const s = window.__spatial.useApp.getState();
    const t = s.tasks[0];
    return {
      state: t?.state,
      msg: t?.message,
      models: s.objects.filter((o) => o.kind === "model").length,
      elapsed: Math.round((Date.now() - 0) / 1000),
    };
  });
  if (i % 5 === 0) console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s · ${st.state} · ${st.msg}`);
  if (st.state === "success" && st.models > 0) {
    done = true;
    break;
  }
  if (st.state === "failed") {
    console.log("❌ 任务失败:", st.msg);
    break;
  }
}

await page.waitForTimeout(5000);
await page.getByRole("button", { name: /文生 3D|x/ }).first().blur().catch(() => {});
await page.screenshot({ path: "test-artifacts/30-ai-result.png" });

const final = await page.evaluate(() => {
  const { useApp, objectRegistry } = window.__spatial;
  const s = useApp.getState();
  const m = s.objects.find((o) => o.kind === "model");
  let verts = 0;
  if (m) {
    const g = objectRegistry.get(m.id);
    g?.traverse((c) => c.isMesh && (verts += c.geometry.attributes.position.count));
  }
  return { task: s.tasks[0], objects: s.objects.length, verts, assets: s.assets.length };
});

console.log("\n=== 结果 ===");
console.log(JSON.stringify(final, null, 1));
console.log("控制台错误:", errors.length ? errors.slice(0, 6).join(" | ") : "(无)");
await browser.close();
process.exit(done && !errors.length ? 0 : 1);
