import { analyzeStrokeShape, type StrokeAnalysis } from "./strokeFit";
import type { SceneObject } from "../types";

export type IntentKind = "zoom" | "orbit" | "air-bend" | "stroke-fit";

export interface IntentPrompt {
  id: string;
  kind: IntentKind;
  title: string;
  body: string;
  createdAt: number;
  expiresAt: number;
  strokeId?: string;
  analysis?: StrokeAnalysis;
}

const COOLDOWN_MS: Record<IntentKind, number> = {
  zoom: 24000,
  orbit: 24000,
  "air-bend": 20000,
  "stroke-fit": 0, // Triggered intentionally after a finished stroke unless muted.
};

const PROMPT_TTL_MS = 10000;

class IntentPredictor {
  current: IntentPrompt | null = null;
  private lastShown: Partial<Record<IntentKind, number>> = {};
  private muted = new Set<IntentKind>();
  private listeners = new Set<() => void>();
  private airBendStreak = { count: 0, lastAt: 0 };

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private canShow(kind: IntentKind, now: number) {
    if (this.muted.has(kind)) return false;
    const prev = this.lastShown[kind];
    return prev === undefined || now - prev >= COOLDOWN_MS[kind];
  }

  private show(prompt: Omit<IntentPrompt, "id" | "createdAt" | "expiresAt">, now = performance.now()) {
    if (!this.canShow(prompt.kind, now)) return;
    this.lastShown[prompt.kind] = now;
    this.current = {
      ...prompt,
      id: `${prompt.kind}-${Math.round(now)}`,
      createdAt: now,
      expiresAt: now + PROMPT_TTL_MS,
    };
    this.emit();
  }

  dismiss(muteKind = false) {
    if (!this.current) return;
    if (muteKind) this.muted.add(this.current.kind);
    this.current = null;
    this.emit();
  }

  tick(now = performance.now()) {
    if (this.current && now >= this.current.expiresAt) {
      this.current = null;
      this.emit();
    }
  }

  /** 单手前后推拉或张合缩放时给出规律性引导 */
  onZoomDetected(direction: "in" | "out", now = performance.now()) {
    this.show(
      {
        kind: "zoom",
        title: direction === "in" ? "预测意图：放大视角" : "预测意图：缩小视角",
        body: "单手张开靠近镜头放大、五指收拢拉远缩小；也支持双掌开合缩放，或随时用鼠标滚轮。",
      },
      now,
    );
  }

  /** 挥掌拨转视角时提示，减少“不知道怎么触发的”困惑 */
  onOrbitSweep(now = performance.now()) {
    this.show(
      {
        kind: "orbit",
        title: "已触发：挥掌拨转视角",
        body: "单手五指张开直接挥动即可像拨地球仪一样转视角；停住手掌或握起即停止。",
      },
      now,
    );
  }

  /** 用户在空白画布反复虚空弯曲食指时提示正确动作 */
  onAirBend(tool: string, now = performance.now()) {
    if (now - this.airBendStreak.lastAt > 2500) this.airBendStreak.count = 0;
    this.airBendStreak.lastAt = now;
    this.airBendStreak.count++;
    if (this.airBendStreak.count < 2) return;
    this.airBendStreak.count = 0;
    this.show(
      {
        kind: "air-bend",
        title: "预测意图：虚空点击？",
        body:
          tool === "draw"
            ? "指着按钮时轻弯食指可点击；在网格画线请用「拇指碰食指捏合」起笔，分开就收笔。"
            : "指着界面按钮轻弯食指可点击；在画布抓物体或画线请用「拇指+食指捏合」。",
      },
      now,
    );
  }

  /** 画完一笔后自动识别几何形状，提供一键规整（SW 风格）或删改 */
  onStrokeCommitted(object: SceneObject, now = performance.now()) {
    const pts = object.points ?? [];
    if (pts.length < 3) return;
    const analysis = analyzeStrokeShape(pts, object.planeNormal);
    if (analysis.kind !== "free") {
      this.show(
        {
          kind: "stroke-fit",
          title: `识别到近似「${analysis.label}」`,
          body: "手绘如有微颤，可一键规整为标准几何体、顺滑去抖或删除重画。",
          strokeId: object.id,
          analysis,
        },
        now,
      );
    } else if (pts.length >= 10) {
      this.show(
        {
          kind: "stroke-fit",
          title: "笔迹已生成",
          body: "觉得手抖不够顺滑，可一键顺滑去抖、规整形状或删除重画。",
          strokeId: object.id,
          analysis,
        },
        now,
      );
    }
  }
}

export const intentPredictor = new IntentPredictor();
