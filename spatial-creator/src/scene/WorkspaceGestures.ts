import * as THREE from "three";
import type { OrbitControls } from "three-stdlib";
import { classifyGesture } from "../lib/gesture";
import { handState, type HandFrame } from "../lib/handState";
import { intentPredictor } from "../lib/intentPredictor";
import { useApp } from "../store";
import { saveCameraView } from "./CameraController";
import { gestureRuntime } from "./runtime";

type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type Sample = { x: number; y: number; span: number; palm: number; openCount: number };
type Candidate = { kind: "orbit" | "panZoom" | "history" | "menu" | "focus"; ids: number[]; since: number; start: Sample; last: Sample; zoomPalm: number; moved: boolean };

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_ORIGIN = new THREE.Vector3(0, 0.9, 0);
const LIMIT = THREE.MathUtils.degToRad(85);
const ORBIT_YAW_SCALE = Math.PI * 0.85;
const ORBIT_PITCH_SCALE = Math.PI * 0.65;
const MAX_ORBIT_STEP_THETA = 0.35;
const MAX_ORBIT_STEP_PHI = 0.28;

function facingCamera(hand: HandFrame) {
  const [w, a, b] = [hand.world[0], hand.world[5], hand.world[17]];
  if (!w || !a || !b) return false;
  const ax = a.x - w.x, ay = a.y - w.y, az = a.z - w.z;
  const bx = b.x - w.x, by = b.y - w.y, bz = b.z - w.z;
  const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
  return Math.abs(z) > Math.hypot(x, y, z) * .38;
}

function palm(hand: HandFrame, rect: DOMRect): Sample {
  const w = hand.screen[0], m = hand.screen[9];
  return { x: (w.x + m.x) * .5 * rect.width, y: (w.y + m.y) * .5 * rect.height, span: 0, palm: hand.palm, openCount: hand.fingers.count };
}

function sample(primary: HandFrame, other: HandFrame | undefined, rect: DOMRect): Sample {
  const a = palm(primary, rect);
  if (!other) return a;
  const b = palm(other, rect);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y), palm: (a.palm + b.palm) / 2, openCount: a.openCount };
}

export class WorkspaceGestures {
  private candidate: Candidate | null = null;
  private lastFrame = -1;
  private lastSampleAt = 0;
  private needsNeutral = false;
  private moving = false;
  private damping = true;
  private menuLost = 0;
  private offset = new THREE.Vector3();
  private delta = new THREE.Vector3();
  private spherical = new THREE.Spherical();

  reset(camera: Camera, orbit: OrbitControls | null, neutral = false, save = true) {
    if (this.moving && orbit) {
      orbit.enableDamping = this.damping;
      if (save) saveCameraView(camera, orbit);
    }
    this.candidate = null;
    this.moving = false;
    this.needsNeutral ||= neutral;
    if (gestureRuntime.palms.length) gestureRuntime.palms = [];
    gestureRuntime.cue = "";
  }

