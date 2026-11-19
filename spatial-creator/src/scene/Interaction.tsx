import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useApp } from "../store";
import { handInputWindow, handPoseWindow, handState } from "../lib/handState";
import { drawRuntime, objectRegistry, pointerRuntime } from "./runtime";
import { beginSculptOp, cancelSculptOp, captureGeometry, endSculptOp, sculptFromBaseline } from "../lib/deformation";
import { buildExtrusionGeometry, LiveRibbon, smoothStroke } from "../lib/stroke";
import { commitExtrusion, prepareSketchExtrusion } from "../lib/extrusion";
import { intentPredictor } from "../lib/intentPredictor";
import { metrics } from "../lib/metrics";
import { indexTapUi, pinchUi, releaseUi, resetIndexTap, suspendHandPointer, syncUiPointer, uiPointer } from "../lib/uiPointer";
import { descendants, fromMatrix, matrix } from "../lib/assembly";
import { selectionIds } from "../lib/selection";
import type { Vec3 } from "../types";
import type { OrbitControls } from "three-stdlib";
import { WorkspaceGestures } from "./WorkspaceGestures";

const DRAW_DISTANCE = 3.2;
const MAX_STROKE_POINTS = 420;

function hierarchyLocked(id: string) {
  const { objects,selectedIds } = useApp.getState(), ids = selectionIds(objects,selectedIds.includes(id)?selectedIds:[id]);
  return objects.some(o => ids.has(o.id) && o.locked);
}

function syncHierarchy(id: string, preview: boolean) {
  const { objects,selectedIds } = useApp.getState(), original = objects.find(o => o.id === id), runtime = objectRegistry.get(id);
  if (!original || !runtime) return;
  const ids = selectionIds(objects,selectedIds.includes(id)?selectedIds:[id]);
  runtime.updateMatrix();
  const delta = runtime.matrix.clone().multiply(matrix(original.transform).invert());
  for (const object of objects) {
    if (!ids.has(object.id) || (preview && object.id === id)) continue;
    const node = objectRegistry.get(object.id); if (!node) continue;
    const next = preview ? fromMatrix(delta.clone().multiply(matrix(object.transform))) : object.transform;
    node.position.fromArray(next.position); node.rotation.set(...next.rotation); node.scale.fromArray(next.scale);
    node.updateMatrixWorld(true);
  }
}

type Mode =
  | { kind: "none" }
  | { kind: "grab"; id: string; offset: THREE.Vector3; plane: THREE.Plane }
  | { kind: "stroke"; plane: THREE.Plane; planeId: string }
  | { kind: "extrude"; id: string; startY: number; moved: boolean }
  | { kind: "sculpt"; id: string; mesh: THREE.Mesh; point: THREE.Vector3; normal: THREE.Vector3; dist: number; diagonal: number; minSize: number }
  | { kind: "twohand"; id: string; hands: number[]; partner: { x: number; y: number }; dist: number; angle: number; scale0: THREE.Vector3; rotY0: number };

