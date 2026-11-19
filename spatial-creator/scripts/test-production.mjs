import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const pw = await import(pathToFileURL(process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js").href);
const browser = await (pw.chromium || pw.default.chromium).launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const errors = [], tests = [];
mkdirSync("test-artifacts/draft1", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(process.env.API_BASE || "http://127.0.0.1:8787", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "鼠标模式", exact: true }).click();
  assert.equal(await page.evaluate(() => Boolean(window.__spatial)), false);
  tests.push("production omits developer scene mutation hook");
  await page.getByRole("button", { name: "立方体", exact: true }).click();
  await page.getByRole("button", { name: /项目 ·/ }).click();
  const project = page.getByRole("dialog", { name: "项目管理" }); await project.waitFor();
  assert.match(await project.innerText(), /1 个对象/);
  await project.getByRole("button", { name: "保存到浏览器", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".project-status")?.textContent.includes("已保存"));
  await page.keyboard.press("Escape"); await project.waitFor({ state: "detached" });
  tests.push("production creates object and commits project through user controls");
  await page.keyboard.press("h"); await page.getByRole("dialog", { name: "操作指引" }).waitFor();
  await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "操作指引" }).waitFor({ state: "detached" });
  tests.push("production help and modal keyboard handling work");
  for (const height of [800,720]) {
    await page.setViewportSize({width:1280,height});
    const reachable=await page.evaluate(()=>Array.from(document.querySelectorAll(".rail .tool")).every(button=>{
      const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===button||button.contains(hit);
    }));
    assert.ok(reachable,`tool rail covered at 1280×${height}`);
  }
  tests.push("all four tools remain reachable at 1280x800 and 1280x720");
  await page.setViewportSize({width:1280,height:800});
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-artifacts/draft1/production-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(layout.document <= layout.viewport, `document overflow ${JSON.stringify(layout)}`);
  await page.getByRole("button", { name: /项目 ·/ }).click();
  await page.getByRole("dialog", { name: "项目管理" }).waitFor();
  await page.screenshot({ path: "test-artifacts/draft1/production-narrow.png" });
  tests.push("390px layout has no document overflow and project dialog remains reachable; desktop product only");
  assert.deepEqual(errors, []); tests.push("no production runtime errors");
  writeFileSync("test-artifacts/draft1/production.json", JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), passed: tests.length, tests, runtimeErrors: errors, note: "No camera or paid provider requests; narrow layout is a smoke check, not mobile certification" }, null, 2));
  console.log(`${tests.length}/${tests.length} production smoke groups passed`);
} finally { await browser.close(); }
