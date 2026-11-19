import Fastify from "fastify";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { createRequestCache } from "./idempotency.mjs";
import {
  createTextTo3D,
  createImgTo3D,
  getTask,
  uploadImage,
  fetchBinary,
  LUX3D,
  ApiError,
} from "./lux3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = Number(process.env.PORT || 8787);

const app = Fastify({
  logger: { level: "info", transport: undefined },
  bodyLimit: 32 * 1024 * 1024,
});

app.addHook("onSend", async (req, reply, payload) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return payload;
});

app.options("/*", async (_req, reply) => reply.code(204).send());

const idempotent = createRequestCache(join(root, ".runtime"));

app.get("/api/health", async () => ({
  ok: true,
  service: "spatial-creator",
  lux3dBase: LUX3D.base,
  keyConfigured: Boolean(LUX3D.key),
}));

app.post("/api/lux3d/text-to-3d", async (req, reply) => {
  const { prompt, style, faceCount } = req.body || {};
  if (!prompt || !String(prompt).trim()) {
    return reply.code(400).send({ error: "prompt 不能为空" });
  }
  const out = await idempotent(req, () => createTextTo3D({
    prompt: String(prompt).slice(0, 800),
    style: style || "photorealistic",
    faceCount: Math.min(300000, Math.max(10000, Number(faceCount) || 200000)),
  }));
  return out;
});

/** 前端传 dataURL（base64），服务端上传 OUS 后创建图生 3D 任务 */
app.post("/api/lux3d/img-to-3d", async (req, reply) => {
  const { images, faceCount, version } = req.body || {};
  const list = Array.isArray(images) ? images.slice(0, 4) : [];
  if (!list.length) return reply.code(400).send({ error: "images 不能为空" });
  const uploads = [];
  for (let i = 0; i < list.length; i++) {
    const m = typeof list[i] === "string" && /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/]+={0,2})$/i.exec(list[i]);
    if (!m) return reply.code(400).send({ error: "仅支持 base64 图片 dataURL" });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 12 * 1024 * 1024) {
      return reply.code(400).send({ error: `第 ${i + 1} 张图片超过 12MB` });
    }
    const ext = m[1].split("/")[1].replace("jpeg", "jpg");
    uploads.push({ buf, name: `upload-${i}.${ext}` });
  }
  return idempotent(req, async () => {
  const urls = [];
  for (const { buf, name } of uploads) urls.push(await uploadImage(buf, name));
  const out = await createImgTo3D({
    imageUrls: urls,
    faceCount: Math.min(300000, Math.max(10000, Number(faceCount) || 200000)),
    version: version || "G1-Turbo",
  });
  return { ...out, imageUrls: urls };
  });
});

app.get("/api/lux3d/task/:taskId", async (req) => getTask(req.params.taskId));

/** 代理下载产物 GLB，避免浏览器 CORS */
app.get("/api/asset", async (req, reply) => {
  const url = req.query?.url;
  if (!url || !/^https?:\/\//.test(url)) {
    return reply.code(400).send({ error: "url 非法" });
  }
  const buf = await fetchBinary(url);
  reply.header("Content-Type", "model/gltf-binary");
  reply.header("Cache-Control", "public, max-age=3600");
  return reply.send(buf);
});

app.setErrorHandler((err, _req, reply) => {
  const status = err instanceof ApiError ? (err.status >= 400 ? err.status : 502) : (err.statusCode || 500);
  app.log.error({ msg: err.message, code: err.code });
  reply.code(status).send({ error: err.message, code: err.code ?? null });
});

/* 生产模式：直接托管构建产物 */
const dist = join(root, "dist");
if (existsSync(dist)) {
  const fastifyStatic = await import("fastify-static").catch(() => null);
  if (fastifyStatic) {
    await app.register(fastifyStatic.default, { root: dist });
  } else {
    const { createReadStream, statSync } = await import("node:fs");
    const { extname } = await import("node:path");
    const types = {
      ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
      ".wasm": "application/wasm", ".json": "application/json",
      ".task": "application/octet-stream", ".glb": "model/gltf-binary",
      ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
    };
    app.get("/*", async (req, reply) => {
      let p = resolve(dist, decodeURIComponent(req.params["*"] || "index.html"));
      if (p !== resolve(dist) && !p.startsWith(resolve(dist) + sep)) return reply.code(400).send({ error: "资源路径无效" });
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(dist, "index.html");
      reply.header("Content-Type", types[extname(p)] || "application/octet-stream");
      return reply.send(createReadStream(p));
    });
  }
}

await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`API ready on http://localhost:${PORT}`);
