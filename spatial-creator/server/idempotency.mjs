import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
export function createRequestCache(directory) {
// Coalesce in-flight retries; a reused request ID with a different payload is rejected.
const requestDirectory = directory;
const requestFile = join(requestDirectory, "ai-requests.json");
const durableRequests = new Map(existsSync(requestFile) ? JSON.parse(readFileSync(requestFile, "utf8")) : []);
const requests = new Map();
function persistRequests() {
  mkdirSync(requestDirectory, { recursive: true });
  writeFileSync(`${requestFile}.tmp`, JSON.stringify([...durableRequests]));
  renameSync(`${requestFile}.tmp`, requestFile);
}
return async function idempotent(req, operation) {
  const id = req.body?.requestId;
  if (!id) return operation(); // compatibility with existing clients
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw Object.assign(new Error("requestId 格式无效"), { statusCode: 400 });
  const hash = createHash("sha256").update(req.url + JSON.stringify(req.body)).digest("hex");
  const old = requests.get(id);
  if (old) {
    if (old.hash !== hash) throw Object.assign(new Error("同一 requestId 不能用于不同请求"), { statusCode: 409 });
    return old.promise;
  }
  const durable = durableRequests.get(id);
  if (durable) {
    if (durable.hash !== hash) throw Object.assign(new Error("同一 requestId 不能用于不同请求"), { statusCode: 409 });
    if (durable.result) return durable.result;
    throw Object.assign(new Error("此请求已提交或结果未知。为避免重复创建计费任务，请查询已有 taskId 或明确发起新任务。"), { statusCode: 409 });
  }
  if (requests.size >= 1000) requests.delete(requests.keys().next().value);
  if (durableRequests.size >= 1000) durableRequests.delete(durableRequests.keys().next().value);
  durableRequests.set(id, { hash, status: "submitted" }); persistRequests();
  const promise = operation().then(result => { durableRequests.set(id, { hash, status: "complete", result }); persistRequests(); return result; });
  requests.set(id, { hash, promise });
  // Retain failures too: retrying an uncertain upstream response must not create a paid task twice.
  return promise;
};

}
