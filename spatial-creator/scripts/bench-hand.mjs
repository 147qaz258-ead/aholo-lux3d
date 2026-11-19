/**
 * 手势交互层基准：验证"不碰鼠标能不能用"。
 *
 * 覆盖三件事：
 *  1) 五指可视化——每根手指伸展时，姿态回显是否对得上
 *  2) 手势点击 UI——手移到按钮上捏合，是否真的触发；误触率多少
 *  3) 纯手势闭环——从空场景到画出 1 条线，全程不碰鼠标要多久
 *
 * 依赖 dev(5173) + api(8787)，通过 window.__spatial 注入合成手。
 * 输出 test-artifacts/bench-hand.json
 */
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

const PW = process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js";
const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium || pw.default?.chromium;

const BASE = process.env.BASE || "http://127.0.0.1:5173";
const out = { ranAt: new Date().toISOString(), cases: [], checks: [] };

function rec(id, name, want, actual, ok, evidence = "") {
  out.cases.push({ id, name, want, actual, ok, evidence });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${id} ${name} :: ${actual}`);
}

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(700);
await page.getByRole("button", { name: "鼠标模式" }).click();
await page.waitForTimeout(900);

/* ---------------- 合成手注入 ---------------- */
await page.evaluate(() => {
  const S = window.__spatial;
  const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];

  const build = (cx, cy, pinched, onList) => {
    // 必须用 canvas 的矩形换算：顶栏占了 54px，用 innerHeight 会系统性偏移
    const cv = document.querySelector(".viewport canvas").getBoundingClientRect();
    const tx = (cx - cv.left) / cv.width;
    const ty = (cy - cv.top) / cv.height;
    const pts = [];
    const P = (dx, dy, dz = 0) => pts.push({ x: tx + dx, y: ty + dy, z: dz });
    P(-0.055, 0.27, 0.01);
    P(-0.095, 0.205, 0.005); P(-0.125, 0.165, 0); P(-0.148, 0.135, -0.005); P(-0.158, 0.118, -0.01);
    P(-0.032, 0.155, 0); P(-0.03, 0.088, -0.005); P(-0.018, 0.042, -0.008); P(0, 0, -0.012);
    P(0.012, 0.148, 0.004); P(0.014, 0.072, 0.002); P(0.014, 0.018, 0); P(0.014, -0.035, -0.004);
    P(0.05, 0.158, 0.008); P(0.055, 0.086, 0.01); P(0.057, 0.036, 0.012); P(0.06, -0.006, 0.014);
    P(0.085, 0.185, 0.012); P(0.095, 0.128, 0.016); P(0.1, 0.088, 0.02); P(0.105, 0.058, 0.024);
    const extended = { thumb: false, index: false, middle: false, ring: false, pinky: false };
    for (const k of onList) extended[k] = true;
    const count = onList.length;
    S.handState.status = "ready";
    S.handState.primary = {
      id: 0,
      handedness: "Right",
      screen: pts,
      raw: pts,
      world: pts,
      view: { x: tx, y: ty },
      ndc: { x: tx * 2 - 1, y: -(ty * 2 - 1) },
      pinch: pinched ? 0.93 : 0.14,
      pinched,
      palm: 0.165,
      fingers: {
        ratio: { thumb: 0.8, index: 0.9, middle: 0.9, ring: 0.88, pinky: 0.8 },
        extended,
        count,
      },
    };
    S.handState.hands = [S.handState.primary];
    S.handState.gesture = pinched ? "pinch" : count >= 4 ? "open" : count === 0 ? "fist" : "spread";
    S.handState.updatedAt = performance.now();
    return FINGERS;
  };

  window.__hand = {
    at(x, y, pinched = false, onList = ["thumb", "index", "middle", "ring", "pinky"]) {
      window.__last = { x, y, pinched, onList };
      build(x, y, pinched, onList);
    },
    start() {
      if (window.__handTimer) clearInterval(window.__handTimer);
      window.__handTimer = setInterval(() => {
        const l = window.__last || { x: 800, y: 400, pinched: false, onList: [] };
        build(l.x, l.y, l.pinched, l.onList);
      }, 16);
    },
    set(pinched) {
      window.__last.pinched = pinched;
    },
    move(x, y) {
      window.__last.x = x;
      window.__last.y = y;
    },
    stop() {
      clearInterval(window.__handTimer);
      window.__handTimer = null;
      window.__spatial.handState.primary = null;
      window.__spatial.handState.hands = [];
      window.__spatial.handState.status = "idle";
      window.__spatial.handState.gesture = "none";
    },
  };
});

const W = 1600;
const H = 900;
const CX = W / 2;
const CY = H / 2;

/* ---------------- S1 五指可视化 ---------------- */
try {
  await page.evaluate(() => {
    window.__hand.at(800, 450, false, ["thumb", "index", "middle", "ring", "pinky"]);
    window.__hand.start();
  });
  await page.waitForTimeout(320);

  const poses = [
    { on: [], tag: "0 指" },
    { on: ["index"], tag: "1 指" },
    { on: ["index", "middle"], tag: "2 指" },
    { on: ["thumb", "index", "middle", "ring"], tag: "4 指" },
    { on: ["thumb", "index", "middle", "ring", "pinky"], tag: "5 指" },
  ];
  const rows = [];
  for (const p of poses) {
    await page.evaluate((on) => window.__hand.at(window.__last.x, window.__last.y, false, on), p.on);
    await page.waitForTimeout(260);
    const got = await page.evaluate(() => ({
      count: document.querySelector(".cp-count")?.textContent?.trim(),
      lit: Array.from(document.querySelectorAll(".cp-finger")).map((e) => e.classList.contains("on")),
    }));
    const litCount = got.lit.filter(Boolean).length;
    rows.push({ pose: p.tag, want: p.on.length, uiCount: got.count, litCount, match: litCount === p.on.length });
  }
  const okRows = rows.filter((r) => r.match).length;
  rec(
    "IU-001",
    "五指可视化与姿态同步",
    "5 种姿态的亮灯数与手指数一致",
    `${okRows}/${rows.length} 一致（${rows.map((r) => `${r.pose}→${r.litCount}`).join(" ")}）`,
    okRows === rows.length,
    "test-artifacts/92-fingers.png",
  );
  out.fingerRows = rows;
  await page.screenshot({ path: "test-artifacts/92-fingers.png" });
} catch (e) {
  rec("IU-001", "五指可视化与姿态同步", "见口径", String(e), false);
}

/* ---------------- S2 手势点击 UI ---------------- */
const targets = [
  { label: "选择", check: () => window.__spatial.useApp.getState().tool === "select", nameBtn: "选择" },
  { label: "绘制", check: () => window.__spatial.useApp.getState().tool === "draw", nameBtn: "绘制" },
  { label: "雕刻", check: () => window.__spatial.useApp.getState().tool === "sculpt", nameBtn: "雕刻" },
  { label: "生成", check: () => window.__spatial.useApp.getState().tool === "ai", nameBtn: "生成" },
];

try {
  const results = [];
  for (const t of targets) {
    await page.evaluate(() => window.__spatial.useApp.getState().setTool("select"));
    await page.waitForTimeout(120);
    const box = await page.getByRole("button", { name: t.nameBtn, exact: true }).first().boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(([px, py]) => window.__hand.at(px, py, false), [x, y]);
    await page.waitForTimeout(300);
    const hover = await page.evaluate(() => window.__spatial.uiPointer.overUi && document.querySelectorAll(".hand-hover").length > 0);
    const t0 = Date.now();
    await page.evaluate(() => window.__hand.set(true));
    await page.waitForTimeout(90);
    const hit = await page.evaluate(t.check);
    await page.evaluate(() => window.__hand.set(false));
    await page.waitForTimeout(400);
    results.push({ tool: t.label, hover, hit, ms: Date.now() - t0 });
  }
  const okCount = results.filter((r) => r.hit).length;
  rec(
    "IU-002",
    "手势点击工具栏",
    "4/4 切换成功，悬停高亮可见",
    `${okCount}/4 切换成功，悬停高亮 ${results.filter((r) => r.hover).length}/4`,
    okCount === 4,
    "test-artifacts/93-click-tool.png",
  );
  out.clickResults = results;
} catch (e) {
  rec("IU-002", "手势点击工具栏", "见口径", String(e), false);
}

/* ---------------- S3 防误触：路过按钮不停留就捏 ---------------- */
try {
  await page.evaluate(() => {
    window.__spatial.useApp.getState().setTool("select");
    window.__spatial.uiPointer.clicks = 0;
  });
  const boxes = [];
  for (const n of ["选择", "绘制", "雕刻", "生成"]) {
    const b = await page.getByRole("button", { name: n, exact: true }).first().boundingBox();
    boxes.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  for (let i = 0; i < 16; i++) {
    const b = boxes[i % boxes.length];
    await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [b.x, b.y]);
    await page.waitForTimeout(60);
    await page.evaluate(() => window.__hand.set(true));
    await page.waitForTimeout(60);
    await page.evaluate(() => window.__hand.set(false));
    await page.waitForTimeout(40);
  }
  const clicks = await page.evaluate(() => window.__spatial.uiPointer.clicks);
  rec(
    "IU-003",
    "路过式误触",
    "16 次快速掠过并捏合，误触发 ≤1",
    `${clicks} 次`,
    clicks <= 1,
  );
  out.falseTrigger = clicks;
} catch (e) {
  rec("IU-003", "路过式误触", "见口径", String(e), false);
}

/* ---------------- S4 纯手势闭环：不碰鼠标画一条线 ---------------- */
try {
  await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    st.clearScene();
    st.setTool("select");
  });
  await page.waitForTimeout(200);
  const t0 = Date.now();
  // 第一步：手移到「绘制」
  const db = await page.getByRole("button", { name: "绘制", exact: true }).first().boundingBox();
  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [db.x + db.width / 2, db.y + db.height / 2]);
  await page.waitForTimeout(280);
  await page.evaluate(() => window.__hand.set(true));
  await page.waitForTimeout(90);
  await page.evaluate(() => window.__hand.set(false));
  const toolOk = await page.evaluate(() => window.__spatial.useApp.getState().tool === "draw");
  await page.waitForTimeout(200);
  // 第二步：手移到画布中央画一笔
  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [CX, CY]);
  await page.waitForTimeout(260);
  await page.evaluate(() => window.__hand.set(true));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    await page.evaluate(([x, y]) => window.__hand.move(x, y), [CX + Math.cos(a) * 130, CY + Math.sin(a) * 100]);
    await page.waitForTimeout(42);
  }
  await page.evaluate(() => window.__hand.set(false));
  await page.waitForTimeout(350);
  const sec = (Date.now() - t0) / 1000;
  const res = await page.evaluate(() => {
    const objs = window.__spatial.useApp.getState().objects;
    const s = objs.find((o) => o.kind === "stroke");
    return { strokes: objs.filter((o) => o.kind === "stroke").length, pts: s?.points?.length ?? 0 };
  });
  rec(
    "IU-004",
    "纯手势闭环（切工具→画线）",
    "全程不碰鼠标，≤15s 内产出 1 条笔迹且 ≥8 点",
    `工具切换 ${toolOk ? "成功" : "失败"}，笔迹 ${res.strokes} 条 / ${res.pts} 点，耗时 ${sec.toFixed(1)}s`,
    toolOk && res.strokes === 1 && res.pts >= 8 && sec <= 15,
    "test-artifacts/94-pure-hand.png",
  );
  out.pureHand = { sec: +sec.toFixed(1), ...res, toolOk };
  await page.screenshot({ path: "test-artifacts/94-pure-hand.png" });
} catch (e) {
  rec("IU-004", "纯手势闭环（切工具→画线）", "见口径", String(e), false);
}

/* ---------------- S5 指针跟随覆盖整个场景区 ---------------- */
try {
  const pts = [
    { x: 240, y: 160, tag: "左上" },
    { x: 1360, y: 160, tag: "右上" },
    { x: 1360, y: 760, tag: "右下" },
    { x: 240, y: 760, tag: "左下" },
  ];
  const rows = [];
  for (const p of pts) {
    await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [p.x, p.y]);
    await page.waitForTimeout(180);
    const got = await page.evaluate(() => {
      const c = document.querySelector(".hand-cursor");
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    rows.push({ tag: p.tag, want: `${p.x},${p.y}`, got: `${got.x},${got.y}`, ok: Math.abs(got.x - p.x) <= 6 && Math.abs(got.y - p.y) <= 6 });
  }
  const okRows = rows.filter((r) => r.ok).length;
  rec("IU-005", "指针覆盖四角", "四角坐标误差 ≤6px", `${okRows}/4 命中（${rows.map((r) => r.tag + ":" + r.got).join(" ")}）`, okRows === 4);
  out.corners = rows;
} catch (e) {
  rec("IU-005", "指针覆盖四角", "见口径", String(e), false);
}

/* ---------------- S7 全 UI 可达：每个可见按钮手都能指到 ---------------- */
try {
  const btns = await page.evaluate(() => {
    // 只统计"此刻真的可见且可用"的按钮：禁用态（如未开摄像头时的校准）
    // 和滚出面板可视区的按钮不属于手势可达性问题
    const list = Array.from(document.querySelectorAll("button")).filter((b) => {
      const r = b.getBoundingClientRect();
      const visible = r.width > 8 && r.height > 8 && r.top >= 0 && r.bottom <= window.innerHeight;
      return visible && !b.disabled && getComputedStyle(b).visibility !== "hidden";
    });
    return list.map((b) => {
      const r = b.getBoundingClientRect();
      return {
        label: (b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || "").trim().slice(0, 14),
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
      };
    });
  });
  let reach = 0;
  const miss = [];
  for (const b of btns) {
    await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [b.x, b.y]);
    await page.waitForTimeout(70);
    const ok = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const t = el?.closest("button");
      return Boolean(t) && window.__spatial.uiPointer.overUi;
    }, [b.x, b.y]);
    if (ok) reach++;
    else miss.push(b.label);
  }
  rec(
    "IU-007",
    "全 UI 可达性",
    "所有可见按钮 100% 可被手势指到",
    `${reach}/${btns.length} 可达${miss.length ? "，漏 " + miss.slice(0, 5).join("/") : ""}`,
    reach === btns.length && btns.length >= 10,
  );
  out.reach = { total: btns.length, ok: reach, miss };
} catch (e) {
  rec("IU-007", "全 UI 可达性", "见口径", String(e), false);
}

/* ---------------- S8 行内小图标：18px 的眼睛/锁/垃圾桶 ---------------- */
try {
  await page.evaluate(() => {
    const st = window.__spatial.useApp.getState();
    st.clearScene();
    st.setTool("select");
  });
  await page.waitForTimeout(150);
  // 造一个对象，才能出现行内图标（这里用鼠标点，只为准备场景，不参与本项判定）
  await page.getByRole("button", { name: "球体", exact: true }).first().click();
  await page.waitForTimeout(250);

  const iconAt = (idx) =>
    page.evaluate((i) => {
      const el = document.querySelectorAll(".obj-item .mini")[i];
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    }, idx);

  const tap = async (x, y) => {
    await page.evaluate(([px, py]) => window.__hand.at(px, py, false), [x, y]);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__hand.set(true));
    await page.waitForTimeout(110);
    await page.evaluate(() => window.__hand.set(false));
    await page.waitForTimeout(420);
  };

  const e0 = await iconAt(0);
  await tap(e0.x, e0.y);
  const hidden = await page.evaluate(() => window.__spatial.useApp.getState().objects[0]?.visible === false);

  const e1 = await iconAt(1);
  await tap(e1.x, e1.y);
  const locked = await page.evaluate(() => window.__spatial.useApp.getState().objects[0]?.locked === true);

  const e2 = await iconAt(2);
  await tap(e2.x, e2.y);
  const removed = await page.evaluate(() => window.__spatial.useApp.getState().objects.length === 0);

  rec(
    "IU-010",
    "行内小图标（眼睛/锁/删除）",
    `18px 图标可用手势点中：隐藏/锁定/删除 3/3`,
    `图标尺寸 ${Math.round(e0.w)}×${Math.round(e0.h)}；隐藏 ${hidden ? "成功" : "失败"}、锁定 ${locked ? "成功" : "失败"}、删除 ${removed ? "成功" : "失败"}`,
    hidden && locked && removed,
    "test-artifacts/95-inline-icons.png",
  );
  out.inlineIcons = { size: [Math.round(e0.w), Math.round(e0.h)], hidden, locked, removed };
  await page.screenshot({ path: "test-artifacts/95-inline-icons.png" });
} catch (e) {
  rec("IU-010", "行内小图标（眼睛/锁/删除）", "3/3", String(e), false);
}

/* ---------------- S9 滑杆：捏合按住并移动才能改值 ---------------- */
try {
  await page.getByRole("button", { name: "球体", exact: true }).first().click();
  await page.waitForTimeout(200);
  const box = await page.evaluate(() => {
    const el = document.querySelector('input[type="range"][data-hand-label="雕刻半径"]');
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, y: r.y + r.height / 2, value: Number(el.value) };
  });
  // 指到右端 → 捏住 → 拖到左端 → 松开
  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [box.right - 4, box.y]);
  await page.waitForTimeout(320);
  await page.evaluate(() => window.__hand.set(true));
  await page.waitForTimeout(120);
  await page.evaluate(([x, y]) => window.__hand.move(x, y), [box.left + 3, box.y]);
  await page.waitForTimeout(220);
  const during = await page.evaluate(() => ({
    value: window.__spatial.useApp.getState().settings.sculptRadius,
    drag: Boolean(window.__spatial.uiPointer.drag),
    label: window.__spatial.uiPointer.dragLabel,
    cursor: document.querySelector(".hand-cursor")?.classList.contains("drag"),
  }));
  await page.evaluate(() => window.__hand.set(false));
  await page.waitForTimeout(280);
  const after = await page.evaluate(() => window.__spatial.useApp.getState().settings.sculptRadius);

  // 再拖回右端，确认是双向的，不是一次性写死
  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [box.left + 3, box.y]);
  await page.waitForTimeout(320);
  await page.evaluate(() => window.__hand.set(true));
  await page.waitForTimeout(100);
  await page.evaluate(([x, y]) => window.__hand.move(x, y), [box.right - 4, box.y]);
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => window.__spatial.useApp.getState().settings.sculptRadius);
  await page.evaluate(() => window.__hand.set(false));
  await page.waitForTimeout(300);

  const ok = during.drag && during.cursor && after <= 0.06 && back >= 0.44;
  rec(
    "IU-011",
    "滑杆手势拖动",
    "捏合按住并移动可改值，拖到两端到达 min/max",
    `起点 ${box.value} → 左端 ${after.toFixed(2)}（min 0.04）→ 回右端 ${back.toFixed(2)}（max 0.50）；拖动中光标态 ${during.cursor ? "实心" : "无"}、数值「${during.label}」`,
    ok,
    "test-artifacts/96-slider-drag.png",
  );
  out.slider = { from: box.value, toLeft: after, toRight: back, dragLabel: during.label };
  await page.screenshot({ path: "test-artifacts/96-slider-drag.png" });
} catch (e) {
  rec("IU-011", "滑杆手势拖动", "见口径", String(e), false);
}

/* ---------------- S10 预设短语 + 风格循环：不用键盘也能提交生成 ---------------- */
try {
  // 预设短语只在「生成」工具下出现，先切过去
  await page.evaluate(() => window.__spatial.useApp.getState().setTool("ai"));
  await page.waitForTimeout(260);
  const chipCount = await page.evaluate(() => document.querySelectorAll(".chip-btn").length);
  const chipBox = await page.evaluate(() => {
    const el = document.querySelector(".chip-btn");
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [chipBox.x, chipBox.y]);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__hand.set(true));
  await page.waitForTimeout(110);
  await page.evaluate(() => window.__hand.set(false));
  await page.waitForTimeout(420);
  const filled = await page.evaluate(() => document.querySelector(".ai-input")?.value ?? "");

  const styleBtn = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("风格 "));
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim() };
  });
  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [styleBtn.x, styleBtn.y]);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__hand.set(true));
  await page.waitForTimeout(110);
  await page.evaluate(() => window.__hand.set(false));
  await page.waitForTimeout(420);
  const styleAfter = await page.evaluate(
    () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("风格 "))?.textContent.trim(),
  );

  rec(
    "IU-012",
    "纯手势准备生成（预设短语 + 风格循环）",
    "点短语即填入描述；点风格按钮即切换，全程不用键盘",
    `${chipCount} 条预设；填入「${filled.slice(0, 12)}…」；风格 ${styleBtn.text} → ${styleAfter}`,
    Boolean(filled) && styleAfter !== styleBtn.text,
  );
  out.aiGesture = { chipCount, filled, styleBefore: styleBtn.text, styleAfter };
} catch (e) {
  rec("IU-012", "纯手势准备生成（预设短语 + 风格循环）", "见口径", String(e), false);
}

/* ---------------- S11 预设色块：系统取色器的可用替代 ---------------- */
try {
  const sw = await page.evaluate(() => {
    const el = document.querySelectorAll(".swatch")[2];
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, want: getComputedStyle(el).backgroundColor };
  });
  const before = await page.evaluate(() => window.__spatial.useApp.getState().objects[0]?.color);
  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [sw.x, sw.y]);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__hand.set(true));
  await page.waitForTimeout(110);
  await page.evaluate(() => window.__hand.set(false));
  await page.waitForTimeout(420);
  const after = await page.evaluate(() => window.__spatial.useApp.getState().objects[0]?.color);
  rec("IU-013", "预设色块改色", "点色块即改对象颜色", `${before} → ${after}`, Boolean(after) && after !== before, "test-artifacts/97-swatch.png");
  out.swatch = { before, after };
  await page.screenshot({ path: "test-artifacts/97-swatch.png" });
} catch (e) {
  rec("IU-013", "预设色块改色", "见口径", String(e), false);
}

/* ---------------- S12 面板手势滚动：长面板的每一行都够得到 ---------------- */
try {
  // 先把属性面板撑到可滚动
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "球体", exact: true }).first().click();
  await page.waitForTimeout(300);

  const spot = await page.evaluate(() => {
    const host = document.querySelector("[data-hand-scroll]");
    const r = host.getBoundingClientRect();
    // 找一条"没有控件"的竖带：捏合在这里就是滚动，不是点按钮
    for (let x = r.left + 6; x < r.right - 6; x += 6) {
      for (let y = r.top + 20; y < r.bottom - 20; y += 12) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (el.closest("button, input, select, textarea, [data-hand-hit]")) continue;
        return { x, y, scrollTop: host.scrollTop, scrollable: host.scrollHeight > host.clientHeight + 4 };
      }
    }
    return null;
  });
  if (!spot?.scrollable) throw new Error("属性面板未形成可滚动区域，无法验证手势滚动");

  await page.evaluate(([x, y]) => window.__hand.at(x, y, false), [spot.x, spot.y]);
  await page.waitForTimeout(320);
  const armed = await page.evaluate(() => !window.__spatial.uiPointer.overUi && Boolean(window.__spatial.uiPointer.scrollHost));
  await page.evaluate(() => window.__hand.set(true));
  await page.waitForTimeout(120);
  await page.evaluate(([x, y]) => window.__hand.move(x, y), [spot.x, spot.y - 140]);
  await page.waitForTimeout(260);
  const scrolled = await page.evaluate(() => document.querySelector("[data-hand-scroll]").scrollTop);
  await page.evaluate(() => window.__hand.set(false));
  await page.waitForTimeout(250);

  rec(
    "IU-014",
    "面板手势滚动",
    "在面板空白处捏合并上移，面板内容跟着滚，且不误触按钮",
    `空白处命中滚动区 ${armed ? "是" : "否"}，scrollTop ${spot.scrollTop} → ${Math.round(scrolled)}`,
    armed && scrolled > spot.scrollTop + 60,
  );
  out.scroll = { from: spot.scrollTop, to: Math.round(scrolled), armed };
} catch (e) {
  rec("IU-014", "面板手势滚动", "见口径", String(e), false);
}

/* ---------------- S6 页面异常 ---------------- */
const unexpected = errs.filter((m) => !/ERR_FAILED|Failed to fetch/i.test(m));
rec("IU-006", "页面运行时异常", "0 条", `${unexpected.length} 条`, unexpected.length === 0, unexpected.slice(0, 3).join(" | "));

await page.evaluate(() => window.__hand.stop());
out.pass = out.cases.filter((c) => c.ok).length;
out.total = out.cases.length;
out.errors = unexpected;
mkdirSync("test-artifacts", { recursive: true });
writeFileSync("test-artifacts/bench-hand.json", JSON.stringify(out, null, 2));
console.log(`\n通过 ${out.pass}/${out.total}`);
await browser.close();
