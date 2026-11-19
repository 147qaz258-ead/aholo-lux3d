import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.API_BASE || "http://127.0.0.1:8787";
const results = [];
const health = await fetch(`${base}/api/health`); assert.equal(health.status, 200);
const info = await health.json(); assert.equal(info.ok, true); assert.equal(typeof info.keyConfigured, "boolean");
assert.equal(Object.keys(info).some(k => /suffix|apikey|token/i.test(k)), false);
results.push("health reports readiness without credential fragments");
for (const [path, body] of [
  ["text-to-3d", { prompt: "" }],
  ["img-to-3d", { images: [] }],
  ["img-to-3d", { requestId: "invalid_images_no_upstream", images: ["data:image/png;base64,aGVsbG8=", "invalid"] }],
]) {
  const response = await fetch(`${base}/api/lux3d/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 400); assert.ok((await response.json()).error);
}
results.push("invalid text and all image inputs reject before upstream submission");
const invalidAsset = await fetch(`${base}/api/asset?url=invalid`); assert.equal(invalidAsset.status, 400);
results.push("invalid asset URL rejected");
const index = await fetch(base); assert.equal(index.status, 200); assert.match(await index.text(), /Aether Studio/);
results.push("production build served from API root");
const traversal = await fetch(`${base}/..%5c.env`); assert.equal(traversal.status, 400);
results.push("static paths cannot leave build directory");
mkdirSync("test-artifacts/draft1", { recursive: true });
writeFileSync("test-artifacts/draft1/api-local.json", JSON.stringify({ date: new Date().toISOString(), tests: results, passed: results.length, note: "Local API only; no paid provider requests" }, null, 2));
console.log(`${results.length}/${results.length} local API groups passed; no provider calls`);