  update(camera: Camera, orbit: OrbitControls | null, hand: HandFrame | null, rect: DOMRect, now: number, blocked: boolean, editing: boolean, mouse: boolean) {
    const s = useApp.getState();
    const menu = s.gestureMenu;
    if (menu) {
      if (mouse && !hand) return true;
      if (!hand || menu.id !== hand.id) {
        this.menuLost ||= now;
        if (now - this.menuLost > 450) s.setGestureMenu(null);
      } else {
        this.menuLost = 0;
        if (Math.hypot(hand.view.x - menu.x, hand.view.y - menu.y) > .36) s.setGestureMenu(null);
      }
      return true;
    }
    this.menuLost = 0;

    if (!hand || !orbit || editing || mouse) {
      this.reset(camera, orbit, editing || mouse);
      if (!hand && !editing && !mouse) this.needsNeutral = false;
      return false;
    }
    const pose = classifyGesture(hand.fingers, hand.pinched);
    const hands = handState.hands.length ? handState.hands : [hand];
    const pinchIntent = pose !== "fist" && hands.some(h => h.pinched || (h.pinchClosure ?? h.pinch) >= Math.max(.35, s.settings.pinchSensitivity - .12));
    if (blocked || pinchIntent) {
      this.reset(camera, orbit, pinchIntent && Boolean(this.candidate));
      return false;
    }
    if (handState.frames === this.lastFrame) return this.moving;
    this.lastFrame = handState.frames;

    const open = hands.filter(h => classifyGesture(h.fingers, h.pinched) === "open" && facingCamera(h));
    if (!open.length && pose !== "peace" && pose !== "fist" && pose !== "three") {
      this.reset(camera, orbit);
      this.needsNeutral = false;
      return false;
    }
    if (this.needsNeutral) return false;

    const previous = this.candidate;
    const first = open.find(h => h.id === previous?.ids[0]) ?? open.find(h => h.id !== hand.id) ?? open[0];
    const second = open.find(h => h.id !== first?.id);
    const kind = second ? "panZoom" : first ? "orbit" : pose === "peace" ? "history" : pose === "three" ? "focus" : "menu";
    const ids = second ? [first.id, second.id] : [first?.id ?? hand.id];
    const p = kind === "history" || kind === "focus"
      ? { x: hand.view.x * rect.width, y: hand.view.y * rect.height, span: 0, palm: hand.palm, openCount: hand.fingers.count }
      : sample(first ?? hand, second, rect);
    if (!previous || previous.kind !== kind || ids.some((id, i) => id !== previous.ids[i])) {
      const changeToSingle = previous?.kind === "panZoom" && kind === "orbit";
      const changeToTwoHandAfterOrbit = previous?.kind === "orbit" && previous.moved && kind === "panZoom";
      const changedOrbitHand = previous?.kind === "orbit" && kind === "orbit";
      this.reset(camera, orbit, changeToSingle || changeToTwoHandAfterOrbit || changedOrbitHand);
      if (!this.needsNeutral) {
        this.candidate = { kind, ids, since: now, start: p, last: p, zoomPalm: p.palm, moved: false };
        this.lastSampleAt = now;
        gestureRuntime.cue = kind;
        if (kind === "orbit" || kind === "panZoom") gestureRuntime.palms = ids;
      }
      return false;
    }

    const side = Math.min(rect.width, rect.height);
    if (side <= 0) return false;
    const dx = p.x - previous.start.x, dy = p.y - previous.start.y;
    const dwell = now - previous.since;
    if (kind === "focus") {
      if (Math.hypot(dx, dy) > side * .035) {
        previous.start = p;
        previous.since = now;
      } else if (dwell >= 500) {
        const selected = s.selectedIds.length > 0;
        if (s.objects.length) {
          window.dispatchEvent(new CustomEvent("aether:view", { detail: selected ? "selected" : "all" }));
        }
        this.reset(camera, orbit, true);
      }
      return true;
    }
    if (kind === "menu") {
      if (Math.hypot(dx, dy) > side * .055) {
        previous.start = p;
        previous.since = now;
      } else if (dwell >= 350) {
        s.setGestureMenu({ id: hand.id, x: hand.view.x, y: hand.view.y });
        this.reset(camera, orbit, true);
      }
      return true;
    }
    if (kind === "history") {
      if (dwell >= 200) gestureRuntime.cue = "history-ready";
      if (dwell > Math.max(900, Math.min(1600, 450 + handState.resultIntervalMs * 2.5))) this.reset(camera, orbit, true);
      else if (dwell >= 200 && Math.abs(dx) >= side * .1 && Math.abs(dy) <= Math.abs(dx) * .45) {
        const ok = dx < 0 ? s.undo() : s.redo();
        if (ok) s.toast(dx < 0 ? "已撤销" : "已重做", "ok");
        this.reset(camera, orbit, true);
      }
      return true;
    }
    if (gestureRuntime.palms !== previous.ids) gestureRuntime.palms = previous.ids;
    const travel = Math.max(Math.hypot(dx, dy), Math.abs(p.span - previous.start.span));
    if (!previous.moved && travel < side * .03) {
      this.lastSampleAt = now;
      return false;
    }
    if (!this.moving) {
      this.damping = orbit.enableDamping;
      orbit.enableDamping = false;
      this.moving = true;
      const fraction = side * .03 / travel;
      previous.last = {
        x: previous.start.x + dx * fraction,
        y: previous.start.y + dy * fraction,
        span: THREE.MathUtils.lerp(previous.start.span, p.span, fraction),
        palm: previous.start.palm,
        openCount: p.openCount,
      };
      previous.moved = true;
    }
    const last = previous.last;
    if (Math.max(Math.hypot(p.x - last.x, p.y - last.y), Math.abs(p.span - last.span)) < Math.max(2, side * .0025)) {
      this.lastSampleAt = now;
      return true;
    }
    this.lastSampleAt = now;
    previous.last = p;
    if (kind === "orbit") {
      // Strictly linear mapping from hand displacement to orbit angle without non-linear speed boost.
      const dTheta = THREE.MathUtils.clamp(-((p.x - last.x) / side) * ORBIT_YAW_SCALE, -MAX_ORBIT_STEP_THETA, MAX_ORBIT_STEP_THETA);
      const dPhi = THREE.MathUtils.clamp(-((p.y - last.y) / side) * ORBIT_PITCH_SCALE, -MAX_ORBIT_STEP_PHI, MAX_ORBIT_STEP_PHI);
      this.rotateDelta(camera, orbit, dTheta, dPhi);
    } else {
      this.panZoom(camera, orbit, p, last, rect.height, side);
    }
    orbit.update();
    camera.updateMatrixWorld();
    return true;
  }

