import { handState, type HandFrame } from "./handState";

interface RecordedFrame {
  timestamp: number;
  sourceFrameId: number;
  trackingState: string;
  hands: HandFrame[];
}
interface RecordedEvent { eventId: string; timestamp: number; type: string; payload: unknown }
let enabled = false, startedAt = 0;
let frames: RecordedFrame[] = [], events: RecordedEvent[] = [];
export const recorder = {
  get active() { return enabled; },
  get frameCount() { return frames.length; },
  start() { frames = []; events = []; startedAt = performance.now(); enabled = true; },
  stop() { enabled = false; },
  handFrame() {
    if (!enabled) return;
    if (frames.length >= 1800) { enabled = false; return; }
    frames.push({ timestamp: performance.now() - startedAt, sourceFrameId: handState.frames, trackingState: handState.trackingState, hands: structuredClone(handState.hands) });
  },
  event(type: string, payload: unknown) {
    if (!enabled || events.length >= 10000) return;
    events.push({ eventId: crypto.randomUUID(), timestamp: performance.now() - startedAt, type, payload: structuredClone(payload) });
  },
  export() {
    return { version: 1, coordinateSpace: { raw: "mirrored normalized image", screen: "calibrated normalized viewport", ndc: "normalized device coordinates", world: "hand-local meters, not room coordinates" },
      createdAt: new Date().toISOString(), environment: { userAgent: navigator.userAgent, width: innerWidth, height: innerHeight, camera: handState.cameraInfo }, frames, events };
  },
  /** A diagnostic iterator never dispatches UI or scene commands. */
  async replay(onFrame: (frame: RecordedFrame) => void, signal?: AbortSignal) {
    for (let i = 0; i < frames.length; i++) {
      signal?.throwIfAborted(); onFrame(structuredClone(frames[i]));
      if (i < frames.length - 1) await new Promise<void>(resolve => setTimeout(resolve, Math.min(100, Math.max(0, frames[i+1].timestamp-frames[i].timestamp))));
    }
  },
};