export function Interaction() {
  const { camera, gl, controls } = useThree();
  const orbit = controls as OrbitControls | null;
  const gestures = useMemo(() => new WorkspaceGestures(), []);
  const mode = useRef<Mode>({ kind: "none" });
  const prevPinch = useRef(false);
  const source = useRef<"hand" | "mouse">("mouse");
  const sourceHandId = useRef<number | null>(null);
  const lastHandNdc = useRef({ x: 0, y: 0 });
  const cancelEpoch = useRef(useApp.getState().cancelEpoch);
  const rearm = useRef({ hand: false, mouse: false });
  const lostAt = useRef(0);
  const lastEditSample = useRef(-1);
  const lastHandAt = useRef(0);
  const mouseUntil = useRef(0);
  const mouseButton = useRef(-1);
  const sketchSource = useRef<unknown>(null);
  const sketchDirection = useMemo(() => new THREE.Vector3(), []);
  const handleNdc = useMemo(() => new THREE.Vector2(2, 2), []);
  const recovering = useRef({ frame: 0, count: 0 });
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const tmp = useMemo(
    () => ({
      v1: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      plane: new THREE.Plane(),
      dir: new THREE.Vector3(),
      m: new THREE.Matrix4(),
      sample: new THREE.Vector3(),
      projected: new THREE.Vector3(),
    }),
    [],
  );
  const rectRef = useRef<DOMRect | null>(null);
  const rectTick = useRef(0);
  const lastFeedbackFrame = useRef(-1);
  const stalledFrame = useRef(-1);
  const strokeReleaseAt = useRef(0);
  const contact = useRef({ id: "", frame: -1, count: 0, x: 0, y: 0 });

  const cancel = () => {
    const m = mode.current;
    if (m.kind === "sculpt") cancelSculptOp();
    if (m.kind === "grab" || m.kind === "twohand") syncHierarchy(m.id, false);
    drawRuntime.active = false; drawRuntime.points = []; drawRuntime.closing = false;
    drawRuntime.thickness = 0;
    lostAt.current = 0; recovering.current.count = 0; strokeReleaseAt.current = 0;
    mode.current = { kind: "none" };
    rearm.current.hand = true;
    rearm.current.mouse = true;
    releaseUi(); useApp.getState().setInteraction("Cancelled");
  };

  /* 鼠标回退输入 */
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      handState.mouse.x = (e.clientX - r.left) / r.width;
      handState.mouse.y = (e.clientY - r.top) / r.height;
      handState.mouseMode = true;
      handState.mouse.movedAt = performance.now();
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && mode.current.kind !== "none") { e.stopImmediatePropagation(); return; }
      mouseButton.current = e.button;
      mouseUntil.current = performance.now() + 300;
      if (mode.current.kind !== "none" && source.current === "hand") cancel();
      move(e);
      if (e.button === 0) handState.mouse.down = true;
    };
    const up = () => {
      if (mouseButton.current >= 0) mouseUntil.current = performance.now() + 300;
      mouseButton.current = -1;
      handState.mouse.down = false;
    };
    const wheel = (e: WheelEvent) => {
      if (mode.current.kind !== "none") { e.preventDefault(); e.stopImmediatePropagation(); return; }
      handState.mouse.movedAt = performance.now();
      mouseUntil.current = handState.mouse.movedAt + 300;
    };
    const interrupted = () => { up(); cancel(); useApp.getState().setGestureMenu(null); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("wheel", wheel, { capture: true, passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("blur", interrupted);
    el.addEventListener("pointercancel", interrupted);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("wheel", wheel, true);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", interrupted);
      el.removeEventListener("pointercancel", interrupted);
      cancel();
    };
  }, [gl]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    const st = useApp.getState();
    const now = performance.now();
    metrics.markRender(dtRaw * 1000);

    if (cancelEpoch.current !== st.cancelEpoch) {
      cancelEpoch.current = st.cancelEpoch;
      cancel();
      if (st.gestureMenu) st.setGestureMenu(null);
      resetIndexTap();
      gestures.reset(camera, orbit, true, false);
    }

    const mouseActive = mouseButton.current >= 0 || now < mouseUntil.current;
    const capture = mode.current;
    const capturedHand = capture.kind !== "none" && source.current === "hand" ? sourceHandId.current : null;
    // A slow but continuous Worker still owns this edit. Reused frames never move
    // geometry (see lastEditSample); an empty/ambiguous result still freezes immediately.
    const inputWindow = capturedHand !== null && handState.trackingState === "READY"
      ? handPoseWindow() : handInputWindow();
    const handFresh =
      handState.status === "ready" && !handState.paused && handState.trackingState !== "IDENTITY_UNCERTAIN" && now - handState.updatedAt < inputWindow;
    // A renderer stall can delay both the tracker callback and this frame. Wait for its queued result.
    if (capturedHand !== null && !handFresh && dtRaw > .12 && handState.trackingState === "READY"
      && !handState.paused && stalledFrame.current !== handState.frames && handState.hands.some(h => h.id === capturedHand)) {
      stalledFrame.current = handState.frames;
      return;
    }
    const hand = handFresh && !mouseActive
      ? capturedHand === null ? handState.primary : handState.hands.find(h => h.id === capturedHand) ?? null
      : null;
    const useHand = Boolean(hand);
    if (useHand && handState.sourceFrameAt > 0 && lastFeedbackFrame.current !== handState.frames) { metrics.markFeedback(performance.now() - handState.sourceFrameAt); lastFeedbackFrame.current = handState.frames; }
    const ndc = useHand
      ? hand!.ndc
      : { x: handState.mouse.x * 2 - 1, y: -(handState.mouse.y * 2 - 1) };
    const rawPinched = useHand ? hand!.pinched : handState.mouse.down;
    const lostPartner = capture.kind === "twohand" && capture.hands.some(id => !handState.hands.some(h => h.id === id));
    if (capture.kind !== "none" && source.current === "hand" && (!useHand || lostPartner)) {
      suspendHandPointer();
      resetIndexTap();
      pointerRuntime.active = pointerRuntime.hasWorldPoint = pointerRuntime.contactConfirmed = false;
      pointerRuntime.hoverId = null;
      if (!lostAt.current) {
        // When results stop entirely, count loss from the last known sample.
        lostAt.current = handState.updatedAt && now - handState.updatedAt >= inputWindow ? handState.updatedAt : now;
      }
      recovering.current.count = 0;
      st.setInteraction(now - lostAt.current > 200 ? "Lost" : "LostPending");
      if (now - lostAt.current >= 450) { cancel(); st.toast("手部追踪中断，当前操作已回滚", "warn"); }
      return;
    }
    if (lostAt.current && useHand) {
      if (now - lostAt.current >= 450) {
        cancel();
        st.toast("手部追踪中断，当前操作已回滚", "warn");
        return;
      }
      if (recovering.current.frame !== handState.frames) { recovering.current.frame = handState.frames; recovering.current.count++; }
      const needed = handState.resultIntervalMs >= 80 || handState.trackingState === "READY" ? 1 : 3;
      if (recovering.current.count < needed) { st.setInteraction("Recovering"); return; }
      const duration = now - lostAt.current;
      const partner = capture.kind === "twohand" ? handState.hands.find(h => h.id !== hand!.id && capture.hands.includes(h.id)) : null;
      const maxJump = capture.kind === "stroke" ? .5 : .05;
      const continuous = duration < 450 && sourceHandId.current === hand!.id
        && Math.hypot(hand!.ndc.x-lastHandNdc.current.x, hand!.ndc.y-lastHandNdc.current.y) < maxJump
        && (!partner || capture.kind === "twohand" && Math.hypot(partner.ndc.x - capture.partner.x, partner.ndc.y - capture.partner.y) < .12);
      lostAt.current = 0; recovering.current.count = 0;
      if (!continuous) cancel();
    }
    if (capturedHand !== null && useHand && lastEditSample.current === handState.frames) return;
    if (useHand) {
      lastEditSample.current = handState.frames;
      lastHandAt.current = hand!.timestamp ?? handState.updatedAt;
      lastHandNdc.current = { ...hand!.ndc };
    }
    if (useHand && !rawPinched) rearm.current.hand = false;
    if (!handState.mouse.down) rearm.current.mouse = false;
    const pinched = rawPinched && !rearm.current[useHand ? "hand" : "mouse"];

    pointerRuntime.ndc.set(ndc.x, ndc.y);
    // Do not teleport the scene ring to the old mouse position when a hand frame drops.
    const mouseOwnsPointer = mouseActive || handState.paused || handState.status !== "ready" || handState.mouse.movedAt > lastHandAt.current;
    pointerRuntime.active = useHand || (handState.mouseMode && mouseOwnsPointer);
    pointerRuntime.pinched = pinched;
    pointerRuntime.pinch = useHand ? hand!.pinch : pinched ? 1 : 0;
    pointerRuntime.source = useHand ? "hand" : "mouse";

    const pinchEdgeRaw = pinched && !prevPinch.current;
    const releaseEdge = !pinched && prevPinch.current;
    prevPinch.current = pinched;

    metrics.markPointer(ndc.x, ndc.y);

    /* ---------------- UI 层：手势悬停与点击 ----------------
     * 纯手势用户点不到工具栏就等于进不去绘制/生成，所以这一层是必需的：
     * 指针压在按钮上 → 高亮；捏一下 → 真实 click。命中 UI 时抑制 3D 交互。 */
    rectTick.current++;
    if (!rectRef.current || rectTick.current % 24 === 0) {
      rectRef.current = gl.domElement.getBoundingClientRect();
    }
    syncUiPointer(ndc, rectRef.current, useHand ? "hand" : "mouse", now, pinched, lastHandAt.current);
    if (releaseEdge) releaseUi();
    const captured = mode.current.kind !== "none";
    const menuOwner = !st.gestureMenu || (st.gestureMenu.id === hand?.id && !!uiPointer.target?.closest(".gesture-menu"));
    const poseHand = hand ?? (!mouseActive && !captured && handState.status === "ready" && !handState.paused
      && handState.trackingState === "READY" && now - handState.updatedAt < handPoseWindow() ? handState.primary : null);
    const tapConsumed = indexTapUi(!captured ? poseHand : null, handState.frames, now, st.gestureMenu?.id ?? null);
    const uiConsumed = tapConsumed || (!captured && menuOwner && pinchUi(pinchEdgeRaw, now));
    const gestureConsumed = gestures.update(camera, orbit, poseHand, rectRef.current, now, tapConsumed || useHand && (uiPointer.blockScene || uiConsumed), captured || releaseEdge, mouseActive);
    if (tapConsumed || gestureConsumed) {
      pointerRuntime.hoverId = null;
      pointerRuntime.hasWorldPoint = false;
      return;
    }

    raycaster.setFromCamera(pointerRuntime.ndc as unknown as THREE.Vector2, camera);

    // 指针压在界面上时不做拾取：否则会"隔着面板选中后面的球"，物体高亮也会误导用户
    const canPick = !uiPointer.blockScene && pointerRuntime.active && st.tool !== "draw";
    const hits = canPick ? raycaster.intersectObjects(Array.from(objectRegistry.values()).filter(o => o.visible), true) : [];
    const hit = hits.find((h) => (h.object as THREE.Mesh).isMesh) || null;

    pointerRuntime.hoverId = hit ? (hit.object.userData.objectId ?? findId(hit.object)) : null;
    if (hit) {
      pointerRuntime.worldPoint.copy(hit.point);
      pointerRuntime.hasWorldPoint = true;
      if (hit.face) {
        pointerRuntime.normal.copy(hit.face.normal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
      }
    } else {
      pointerRuntime.hasWorldPoint = false;
    }
    if (!hit || !useHand) { pointerRuntime.contactConfirmed = !!hit; contact.current.count = 0; }
    else if (contact.current.frame !== handState.frames) {
      const c = contact.current;
      c.count = c.id === pointerRuntime.hoverId && Math.hypot(c.x-ndc.x,c.y-ndc.y) < .04 ? c.count + 1 : 1;
      c.id = pointerRuntime.hoverId ?? ""; c.frame = handState.frames; c.x = ndc.x; c.y = ndc.y;
      pointerRuntime.contactConfirmed = c.count >= 3;
    }

    /* 被 UI 消费的捏合不再触达 3D：否则点"绘制"的同时会在画布上落一笔。
     * 另外只要指针压在界面皮面上就整体抑制 3D 拾取，避免"点按钮却选中了后面的球"、
     * "在属性面板空白处捏合却在画布上画了一条线"。 */
    const pinchEdge = pinchEdgeRaw && !uiConsumed && !uiPointer.blockScene;
    if (pinchEdge) { source.current = useHand ? "hand" : "mouse"; sourceHandId.current = hand?.id ?? null; }
    if (pinchEdge) metrics.markPinchApplied();
    if (mode.current.kind === "none") st.setInteraction(pointerRuntime.hoverId ? "Hover" : "Idle");
    else st.setInteraction(mode.current.kind === "sculpt" ? "Pressing" : mode.current.kind === "stroke" || mode.current.kind === "extrude" ? "Drawing" : "Grabbing");
    const current = mode.current;
    if ((current.kind === "grab" || current.kind === "sculpt" || current.kind === "twohand") && !st.objects.some(o => o.id === current.id && !o.locked && o.visible)) { cancel(); return; }
    if ((current.kind === "grab" || current.kind === "twohand") && hierarchyLocked(current.id)) { cancel(); return; }

    /* ---------------- 双手：缩放 + 绕 Y 旋转 ---------------- */
    if (
      st.tool === "select" &&
      useHand && (current.kind === "twohand" || !uiPointer.blockScene && !uiConsumed) && !rearm.current.hand &&
      handState.twoHand.active &&
      handState.hands.length >= 2 &&
      handState.hands.some(h => h.id === hand!.id) &&
      handState.hands.every((h) => h.pinched) &&
      st.selectedId && (current.kind === "none" || current.kind === "grab" || current.kind === "twohand")
    ) {
      const id = st.selectedId;
      const obj = objectRegistry.get(id);
      if (obj && !hierarchyLocked(id)) {
        if (mode.current.kind !== "twohand") {
          if (mode.current.kind !== "none") cancel();
          source.current = "hand"; sourceHandId.current = hand!.id; rearm.current.hand = false;
          mode.current = {
            kind: "twohand",
            id,
            hands: handState.hands.map(h => h.id),
            partner: { ...handState.hands.find(h => h.id !== hand!.id)!.ndc },
            dist: handState.twoHand.distance,
            angle: handState.twoHand.angle,
            scale0: obj.scale.clone(),
            rotY0: obj.rotation.y,
          };
        } else {
          const m = mode.current as Extract<Mode, { kind: "twohand" }>;
          m.partner = { ...handState.hands.find(h => h.id !== hand!.id)!.ndc };
          const ratio = Math.max(0.25, Math.min(4, handState.twoHand.distance / Math.max(1e-3, m.dist)));
          obj.scale.copy(m.scale0).multiplyScalar(ratio);
          let dA = handState.twoHand.angle - m.angle;
          while (dA > Math.PI) dA -= Math.PI * 2;
          while (dA < -Math.PI) dA += Math.PI * 2;
          obj.rotation.y = m.rotY0 + dA;
          syncHierarchy(m.id, true);
        }
      }
      return;
    }
    if (mode.current.kind === "twohand") {
      const m = mode.current as Extract<Mode, { kind: "twohand" }>;
      const obj = objectRegistry.get(m.id);
      if (obj && handState.hands.some(h => m.hands.includes(h.id) && !h.pinched)) {
        useApp.getState().setTransform(m.id, {
          position: obj.position.toArray() as Vec3,
          rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as Vec3,
          scale: obj.scale.toArray() as Vec3,
        });
        syncHierarchy(m.id, false);
      } else {
        syncHierarchy(m.id, false);
      }
      mode.current = { kind: "none" };
    }

    /* ---------------- 工具 ---------------- */

    if (st.tool === "draw") {
      const planePoint = tmp.v1.copy(camera.position).addScaledVector(camera.getWorldDirection(tmp.v2), DRAW_DISTANCE);
      tmp.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp.dir), planePoint);
      if (st.settings.drawPlane !== "camera") {
        const normal = st.settings.drawPlane === "xy" ? new THREE.Vector3(0, 0, 1) : st.settings.drawPlane === "xz" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        tmp.plane.set(normal, -st.settings.drawDepth);
      }
      if (mode.current.kind === "stroke") tmp.plane.copy(mode.current.plane);
      drawRuntime.plane.copy(tmp.plane);
      const p = tmp.sample;
      const ok = raycaster.ray.intersectPlane(tmp.plane, p);
      const selected = st.objects.find(o => o.id === st.selectedId);
      if (sketchSource.current !== selected) {
        sketchSource.current = selected;
        drawRuntime.extrusion = null;
        drawRuntime.thickness = 0;
        if (selected?.kind === "stroke") {
          try { drawRuntime.extrusion = prepareSketchExtrusion(selected, camera.getWorldDirection(sketchDirection)); }
          catch { /* Open sketches remain editable. */ }
        }
      }
      const sketch = drawRuntime.extrusion;
      const action = mode.current;
      if (action.kind === "extrude") {
        if (!sketch || sketch.source.id !== action.id) { cancel(); return; }
        const pixels = (ndc.y - action.startY) * rectRef.current.height * .5;
        action.moved ||= Math.abs(pixels) >= 8;
        if (pinched && action.moved) {
          drawRuntime.thickness = sketch.profile.diagonal * THREE.MathUtils.clamp(.15 + pixels / rectRef.current.height * 2, .005, 4);
        }
        if (releaseEdge) {
          if (action.moved) {
            try { commitExtrusion(sketch, drawRuntime.thickness); }
            catch (e) { st.toast((e as Error).message, "warn"); }
          }
          drawRuntime.thickness = 0;
          mode.current = { kind: "none" };
        }
        return;
      }
      if (pinchEdge && sketch && action.kind === "none" && distanceToHandle(ndc, handleNdc, rectRef.current) < 25) {
        drawRuntime.thickness = sketch.profile.diagonal * .15;
        mode.current = { kind: "extrude", id: sketch.source.id, startY: ndc.y, moved: false };
        return;
      }
      if (ok) {
        pointerRuntime.worldPoint.copy(p);
        pointerRuntime.hasWorldPoint = true;
        pointerRuntime.hoverId = null;
      }

      if (pinchEdge && ok) {
        strokeReleaseAt.current = 0;
        drawRuntime.active = true;
        drawRuntime.closing = false;
        drawRuntime.points = [p.clone()];
        mode.current = { kind: "stroke", plane: tmp.plane.clone(), planeId: `${st.settings.drawPlane}:${st.settings.drawDepth}` };
      } else if (pinched && mode.current.kind === "stroke" && ok) {
        strokeReleaseAt.current = 0;
        const points = drawRuntime.points;
        const last = tmp.projected.copy(points[points.length - 1]).project(camera);
        if (distanceToHandle(ndc, last, rectRef.current) >= 3) {
          pushStrokeSample(points, p);
          metrics.markStrokePoint();
        }
        const start = tmp.projected.copy(points[0]).project(camera);
        drawRuntime.closing = points.length >= 8 && distanceToHandle(ndc, start, rectRef.current) <= 14
          && points.some(point => point.distanceToSquared(points[0]) > .0025);
      } else if (!pinched && mode.current.kind === "stroke") {
        // 手势绘制时：明显张开手（pinch < 0.25）立即收笔；边缘抖动/侧手（0.25..off）给 150ms 宽限期防断笔
        const hardRelease = !useHand || (hand?.pinch ?? 0) < 0.25;
        const graceMs = hardRelease ? 0 : 150;
        if (!strokeReleaseAt.current) strokeReleaseAt.current = now;
        if (now - strokeReleaseAt.current >= graceMs) {
          strokeReleaseAt.current = 0;
          const state = mode.current;
          if (ok && !uiPointer.blockScene && distanceToHandle(ndc, tmp.projected.copy(drawRuntime.points.at(-1)!).project(camera), rectRef.current) >= 1) {
            pushStrokeSample(drawRuntime.points, p);
          }
          const closed = drawRuntime.closing && !!ok && distanceToHandle(ndc, tmp.projected.copy(drawRuntime.points[0]).project(camera), rectRef.current) <= 16;
          commitStroke(state.planeId, state.plane.normal.clone(), closed, camera.getWorldDirection(sketchDirection));
          metrics.markStrokeEnd();
          drawRuntime.active = false;
          drawRuntime.closing = false;
          mode.current = { kind: "none" };
        }
      }
      return;
    }

    if (st.tool === "sculpt") {
      const active = mode.current.kind === "sculpt" ? mode.current : null;
      if (active) {
        pointerRuntime.brushRadius = active.diagonal * THREE.MathUtils.clamp(st.settings.sculptRadius,.05,.2);
        pointerRuntime.pressure = THREE.MathUtils.clamp((pointerRuntime.pinch-.62)/.38,0,1);
        pointerRuntime.dentDepth = active.minSize * .05 * pointerRuntime.pressure * Math.min(1,st.settings.sculptStrength);
      } else if (pointerRuntime.hoverId) {
        const root = objectRegistry.get(pointerRuntime.hoverId);
        pointerRuntime.brushRadius = root ? new THREE.Box3().setFromObject(root).getSize(tmp.v1).length() * THREE.MathUtils.clamp(st.settings.sculptRadius,.05,.2) : 0;
        pointerRuntime.pressure=0; pointerRuntime.dentDepth=0;
      }
      if (pinchEdge) {
        if (useHand && !pointerRuntime.contactConfirmed) { st.toast("请稳定指向模型表面，再重新捏合", "info"); return; }
        const mesh = hit?.object as THREE.Mesh | undefined;
        const id = mesh ? findId(mesh) : null;
        if (mesh && mesh.isMesh && id && mesh.geometry?.getAttribute("position")) {
          const meta = useApp.getState().objects.find((o) => o.id === id);
          if (meta?.locked) {
            useApp.getState().toast("对象已锁定，先解锁再雕刻", "warn");
            return;
          }
          const isStroke = meta?.kind === "stroke";
          if (!isStroke) {
            beginSculptOp(mesh);
            const bounds = new THREE.Box3().setFromObject(objectRegistry.get(id)!);
            const size = bounds.getSize(new THREE.Vector3());
            mode.current = {
              kind: "sculpt",
              id,
              mesh,
              point: hit!.point.clone(),
              normal: pointerRuntime.normal.clone(),
              dist: camera.position.distanceTo(hit!.point),
              diagonal: size.length(), minSize: Math.max(1e-3, Math.min(...size.toArray())),
            };
            useApp.getState().select(id);
          }
        }
      } else if (pinched && mode.current.kind === "sculpt") {
        const m = mode.current as Extract<Mode, { kind: "sculpt" }>;
        const radius = m.diagonal * THREE.MathUtils.clamp(st.settings.sculptRadius, 0.05, 0.2);
        const strength = st.settings.sculptStrength;
        const sculptPlane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),m.point);
        const tipNear=raycaster.ray.intersectPlane(sculptPlane,new THREE.Vector3())??m.point.clone();
        if (st.sculptMode === "dent") {
          const tight = THREE.MathUtils.clamp((pointerRuntime.pinch - 0.62) / 0.38, 0, 1);
          sculptFromBaseline(m.mesh, m.point, radius, m.normal.clone().multiplyScalar(-0.05 * m.minSize * tight * Math.min(1, strength)));
        } else {
          const delta = tipNear.clone().sub(m.point).multiplyScalar(strength).clampLength(0, m.minSize * 0.2);
          sculptFromBaseline(m.mesh, m.point, radius, delta);
        }
      } else if (releaseEdge && mode.current.kind === "sculpt") {
        endSculptOp();
        const m = mode.current as Extract<Mode, { kind: "sculpt" }>;
        useApp.getState().patchObject(m.id, { deformed: true, geometryEdits: captureGeometry(objectRegistry.get(m.id)!) });
        mode.current = { kind: "none" };
      }
      return;
    }

    /* select / ai */
    pointerRuntime.brushRadius=0; pointerRuntime.pressure=0; pointerRuntime.dentDepth=0;
    if (pinchEdge) {
      const id = hit ? findId(hit.object) : null;
      if (id) {
        if(!useApp.getState().selectedIds.includes(id))useApp.getState().select(id);
        if (hierarchyLocked(id)) {
          // WS-005：锁定对象不响应抓取，避免误改布局
          useApp.getState().toast("对象或其子对象已锁定，先解锁再移动", "warn");
          return;
        }
        const obj = objectRegistry.get(id);
        if (obj) {
          const planeNormal = camera.getWorldDirection(new THREE.Vector3()).negate();
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, obj.position);
          const p = new THREE.Vector3();
          raycaster.ray.intersectPlane(plane, p);
          mode.current = {
            kind: "grab",
            id,
            offset: obj.position.clone().sub(p),
            plane,
          };
        }
      } else {
        useApp.getState().select(null);
      }
    } else if (pinched && mode.current.kind === "grab") {
      const m = mode.current as Extract<Mode, { kind: "grab" }>;
      const obj = objectRegistry.get(m.id);
      if (obj) {
        const p = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(m.plane, p)) {
          p.add(m.offset);
          obj.position.set(p.x, Math.max(0, p.y), p.z);
          syncHierarchy(m.id, true);
        }
      }
    } else if (releaseEdge && mode.current.kind === "grab") {
      const m = mode.current as Extract<Mode, { kind: "grab" }>;
      const obj = objectRegistry.get(m.id);
      if (obj) {
        useApp.getState().setTransform(m.id, {
          position: [obj.position.x, obj.position.y, obj.position.z],
        });
        syncHierarchy(m.id, false);
      }
      mode.current = { kind: "none" };
    }
  });

  return <><LiveStroke /><ExtrusionGuide handleNdc={handleNdc} /></>;
}

