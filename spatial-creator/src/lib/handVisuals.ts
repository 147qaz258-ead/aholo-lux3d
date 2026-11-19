import { handState, type HandFrame } from "./handState";

// Presentation only. Never use retained poses as input for hit tests or gestures.
export function handVisualOpacity(now: number, seenAt: number) {
  const hold = Math.max(360, Math.min(530, handState.resultIntervalMs * 2.4));
  const t = Math.max(0, Math.min(1, (now - seenAt - hold) / 240));
  return 1 - t * t * (3 - 2 * t);
}

export type VisibleHand = { pose: HandFrame; seenAt: number };

export class HandVisualCache {
  hands: VisibleHand[] = [];
  primaryId: number | null = null;
  private lastResultAt = 0;

  update(now: number) {
    if (handState.status !== "ready" || handState.paused) {
      if (this.hands.length) this.hands = [];
      this.primaryId = null;
      this.lastResultAt = 0;
      return;
    }
    const at = handState.updatedAt;
    if (at > this.lastResultAt && handState.trackingState !== "IDENTITY_UNCERTAIN") {
      this.lastResultAt = at;
      const hands = handState.hands.length ? handState.hands : handState.primary ? [handState.primary] : [];
      if (handState.primary) this.primaryId = handState.primary.id;
      if (hands.length) {
        // Do not draw two copies when a single returning hand receives a new ID.
        const matching = this.hands.some(old => hands.some(h => h.id === old.pose.id));
        const missing = matching && hands.length === 1
          ? this.hands.filter(old => old.pose.id !== hands[0].id && handVisualOpacity(now, old.seenAt) > 0)
          : [];
        this.hands = [...hands.map(pose => ({ pose, seenAt: pose.timestamp ?? at })), ...missing].slice(0, 2);
      }
    }
    if (this.hands.some(h => handVisualOpacity(now, h.seenAt) === 0)) {
      this.hands = this.hands.filter(h => handVisualOpacity(now, h.seenAt) > 0);
    }
  }
}
