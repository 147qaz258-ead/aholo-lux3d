# 02 · 接口文档与实测差异

所有内容均来自 2026-11-13 当天的真实调用，不是文档转抄。凡与官方文档不一致处，以**实测可运行的调用**为准并在此记录。

## 1. 基准地址与鉴权

```
Base:   https://api.aholo3d.cn
Header: Authorization: <API Key>        # 不加 Bearer 前缀
```

**差异 1**：OpenAPI 描述文件（`https://labs.aholo3d.cn/api-docs/openapi.json`）里 `servers` 写的是 `https://api.aholo.cn`。用赛事发放的 Key 实测，`api.aholo.cn` 与 `api.aholo3d.cn` 网关行为一致，本项目固定使用 `https://api.aholo3d.cn`（与 `labs.aholo3d.cn` 的 Key 签发侧一致）。

**差异 2**：官方文档示例中的 `GET /lux3d/v1/tasks` **不存在**，返回 `404 No matching API found`。真实的任务列表接口是 `GET /lux3d/v1/generate/task/list`。

## 2. 响应信封

所有 Lux3D 接口统一返回：

```json
{ "f": null, "c": "0", "m": "", "d": 7092543 }
```

| 字段 | 含义 |
|---|---|
| `c` | 状态码，`"0"` 成功；普通参数错误 `"-1"`；业务错误为专用码（如 `GENERATION_CONCURRENCY_LIMIT_EXCEEDED`） |
| `m` | 提示信息 |
| `d` | 业务数据。创建任务是 `taskId`（int64）；查询任务是对象 |
| `f` | 失败信息，成功时为 `null` |

注意：**HTTP 200 不代表业务成功**，必须判 `c === "0"`。并发超限时 HTTP 仍是 200。

## 3. 文生 3D

```
POST /lux3d/v1/generate/text-to-3d/task/create
```

```json
{
  "prompt": "一把悬浮的白色陶瓷椅子，极简主义，边缘发光",
  "style": "photorealistic",        // photorealistic | cartoon | anime | hand_painted | cyberpunk | fantasy | glass
  "version": "G1",                  // G1 | G1-Turbo
  "faceCount": 120000,              // 10000–300000，默认 300000
  "outputFormat": ["glb"],          // zip | glb | ply
  "aiPredictSize": true
}
```

返回 `{"c":"0","d":7092543}`。

## 4. 图生 3D

```
POST /lux3d/v1/generate/img-to-3d/task/create
```

- `img`（单图 URL）与 `imgs`（1–32 张 URL 数组）**必须且只能提供一个**
- 用 `imgs` 时必须显式传 `version`
- 单图建议 `G1`，多图建议 `G1-Turbo`

## 5. 任务查询

```
GET /lux3d/v1/generate/task/get?taskid=7092543
```

**差异 3**：任务 ID 是 **query 参数 `taskid`**，不是路径参数。写成 `/task/get/7092543` 会 404。

响应：

```json
{
  "c": "0",
  "d": {
    "taskId": 7092543,
    "bizId": "LUX_3D",
    "status": 3,
    "outputs": [
      { "content": "https://.../result.zip?sign=..." },
      { "content": "https://qhsmodel.kujiale.com/lux3dPbrEmbedResult/xxx/textured.glb" }
    ]
  }
}
```

**status 枚举（实测）**：`0` 排队 → `1` 运行中 → `3` 成功 / `4` 失败。没有观察到 `2`。

**差异 4（最容易踩）**：请求 `outputFormat: ["glb"]` 时，G1 **仍然返回 zip + glb 两件产物**，且 `outputs[0]` 是 **zip**。直接取 `outputs[0]` 会拿到一个压缩包并当成 GLB 解析失败。

本项目按扩展名打分排序后取 GLB：

```ts
const score = (u) => /\.glb(\?|$)/i.test(u) ? 3 : /\.ply(\?|$)/i.test(u) ? 2 : /\.zip(\?|$)/i.test(u) ? 0 : 1;
```