  private rotateDelta(camera: Camera, orbit: OrbitControls, dTheta: number, dPhi: number) {
    this.spherical.setFromVector3(this.offset.copy(camera.position).sub(orbit.target));
    this.spherical.theta += dTheta;
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi + dPhi, Math.PI / 2 - LIMIT, Math.PI / 2 + LIMIT);
    camera.up.copy(WORLD_UP);
    camera.position.copy(orbit.target).add(this.offset.setFromSpherical(this.spherical));
  }

  private panZoom(camera: Camera, orbit: OrbitControls, p: Sample, last: Sample, height: number, side: number) {
    const offset = this.offset.copy(camera.position).sub(orbit.target);
    const distance = offset.length();
    const ortho = camera as THREE.OrthographicCamera;
    const visible = ortho.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom
      : distance * 2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
    const panDelta = Math.hypot(p.x - last.x, p.y - last.y);
    const spanDelta = Math.abs(p.span - last.span);
    // Keep orbit.target anchored during two-hand pinch/spread zoom unless both hands clearly pan together.
    if (panDelta > Math.max(side * .015, spanDelta * .12)) {
      const move = this.delta.set(-(p.x - last.x) * visible / height, (p.y - last.y) * visible / height, 0).applyQuaternion(camera.quaternion);
      orbit.target.add(move);
      const maxTargetOffset = Math.max(12, distance * 2.5);
      const fromOrigin = this.delta.copy(orbit.target).sub(DEFAULT_ORIGIN);
      if (fromOrigin.length() > maxTargetOffset) {
        orbit.target.copy(DEFAULT_ORIGIN).add(fromOrigin.setLength(maxTargetOffset));
      }
    }
    const factor = THREE.MathUtils.clamp(Math.exp((p.span - last.span) * 2.6 / side), .75, 1.35);
    if (ortho.isOrthographicCamera) {
      ortho.zoom = THREE.MathUtils.clamp(ortho.zoom * factor, .1, 10);
      ortho.updateProjectionMatrix();
    } else {
      offset.setLength(THREE.MathUtils.clamp(distance / factor, orbit.minDistance, orbit.maxDistance));
    }
    camera.position.copy(orbit.target).add(offset);
    if (spanDelta > 2) intentPredictor.onZoomDetected(factor > 1 ? "in" : "out");
  }
}
