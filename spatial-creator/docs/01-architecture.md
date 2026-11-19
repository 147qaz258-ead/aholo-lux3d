# 01 · 系统架构

## 1. 分层

```
┌──────────────────────────── 浏览器 ────────────────────────────┐
│  React 19 + R3F 9 + Three.js 0.180                             │
│                                                                │
│  ┌──────────┐  ┌───────────────┐  ┌────────────────────────┐   │
│  │ handTracker│→│  handState     │→│  Interaction (useFrame) │   │
│  │ MediaPipe │  │  可变单例      │  │  手势 → 场景状态机      │   │
│  └──────────┘  └───────────────┘  └───────────┬────────────┘   │
│         │                                       │              │
│   getUserMedia                          objectRegistry          │
│                                         （id → Object3D）       │
│  zustand store（低频：对象/设置/任务/提示）                      │
└────────────────────────────────┬───────────────────────────────┘
                                 │ /api/*
┌────────────────────────────────▼───────────────────────────────┐
│  Fastify 网关（Node 22）                                        │
│   · /api/lux3d/text-to-3d   创建文生任务                        │
│   · /api/lux3d/img-to-3d    OUS 上传 → 创建图生任务             │
│   · /api/lux3d/task/:id     查询任务状态                        │
│   · /api/asset              代理下载产物（绕开 CORS）           │
│   · 生产模式同时托管 dist/                                      │
└────────────────────────────────┬───────────────────────────────┘
                                 │ Authorization: <API Key>
                     https://api.aholo3d.cn
```

**为什么分两层**：API Key 不能出现在前端产物里（基线 TC-SEC-01）；同时 Lux3D 产物是带签名的 CDN 链接，浏览器直连有 CORS 与签名过期风险，统一由服务端代理。

## 2. 两条数据通道（关键设计）

手部数据每秒 30–60 次变化。如果放进 React 状态，每帧都会触发整棵组件树重渲染，必然掉帧。因此拆成两条：

| 通道 | 载体 | 更新频率 | 谁在读 |
|---|---|---|---|
| 高频 | `handState`（模块级可变对象） | 每帧 | `useFrame` 内的交互控制器、摄像头骨架 canvas |
| 低频 | `useApp`（zustand） | 变化时 | UI 面板、对象列表、HUD（500ms 聚合一次） |

三维对象的位置在**拖拽过程中**也直接改 Three.js 对象，松手时才写回 store（`setTransform`），避免拖动期间每帧 setState。

## 3. 交互状态机

`src/scene/Interaction.tsx` 每帧执行：

1. 取指针来源：手部 `handState.primary.ndc`（450ms 内更新过）否则鼠标。
2. `raycaster.setFromCamera` → 与 `objectRegistry` 中所有可见对象求交（BVH 加速）。
3. 按当前工具分派：

| 工具 | 捏合按下 | 保持捏合 | 松开 |
|---|---|---|---|
| 选择 | 命中则选中 + 建立相机朝向平面，记录偏移 | 射线与平面求交 → 移动对象 | 写回 store |
| 绘制 | 在相机前方 3.2 单位平面上落笔 | 追加点（间距 > 0.012） | 生成 `stroke` 对象 |
| 雕刻 | 命中网格 → `beginSculptOp` | 按压：沿法线内推；拉伸：位移 = 指尖位移 | `endSculptOp` + 重算法线 |
| 生成 | 不接管场景，聚焦 AI 面板 | — | — |

双手同时捏合且已选中对象时，走独立分支：两手间距比值 → 缩放，两手连线角差 → 绕 Y 旋转。

## 4. 局部形变

`src/lib/deformation.ts`

- **双缓冲**：`base`（原始顶点）+ `offset`（累计偏移），写入 `position = base + offset`。可叠加、可撤销，不需要重建几何体。
- **衰减**：`w = (1 - d/R)²`，视觉上无硬边。
- **位移上限**：`0.34 × geometry.boundingSphere.radius`。没有这个上限时，长按会把顶点拉成贯穿场景的尖刺（实测过，见进度记录的 bug 列表）。
- **撤销**：记录每次操作中被触碰顶点的旧 offset（稀疏 Map），不整块复制顶点数组。
- **性能**：拖动期间不重算法线，只在松手时 `computeVertexNormals()` + `boundsTree.refit()`。

实测：64,707 顶点模型上按压连续生效，无阻塞。

## 5. 笔迹

- **绘制中**：`LiveRibbon` —— 预分配 1024 点的面向相机带状面片，每帧只写顶点、`setDrawRange`，不触发 GC 与 React。
- **成型后**：`TubeGeometry(CatmullRom)` —— 真实三维管体，可被射线拾取、可选中、可删除。

不用 `Line`：Windows/ANGLE 下 `linewidth` 恒为 1px，且无法做真实光照。用 ribbon+tube 才有可塑的视觉表现。

## 6. 模型资产

- Lux3D 返回 GLB → 服务端代理下载 → `IndexedDB`（`assets` store，按 taskId 命名）→ `GLTFLoader.parseAsync`。
- 加载后**归一化**：缩放到最大边 1.2 世界单位并居中，保证任意生成结果都能被手势直接操作。
- 每个 mesh 建立 `boundsTree`（three-mesh-bvh），否则 6 万面的射线检测会卡死主线程。

## 7. 预留扩展点

| 目标 | 接入点 |
|---|---|
| WebXR / MR | `Viewport` 的 camera 与 `handTracker` 输出解耦，替换 `handState` 数据源即可 |
| 深度相机 | `HandFrame` 增加 `depth` 字段，`Interaction` 中把「平面求交」换成「深度反投影」 |
| CAD / 参数化 | `SceneObject.primitive.params` 已是数据驱动，可直接挂参数化求解 |
| 多模态 AI 编辑 | AI 面板已走「任务 → 产物 → 资产」通用管线，新增编辑任务只需扩 `AiTask.mode` |
