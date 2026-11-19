import { classifyGesture, FINGERS } from "./gesture";
import type { FingerState } from "./gesture";
import type { HandFrame } from "./handState";

const HOLD_MS = 450;
const PINCH_BIT = 1 << FINGERS.length;

function maskFor(hand: HandFrame) {
  return FINGERS.reduce((mask, finger, i) => mask | (Number(hand.fingers.extended[finger.name]) << i), hand.pinched ? PINCH_BIT : 0);
}

export function poseFor(mask: number) {
  const extended = Object.fromEntries(FINGERS.map((finger, i) => [finger.name, Boolean(mask & (1 << i))])) as FingerState["extended"];
  return classifyGesture({ extended, count: Object.values(extended).filter(Boolean).length }, Boolean(mask & PINCH_BIT));
}

/** Slow down display changes only. Never feed these values back into gesture input. */
export class HandFeedback {
  private lastSeen = 0;
  private acceptedId: number | null = null;
  private mask: number | null = null;
  private sampleId: number | null = null;
  private lastFrame = -1;
  private samples: number[] = [];

  update(hand: HandFrame | null, now: number, frame: number, enabled: boolean) {
    if (!enabled || now - this.lastSeen >= HOLD_MS) {
      this.mask = null;
      this.acceptedId = null;
    }
    if (!enabled || !hand) {
      this.samples.length = 0;
      this.sampleId = null;
      return this.mask;
    }
    if (hand.id === this.acceptedId) this.lastSeen = now;
    if (this.sampleId !== hand.id) {
      this.samples.length = 0;
      this.sampleId = hand.id;
    }
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      const sample = maskFor(hand);
      this.samples.push(sample);
      if (this.samples.length > 3) this.samples.shift();
      if (this.samples.length >= 2 && (this.mask === null || hand.id !== this.acceptedId)) {
        this.acceptedId = hand.id;
        this.lastSeen = now;
        this.mask = sample;
      } else if (this.mask !== null && hand.id === this.acceptedId && this.samples.length === 3) {
        const [a, b, c] = this.samples;
        // Each bit can settle independently while a different finger is near its threshold.
        this.mask = (this.mask & (a | b | c)) | (a & b & c);
      }
    }
    return this.mask;
  }
}
