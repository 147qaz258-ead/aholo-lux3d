import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
    // MediaPipe 需要跨源隔离才能启用 SharedArrayBuffer（多线程 wasm）
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  // 手部推理 Worker 必须打成经典（iife）脚本：
  // MediaPipe 在 Worker 里靠 importScripts 加载 wasm 加载器，module worker 没有这个函数，
  // 会退到 document.createElement("script") 然后直接失败。见 src/lib/handWorker.ts。
  worker: {
    format: "iife",
  },
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