## 6. 素材上传（图生 3D 必需）

Lux3D 只接受**公网可访问的图片 URL**，本地文件必须先上传。三步：

```
1) GET  /asset/v1/token            （Authorization: <API Key>）
   → { "ousToken": "...", "globalDomain": "https://ous-cos.kujiale.com", "blockSize": 5242880 }

2) POST {globalDomain}/ous/api/v2/single/upload       # multipart/form-data
   Header: ous-token-v2: <ousToken>                   # 注意不是 Authorization
   Fields: md5=<文件 MD5 小写十六进制>, file=<二进制>
   → { "c":"0", "d": { "taskId": ... } }

3) GET  {globalDomain}/ous/api/v2/upload/status       # 轮询，间隔 ≥200ms
   Header: ous-token-v2: <ousToken>
   → d.status === 5 时为成功终态，d 内含可访问 url
```

**差异 5**：上传接口的鉴权头是 `ous-token-v2`，与网关的 `Authorization` 是两套凭证；且域名不同（`ous-cos.kujiale.com`），不能复用网关鉴权。

**差异 6**：单文件上传上限为 `blockSize`（实测 5,242,880 = 5 MB）。超过需走 `block/upload/init` + `block/upload/part` 分片流程。本项目把前端图片限制在 12 MB 前端校验，实际超过 5 MB 会失败——**已知限制**，记录在 `docs/03-progress.md`。

**差异 7**：`/asset/v1/token` **不走 `{c,d}` 信封**，凭证直接在响应顶层。第一版实现按 `json.d` 取值，导致 `globalDomain` 为 undefined，图生 3D 一提交就 500。
> 这个 bug 在 2026-11-13 首次真实图生测试（task `7137496`）时才暴露——**因为之前从未点过图生按钮**。修复：`json.d ?? json`，并对字段做结构校验，缺字段直接抛 `BAD_TOKEN_SHAPE` 而不是让它悄悄变成 undefined。

**差异 8**：上传状态响应的实际字段集（实测）：
```json
// status 5（成功终态）
{ "status": 5, "uploadKey": "resource/platform/temp/2026/11/13/xxx.png",
  "url": "https://holo-cos.aholo3d.cn/...png", "md5": "...", "obsTaskId": "3FO6IQHOG4AT" }
// status 4（传输中）：只有 uploadKey / obsTaskId，没有 url
```
所以「有 url」不能作为完成判据，必须 `status === 5`。上传响应体是 `{"c":"0","m":"","d":{"obsTaskId":"..."}}`，**obsTaskId 不在顶层**。

实测上传耗时 1.5–2.1 s（397 KB PNG），产物 URL 可直接 `GET`（HTTP 206 / `image/png`）。

## 7. 本项目内部 API

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| GET | `/api/health` | — | `{ok, lux3dBase, keyConfigured, keyTail}` |
| POST | `/api/lux3d/text-to-3d` | `{prompt, style, faceCount}` | `{taskId}` |
| POST | `/api/lux3d/img-to-3d` | `{images: string[] /* dataURL */, faceCount, version}` | `{taskId, imageUrls}` |
| GET | `/api/lux3d/task/:taskId` | — | `{taskId, status, outputs: string[]}` |
| GET | `/api/asset?url=` | 远端产物 URL | 二进制流（`model/gltf-binary`） |

服务端把 Lux3D 的信封拍平成前端友好的结构，`outputs` 已按 GLB 优先排序。

## 8. 实测耗时与产物

| 项目 | 数值 |
|---|---|
| 文生 3D（G1，120k 面） | 311 s（约 5 分 11 秒） |
| 文生 3D（G1，80k 面） | 约 4–5 分钟 |
| GLB 体积 | 8.4 MB / 11.5 MB（两种提示词） |
| GLB 顶点数 | 64,707（单 mesh） |
| 前端解析 + 归一化 | 约 5 s |
| 任务查询建议间隔 | 3 s（本项目取值） |
