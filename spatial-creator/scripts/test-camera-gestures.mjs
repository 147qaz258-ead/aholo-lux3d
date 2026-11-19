import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Only getUserMedia is replaced. Chrome sends actual image frames through the real
// MediaPipe Worker, hand tracker, gesture recognizer and workspace interaction.
const base = process.env.BASE || "http://127.0.0.1:5173";
const out = "test-artifacts/hand-camera-fixtures";
mkdirSync(out, { recursive: true });
const mediapipe = "https://storage.googleapis.com/mediapipe-assets/";
const sources = {
  "fist.jpg": mediapipe + "fist.jpg",
  "pointing_up.jpg": mediapipe + "pointing_up.jpg",
  "right_hands.jpg": mediapipe + "right_hands.jpg",
  "thumb_up.jpg": mediapipe + "thumb_up.jpg",
  "victory.jpg": mediapipe + "victory.jpg",
  // Steven H. Keys (keysphotography.com), CC BY 2.5; see the acceptance notes for attribution.
  "ok-sign.jpg": "https://upload.wikimedia.org/wikipedia/commons/1/19/OK_Sign.jpg",
};
const pictures = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, url]) => {
  const path = `${out}/${name}`;
  let bytes;
  try { bytes = readFileSync(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "AetherStudioGestureTests/1.0 (local regression fixture)" } });
    if (!response.ok) throw new Error(`Cannot load fixture ${name}: ${response.status} ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(path, bytes);
  }
  return [name, `data:image/jpeg;base64,${bytes.toString("base64")}`];
})));
const pw = await import(pathToFileURL(process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js").href);
const browser = await (pw.chromium || pw.default.chromium).launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(14000);
  await page.addInitScript(async urls => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const g = canvas.getContext("2d");
    const images = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([name, url]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return [name, img];
    })));
    let shots = [];
    function paint() {
      g.fillStyle = "#c4c6c6";
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (const { name, x = 0, y = 0, size = 300, crop } of shots) {
        const img = images[name];
        const [sx, sy, sw, sh] = crop || [0, 0, img.width, img.height];
        const scale = size / Math.max(sw, sh);
        g.drawImage(img, sx, sy, sw, sh, 320 + x - sw * scale / 2, 180 + y - sh * scale / 2, sw * scale, sh * scale);
      }
    }
    window.__testCameraFeed = next => { shots = next; paint(); };
    navigator.mediaDevices.getUserMedia = async () => {
      paint();
      const stream = canvas.captureStream(30);
      setInterval(paint, 33);
      return stream;
    };
  }, pictures);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__testCameraFeed);
  await page.getByRole("button", { name: "鼠标模式", exact: true }).click();
  await page.locator(".cam-panel").getByRole("button", { name: "启用摄像头", exact: true }).click();
  await page.waitForFunction(() => window.__spatial?.useApp.getState().cameraReady, null, { timeout: 25000 });

  const show = (...shots) => page.evaluate(shots => window.__testCameraFeed(shots), shots);
  const gesture = name => page.waitForFunction(name => {
    const h = window.__spatial.handState;
    return !!h.primary && h.gesture === name;
  }, name);
  const clear = async () => {
    await show();
    await page.waitForFunction(() => window.__spatial.handState.hands.length === 0);
  };
  const sample = () => page.evaluate(() => {
    const h = window.__spatial.handState;
    return { fps: h.fps, intervalMs: Math.round(h.resultIntervalMs), gesture: h.gesture, tracking: h.trackingState, interaction: window.__spatial.useApp.getState().interaction, strokePoints: window.__spatial.drawRuntime.points.length,
      hands: h.hands.map(hand => ({ pinch: hand.pinch, pinched: hand.pinched, fingers: hand.fingers.extended })) };
  });
  const camera = () => page.evaluate(() => window.__three.camera.position.toArray());
  const moved = (before, index, limit) => page.waitForFunction(({ before, index, limit }) =>
    Math.abs(window.__three.camera.position.getComponent(index) - before[index]) > limit, { before, index, limit });
  const frames = async count => {
    const before = await page.evaluate(() => window.__spatial.handState.frames);
    await page.waitForFunction(end => window.__spatial.handState.frames >= end, before + count);
  };
  async function test(name, verify) {
    try {
      const detail = await verify();
      results.push({ name, status: "PASS", detail });
      console.log("PASS", name, detail ?? "");
    } catch (error) {
      const input = await sample();
      results.push({ name, status: "FAIL", error: error.message, input });
      console.error("FAIL", name, error.message, input);
    } finally {
      await page.keyboard.press("Escape");
      await clear();
    }
  }
  const palette = page.locator(".gesture-menu");
  const open = { name: "right_hands.jpg", crop: [0, 0, 360, 382] };

  await test("camera replay of an index bend and lift clicks a real workbench button", async () => {
    // Same handedness; align the photographed wrists to replay a curl at a
    // stationary palm. Only the camera frames are replaced, not the tracker.
    const point = { name: "pointing_up.jpg" };
    const curl = { name: "fist.jpg", x: -5, y: 32 };
    const draw = page.locator(".rail .tool[aria-label='绘制']");
    await page.keyboard.press("1");
    await show(point);
    await gesture("point");
    await frames(3);
    const aim = await page.evaluate(() => {
      const stage = document.querySelector(".viewport canvas").getBoundingClientRect();
      const { view, id } = window.__spatial.handState.primary;
      return { id, left: stage.left + view.x * stage.width, top: stage.top + view.y * stage.height };
    });
    // Put the existing button inside the stationary photo's reach, retaining
    // its DOM element and real React click handler.
    const hadRail = await page.evaluate(() => {
      const s = window.__spatial.useApp.getState();
      if (!s.panels.rail) s.togglePanel("rail");
      return s.panels.rail;
    });
    await draw.waitFor();
    await draw.evaluate((button, { left, top }) => {
      const rail = button.closest(".rail");
      const parent = rail.offsetParent.getBoundingClientRect();
      const box = button.getBoundingClientRect(), original = rail.getBoundingClientRect();
      Object.assign(rail.style, { transform: "none",
        left: (left - parent.left - (box.left - original.left + box.width / 2)) + "px",
        top: (top - parent.top - (box.top - original.top + box.height / 2)) + "px",
      });
    }, aim);
    const check = () => page.evaluate(() => {
      const { useApp, uiPointer, drawRuntime } = window.__spatial;
      return { tool: useApp.getState().tool, clicks: uiPointer.clicks, drawing: drawRuntime.active };
    });
    const before = await check();
    try {
      await page.waitForFunction(() => window.__spatial.uiPointer.tapLabel.includes("弯一下食指"));
      await show(curl);
      await page.waitForFunction(() => window.__spatial.uiPointer.tapAnchor !== null, null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.__spatial.handState.primary.id), aim.id);
      assert.deepEqual(await check(), before, "the down motion alone must not click");
      await show(point);
      await page.waitForFunction(() => window.__spatial.useApp.getState().tool === "draw");
      await frames(3);
      const after = await check();
      assert.deepEqual(after, { tool: "draw", clicks: before.clicks + 1, drawing: false });
      return after;
    } finally {
      await draw.evaluate(button => {
        button.closest(".rail").removeAttribute("style");
      });
      if (!hadRail) await page.evaluate(() => window.__spatial.useApp.getState().togglePanel("rail"));
      await page.keyboard.press("1");
    }
  });

  await test("camera fist opens the palette without sending a pinch", async () => {
    await show({ name: "fist.jpg" });
    await gesture("fist");
    await palette.getByRole("button", { name: "绘制", exact: true }).waitFor();
    const actual = await sample();
    assert.ok(actual.hands[0].pinch < .2 && !actual.hands[0].pinched);
    assert.equal(await page.evaluate(() => window.__spatial.useApp.getState().objects.length), 0);
    return actual;
  });

  await test("camera thumbs-up does not open the palette or pinch", async () => {
    await show({ name: "thumb_up.jpg" });
    await gesture("spread");
    await frames(3);
    assert.equal(await palette.count(), 0);
    assert.equal((await sample()).hands[0].pinched, false);
  });

  await test("camera palm rotates across both axes and rearms after losing the hand", async () => {
    await show(open);
    await gesture("open");
    await page.getByText(/掌心亮环已出现/).waitFor();
    const before = await camera();
    await frames(2);
    assert.deepEqual(await camera(), before, "a stationary palm should not move the camera");
    await show({ ...open, x: 55 });
    await moved(before, 0, .25);
    await clear();
    await frames(2);
    const afterHorizontal = await camera();
    await show({ ...open, size: 260 });
    await gesture("open");
    await page.getByText(/掌心亮环已出现/).waitFor();
    assert.deepEqual(await camera(), afterHorizontal, "rearming should not jump the camera");
    await show({ ...open, size: 260, y: -38 });
    await moved(afterHorizontal, 1, .15);
    return { before, afterHorizontal, afterVertical: await camera(), ...(await sample()) };
  });

  await test("camera detects two open palms and enters pan/zoom", async () => {
    await show({ name: "right_hands.jpg", size: 510 });
    await page.waitForFunction(() => window.__spatial.handState.twoHand.active);
    await page.getByText("双掌开合缩放，同向移动平移。", { exact: true }).waitFor();
    const before = await camera();
    await show({ name: "right_hands.jpg", size: 575, x: 25 });
    await page.waitForFunction(before => window.__three.camera.position.toArray().some((n, i) => Math.abs(n - before[i]) > .15), before);
    return { before, after: await camera(), ...(await sample()) };
  });

  await test("camera pinch starts a stroke and opening the fingers finishes it", async () => {
    await page.keyboard.press("2");
    await show({ name: "pointing_up.jpg" });
    await gesture("point");
    await show({ name: "ok-sign.jpg" });
    await gesture("pinch");
    await page.waitForFunction(() => window.__spatial.drawRuntime.active);
    for (const [x, count] of [[30, 2], [65, 3]]) {
      await show({ name: "ok-sign.jpg", x });
      await page.waitForFunction(min => window.__spatial.drawRuntime.active && window.__spatial.drawRuntime.points.length >= min, count, { timeout: 7500 });
    }
    await show({ name: "pointing_up.jpg", x: 65 });
    await gesture("point");
    await page.waitForFunction(() => window.__spatial.useApp.getState().objects.some(o => o.kind === "stroke"));
    assert.equal(await palette.count(), 0);
    await page.keyboard.press("1");
  });

  await test("a camera result with no hand rolls back an unfinished stroke", async () => {
    const objectCount = () => page.evaluate(() => window.__spatial.useApp.getState().objects.length);
    const before = await objectCount();
    await page.keyboard.press("2");
    await show({ name: "pointing_up.jpg" });
    await gesture("point");
    await show({ name: "ok-sign.jpg" });
    await page.waitForFunction(() => window.__spatial.drawRuntime.active);
    await clear();
    await page.waitForFunction(() => !window.__spatial.drawRuntime.active && window.__spatial.drawRuntime.points.length === 0);
    assert.equal(await objectCount(), before);
    await page.keyboard.press("1");
  });

  await test("camera distinguishes the scissors pose from a fist or pinch", async () => {
    await show({ name: "victory.jpg" });
    await gesture("peace");
    assert.equal((await sample()).hands[0].pinched, false);
    assert.equal(await palette.count(), 0);
  });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
}
if (results.some(test => test.status === "FAIL")) process.exitCode = 1;