function distanceToHandle(a: { x: number; y: number }, b: { x: number; y: number }, rect: DOMRect) {
  return Math.hypot((a.x - b.x) * rect.width, (a.y - b.y) * rect.height) * .5;
}

function pushStrokeSample(points: THREE.Vector3[], point: THREE.Vector3) {
  if (points.length === MAX_STROKE_POINTS) {
    let least = Infinity, index = 1;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1].distanceTo(points[i]), b = points[i].distanceTo(points[i + 1]);
      const error = a + b - points[i - 1].distanceTo(points[i + 1]);
      if (error < least) { least = error; index = i; }
    }
    points.splice(index, 1);
  }
  points.push(point.clone());
}

function findId(obj: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (typeof cur.userData?.objectId === "string") return cur.userData.objectId;
    cur = cur.parent;
  }
  return null;
}

function commitStroke(planeId: string, normal: THREE.Vector3, closed: boolean, viewDirection: THREE.Vector3) {
  const pts = drawRuntime.points;
  const length = pts.reduce((sum, p, i) => sum + (i ? p.distanceTo(pts[i - 1]) : 0), 0);
  if (pts.length < 3 || length < 0.03) { useApp.getState().toast("轨迹太短：至少 3 个采样点和 0.03 场景单位", "warn"); return; }
  const { addObject, settings } = useApp.getState();
  const id = Math.random().toString(36).slice(2, 10);
  if (normal.dot(viewDirection) > 0) normal.negate();
  const rawPoints = pts.map(p => p.toArray() as Vec3);
  const points = smoothStroke(rawPoints, settings.strokeSmoothing);
  if (closed) points[points.length - 1] = [...points[0]];
  const object = {
    id,
    kind: "stroke",
    name: `笔迹 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    color: "#8ef0ff",
    points, rawPoints,
    planeNormal: normal.toArray() as Vec3,
    planeId, strokeId: id, version: 1, source: "stroke",
    width: 0.011,
    createdAt: Date.now(),
  } satisfies import("../types").SceneObject;
  addObject(object);
  intentPredictor.onStrokeCommitted(object);
  const { toast } = useApp.getState();
  if (closed) {
    try {
      prepareSketchExtrusion(object, viewDirection);
      toast("轮廓已闭合，捏住厚度手柄上下拖动", "ok");
    } catch (e) { toast((e as Error).message, "warn"); }
  } else toast(`笔迹已生成（${pts.length} 点）`, "ok");
}

function ExtrusionGuide({ handleNdc }: { handleNdc: THREE.Vector2 }) {
  const { camera, size } = useThree();
  const handle = useRef<THREE.Group>(null);
  const preview = useRef<THREE.Mesh>(null);
  const sketchRef = useRef<typeof drawRuntime.extrusion>(null);
  const unit = useRef<THREE.BufferGeometry | null>(null);
  const p = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => unit.current?.dispose(), []);
  useFrame(() => {
    const group = handle.current, mesh = preview.current;
    if (!group || !mesh) return;
    const sketch = drawRuntime.extrusion;
    const active = !!sketch && useApp.getState().tool === "draw" && !drawRuntime.active;
    group.visible = active && drawRuntime.thickness === 0;
    mesh.visible = active && drawRuntime.thickness > 0;
    if (sketchRef.current !== sketch) {
      unit.current?.dispose();
      unit.current = null;
      sketchRef.current = sketch;
    }
    if (!active || !sketch) return;
    if (mesh.visible) {
      if (!unit.current) {
        unit.current = buildExtrusionGeometry(sketch.profile, 1);
        mesh.geometry = unit.current;
      }
      const { x, y, z } = sketch.profile.normal;
      const d = drawRuntime.thickness - 1;
      mesh.matrix.set(
        1 + d*x*x, d*x*y, d*x*z, sketch.position.x,
        d*y*x, 1 + d*y*y, d*y*z, sketch.position.y,
        d*z*x, d*z*y, 1 + d*z*z, sketch.position.z,
        0, 0, 0, 1,
      );
      mesh.matrixWorldNeedsUpdate = true;
      return;
    }
    let right = -Infinity, top = -Infinity, bottom = Infinity, depth = 0;
    for (const point of sketch.contour) {
      p.fromArray(point).add(sketch.position).project(camera);
      if (p.x > right) { right = p.x; depth = p.z; }
      top = Math.max(top, p.y);
      bottom = Math.min(bottom, p.y);
    }
    if (depth < -1 || depth > 1 || right < -1 || bottom > 1 || top < -1) {
      handleNdc.set(2, 2);
      group.visible = false;
      return;
    }
    handleNdc.set(THREE.MathUtils.clamp(right + 54 / size.width, -.94, .94), THREE.MathUtils.clamp((top + bottom) / 2, -.91, .91));
    group.position.set(handleNdc.x, handleNdc.y, depth).unproject(camera);
    group.quaternion.copy(camera.quaternion);
    const scale = p.set(handleNdc.x + 30 / size.width, handleNdc.y, depth).unproject(camera).distanceTo(group.position);
    group.scale.setScalar(scale);
  });
  return <>
    <group ref={handle} name="thickness-handle" visible={false}>
      <mesh renderOrder={12} raycast={() => null}>
        <ringGeometry args={[.72, 1, 32]} />
        <meshBasicMaterial color="#ffdfa0" depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh renderOrder={12} raycast={() => null}>
        <circleGeometry args={[.24, 16]} />
        <meshBasicMaterial color="#ffdfa0" depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
    <mesh ref={preview} name="extrusion-preview" visible={false} matrixAutoUpdate={false} raycast={() => null}>
      <meshStandardMaterial color="#8ef0ff" roughness={.5} opacity={.62} transparent depthWrite={false} />
    </mesh>
  </>;
}

/** 绘制中的实时笔迹：预分配缓冲，每帧只更新顶点，不触发 React 渲染 */
function LiveStroke() {
  const ribbon = useMemo(() => new LiveRibbon(0.012), []);
  const meshRef = useRef<THREE.Mesh>(null);
  const startRef = useRef<THREE.Mesh>(null);
  const lastSample = useRef<THREE.Vector3 | undefined>(undefined);
  const wasActive = useRef(false);
  const { camera } = useThree();

  useEffect(() => {
    if (meshRef.current) meshRef.current.raycast = () => null;
    return () => ribbon.dispose();
  }, [ribbon]);

  useFrame(() => {
    const active = drawRuntime.active;
    if (active) {
      const sample = drawRuntime.points.at(-1);
      if (!wasActive.current || lastSample.current !== sample) {
        ribbon.update(drawRuntime.points, camera.position);
        lastSample.current = sample;
      }
      if (meshRef.current) meshRef.current.visible = true;
    } else if (meshRef.current && meshRef.current.visible) {
      meshRef.current.visible = false;
    }
    const material = meshRef.current?.material as THREE.MeshBasicMaterial | undefined;
    material?.color.set(drawRuntime.closing ? "#ffdfa0" : "#b6fffb");
    const start = startRef.current;
    if (start) {
      start.visible = active && drawRuntime.points.length > 2;
      if (start.visible) {
        start.position.copy(drawRuntime.points[0]);
        start.quaternion.copy(camera.quaternion);
        (start.material as THREE.MeshBasicMaterial).color.set(drawRuntime.closing ? "#ffdfa0" : "#7cf7e3");
      }
    }
    wasActive.current = active;
  });

  return (
    <><mesh ref={meshRef} geometry={ribbon.geometry} visible={false}>
      <meshBasicMaterial
        color="#b6fffb"
        transparent
        opacity={0.95}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
    <mesh ref={startRef} visible={false} raycast={() => null}>
      <ringGeometry args={[.025, .033, 20]} />
      <meshBasicMaterial color="#7cf7e3" depthWrite={false} toneMapped={false} />
    </mesh></>
  );
}

/** 三维光标：钉在当前接触点或绘制平面上，提供真实的空间反馈 */
export function PointerCursor() {
  const ring = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  /* 逐帧复用的临时对象：原来每帧 new Plane/Vector3/Raycaster，60fps 下等于每秒造 300 个垃圾 */
  const scratch = useMemo(
    () => ({
      p: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      plane: new THREE.Plane(),
      rc: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      scale: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
    }),
    [],
  );

  useFrame(() => {
    const g = ring.current;
    if (!g) return;
    g.visible = pointerRuntime.active && (pointerRuntime.source !== "hand" || pointerRuntime.hasWorldPoint);
    if (!g.visible) return;
    const { p, dir, plane, rc, ndc, scale, tmp } = scratch;
    if (pointerRuntime.hasWorldPoint) {
      p.copy(pointerRuntime.worldPoint);
    } else {
      camera.getWorldDirection(dir);
      plane.setFromNormalAndCoplanarPoint(dir, tmp.copy(camera.position).addScaledVector(dir, DRAW_DISTANCE));
      rc.setFromCamera(ndc.set(pointerRuntime.ndc.x, pointerRuntime.ndc.y), camera);
      if (!rc.ray.intersectPlane(plane, p)) return;
    }
    g.position.copy(p);
    if (useApp.getState().tool === "sculpt" && pointerRuntime.hasWorldPoint) g.quaternion.setFromUnitVectors(scale.set(0,0,1), pointerRuntime.normal);
    else g.lookAt(camera.position);
    const s = useApp.getState().tool === "sculpt" && pointerRuntime.brushRadius > 0 ? pointerRuntime.brushRadius / .038 : pointerRuntime.pinched ? 0.55 : 1;
    g.scale.lerp(scale.set(s, s, s), 0.25);
    if (mat.current) {
      const hot = pointerRuntime.hoverId !== null;
      mat.current.color.set(pointerRuntime.contactConfirmed ? "#ffb84d" : hot ? "#ffffff" : pointerRuntime.pinched ? "#39f5d4" : "#7cf7e3");
      mat.current.opacity = hot ? 0.95 : 0.6;
    }
    g.rotation.z += 0.02;
  });

  return (
    <group ref={ring} name="surface-pointer" visible={false}>
      <mesh>
        <ringGeometry args={[0.028, 0.038, 48]} />
        <meshBasicMaterial ref={mat} color="#7cf7e3" transparent opacity={0.7} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.006, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** 选中框：跟随对象真实世界包围盒（含形变） */
export function SelectionOverlay() {
  const selectedIds = useApp((s) => s.selectedIds);
  const ref = useRef<THREE.Mesh>(null);
  const frame = useRef(0);

  useFrame(() => {
    if (++frame.current % 3 !== 0) return;
    const m = ref.current;
    if (!m) return;
    if (!selectedIds.length) {
      m.visible = false;
      return;
    }
    const box = new THREE.Box3();
    for(const id of selectedIds){const obj=objectRegistry.get(id);if(obj&&obj.visible)box.expandByObject(obj);}
    if (box.isEmpty()) {
      m.visible = false;
      return;
    }
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    m.visible = true;
    m.position.copy(c);
    m.scale.set(Math.max(0.02, s.x + 0.06), Math.max(0.02, s.y + 0.06), Math.max(0.02, s.z + 0.06));
  });

  return (
    <mesh ref={ref} visible={false} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#2ee8c8" wireframe transparent opacity={0.4} toneMapped={false} />
    </mesh>
  );
}
