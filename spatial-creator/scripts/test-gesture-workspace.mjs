import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const pw = await import(pathToFileURL(process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js").href);
const browser = await (pw.chromium || pw.default.chromium).launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
const results = [], errors = [];
const output = "test-artifacts/gesture-workspace";
mkdirSync(output, { recursive: true });

async function test(name, run) {
  try {
    const detail = await run();
    results.push({ name, status: "PASS", detail });
    console.log("PASS", name, detail ?? "");
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.stack });
    console.error("FAIL", name, error);
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      constructor() { window.__speech = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
      text(transcript, isFinal) { this.onresult?.({ results: [{ 0: { transcript }, isFinal }] }); }
    };
  });
  await page.goto(process.env.BASE || "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "鼠标模式", exact: true }).click();
  await page.waitForFunction(() => window.__spatial?.useApp && window.__three);
  await page.evaluate(() => {
    const { handState: state } = window.__spatial;
    const pose = (x, y, sign, id) => {
      const open = sign === "open", peace = sign === "peace", three = sign === "three";
      const extended = { thumb: open, index: open || peace || three || sign === "point", middle: open || peace || three, ring: open || three, pinky: open };
      const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
      world[5] = { x: -.03, y: -.06, z: 0 }; world[17] = { x: .04, y: -.055, z: 0 };
      world[9] = { x: 0, y: -.065, z: 0 };
      if (sign === "point" || sign === "bend") {
        world[6] = { x: -.03, y: -.10, z: 0 };
        world[8] = sign === "point" ? { x: -.03, y: -.15, z: 0 } : { x: -.03, y: -.094, z: -.032 };
      }
      const screen = world.map(p => ({ x: x + p.x, y: y + p.y, z: 0 }));
      const pinched = sign === "pinch";
      return { id, handedness: id ? "Left" : "Right", screen, raw: screen, world, view: { x, y }, ndc: { x: x * 2 - 1, y: 1 - y * 2 },
        fingers: { count: Object.values(extended).filter(Boolean).length, extended }, palm: .16, pinched, pinch: pinched ? .95 : .1 };
    };
    window.__hands = [];
    window.__pose = (x, y, sign, id = 0) => pose(x, y, sign, id);
    window.__timer = setInterval(() => {
      state.hands = window.__hands;
      state.primary = state.hands[0] ?? null;
      state.secondary = state.hands[1] ?? null;
      state.status = "ready";
      state.updatedAt = performance.now(); state.frames++;
      state.trackingState = state.primary ? "READY" : "LOST";
      state.twoHand.active = state.hands.length === 2;
      if (state.secondary) {
        const a = state.hands.find(h => h.id === 0).view, b = state.hands.find(h => h.id === 1).view;
        state.twoHand.distance = Math.hypot(b.x - a.x, b.y - a.y);
        state.twoHand.angle = Math.atan2(b.y - a.y, b.x - a.x);
      }
    }, 25);
  });
  async function hands(primary, secondary, wait = 140) {
    await page.evaluate(([a, b]) => { window.__hands = [a, b].filter(Boolean).map(p => window.__pose(...p)); }, [primary, secondary]);
    await page.waitForTimeout(wait);
  }
  const camera = () => page.evaluate(() => window.__three.camera.position.toArray());
  const stage = page.locator(".viewport canvas");

  await test("empty workspace offers a first drawing step", async () => {
    const start = page.getByRole("region", { name: "创作起步" });
    await start.getByRole("button", { name: "开始绘制" }).click();
    await start.getByText("在网格上按住鼠标左键画线，松开后收笔。").waitFor();
    assert.equal(await page.evaluate(() => window.__spatial.useApp.getState().tool), "draw");
    await page.keyboard.press("1");
  });

  const handTarget = async button => {
    const [box, canvas] = await Promise.all([button.boundingBox(), stage.boundingBox()]);
    return [(box.x + box.width / 2 - canvas.x) / canvas.width, (box.y + box.height / 2 - canvas.y) / canvas.height];
  };
  async function tapPose(wrist, sign, tip = wrist, id = 0) {
    const before = await page.evaluate(({ wrist, sign, tip, id }) => {
      const h = window.__pose(...wrist, sign, id);
      h.view = { x: tip[0], y: tip[1] };
      h.ndc = { x: tip[0] * 2 - 1, y: 1 - tip[1] * 2 };
      window.__hands = [h];
      return window.__spatial.handState.frames;
    }, { wrist, sign, tip, id });
    await page.waitForFunction(frame => window.__spatial.handState.frames >= frame + 3, before);
  }
  const readClicks = () => page.evaluate(() => window.__spatial.uiPointer.clicks);
  const tapCue = text => page.waitForFunction(cue => window.__spatial.uiPointer.tapLabel.includes(cue), text);
  const armTap = async pos => { await tapPose(pos, "point"); await tapCue("弯一下食指"); };
  const drawButton = page.locator(".rail").getByRole("button", { name: "绘制", exact: true });
  const getTool = () => page.evaluate(() => window.__spatial.useApp.getState().tool);
  const center = [.55, .45];

  await test("one index bend and lift delivers one DOM click to the aimed workbench button", async () => {
    const pos = await handTarget(drawButton);
    const before = await readClicks();
    const cam = await camera();
    await drawButton.evaluate(el => el.addEventListener("click", () => { el.dataset.testClicked = String(Number(el.dataset.testClicked || 0) + 1); }));
    await armTap(pos);
    await tapPose(pos, "bend", center);
    await tapCue("伸直点击");
    assert.equal(await getTool(), "select", "bending or holding must not click");
    assert.equal(await readClicks(), before);
    await tapPose(pos, "point", center);
    await page.waitForFunction(() => window.__spatial.useApp.getState().tool === "draw");
    await tapPose(pos, "point", pos);
    assert.equal(await drawButton.getAttribute("data-test-clicked"), "1");
    assert.equal(await readClicks(), before + 1);
    assert.deepEqual(await camera(), cam);
    assert.equal(await page.evaluate(() => window.__spatial.drawRuntime.active), false);
    await hands();
    await page.keyboard.press("1");
  });

  await test("index tapping cancels on empty canvas, moved palm, lost hand, timeout, disabled or obscured UI", async () => {
    const pos = await handTarget(drawButton);
    const before = await readClicks();
    await tapPose(center, "point");
    await tapPose(center, "bend");
    await tapPose(center, "point");
    for (const cancel of ["move", "loss", "timeout", "disabled", "dialog", "menu"]) {
      await armTap(pos);
      await tapPose(pos, "bend");
      await tapCue("伸直点击");
      if (cancel === "move") await tapPose([pos[0] + .14, pos[1]], "point", pos);
      if (cancel === "loss") await hands();
      if (cancel === "timeout") await page.waitForFunction(() => window.__spatial.uiPointer.tapAnchor === null);
      if (cancel === "disabled") await drawButton.evaluate(el => { el.disabled = true; });
      if (cancel === "dialog") await page.evaluate(() => {
        const el = document.createElement("div");
        el.id = "gesture-test-dialog"; el.setAttribute("aria-modal", "true"); document.body.appendChild(el);
      });
      if (cancel === "menu") await page.evaluate(() => window.__spatial.useApp.getState().setGestureMenu({ id: 0, x: .45, y: .45 }));
      try {
        await tapPose(pos, "point");
        assert.equal(await readClicks(), before, cancel);
        assert.equal(await getTool(), "select", cancel);
      } finally {
        if (cancel === "disabled") await drawButton.evaluate(el => { el.disabled = false; });
        await page.evaluate(() => {
          document.getElementById("gesture-test-dialog")?.remove();
          window.__spatial.useApp.getState().setGestureMenu(null);
        });
        await hands();
      }
    }
    assert.equal(await page.evaluate(() => window.__spatial.drawRuntime.active), false);
  });

  await test("switching from a bent index to a pinch fires the button only once", async () => {
    const pos = await handTarget(drawButton);
    const before = await readClicks();
    await armTap(pos);
    await tapPose(pos, "bend");
    await tapCue("伸直点击");
    await tapPose(pos, "pinch");
    await page.waitForFunction(() => window.__spatial.useApp.getState().tool === "draw");
    await tapPose(pos, "point");
    assert.equal(await readClicks(), before + 1);
    await armTap(pos);
    await tapPose(pos, "bend", center);
    await tapCue("伸直点击");
    await tapPose(pos, "pinch", center);
    assert.equal(await readClicks(), before + 1);
    assert.equal(await page.evaluate(() => window.__spatial.drawRuntime.active), false, "a pinch during the tap must not start a stroke behind it");
    await hands();
    await page.keyboard.press("1");
  });

  await test("five finger readouts stay visible through repeated misses and threshold noise", async () => {
    const hud = page.locator(".interaction-status");
    const readout = hud.getByRole("group", { name: "五指识别状态（仅显示）" });
    const finger = state => readout.locator(`[aria-label="小指：${state}"]`);
    const boxes = () => page.evaluate(() => [".interaction-status", ".workspace-views", ".workspace-start"].map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return [x, y, width, height];
    }));
    assert.match(await hud.innerText(), /当前工具：选择对象/);
    assert.equal(await readout.getByRole("button").count(), 0);
    assert.equal(await readout.locator('[aria-label$="：未识别"]').count(), 5);

    await hud.getByRole("button", { name: "手势指引" }).click();
    await page.getByText(/「五指识别」是只读状态/).waitFor();
    await page.getByRole("button", { name: "关闭操作指引" }).click();
    await page.evaluate(() => window.__spatial.useApp.getState().setCameraReady(true));
    await hud.getByText("未识别到手", { exact: true }).waitFor();
    const layout = await boxes();
    try {
      await hands([.5, .4, "open"]);
      await finger("伸展").waitFor();
      const result = await page.evaluate(async () => {
        const row = document.querySelector(".finger-readout");
        const cells = [...row.children];
        const hint = document.querySelector(".interaction-hint");
        const pinky = cells.at(-1);
        const open = window.__pose(.5, .4, "open");
        const noisy = structuredClone(open);
        noisy.fingers.extended.pinky = false;
        noisy.fingers.count = 4;
        const changed = [];
        const view = document.querySelector(".workspace-views");
        const start = document.querySelector(".workspace-start");
        const initialPositions = [view.offsetTop, start.offsetTop];
        const observer = new MutationObserver(() => {
          if (cells.some((cell, i) => row.children[i] !== cell) || pinky.getAttribute("aria-label") !== "小指：伸展") changed.push("finger changed");
          if (hint.textContent.includes("抬手到摄像头")) changed.push("hint switched to searching");
          if (view.offsetTop !== initialPositions[0] || start.offsetTop !== initialPositions[1]) changed.push("controls moved");
        });
        observer.observe(row, { childList: true, subtree: true, attributes: true });
        observer.observe(hint, { childList: true, subtree: true, characterData: true });
        try {
          for (let i = 0; i < 4; i++) {
            for (const input of [[], [noisy], [open]]) {
              window.__hands = input;
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          return changed;
        } finally { observer.disconnect(); }
      });
      assert.deepEqual(result, []);
      assert.deepEqual(await boxes(), layout);
      await hands(null);
      await hud.getByText("未识别到手", { exact: true }).waitFor();
      assert.equal(await readout.locator('[aria-label$="：未识别"]').count(), 5);
      assert.deepEqual(await boxes(), layout);
      await hands([.5, .4, "point"]);
      await finger("弯曲").waitFor();
      await readout.locator('[aria-label="食指：伸展"]').waitFor();
      await page.evaluate(() => { window.__spatial.handState.paused = true; });
      await hud.getByText("手部输入已暂停", { exact: true }).waitFor();
      assert.equal(await readout.locator('[aria-label$="：未识别"]').count(), 5);
      assert.deepEqual(await boxes(), layout);
    } finally {
      await page.evaluate(() => {
        window.__hands = [];
        window.__spatial.handState.paused = false;
        window.__spatial.useApp.getState().setCameraReady(false);
      });
    }
  });

  await test("single palm rotates camera without changing scene or undo", async () => {
    await page.getByRole("button", { name: "立方体", exact: true }).click();
    const snapshot = () => page.evaluate(() => {
      const s = window.__spatial.useApp.getState();
      return JSON.stringify([s.objects, s.past.length, s.sceneRevision]);
    });
    const before = await snapshot(), start = await camera();
    await hands([.4, .4, "point"], null, 350);
    await page.waitForFunction(() => window.__spatial.pointerRuntime.source === "hand");
    await hands([.4, .4, "open"], null, 25);
    await page.waitForFunction(() => window.__three.scene.getObjectByName("hand-rig").children.at(-1).children[0].visible);
    await hands([.45, .4, "open"]);
    await hands([.52, .4, "open"]);
    const turned = await camera();
    assert.ok(turned.some((value, i) => Math.abs(value - start[i]) > .1));
    await hands([.52, .4, "open"], null, 300);
    assert.deepEqual(await camera(), turned);
    await hands([.52, .4, "point"]);
    assert.equal(await snapshot(), before);
    assert.deepEqual(await page.evaluate(() => window.__spatial.useApp.getState().cameraView.position), turned);
  });

  await test("three fingers offer feedback and focus selection once without touching history", async () => {
    const start = await page.evaluate(() => {
      const s = window.__spatial.useApp.getState();
      s.select(s.objects[0].id);
      s.setCameraReady(true);
      window.__focusEvents = [];
      window.addEventListener("aether:view", event => window.__focusEvents.push(event.detail));
      return [s.sceneRevision, s.past.length];
    });
    const hud = page.locator(".interaction-status");
    try {
      await hands([.5, .40, "point"], null, 140);
      await hands([.5, .40, "three"], null, 100);
      await hud.locator('[aria-label="无名指：伸展"]').waitFor();
      await hud.locator('[aria-label="小指：弯曲"]').waitFor();
      await hud.getByText(/保持三指静止/).waitFor();
      assert.equal(await page.evaluate(() => window.__focusEvents.length), 0);
      await page.waitForFunction(() => window.__focusEvents.length === 1);
      await page.waitForTimeout(700);
      assert.deepEqual(await page.evaluate(() => window.__focusEvents), ["selected"]);
      assert.deepEqual(await page.evaluate(() => {
        const s = window.__spatial.useApp.getState();
        return [s.sceneRevision, s.past.length];
      }), start);
    } finally {
      await hands([.5, .40, "point"]);
      await page.evaluate(() => window.__spatial.useApp.getState().setCameraReady(false));
    }
  });

  await test("repeated dropouts keep all three visual layers steady without holding input", async () => {
    const settings = page.getByRole("button", { name: "摄像头设置" });
    await page.evaluate(() => window.__spatial.useApp.getState().setCameraReady(true));
    await settings.click();
    const sample = () => page.evaluate(() => {
      const { pointerRuntime, uiPointer } = window.__spatial;
      const { scene } = window.__three;
      const rig = scene.getObjectByName("hand-rig");
      const surface = scene.getObjectByName("surface-pointer");
      const cursor = document.querySelector(".hand-cursor");
      const cv = document.querySelector(".cam-stage canvas");
      const ctx = cv.getContext("2d");
      const pixels = cv.width && cv.height ? ctx.getImageData(0, 0, cv.width, cv.height).data : [];
      let drawn = false;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { drawn = true; break; }
      return {
        bones: rig.visible, bonesOpacity: rig.children[1].material.opacity,
        surface: surface.visible, cursor: Number(cursor.style.opacity), at: cursor.style.transform,
        preview: drawn, liveInput: pointerRuntime.source === "hand" && uiPointer.visible,
      };
    });
    try {
      // Leave a previously used mouse position so the fallback ring would be visible on the old code.
      await page.mouse.move(700, 450);
      await hands([.50, .37, "point"], null, 230);
      const tracked = await sample();
      assert.ok(tracked.bones && tracked.preview && tracked.liveInput && tracked.cursor > .95, JSON.stringify(tracked));
      for (let i = 0; i < 2; i++) {
        await hands(null, null, 245);
        const missed = await sample();
        assert.ok(missed.bones && missed.bonesOpacity > .66 && missed.preview && missed.cursor > .95, JSON.stringify(missed));
        assert.equal(missed.at, tracked.at);
        assert.equal(missed.liveInput, false);
        assert.equal(missed.surface, false);
        await hands([.50, .37, "point"], null, 150);
        assert.equal((await sample()).liveInput, true);
      }
      await hands(null, null, 690);
      const lost = await sample();
      assert.ok(!lost.bones && !lost.preview && lost.cursor === 0, JSON.stringify(lost));
    } finally {
      await settings.click();
      await page.evaluate(() => window.__spatial.useApp.getState().setCameraReady(false));
    }
  });

  await test("two palms share render batches and adjust orthographic pan and zoom", async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("aether:view", { detail: "orthographic" })));
    await hands([.39, .42, "point"], [.6, .42, "point", 1]);
    const before = await camera();
    await hands([.39, .42, "open"], [.6, .42, "open", 1], 300);
    await hands([.35, .45, "open"], [.65, .45, "open", 1]);
    await hands([.3, .48, "open"], [.72, .48, "open", 1]);
    const detail = await page.evaluate(() => {
      const { scene, camera } = window.__three;
      const group = scene.getObjectByName("hand-rig");
      return { counts: group.children.filter(x => x.isInstancedMesh).map(x => x.count), zoom: camera.zoom, position: camera.position.toArray() };
    });
    assert.deepEqual(detail.counts, [42, 46, 10]);
    assert.ok(detail.zoom > 1);
    assert.notDeepEqual(detail.position, before);
    await hands([.3, .48, "point"]);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("aether:view", { detail: "perspective" }));
      window.dispatchEvent(new CustomEvent("aether:view", { detail: "reset" }));
    });
    return detail.counts;
  });

  await test("fist opens tools, hand pinch selects and peace swipe undoes and redoes once", async () => {
    await hands([.45, .4, "point"]);
    await hands([.45, .4, "fist"], null, 650);
    const menu = page.getByRole("region", { name: "手势工具" });
    await menu.waitFor();
    const draw = await menu.getByRole("button", { name: "绘制", exact: true }).boundingBox();
    const box = await stage.boundingBox();
    const target = [(draw.x + draw.width / 2 - box.x) / box.width, (draw.y + draw.height / 2 - box.y) / box.height];
    await hands([...target, "point"], null, 250);
    await hands([...target, "pinch"]);
    await menu.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.__spatial.useApp.getState().tool), "draw");
    await hands([.47, .44, "point"]);
    const count = () => page.evaluate(() => window.__spatial.useApp.getState().objects.length);
    const initial = await count();
    await hands([.47, .44, "peace"], null, 290);
    await hands([.35, .44, "peace"], null, 300);
    assert.equal(await count(), initial - 1);
    await hands([.35, .44, "point"]);
    await hands([.35, .44, "peace"], null, 290);
    await hands([.47, .44, "peace"], null, 300);
    assert.equal(await count(), initial);
    await hands([.47, .44, "point"]);
  });

  await test("pinch-draw, close, drag thickness, save, export and undo", async () => {
    const start = [.35, .33];
    const corners = [start, [.58, .33], [.58, .56], [.35, .56], start];
    const cam = await camera();
    await hands([...start, "point"]);
    await hands([...start, "pinch"], null, 0);
    await page.waitForFunction(() => window.__spatial.drawRuntime.active);
    let samples = 1;
    for (let k = 1; k < corners.length; k++) {
      const a = corners[k - 1], b = corners[k];
      for (let step = 1; step <= 5; step++) {
        const mix = step / 5;
        await hands([a[0] + mix * (b[0] - a[0]), a[1] + mix * (b[1] - a[1]), "pinch"], null, 0);
        // Advance after the renderer actually consumes the point. A fixed delay
        // can skip whole corners when Chrome renders with software WebGL.
        await page.waitForFunction(n => window.__spatial.drawRuntime.points.length >= n, ++samples);
      }
    }
    await page.waitForFunction(() => window.__spatial.drawRuntime.closing);
    await hands([...start, "open"], null, 0);
    await page.waitForFunction(() => window.__three.scene.getObjectByName("thickness-handle").visible);
    assert.deepEqual(await camera(), cam);
    const handle = await page.evaluate(() => {
      const { scene, camera } = window.__three;
      const group = scene.getObjectByName("thickness-handle");
      if (!group.visible) return null;
      const p = group.position.clone().project(camera);
      return [(p.x + 1) / 2, (1 - p.y) / 2];
    });
    assert.ok(handle, "closed contour must offer a thickness handle");
    await hands([...handle, "point"]);
    await hands([...handle, "pinch"]);
    const started = await page.evaluate(() => {
      const { drawRuntime, pointerRuntime, uiPointer } = window.__spatial;
      return { thickness: drawRuntime.thickness, drawActive: drawRuntime.active, ndc: pointerRuntime.ndc.toArray(), blocked: uiPointer.blockScene };
    });
    assert.ok(started.thickness > 0, JSON.stringify({ handle, started }));
    await page.waitForFunction(() => window.__three.scene.getObjectByName("extrusion-preview").visible);
    for (let step = 1; step <= 10; step++) {
      await hands([handle[0], handle[1] - .013 * step, "pinch"], null, 55);
    }
    await page.waitForFunction(() => window.__three.scene.getObjectByName("extrusion-preview").visible, null, { timeout: 900 }).catch(() => {});
    const previewState = await page.evaluate(() => {
      const { drawRuntime, pointerRuntime, useApp } = window.__spatial;
      return { visible: window.__three.scene.getObjectByName("extrusion-preview").visible, thickness: drawRuntime.thickness,
        drawActive: drawRuntime.active, ndc: pointerRuntime.ndc.toArray(), tool: useApp.getState().tool, interaction: useApp.getState().interaction,
        selected: useApp.getState().selectedId, sketch: drawRuntime.extrusion?.source.id, pinched: pointerRuntime.pinched };
    });
    assert.equal(previewState.visible, true, JSON.stringify({ handle, started, previewState }));
    await hands([handle[0], handle[1] - .13, "point"]);
    const details = await page.evaluate(async () => {
      const { useApp, objectRegistry, exporter } = window.__spatial;
      const s = useApp.getState(), solid = s.objects.find(o => o.kind === "extrusion");
      if (!solid) throw new Error("extrusion missing");
      const src = s.objects.find(o => o.id === solid.sourceObjectIds[0]);
      const { validateProject } = await import("/src/lib/project.ts");
      const reopened = validateProject(JSON.parse(JSON.stringify(s.snapshot())));
      const { parseGlb } = await import("/src/lib/glb.ts");
      const exported = await parseGlb(await (await exporter.exportSceneGlb("roundtrip", [solid.id])).arrayBuffer());
      let geometry;
      objectRegistry.get(solid.id).traverse(o => { if (o.isMesh && !geometry) geometry = o.geometry; });
      const pos = geometry.getAttribute("position"), edges = new Map();
      for (let i = 0; i < pos.count; i += 3) {
        const point = n => [pos.getX(n), pos.getY(n), pos.getZ(n)].map(x => Math.round(x * 1e5)).join(",");
        const triangle = [point(i), point(i + 1), point(i + 2)];
        for (let j = 0; j < 3; j++) {
          const edge = [triangle[j], triangle[(j + 1) % 3]].sort().join("|");
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
        }
      }
      const undo = s.undo(), visibleAfterUndo = useApp.getState().objects.find(o => o.id === src.id).visible;
      const redo = useApp.getState().redo();
      return { captured: src.visible === false && src.rawPoints.length > 12, watertight: [...edges.values()].every(n => n === 2), undo, redo,
        visibleAfterUndo, thickness: reopened.objects.find(o => o.id === solid.id).extrusion.thickness, exported: exported.children.length > 0 };
    });
    assert.ok(details.captured && details.watertight && details.undo && details.redo && details.visibleAfterUndo && details.exported);
    assert.ok(details.thickness > .2);
    return details;
  });

  await test("missing partner rolls back double pinch without committing", async () => {
    await hands([.42, .4, "point"], [.58, .4, "point", 1]);
    await page.evaluate(() => {
      const s = window.__spatial.useApp.getState();
      s.setTool("select");
      s.select(s.objects.find(x => x.kind === "primitive").id);
    });
    await hands([.42, .4, "point"], [.58, .4, "point", 1]);
    const state = () => page.evaluate(() => {
      const { useApp, objectRegistry } = window.__spatial;
      const s = useApp.getState(), id = s.selectedId;
      return { revisions: s.sceneRevision, scale: objectRegistry.get(id).scale.toArray() };
    });
    const before = await state();
    await hands([.42, .4, "pinch"], [.58, .4, "pinch", 1]);
    await hands([.36, .4, "pinch"], [.64, .4, "pinch", 1]);
    assert.ok((await state()).scale[0] > before.scale[0] * 1.4);
    await hands([.36, .4, "pinch"], null, 650);
    assert.deepEqual(await state(), before);
    await hands([.36, .4, "point"]);
  });

  await test("100 edit transitions suppress palm motion and raw pinch takes priority", async () => {
    await hands(null);
    return page.evaluate(async () => {
      const { WorkspaceGestures } = await import("/src/scene/WorkspaceGestures.ts");
      const { THREE, handState, useApp } = window.__spatial;
      const originalView = useApp.getState().cameraView;
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 1, 5);
      const orbit = { target: new THREE.Vector3(0, 1, 0), enableDamping: true, update() {} };
      const gestures = new WorkspaceGestures();
      const rect = new DOMRect(0, 0, 1000, 800);
      let now = performance.now();
      function frame(x, pose, { elapsed = 40, editing = false, pinch = .1 } = {}) {
        const hand = window.__pose(x, .4, pose);
        hand.pinch = pinch;
        handState.hands = [hand];
        handState.frames++;
        gestures.update(camera, orbit, hand, rect, now += elapsed, false, editing, false);
      }
      for (let i = 0; i < 100; i++) {
        const direction = i % 2 === 0 ? 1 : -1;
        frame(.5, "point");
        frame(.5, "open");
        frame(.5 + direction * .05, "open", { elapsed: 170 });
        const start = camera.position.clone();
        frame(.5 + direction * .1, "open");
        if (camera.position.distanceTo(start) < .1) throw Error("orbit gesture was never armed");
        const stopped = camera.position.clone();
        frame(.5 + direction * .13, "open", { pinch: .59 });
        if (!camera.position.equals(stopped)) throw Error("orbit ignored raw pinch intent");
        frame(.5 + direction * .1, "open", { editing: true });
        frame(.5 + direction * .13, "open", { elapsed: 250 });
        if (!camera.position.equals(stopped)) throw Error("orbit moved during an edit or rearmed on release");
      }
      gestures.reset(camera, orbit);
      useApp.getState().updateCameraView(originalView);
      handState.hands = [];
      return { editTransitions: 100, unintendedMoves: 0 };
    });
  });

  await test("Mandarin dictation preserves draft, can stop or cancel, and never submits", async () => {
    await hands(null);
    await page.getByRole("button", { name: "生成", exact: true }).click();
    const ai = page.locator(".ai-panel");
    const input = ai.getByRole("textbox", { name: "AI 建模描述" });
    const waitForDraft = (value, readOnly) => page.waitForFunction(({ value, readOnly }) => {
      const field = document.querySelector(".ai-input");
      return field?.value === value && field.readOnly === readOnly;
    }, { value, readOnly });
    await input.fill("四角圆润");
    const count = () => page.evaluate(() => window.__spatial.useApp.getState().tasks.length);
    const before = await count();
    await ai.getByRole("button", { name: "语音输入" }).click();
    assert.equal(await page.evaluate(() => window.__speech.lang), "zh-CN");
    await page.evaluate(() => window.__speech.text("蓝色收纳盒", false));
    await waitForDraft("四角圆润 蓝色收纳盒", true);
    assert.equal(await input.inputValue(), "四角圆润 蓝色收纳盒");
    await page.evaluate(() => window.__speech.text("蓝色收纳盒", true));
    await ai.getByRole("button", { name: "停止听写" }).click();
    await waitForDraft("四角圆润 蓝色收纳盒", false);
    assert.equal(await input.inputValue(), "四角圆润 蓝色收纳盒");
    await ai.getByRole("button", { name: "语音输入" }).click();
    await page.evaluate(() => window.__speech.text("临时内容", false));
    await ai.getByRole("button", { name: "取消听写" }).click();
    await waitForDraft("四角圆润 蓝色收纳盒", false);
    assert.equal(await input.inputValue(), "四角圆润 蓝色收纳盒");
    await ai.getByRole("button", { name: "语音输入" }).click();
    await page.evaluate(() => window.__speech.onerror({ error: "not-allowed" }));
    await page.waitForFunction(() => document.querySelector(".dictation-status")?.textContent.includes("未允许语音识别"));
    assert.ok((await ai.getByRole("status").innerText()).includes("未允许语音识别。可在输入框按 Win + H"));
    assert.equal(await count(), before);
    await page.screenshot({ path: `${output}/ai-dictation.png` });
  });

  await test("no browser exceptions", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ date: new Date().toISOString(), results, errors }, null, 2));
}
if (results.some(result => result.status !== "PASS")) process.exitCode = 1;
