import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { handState } from "../lib/handState";
import { HandVisualCache, handVisualOpacity } from "../lib/handVisuals";
import { CalibrationWizard } from "./CalibrationWizard";
import { startCamera, stopCamera, videoRegistry, startCameraDevice } from "../lib/cameraService";
import { IconCamera, IconClose } from "./Icons";

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const FINGER_KEYS = ["thumb", "index", "middle", "ring", "pinky"] as const;
const FINGER_LABEL: Record<string, string> = {
  thumb: "拇指",
  index: "食指",
  middle: "中指",
  ring: "无名指",
  pinky: "小指",
};
const GESTURE_LABEL: Record<string, string> = {
  none: "未检测",
  point: "单指",
  pinch: "捏合",
  open: "张开",
  fist: "握拳",
  peace: "双指",
  three: "三指",
  spread: "多指",
};

export function CameraPanel() {
  const cameraReady = useApp((s) => s.cameraReady);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [details, setDetails] = useState(false);
  /* 姿态回显条：直接改 DOM，不走 state——30fps 的 setState 会把整棵组件树 diff 一遍 */
  const gestureRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const fingerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pinchFillRef = useRef<HTMLElement>(null);
  const pinchBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    videoRegistry.el = videoRef.current;
    return () => {
      videoRegistry.el = null;
    };
  }, []);

  /* 骨架绘制 */
  useEffect(() => {
    let raf = 0;
    let width=0,height=0,lastFrame=-1,lastStatus="",lastPaused=false,lastPaint=0,lastAlpha=0;
    const display = new HandVisualCache();
    const cv=canvasRef.current;if(!cv || !details)return;
    const resize=new ResizeObserver(entries=>{const r=entries[0].contentRect;width=r.width;height=r.height;lastFrame=-1;});resize.observe(cv);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if(document.hidden)return;
      const now=performance.now();if(now-lastPaint<1000/30)return;
      display.update(now);
      const alpha = settings.showHandSkeleton && display.hands.reduce((max, h) => Math.max(max, handVisualOpacity(now, h.seenAt)), 0) || 0;
      if(lastFrame===handState.frames&&lastStatus===handState.status&&lastPaused===handState.paused&&lastAlpha===alpha&&(alpha===0||alpha===1))return;
      lastAlpha = alpha;
      lastPaint=now;lastFrame=handState.frames;lastStatus=handState.status;lastPaused=handState.paused;
      const rect={width,height};
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) {
        cv.width = Math.round(rect.width * dpr);
        cv.height = Math.round(rect.height * dpr);
      }
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, rect.width, rect.height);


      /* 姿态回显：手势类别、手指数、五指逐指亮灭、捏合强度 */
      const hd = handState.paused?null:handState.primary;
      const f = hd?.fingers;
      // 只在文字真的变了才写：每帧无脑赋值会让这两个节点每秒产生 120 次 DOM 变更，
      // 进而触发样式重算，是"面板看着也卡"的一部分
      const gName = hd ? GESTURE_LABEL[handState.gesture] ?? "—" : "未检测";
      if (gestureRef.current && gestureRef.current.textContent !== gName) {
        gestureRef.current.textContent = gName;
      }
      const gCount = `${f?.count ?? 0} / 5`;
      if (countRef.current && countRef.current.textContent !== gCount) {
        countRef.current.textContent = gCount;
      }
      for (let i = 0; i < FINGER_KEYS.length; i++) {
        fingerRefs.current[i]?.classList.toggle("on", Boolean(f?.extended?.[FINGER_KEYS[i]]));
      }
      const pv = hd?.pinch ?? 0;
      if (pinchFillRef.current) pinchFillRef.current.style.width = `${Math.round(pv * 100)}%`;
      pinchBarRef.current?.classList.toggle("over", pv >= 0.62);

      if (!settings.showHandSkeleton||handState.paused) return;

      for (const { pose: hand, seenAt } of display.hands) {
        g.globalAlpha = handVisualOpacity(now, seenAt);
        // 用未校准的镜像坐标绘制，才能和镜像显示的画面严格对齐
        const pts = hand.raw;
        if (!pts?.length) continue;
        const P = (i: number) => ({
          x: pts[i].x * rect.width,
          y: pts[i].y * rect.height,
        });
        g.lineWidth = 1.4;
        g.strokeStyle = hand.pinched ? "rgba(255,255,255,0.9)" : "rgba(46,232,200,0.75)";
        g.shadowColor = "rgba(46,232,200,0.9)";
        g.shadowBlur = 6;
        g.beginPath();
        for (const [a, b] of CONNECTIONS) {
          const p1 = P(a);
          const p2 = P(b);
          g.moveTo(p1.x, p1.y);
          g.lineTo(p2.x, p2.y);
        }
        g.stroke();
        g.shadowBlur = 0;
        for (let i = 0; i < 21; i++) {
          const p = P(i);
          const tip = i === 4 || i === 8;
          g.beginPath();
          g.arc(p.x, p.y, tip ? 3.2 : 1.6, 0, Math.PI * 2);
          g.fillStyle = tip ? "#ffffff" : "rgba(180,240,255,0.8)";
          g.fill();
        }
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {cancelAnimationFrame(raf);resize.disconnect();};
  }, [calibrating, details, settings.showHandSkeleton]);

  const startCalibration = () => {
    if (!cameraReady) { toast("先启用摄像头再校准", "warn"); return; }
    setCalibrating(true);
  };

  return (
    <section className="panel cam-panel">
      {calibrating && <CalibrationWizard onClose={() => setCalibrating(false)} />}
      <div className="cam-stage" hidden={!details}>
        <video ref={videoRef} muted playsInline style={{ transform: settings.mirror ? "scaleX(-1)" : "none" }} />
        <canvas ref={canvasRef} />
        <div className="cam-frame" />
        {!cameraReady && (
          <div className="cam-empty">
            摄像头未启用
            <br />
            <span style={{ color: "var(--dim-2)", fontSize: 10 }}>当前为鼠标模式，功能完全可用</span>
          </div>
        )}
        <div className="cam-overlay-text">
          {cameras(settings.mirror, handState.fps, handState.hands.length)}
        </div>
      </div>
      <div className="cam-pose" hidden={!details}>
        <span ref={gestureRef} className="cp-gesture">
          未检测
        </span>
        <span ref={countRef} className="cp-count">
          0 / 5
        </span>
        <div className="cp-fingers">
          {FINGER_KEYS.map((k, i) => (
            <span
              key={k}
              title={FINGER_LABEL[k]}
              className="cp-finger"
              ref={(el) => {
                fingerRefs.current[i] = el;
              }}
            />
          ))}
        </div>
        <div className="cp-pinch" ref={pinchBarRef} title="捏合强度 · 竖线为触发阈值">
          <i ref={pinchFillRef} />
          <b />
        </div>
      </div>
      <div className="cam-foot">
        <button
          className="btn sm"
          style={{ flex: 1 }}
          onClick={() => (cameraReady ? stopCamera() : startCamera())}
        >
          {cameraReady ? "关闭" : "启用摄像头"}
        </button>
        <button className="btn sm" onClick={() => setDetails(v => !v)} aria-expanded={details}>摄像头设置</button>
        {details && <><button className="btn sm" onClick={startCalibration} disabled={!cameraReady}>
          校准
        </button>
        <button
          className={`btn sm ${settings.dwellClick ? "primary" : ""}`}
          title="手不稳辅助：悬停 0.6 秒自动点击按钮，无需弯指或捏合"
          aria-pressed={Boolean(settings.dwellClick)}
          onClick={() => updateSettings({ dwellClick: !settings.dwellClick })}
        >
          {settings.dwellClick ? "悬停点击:开" : "悬停点击"}
        </button>
        <button
          className="btn sm"
          title="重新枚举设备"
          onClick={() => {
            void (async () => {
              const s = await startCameraDevice();
              if (!s) toast("没有检测到其他摄像头", "warn");
            })();
          }}
        >
          <IconCamera size={13} />
        </button>
        </>}
      </div>
    </section>
  );
}

function cameras(mirror: boolean, fps: number, hands: number) {
  if (!handState.status || handState.status === "idle") return "STANDBY";
  if (handState.status === "loading") return "LOADING MODEL…";
  if (handState.status === "error") return "ERROR";
  return `${hands > 0 ? "TRACKING" : "SEARCHING"} · ${fps}FPS · ${mirror ? "MIRROR" : "RAW"}`;
}
