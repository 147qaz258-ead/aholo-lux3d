/** Camera-space wrist identity, with motion prediction and an explicit ambiguity gate. */
export class HandIdentity {
  private tracks = new Map<number, { x: number; y: number; vx: number; vy: number; time: number }>();
  private next = 0;
  assign(points: { x: number; y: number }[], now: number) {
    for (const [id, track] of this.tracks) if (now - track.time > 1500) this.tracks.delete(id);
    const tracks = [...this.tracks];
    const distance = (p: { x: number; y: number }, t: typeof tracks[number][1]) => {
      const dt = Math.min(150, now - t.time);
      return Math.hypot(p.x - t.x - t.vx * dt, p.y - t.y - t.vy * dt);
    };
    let ids: number[] = [];
    let uncertain = false;
    if (points.length === 2 && tracks.length === 2) {
      const direct = distance(points[0], tracks[0][1]) + distance(points[1], tracks[1][1]);
      const swapped = distance(points[0], tracks[1][1]) + distance(points[1], tracks[0][1]);
      uncertain = Math.abs(direct - swapped) < 0.025 || Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) < 0.05;
      ids = direct <= swapped ? [tracks[0][0], tracks[1][0]] : [tracks[1][0], tracks[0][0]];
    } else {
      const used = new Set<number>();
      ids = points.map(p => {
        const candidate = tracks.filter(([id]) => !used.has(id)).sort((a, b) => distance(p, a[1]) - distance(p, b[1]))[0];
        const id = candidate && distance(p, candidate[1]) < 0.35 ? candidate[0] : this.next++;
        used.add(id); return id;
      });
    }
    if (!uncertain) points.forEach((p, i) => {
      const old = this.tracks.get(ids[i]), dt = Math.max(1, now - (old?.time ?? now));
      this.tracks.set(ids[i], { ...p, vx: old ? (p.x - old.x) / dt : 0, vy: old ? (p.y - old.y) / dt : 0, time: now });
    });
    return { ids, uncertain };
  }
}

export class ConfirmedPinch {
  private active = false;
  private count = 0;
  interrupt() { this.count = 0; }

  update(closure: number, on = 0.62, off = 0.48) {
    const candidate = this.active ? closure > off : closure >= on;
    if (candidate === this.active) this.count = 0;
    else if (++this.count >= 3) { this.active = candidate; this.count = 0; }
    return this.active;
  }
}
