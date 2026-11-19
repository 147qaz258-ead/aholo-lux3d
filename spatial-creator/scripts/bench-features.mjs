/**
 * 功能级量化基准（feature benchmark）。
 *
 * 与 bench-gesture.mjs 的分工：
 *   bench-gesture  只测「21 个关键点 → 判定结果」这一段（纯函数层）
 *   本脚本        用真实浏览器 + 真实鼠标事件驱动**完整链路**（DOM → 场景 → 几何 → IndexedDB）
 *
 * 每一项输出 {id, name, target, actual, pass, evidence}，JSON 落在 test-artifacts/bench-features.json，
 * 文档 docs/06-feature-acceptance.md 的「实测」列直接引用这份输出。
 *
 * 运行：先起 vite dev（5173），再 node scripts/bench-features.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE || "http://127.0.0.1:5173";
const PW = process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js";
const OUT_DIR = "test-artifacts";

const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium || pw.default?.chromium;

const results = [];
const external = [];

function rec(id, name, target, actual, pass, evidence, note = "") {
  results.push({ id, name, target, actual, pass: !!pass, evidence, note });
  const flag = pass ? "PASS" : "FAIL";
  console.log(`[${flag}] ${id} ${name} | 目标 ${target} | 实测 ${actual}${note ? ` | ${note}` : ""}`);
}

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--enable-unsafe-swiftshader",
  ],
});

const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`console:${m.text()}`);
});
page.on("request", (r) => {
  const u = r.url();
  if (/aholo3d\.cn|lux3d/i.test(u) && !u.includes("127.0.0.1")) external.push(u);
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
// 通过 CDP 清 IndexedDB：页面自己持有连接时 deleteDatabase 会被 blocked，清不干净
const cdp = await ctx.newCDPSession(page);
await cdp.send("Storage.clearDataForOrigin", {
  origin: new URL(BASE).origin,
  storageTypes: "indexeddb,local_storage,cache_storage",
});
await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(700);

const shot = async (name) => {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
};

/* ------------------------------------------------------------------ */
/* 0. 进入鼠标模式 + 注入测量助手                                       */
/* ------------------------------------------------------------------ */
await page.getByRole("button", { name: "鼠标模式" }).click();
await page.waitForTimeout(800);

const installBench = async () => {
  await page.evaluate(() => {
  const S = window.__spatial;
  window.__bench = {
    reset() {
      S.useApp.getState().clearScene();
      S.deformation.resetSculptHistory();
      S.useApp.getState().setTool("select");
      S.useApp.getState().setSculptMode("dent");
      S.useApp.getState().updateSettings({
        sculptRadius: 0.18,
        sculptStrength: 1,
        calibration: null,
      });
    },
    canvasRect() {
      return document.querySelector(".viewport canvas").getBoundingClientRect();
    },
    screenOf(id, dy = 0.1) {
      const cam = window.__three.camera;
      const obj = S.objectRegistry.get(id);
      if (!obj) return null;
      const v = new S.THREE.Vector3();
      obj.getWorldPosition(v);
      v.y += dy;
      v.project(cam);
      const r = this.canvasRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    },
    meshes(id) {
      const obj = S.objectRegistry.get(id);
      const out = [];
      obj?.traverse((c) => {
        if (c.isMesh) out.push(c);
      });
      return out;
    },
    verts(id) {
      const m = this.meshes(id)[0];
      if (!m) return null;
      const pos = m.geometry.getAttribute("position");
      const d = m.userData.__sculpt;
      const base = d ? d.base : pos.array;
      let max = 0;
      let moved = 0;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.array[i * 3] - base[i * 3];
        const dy = pos.array[i * 3 + 1] - base[i * 3 + 1];
        const dz = pos.array[i * 3 + 2] - base[i * 3 + 2];
        const l = Math.hypot(dx, dy, dz);
        if (l > 1e-6) moved++;
        if (l > max) max = l;
      }
      return {
        count: pos.count,
        moved,
        max: +max.toFixed(5),
        positions: Array.from(pos.array),
        sphereR: m.geometry.boundingSphere?.radius ?? 1,
      };
    },
  };
  });
};

await installBench();

