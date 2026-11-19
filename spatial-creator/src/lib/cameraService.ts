import { HandTracker } from "./handTracker";
import { handState, resetHandState } from "./handState";
import { useApp } from "../store";

let tracker: HandTracker | null = null;
let starting = false;

export const videoRegistry: { el: HTMLVideoElement | null } = { el: null };

function setStatus(s: "loading" | "ready" | "error", msg?: string) {
  const st = useApp.getState();
  st.setCameraReady(s === "ready");
  if (s === "error") st.toast(`手部追踪失败：${msg || "未知错误"}`, "err");
  if (s === "ready" && msg) st.toast(msg, "info");
}

export function getTracker() {
  if (!tracker) tracker = new HandTracker(useApp.getState().settings, setStatus);
  return tracker;
}

export function syncTrackerSettings() {
  tracker?.updateSettings(useApp.getState().settings);
}

export async function startCamera(deviceId?: string) {
  if (starting) return;
  const video = videoRegistry.el;
  if (!video) {
    useApp.getState().toast("摄像头预览元素尚未就绪", "warn");
    return;
  }
  starting = true;
  try {
    await getTracker().startCamera(video, deviceId);
    const settings = useApp.getState().settings;
    if (settings.calibration && (settings.calibration.deviceId !== handState.cameraInfo?.deviceId || settings.calibration.mirror !== settings.mirror)) useApp.getState().updateSettings({ calibration: null });
    useApp.getState().setCameraReady(true);
    useApp.getState().toast("手部追踪已就绪 —— 抬起手指试试", "ok");
  } catch (e) {
    tracker?.stop(); resetHandState();
    const msg = (e as Error)?.message || "无法访问摄像头";
    handState.status = "error";
    handState.error = msg;
    useApp.getState().setCameraReady(false);
    useApp.getState().toast(`摄像头不可用：${msg}。已切换到鼠标模式。`, "err");
  } finally {
    starting = false;
  }
}

export function stopCamera() {
  tracker?.stop();
  handState.status = "idle";
  resetHandState();
  useApp.getState().setCameraReady(false);
}

export async function listCameras() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput");
  } catch {
    return [];
  }
}

let deviceIndex = -1;

/** 切换到下一个摄像头；只有 1 个设备时返回 false */
export async function startCameraDevice() {
  const devices = await listCameras();
  if (devices.length <= 1) return false;
  deviceIndex = (deviceIndex + 1) % devices.length;
  stopCamera();
  await startCamera(devices[deviceIndex].deviceId);
  return true;
}
