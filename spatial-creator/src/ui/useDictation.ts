import { useEffect, useRef, useState } from "react";

type Result = { isFinal: boolean; 0: { transcript: string } };
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { results: ArrayLike<Result> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const fallback = "可在输入框按 Win + H，或直接键入。";

export function useDictation(enabled: boolean, prompt: string, setPrompt: (text: string) => void) {
  const current = useRef<Recognition | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [interim, setInterim] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  function cancel() {
    const recognition = current.current;
    current.current = null;
    recognition?.abort();
    setPhase("idle");
    setInterim(null);
    setMessage("");
  }

  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);
  useEffect(() => {
    const hide = () => { if (document.hidden && current.current) cancel(); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      const recognition = current.current;
      current.current = null;
      recognition?.abort();
    };
  }, []);

  function start() {
    if (!enabled || current.current) return;
    const { SpeechRecognition, webkitSpeechRecognition } = window as SpeechWindow;
    const Recognizer = SpeechRecognition ?? webkitSpeechRecognition;
    if (!Recognizer) { setMessage(`当前浏览器不支持内置听写。${fallback}`); return; }
    let recognition: Recognition | null = null;
    try {
      recognition = new Recognizer();
      current.current = recognition;
      recognition.lang = "zh-CN";
      recognition.interimResults = true;
      recognition.continuous = false;
      let final = "";
      const append = (words: string) => {
        const prefix = prompt.trimEnd();
        return `${prefix}${prefix && words ? " " : ""}${words}`.slice(0, 600);
      };
      const clear = (notice: string) => {
        current.current = null;
        setPhase("idle");
        setInterim(null);
        setMessage(notice);
      };
      recognition.onstart = () => {
        if (current.current !== recognition) return;
        setPhase(p => p === "starting" ? "listening" : p);
      };
      recognition.onresult = ({ results }) => {
        if (current.current !== recognition) return;
        const parts = Array.from(results);
        final = parts.filter(part => part.isFinal).map(part => part[0].transcript).join("").trim();
        const preview = parts.map(part => part[0].transcript).join("").trim();
        setInterim(preview ? append(preview) : null);
      };
      recognition.onend = () => {
        if (current.current !== recognition) return;
        if (final) setPrompt(append(final));
        clear(final ? "" : "没有听到描述，可再次点击麦克风。");
      };
      recognition.onerror = ({ error }) => {
        if (current.current !== recognition) return;
        const cause = error === "not-allowed" || error === "service-not-allowed" ? "浏览器未允许语音识别。"
          : error === "audio-capture" ? "没有可用的麦克风。"
          : error === "no-speech" ? "没有听到描述。"
          : "语音识别暂不可用。";
        clear(cause + fallback);
      };
      setPhase("starting");
      setMessage("");
      recognition.start();
    } catch {
      current.current = null;
      setPhase("idle");
      setMessage(`无法启动语音识别。${fallback}`);
    }
  }

  function stop() {
    if (!current.current || phase === "stopping") return;
    if (phase === "starting") { cancel(); return; }
    setPhase("stopping");
    try { current.current.stop(); }
    catch { cancel(); setMessage(`无法完成听写。${fallback}`); }
  }

  return { phase, active: phase !== "idle", message, interim, start, stop, cancel };
}