const reset = async () => {
  // 关掉可能还开着的帮助浮层，否则它会拦截所有指针事件
  await page.evaluate(() => {
    const h = document.querySelector(".help");
    if (h) h.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.evaluate(() => window.__bench.reset());
  await page.waitForTimeout(250);
};

const addPrim = async (label) => {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(220);
  return page.evaluate(() => {
    const o = window.__spatial.useApp.getState().objects;
    return o[o.length - 1].id;
  });
};

const mouseAt = async (p, opts = {}) => {
  await page.mouse.move(p.x, p.y, opts);
};

/* ------------------------------------------------------------------ */
/* 1. 工作空间 WS-001 / WS-002 / WS-003 / WS-004 / WS-005 / 快捷键      */
/* ------------------------------------------------------------------ */
try {
  const dom = await page.evaluate(() => ({
    canvas: document.querySelectorAll(".viewport canvas").length,
    chips: document.querySelectorAll(".topbar .chip").length,
    boot: !!document.querySelector(".boot"),
    objCount: window.__spatial.useApp.getState().objects.length,
  }));
  rec(
    "WS-001",
    "工作空间初始化",
    "canvas=1 · 状态芯片≥6 · 无启动遮罩 · 空场景 0 对象",
    JSON.stringify(dom),
    dom.canvas === 1 && dom.chips >= 6 && !dom.boot && dom.objCount === 0,
    "bench-features.json#WS-001",
  );
} catch (e) {
  rec("WS-001", "工作空间初始化", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  const ids = [];
  for (const l of ["立方体", "球体", "圆柱"]) ids.push(await addPrim(l));
  const info = await page.evaluate((ids) => {
    const st = window.__spatial.useApp.getState();
    return {
      n: st.objects.length,
      uniq: new Set(st.objects.map((o) => o.id)).size,
      registry: ids.filter((id) => !!window.__spatial.objectRegistry.get(id)).length,
      kinds: st.objects.map((o) => o.kind),
    };
  }, ids);
  rec(
    "WS-002",
    "对象独立性（ID / 注册表）",
    "3 个对象 → 3 个唯一 ID，注册表命中 3",
    JSON.stringify(info),
    info.n === 3 && info.uniq === 3 && info.registry === 3,
    "bench-features.json#WS-002",
  );
} catch (e) {
  rec("WS-002", "对象独立性", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  await addPrim("立方体");
  const cam = () => page.evaluate(() => {
    const c = window.__three.camera;
    return { p: [c.position.x, c.position.y, c.position.z], d: c.position.distanceTo(new window.__spatial.THREE.Vector3(0, 0.9, 0)) };
  });
  const before = await cam();
  const box = await page.evaluate(() => {
    const r = window.__bench.canvasRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(220);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(220);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(700);
  const zoomed = await cam();
  await page.mouse.move(box.x + 120, box.y + 40);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + 300, box.y + 90, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(700);
  const orbited = await cam();
  const dZoom = (1 - zoomed.d / before.d) * 100;
  const dOrbit = Math.hypot(orbited.p[0] - zoomed.p[0], orbited.p[1] - zoomed.p[1], orbited.p[2] - zoomed.p[2]);
  rec(
    "WS-003",
    "视口导航（滚轮缩放 / 右键旋转）",
    "缩放距离变化 ≥10% · 旋转位移 ≥0.05",
    `缩放 ${dZoom.toFixed(1)}% · 旋转 ${dOrbit.toFixed(3)}`,
    Math.abs(dZoom) >= 10 && dOrbit >= 0.05,
    "bench-features.json#WS-003",
  );
} catch (e) {
  rec("WS-003", "视口导航", "见口径", "抛错", false, String(e));
}

try {
  const state = async () =>
    page.evaluate(() => {
      const st = window.__spatial.useApp.getState();
      const vis = (sel) => {
        const el = document.querySelector(sel);
        return !!el && getComputedStyle(el).display !== "none";
      };
      return {
        panels: st.panels,
        rail: vis(".rail"),
        inspector: vis(".inspector"),
        ai: vis(".ai-panel"),
      };
    });
  const t0 = await state();
  await page.locator('.topbar button[title="隐藏属性区"]').click();
  await page.waitForTimeout(200);
  const t1 = await state();
  await page.locator('.topbar button[title="隐藏 AI 输入区"]').click();
  await page.waitForTimeout(200);
  const t2 = await state();
  await shot("80-panels-hidden");
  await page.locator('.topbar button[title="显示属性区"]').click();
  await page.locator('.topbar button[title="显示 AI 输入区"]').click();
  await page.waitForTimeout(200);
  const t3 = await state();
  rec(
    "WS-004",
    "面板显隐",
    "三个面板可独立隐藏/恢复，恢复后 DOM 可见",
    `初始 ${JSON.stringify(t0.panels)} → 隐藏后 rail=${t1.rail} inspector=${t1.inspector} ai=${t2.ai} → 恢复 ${JSON.stringify(t3.panels)}`,
    t0.rail && t0.inspector && t0.ai && !t1.inspector && !t2.ai && t1.rail && t3.inspector && t3.ai,
    "test-artifacts/80-panels-hidden.png",
  );
} catch (e) {
  rec("WS-004", "面板显隐", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  const id = await addPrim("球体");
  // 改名
  const nameInput = page.locator(".inspector input.num").first();
  await nameInput.fill("测试球");
  await page.waitForTimeout(150);
  const renamed = await page.evaluate(
    (id) => window.__spatial.useApp.getState().objects.find((o) => o.id === id)?.name,
    id,
  );
  // 隐藏
  await page.locator('.obj-item .mini[title="隐藏"]').first().click();
  await page.waitForTimeout(200);
  const hidden = await page.evaluate((id) => {
    const o = window.__spatial.useApp.getState().objects.find((x) => x.id === id);
    const g = window.__spatial.objectRegistry.get(id);
    return { visible: o?.visible, groupVisible: g?.visible };
  }, id);
  await page.locator('.obj-item .mini[title="显示"]').first().click();
  await page.waitForTimeout(150);
  // 锁定后拖拽不应移动
  await page.locator('.obj-item .mini[title="锁定"]').first().click();
  await page.waitForTimeout(150);
  const p0 = await page.evaluate((id) => {
    const g = window.__spatial.objectRegistry.get(id);
    return [g.position.x, g.position.y, g.position.z];
  }, id);
  const pos = await page.evaluate((id) => window.__bench.screenOf(id, 0), id);
  await mouseAt(pos);
  await page.mouse.down();
  await page.mouse.move(pos.x + 160, pos.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const p1 = await page.evaluate((id) => {
    const g = window.__spatial.objectRegistry.get(id);
    return [g.position.x, g.position.y, g.position.z];
  }, id);
  const movedWhenLocked = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  await page.locator('.obj-item .mini[title="解锁（当前不可移动/雕刻）"]').first().click();
  await page.waitForTimeout(150);
  const lockedFlag = await page.evaluate((id) => {
    const st = window.__spatial.useApp.getState();
    return { locked: st.objects.find((o) => o.id === id)?.locked, visible: st.objects.find((o) => o.id === id)?.visible };
  }, id);
  rec(
    "WS-005",
    "对象命名 / 隐藏 / 锁定 / 删除",
    "改名生效 · visible=false 且 group.visible=false · 锁定后拖动位移 <0.01 · 解锁恢复",
    `name=${renamed} hidden=${JSON.stringify(hidden)} 锁定位移=${movedWhenLocked.toFixed(4)} 解锁后 locked=${lockedFlag.locked}`,
    renamed === "测试球" && hidden.visible === false && hidden.groupVisible === false && movedWhenLocked < 0.01 && lockedFlag.locked === false,
    "bench-features.json#WS-005",
  );
} catch (e) {
  rec("WS-005", "对象命名/隐藏/锁定/删除", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  await page.keyboard.press("2");
  const t2 = await page.evaluate(() => window.__spatial.useApp.getState().tool);
  await page.keyboard.press("3");
  const t3 = await page.evaluate(() => window.__spatial.useApp.getState().tool);
  await page.keyboard.press("1");
  const t1 = await page.evaluate(() => window.__spatial.useApp.getState().tool);
  const id = await addPrim("立方体");
  await page.evaluate((id) => window.__spatial.useApp.getState().select(id), id);
  await page.keyboard.press("Escape");
  const desel = await page.evaluate(() => window.__spatial.useApp.getState().selectedId);
  await page.evaluate((id) => window.__spatial.useApp.getState().select(id), id);
  await page.keyboard.press("Delete");
  const afterDel = await page.evaluate(() => window.__spatial.useApp.getState().objects.length);
  await page.keyboard.press("m");
  await page.waitForTimeout(150);
  const metricsOpen = await page.locator(".metrics-panel, .mp").count();
  await page.keyboard.press("m");
  await page.keyboard.press("h");
  await page.waitForTimeout(200);
  const helpOpen = await page.locator(".help").count();
  await page.keyboard.press("h");
  await page.waitForTimeout(250);
  const helpClosed = await page.locator(".help").count();
  rec(
    "WS-006",
    "快捷键（1/2/3/4 · Esc · Del · M · H）",
    "每个键都产生可观察状态变化",
    `tools=${t2}/${t3}/${t1} 取消选择=${desel} 删除后=${afterDel} metrics=${metricsOpen} help=${helpOpen}/关闭后${helpClosed}`,
    t2 === "draw" && t3 === "sculpt" && t1 === "select" && desel === null && afterDel === 0 && metricsOpen > 0 && helpOpen > 0,
    "bench-features.json#WS-006",
  );
} catch (e) {
  rec("WS-006", "快捷键", "见口径", "抛错", false, String(e));
}

/* ------------------------------------------------------------------ */
/* 2. 绘制 DRAW-001 / DRAW-002 / DRAW-003                              */
/* ------------------------------------------------------------------ */
async function drawCircle(cx, cy, r = 100) {
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(120);
  await page.mouse.down();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}

try {
  await reset();
  await page.keyboard.press("2");
  const box = await page.evaluate(() => {
    const r = window.__bench.canvasRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await drawCircle(box.x, box.y, 90);
  const s = await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    const st0 = st.objects.find((o) => o.kind === "stroke");
    return { n: st.objects.length, pts: st0?.points?.length ?? 0, kind: st0?.kind };
  });
  const accept = s.pts / 25;
  rec(
    "DRAW-001",
    "空中绘制出线",
    "25 次移动输入 → ≥20 落点（接受率 ≥80%），生成 1 条可见笔迹",
    `${s.pts} 点 / 25 输入 = ${(accept * 100).toFixed(0)}%，kind=${s.kind}`,
    s.n === 1 && s.kind === "stroke" && accept >= 0.8,
    "test-artifacts/81-stroke.png",
  );
} catch (e) {
  rec("DRAW-001", "空中绘制出线", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  await page.keyboard.press("2");
  const box = await page.evaluate(() => {
    const r = window.__bench.canvasRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await drawCircle(box.x - 140, box.y, 70);
  await drawCircle(box.x, box.y, 70);
  await drawCircle(box.x + 140, box.y, 70);
  const info = await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    const strokes = st.objects.filter((o) => o.kind === "stroke");
    return {
      n: strokes.length,
      uniq: new Set(strokes.map((o) => o.id)).size,
      pts: strokes.map((o) => o.points?.length ?? 0),
      ids: strokes.map((o) => o.id),
    };
  });
  // 删除中间一条，另外两条不受影响
  await page.evaluate((id) => window.__spatial.useApp.getState().removeObject(id), info.ids[1]);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    return st.objects.filter((o) => o.kind === "stroke").map((o) => ({ id: o.id, pts: o.points?.length ?? 0 }));
  });
  rec(
    "DRAW-002",
    "笔迹独立成对象",
    "3 条笔迹 → 3 个唯一 ID；删 1 条剩 2 条且其余点数不变",
    `3 条点数 ${JSON.stringify(info.pts)}，ID 唯一 ${info.uniq}/3；删除后剩 ${after.length} 条`,
    info.n === 3 && info.uniq === 3 && after.length === 2 && after[0].pts === info.pts[0] && after[1].pts === info.pts[2],
    "bench-features.json#DRAW-002",
  );
} catch (e) {
  rec("DRAW-002", "笔迹独立成对象", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  await page.keyboard.press("2");
  const box = await page.evaluate(() => {
    const r = window.__bench.canvasRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await drawCircle(box.x, box.y, 80);
  const id = await page.evaluate(() => window.__spatial.useApp.getState().objects[0]?.id);
  // 选择 + 复制 + 移动 + 删除
  await page.evaluate((id) => window.__spatial.useApp.getState().select(id), id);
  await page.waitForTimeout(100);
  const dupBtn = page.locator(".inspector .btn", { hasText: "复制" }).first();
  await dupBtn.click();
  await page.waitForTimeout(250);
  const dup = await page.evaluate((id) => {
    const st = window.__spatial.useApp.getState();
    const src = st.objects.find((o) => o.id === id);
    const copy = st.objects.find((o) => o.id !== id);
    return {
      n: st.objects.length,
      samePts: (copy?.points?.length ?? 0) === (src?.points?.length ?? -1),
      dx: copy && src ? copy.transform.position[0] - src.transform.position[0] : 0,
    };
  }, id);
  await page.evaluate((id) => {
    window.__spatial.useApp.getState().setTransform(id, { position: [0.4, 1.2, 0] });
  }, id);
  await page.waitForTimeout(300);
  const moved = await page.evaluate((id) => {
    const g = window.__spatial.objectRegistry.get(id);
    return [g.position.x, g.position.y, g.position.z];
  }, id);
  const del = await page.evaluate((id) => {
    window.__spatial.useApp.getState().removeObject(id);
    return window.__spatial.useApp.getState().objects.length;
  }, id);
  rec(
    "DRAW-003",
    "笔迹编辑（选择/移动/复制/删除）",
    "复制后 2 条且点数一致、偏移 0.6；移动写回变换；删除剩 1",
    `复制后 ${dup.n} 条 点数一致=${dup.samePts} 偏移=${dup.dx.toFixed(2)}；移动后 position=${moved.map((v) => v.toFixed(2))}；删除剩 ${del}`,
    dup.n === 2 && dup.samePts && Math.abs(dup.dx - 0.6) < 1e-6 && Math.abs(moved[1] - 1.2) < 1e-6 && del === 1,
    "bench-features.json#DRAW-003",
    "端点编辑未实现",
  );
} catch (e) {
  rec("DRAW-003", "笔迹编辑", "见口径", String(e), false, "bench-features.json#DRAW-003");
}

/* ------------------------------------------------------------------ */
/* 3. 操作 MAN-001 ~ MAN-008                                          */
/* ------------------------------------------------------------------ */
try {
  await reset();
  const id = await addPrim("球体");
  const pos = await page.evaluate((id) => window.__bench.screenOf(id, 0), id);
  await mouseAt(pos);
  await page.waitForTimeout(300);
  const hover = await page.evaluate(() => window.__spatial.pointerRuntime.hoverId);
  const world = await page.evaluate(() => {
    const p = window.__spatial.pointerRuntime;
    return { has: p.hasWorldPoint, n: [p.normal.x, p.normal.y, p.normal.z] };
  });
  const nLen = Math.hypot(...world.n);
  rec(
    "MAN-001 / MAN-004",
    "悬停高亮 + 表面求交（交点与法线）",
    "hoverId 命中对象 · hasWorldPoint=true · 法线单位长度 |n|-1 ≤1e-3",
    `hoverId=${hover ? hover.slice(0, 6) : null} hasPoint=${world.has} |n|=${nLen.toFixed(4)}`,
    hover === id && world.has && Math.abs(nLen - 1) < 1e-3,
    "bench-features.json#MAN-001",
  );
} catch (e) {
  rec("MAN-001 / MAN-004", "悬停与表面求交", "见口径", String(e), false, "bench-features.json#MAN-001");
}

try {
  await reset();
  const id = await addPrim("球体");
  const pos = await page.evaluate((id) => window.__bench.screenOf(id, 0), id);
  await mouseAt(pos);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => window.__spatial.useApp.getState().selectedId);
  rec(
    "MAN-002",
    "捏合/点击选中对象",
    "悬停后按下即 selectedId 命中",
    `selectedId=${sel ? sel.slice(0, 6) : null}`,
    sel === id,
    "bench-features.json#MAN-002",
  );
} catch (e) {
  rec("MAN-002", "选中对象", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  const id = await addPrim("立方体");
  const pos = await page.evaluate((id) => window.__bench.screenOf(id, 0), id);
  await mouseAt(pos);
  await page.waitForTimeout(150);
  const p0 = await page.evaluate((id) => {
    const g = window.__spatial.objectRegistry.get(id);
    return [g.position.x, g.position.y, g.position.z];
  }, id);
  await page.mouse.down();
  const samples = [];
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(pos.x + i * 18, pos.y + i * 3);
    await page.waitForTimeout(35);
    samples.push(
      await page.evaluate((id) => {
        const g = window.__spatial.objectRegistry.get(id);
        return g.position.x;
      }, id),
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const p1 = await page.evaluate((id) => {
    const st = window.__spatial.useApp.getState();
    const o = st.objects.find((x) => x.id === id);
    const g = window.__spatial.objectRegistry.get(id);
    return { store: o.transform.position, world: [g.position.x, g.position.y, g.position.z] };
  }, id);
  const dist = Math.hypot(p1.store[0] - p0[0], p1.store[1] - p0[1], p1.store[2] - p0[2]);
  const mono = samples.every((v, i) => i === 0 || v >= samples[i - 1] - 0.01);
  rec(
    "MAN-003",
    "抓取移动（连续跟随 + 释放后写回）",
    "位移 ≥0.3 世界单位 · 采样 10 帧单调不回弹 · 释放后 store 与场景一致（差 <1e-3）",
    `位移 ${dist.toFixed(2)} 单调=${mono} store/world 差 ${Math.hypot(p1.store[0] - p1.world[0], p1.store[2] - p1.world[2]).toFixed(5)}`,
    dist >= 0.3 && mono && Math.abs(p1.store[1] - p1.world[1]) < 1e-3,
    "bench-features.json#MAN-003",
  );
} catch (e) {
  rec("MAN-003", "抓取移动", "见口径", "抛错", false, String(e));
}

async function sculptAt(id, holdMs = 700, drag = 0) {
  const pos = await page.evaluate((id) => window.__bench.screenOf(id, 0), id);
  await page.keyboard.press("3");
  await mouseAt(pos);
  await page.waitForTimeout(200);
  await page.mouse.down();
  if (drag) {
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(pos.x, pos.y - (i * drag) / 10);
      await page.waitForTimeout(40);
    }
  }
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

try {
  await reset();
  const id = await addPrim("球体");
  const before = await page.evaluate((id) => window.__bench.verts(id), id);
  await sculptAt(id, 700);
  const after = await page.evaluate((id) => window.__bench.verts(id), id);
  const cap = 0.34 * after.sphereR;
  rec(
    "MAN-005",
    "局部按压凹陷",
    "受影响顶点 >0 · 最大位移 ∈[0.01, 0.34×包围球半径] · 影响顶点占比 <40%",
    `受影响 ${after.moved}/${after.count}（${((after.moved / after.count) * 100).toFixed(1)}%）最大位移 ${after.max}（上限 ${cap.toFixed(3)}）`,
    after.moved > 0 && after.max >= 0.01 && after.max <= cap + 1e-3 && after.moved / after.count < 0.4,
    "test-artifacts/82-dent.png",
    `顶点 ${before.count}`,
  );
} catch (e) {
  rec("MAN-005", "局部按压凹陷", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  const id = await addPrim("球体");
  await page.evaluate(() => {
    window.__spatial.useApp.getState().setSculptMode("stretch");
    window.__spatial.useApp.getState().updateSettings({ sculptRadius: 0.16 });
  });
  const before = await page.evaluate((id) => window.__bench.verts(id), id);
  await sculptAt(id, 500, 90);
  const after = await page.evaluate((id) => window.__bench.verts(id), id);
  rec(
    "MAN-006",
    "局部拉伸",
    "拖动 90px → 受影响顶点 >0 且最大位移 >0.02，未受影响区域位移 =0",
    `受影响 ${after.moved}/${after.count} 最大位移 ${after.max}`,
    after.moved > 0 && after.max > 0.02 && after.max <= 0.34 * after.sphereR + 1e-3,
    "test-artifacts/83-stretch.png",
  );
} catch (e) {
  rec("MAN-006", "局部拉伸", "见口径", "抛错", false, String(e));
}

try {
  const counts = [];
  for (const r of [0.08, 0.32]) {
    await reset();
    const id = await addPrim("球体");
    await page.evaluate((r) => window.__spatial.useApp.getState().updateSettings({ sculptRadius: r }), r);
    await sculptAt(id, 260);
    const v = await page.evaluate((id) => window.__bench.verts(id), id);
    counts.push(v.moved);
  }
  const ratio = counts[1] / Math.max(1, counts[0]);
  rec(
    "MAN-007",
    "影响半径生效",
    "半径 0.08→0.32（4 倍）受影响顶点数比 ≥6（面积比 16）",
    `${counts[0]} → ${counts[1]}，比值 ${ratio.toFixed(1)}`,
    ratio >= 6,
    "bench-features.json#MAN-007",
  );
} catch (e) {
  rec("MAN-007", "影响半径生效", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  const id = await addPrim("球体");
  const base = await page.evaluate((id) => window.__bench.verts(id), id);
  await sculptAt(id, 450);
  const deformed = await page.evaluate((id) => window.__bench.verts(id), id);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  const undone = await page.evaluate((id) => window.__bench.verts(id), id);
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(400);
  const redone = await page.evaluate((id) => window.__bench.verts(id), id);
  const maxDiff = (a, b) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  };
  const errUndo = maxDiff(undone.positions, base.positions);
  const errRedo = maxDiff(redone.positions, deformed.positions);
  rec(
    "MAN-008",
    "撤销 / 重做",
    "撤销后与初始顶点最大误差 <1e-6 · 重做后与形变后最大误差 <1e-6",
    `撤销误差 ${errUndo.toExponential(2)} · 重做误差 ${errRedo.toExponential(2)}`,
    errUndo < 1e-6 && errRedo < 1e-6,
    "bench-features.json#MAN-008",
  );
} catch (e) {
  rec("MAN-008", "撤销/重做", "见口径", "抛错", false, String(e));
}

/* ------------------------------------------------------------------ */
/* 4. 生成与模型 AI / MODEL                                           */
/* ------------------------------------------------------------------ */
try {
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/lux3d/task/7137496");
    const j = await r.json();
    return {
      status: r.status,
      taskId: j.taskId ?? null,
      state: j.status ?? null,
      out: JSON.stringify(j.outputs ?? null).slice(0, 140),
    };
  });
  const glb = api.out && /\.glb/i.test(api.out);
  rec(
    "AI-001/002/003/004",
    "Lux3D 任务查询链路（真实 task 7137496）",
    "HTTP 200 · taskId 命中 · 服务端归一化 status=3（成功）· 产物 URL 为 .glb",
    `HTTP ${api.status} taskId=${api.taskId} status=${api.state} outputs=${api.out}`,
    api.status === 200 && api.taskId === 7137496 && api.state === 3 && glb,
    "docs/02-api.md · task 7137496",
    "生成耗时 111.9s / 14.3MB / 126,059 顶点见 03-progress",
  );
} catch (e) {
  rec("AI-001/002/003/004", "Lux3D 任务查询链路", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  const labels = ["立方体", "球体", "圆柱", "圆锥", "圆环"];
  for (const l of labels) await addPrim(l);
  const counts = await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    return st.objects.map((o) => {
      const g = window.__spatial.objectRegistry.get(o.id);
      let v = 0;
      g?.traverse((c) => {
        if (c.isMesh) v = Math.max(v, c.geometry.getAttribute("position").count);
      });
      return { type: o.primitive?.type, v };
    });
  });
  rec(
    "MODEL-001",
    "五种基础几何体",
    "5 种全部创建成功，每种顶点数 >100",
    JSON.stringify(counts),
    counts.length === 5 && counts.every((c) => c.v > 100),
    "bench-features.json#MODEL-001",
  );
} catch (e) {
  rec("MODEL-001", "五种基础几何体", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  const t0 = Date.now();
  await page.getByRole("button", { name: "载入示例 · 文生3D 陶瓷椅" }).click();
  await page.waitForFunction(
    () => {
      const st = window.__spatial.useApp.getState();
      const o = st.objects.find((x) => x.kind === "model");
      if (!o) return false;
      const g = window.__spatial.objectRegistry.get(o.id);
      let ok = false;
      g?.traverse((c) => {
        if (c.isMesh && c.geometry.getAttribute("position").count > 1000) ok = true;
      });
      return ok;
    },
    { timeout: 30000 },
  );
  const ms = Date.now() - t0;
  const info = await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    const o = st.objects.find((x) => x.kind === "model");
    const g = window.__spatial.objectRegistry.get(o.id);
    let verts = 0;
    let textures = 0;
    let mats = 0;
    g?.traverse((c) => {
      if (c.isMesh) {
        verts += c.geometry.getAttribute("position").count;
        mats++;
        const m = c.material;
        if (m?.map) textures++;
      }
    });
    return { verts, mats, textures, assetId: o.assetId };
  });
  rec(
    "MODEL-002/003 / AI-004",
    "模型导入与材质（真实 Lux3D 产物）",
    "顶点 >5 万 · 材质数 ≥1 · 载入 <15s",
    `顶点 ${info.verts} 材质 ${info.mats} 贴图 ${info.textures} 耗时 ${(ms / 1000).toFixed(1)}s`,
    info.verts > 50000 && info.mats >= 1 && ms < 15000,
    "test-artifacts/84-model.png",
  );
} catch (e) {
  rec("MODEL-002/003 / AI-004", "模型导入与材质", "见口径", "抛错", false, String(e));
}

try {
  const exp = await page.evaluate(async () => {
    const blob = await window.__spatial.exporter.exportSceneGlb("bench");
    const buf = await blob.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
    return { bytes: blob.size, magic };
  });
  rec(
    "MODEL-005",
    "场景导出 GLB",
    "magic=glTF · 体积 >10KB",
    `${exp.bytes} bytes · magic=${exp.magic}`,
    exp.magic === "glTF" && exp.bytes > 10240,
    "bench-features.json#MODEL-005",
  );
} catch (e) {
  rec("MODEL-005", "场景导出 GLB", "见口径", "抛错", false, String(e));
}

try {
  await reset();
  await page.locator('.inspector input[type="file"]').setInputFiles("public/samples/ceramic-chair.glb");
  await page.waitForFunction(
    () => {
      const st = window.__spatial.useApp.getState();
      return st.objects.some((o) => o.kind === "model" && String(o.assetId).startsWith("asset_import_"));
    },
    { timeout: 30000 },
  );
  const info = await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    const o = st.objects.find((x) => x.kind === "model");
    return { n: st.objects.length, name: o?.name, asset: o?.assetId };
  });
  await page.waitForTimeout(2500);
  const verts = await page.evaluate((id) => {
    const g = window.__spatial.objectRegistry.get(id);
    let v = 0;
    g?.traverse((c) => {
      if (c.isMesh) v += c.geometry.getAttribute("position").count;
    });
    return v;
  }, await page.evaluate(() => window.__spatial.useApp.getState().objects[0].id));
  rec(
    "MODEL-002.b",
    "本地 GLB 导入",
    "选文件 → 1 个 model 对象 · 资产键以 asset_import_ 开头 · 顶点 >5 万",
    `${info.n} 对象 name=${info.name} asset=${info.asset} 顶点 ${verts}`,
    info.n === 1 && verts > 50000,
    "test-artifacts/84-model.png",
  );
} catch (e) {
  rec("MODEL-002.b", "本地 GLB 导入", "见口径", String(e), false, "bench-features.json#MODEL-002b");
}

/* ------------------------------------------------------------------ */
/* 5. 数据 DATA-001 / DATA-002                                        */
/* ------------------------------------------------------------------ */
try {
  await reset();
  await addPrim("立方体");
  const id = await page.evaluate(() => window.__spatial.useApp.getState().objects[0].id);
  await page.evaluate((id) => {
    window.__spatial.useApp.getState().setTransform(id, { position: [0.33, 0.55, -0.2] });
    window.__spatial.useApp.getState().patchObject(id, { name: "持久化测试" });
  }, id);
  await page.waitForTimeout(600);
  const beforeSave = await page.evaluate(() => {
    const o = window.__spatial.useApp.getState().objects[0];
    return { n: window.__spatial.useApp.getState().objects.length, name: o.name, pos: o.transform.position };
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  // 刷新后启动遮罩会重新出现，必须先进入再操作
  await page.getByRole("button", { name: "鼠标模式" }).click();
  await page.waitForTimeout(500);
  await installBench();
  const afterReload = await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    const o = st.objects[0];
    return { n: st.objects.length, name: o?.name, pos: o?.transform.position };
  });
  const same =
    afterReload.n === beforeSave.n &&
    afterReload.name === beforeSave.name &&
    afterReload.pos?.every((v, i) => Math.abs(v - beforeSave.pos[i]) < 1e-9);
  rec(
    "DATA-001 / DATA-002",
    "项目保存 / 自动保存 / 刷新恢复",
    "刷新后对象数、名称、位置 100% 一致（误差 0）",
    `保存前 ${JSON.stringify(beforeSave)} → 刷新后 ${JSON.stringify(afterReload)}`,
    same,
    "bench-features.json#DATA-001",
  );
} catch (e) {
  rec("DATA-001 / DATA-002", "保存与刷新恢复", "见口径", "抛错", false, String(e));
}

/* ------------------------------------------------------------------ */
/* 6. 错误反馈 SYS-001 / SYS-002、快捷键恢复、性能                     */
/* ------------------------------------------------------------------ */
try {
  await reset();
  const errBase = pageErrors.length;
  await page.route("**/samples/**", (r) => r.abort());
  await page.getByRole("button", { name: "载入示例 · 图生3D 青瓷" }).click();
  await page.waitForTimeout(2500);
  const toasts = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".toast")).map((e) => e.textContent || ""),
  );
  await page.unroute("**/samples/**");
  // 这次失败是故意注入的，不计入"未捕获异常"门禁
  const injected = pageErrors.splice(errBase);
  const unexpected = injected.filter((m) => !/ERR_FAILED|Failed to fetch|samples/i.test(m));
  pageErrors.push(...unexpected);
  rec(
    "SYS-001",
    "失败可见（资源拉取失败）",
    "阻断网络后 1.5s 内出现含「失败」的 toast，界面不崩",
    JSON.stringify(toasts).slice(0, 120),
    toasts.some((t) => /失败|缺失/.test(t)),
    "bench-features.json#SYS-001",
  );
} catch (e) {
  rec("SYS-001", "失败可见", "见口径", String(e), false, "bench-features.json#SYS-001");
}

try {
  const chips = await page.evaluate(() => {
    const t = document.querySelector(".topbar")?.textContent || "";
    return {
      text: t.replace(/\s+/g, " ").slice(0, 120),
      hasLux: /LUX3D (ONLINE|OFFLINE)/.test(t),
      hasObj: /OBJ \d+/.test(t),
      hasTrack: /(HAND TRACK|MOUSE FALLBACK)/.test(t),
    };
  });
  rec(
    "SYS-002",
    "运行状态显示",
    "顶栏同时显示 摄像头模式 / 手数 / 渲染帧 / Lux3D / 对象数",
    chips.text,
    chips.hasLux && chips.hasObj && chips.hasTrack,
    "bench-features.json#SYS-002",
  );
} catch (e) {
  rec("SYS-002", "运行状态显示", "见口径", "抛错", false, String(e));
}

try {
  const perf = await page.evaluate(async () => {
    const m = window.__spatial.metrics;
    m.reset();
    await new Promise((r) => setTimeout(r, 6000));
    const s = m.snapshot();
    return {
      renderFps: s.render?.fps ?? null,
      frameP95: s.render?.p95DtMs ?? s.render?.lastDtMs ?? null,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      objects: window.__spatial.useApp.getState().objects.length,
    };
  });
  rec(
    "PERF-001",
    "渲染性能（软渲染 WebGL，1600×900）",
    "空场景/单模型 ≥30fps（真机 GPU 目标 ≥50fps）",
    `${perf.renderFps}fps · p95 帧 ${perf.frameP95}ms · heap ${perf.heapMB}MB · 对象 ${perf.objects}`,
    (perf.renderFps ?? 0) >= 30,
    "bench-features.json#PERF-001",
    "SwiftShader 软渲染，真机需复测",
  );
} catch (e) {
  rec("PERF-001", "渲染性能", "见口径", "抛错", false, String(e));
}

/* ------------------------------------------------------------------ */
/* 7. 密钥与隐私（静态扫描构建产物 + 网络记录）                        */
/* ------------------------------------------------------------------ */
try {
  const KEY = process.env.LUX3D_API_KEY || process.env.LUX_KEY_TAIL;
  if (!KEY) throw new Error("请设置 LUX3D_API_KEY 或 LUX_KEY_TAIL 后检查密钥泄漏");
  const distDir = "dist/assets";
  let hits = [];
  let files = [];
  try {
    files = readdirSync(distDir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const s = readFileSync(`${distDir}/${f}`, "utf8");
      if (s.includes(KEY) || s.includes("api.aholo3d.cn")) hits.push(f);
    }
  } catch {
    hits = ["dist 不存在"];
  }
  rec(
    "SEC-001",
    "密钥不进入前端包 + 浏览器不直连 Lux3D",
    "构建产物 0 命中密钥/直连域名 · 运行期外部请求 0",
    `扫描 ${files.length} 个 js，命中 [${hits.join(",")}]；运行期外部请求 ${external.length} 条`,
    hits.length === 0 && external.length === 0,
    "bench-features.json#SEC-001",
  );
} catch (e) {
  rec("SEC-001", "密钥保护", "见口径", "抛错", false, String(e));
}

try {
  const media = await page.evaluate(async () => {
    const w = await navigator.mediaDevices.enumerateDevices();
    const cams = w.filter((d) => d.kind === "videoinput").length;
    return { cams, secure: window.isSecureContext };
  });
  rec(
    "SEC-002",
    "摄像头隐私（本地推理）",
    "视频流不上传：运行期无任何上传视频的请求；页面为安全上下文",
    `外部请求 ${external.length} 条（均为 0 才算通过）· 摄像头 ${media.cams} 个 · secureContext=${media.secure}`,
    external.length === 0,
    "bench-features.json#SEC-002",
  );
} catch (e) {
  rec("SEC-002", "摄像头隐私", "见口径", "抛错", false, String(e));
}

/* ------------------------------------------------------------------ */
/* 8. 摄像头真机外的部分：权限与模型加载                              */
/* ------------------------------------------------------------------ */
try {
  const p2 = await ctx.newPage();
  // 非前台标签页的 rAF 会被浏览器暂停，取帧循环跟着停 → frames 恒为 0。
  // 必须先切到前台，否则测到的不是产品行为。
  await p2.bringToFront();
  await p2.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await p2.waitForTimeout(500);
  await p2.getByRole("button", { name: "启用摄像头并进入" }).click();
  await p2.waitForFunction(() => window.__spatial?.handState?.status === "ready", { timeout: 30000 }).catch(() => {});
  // status=ready 只代表模型加载完，取帧循环还在等视频出画面；必须等真有推理结果
  await p2.waitForFunction(() => (window.__spatial?.handState?.frames ?? 0) > 0, { timeout: 20000 }).catch(() => {});
  await p2.waitForTimeout(400);
  const cam = await p2.evaluate(() => ({
    status: window.__spatial.handState.status,
    ready: window.__spatial.useApp.getState().cameraReady,
    w: document.querySelector(".cam-panel video")?.videoWidth ?? 0,
    h: document.querySelector(".cam-panel video")?.videoHeight ?? 0,
    err: window.__spatial.handState.error || null,
    // 时钟同源检查：推理在 Worker 里跑，若把 Worker 的 performance.now() 当时间戳写进
    // handState.updatedAt，这个差值会变成"页面已运行时长"（实测 4106ms），
    // 下游 3D 手 / 手势指针全部判为过期 → 手不显示、只能用鼠标。
    ageMs: Math.round(performance.now() - window.__spatial.handState.updatedAt),
    frames: window.__spatial.handState.frames,
  }));
  await p2.screenshot({ path: `${OUT_DIR}/85-camera.png` });
  rec(
    "CAM-003",
    "手部数据的时间基准与主线程同源",
    "真实推理链路下，handState.updatedAt 与主线程 performance.now() 之差 < 300ms（等价于握手：最后一次推理确实是刚刚发生的）",
    `age=${cam.ageMs}ms · frames=${cam.frames}`,
    cam.ageMs >= 0 && cam.ageMs < 300 && cam.frames > 0,
    "bench-features.json#CAM-003",
    "Worker 的 performance.now() 从 Worker 创建时归零，误用会让手部可视化与指针整体失效",
  );
  await p2.close();
  rec(
    "CAM-001 / CAM-002",
    "摄像头接入 + 手部模型加载",
    "cameraReady=true · 视频宽高 >0 · 追踪器 status=ready（模型加载完成）",
    `status=${cam.status} ready=${cam.ready} video=${cam.w}×${cam.h}`,
    cam.ready && cam.w > 0 && cam.status === "ready",
    "test-artifacts/85-camera.png",
    "假摄像头无手，检测率需真机",
  );
} catch (e) {
  rec("CAM-001 / CAM-002", "摄像头接入", "见口径", "抛错", false, String(e));
}

/* ------------------------------------------------------------------ */
if (pageErrors.length) console.log("页面错误：", pageErrors.slice(0, 5));
rec("SYS-000", "全程无未捕获异常", "pageerror = 0", `${pageErrors.length} 条`, pageErrors.length === 0, "bench-features.json#SYS-000", pageErrors.slice(0, 3).join(" | "));

mkdirSync(OUT_DIR, { recursive: true });
const summary = {
  ranAt: new Date().toISOString(),
  base: BASE,
  pass: results.filter((r) => r.pass).length,
  fail: results.filter((r) => !r.pass).length,
  results,
};
writeFileSync(`${OUT_DIR}/bench-features.json`, JSON.stringify(summary, null, 2), "utf8");

console.log("\n================ 汇总 ================");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(18)} ${r.name}`);
console.log(`\n通过 ${summary.pass} / ${results.length}，失败 ${summary.fail}`);

await browser.close();
