# 已有功能清单 v2 · Feature Inventory v2

> **本文档只记录"代码里已经存在、且能跑"的功能。** 不写计划、不写缺口分析、不写改进方案。
>
> 审计方式：逐个读源码确认，不从旧文档、文件名或注释推断。范围 `src/**`、`server/**`、`scripts/**`（仅用于判定"是否运行验证过"）、`package.json`、`vite.config.ts`。
> 源码根目录：`E:\C_Projects\Aholo Lux3D\spatial-creator`（**注意：不在当前工作区 `deepseek机器人` 下**）。
> v2 审计时间：2026-11-17。A—D 沿用 v1（2026-11-16 核对）原文，E—J 本轮重做。

## 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 用户用**手**就能到，且当前可用 |
| 🖱 | 功能存在，但必须鼠标/键盘才能触发（手势到不了） |
| ⛔ | 代码里有实现，但**界面上没有入口**，用户到不了 |
| ⚙ | 内部系统能力（服务端/数据/渲染管线），**不适用**手势可达性 |
| ⚠ | 附加标记：**尚未完成实际运行验证**（可与 ✅/🖱 组合，如 `✅⚠`） |

> 标记描述"当前可达性 + 验证状态"，不是"设计意图"。`⚙` 不是降级，是这类能力本来就没有界面。
> v1 只有 ✅/🖱/⛔ 三态，把"服务端能力""未验证"混进了 ✅，v2 拆开。

## 统计口径

- 一行 = 一个可单独判定"在不在 / 能不能触发"的行为。**复合条目按行为拆分**，拆分原因在 §修改记录逐条列出。
- 只统计**已实现**的功能。缺失能力（取消生成、视角手势、虚拟键盘等）不进表，统一放 §六「已确认缺失」并注明源码依据。
- 类型列取值：`交互`（用户操作）、`界面反馈`（状态/视觉回显）、`数据管理`（持久化/导入导出/资产）、`服务能力`（HTTP/上游调用）、`系统内部`（不面向用户的机制）。

## 总览

| 大类 | 小类数 | 功能项 | ✅ | 🖱 | ⛔ | ⚙ | 其中 ⚠ |
|---|---:|---:|---:|---:|---:|---:|---:|
| A 手部感知与建模 | 5 | 33 | 32 | 0 | 1 | 0 | 0 |
| B 手势控制与指针 | 8 | 37 | 36 | 1 | 0 | 0 | 0 |
| C 三维交互与工具 | 8 | 37 | 35 | 2 | 0 | 0 | 0 |
| D 场景与对象管理 | 7 | 21 | 18 | 3 | 0 | 0 | 0 |
| E AI 生成 | 7 | 39 | 27 | 5 | 2 | 5 | 0 |
| F 导入导出与持久化 | 4 | 20 | 12 | 2 | 2 | 4 | 1 |
| G 视图与渲染 | 5 | 31 | 23 | 5 | 1 | 2 | 1 |
| H 相机硬件 | 2 | 10 | 10 | 0 | 0 | 0 | 2 |
| I 界面框架与反馈 | 5 | 26 | 21 | 4 | 0 | 1 | 0 |
| J 后端服务 | 2 | 16 | 10 | 0 | 0 | 6 | 1 |
| **合计** | **53** | **270** | **224** | **22** | **6** | **18** | **5** |

> A—D 为 v1 原统计（未在本轮逐条重核，见 §八 复核备注）；E—J 为本轮实测。
> 与 v1 的差额说明见 §修改记录：v1 的 E—J 共 104 条，v2 为 142 条，全部差额有逐条出处。

## 🖱（必须鼠标/键盘）的构成

共 22 条（A—D 6 条 + E—J 16 条），逐条相加 = 22：

| 类别 | 条数 | 编号 |
|---|---:|---|
| 键盘操作（本就不该由手势替代） | 8 | B1-06、C5-04、C8-02、D4-04、E1-04、I4-06、I5-01、I5-05 |
| 视角控制（无任何手势绑定） | 5 | G1-01、G1-02、G1-03、G1-04、G1-05 |
| 文件选择 / 拖拽（浏览器要求真实用户事件，合成点击会被拦） | 5 | E2-01、E2-02、E2-06、F4-01、F4-02 |
| 原生弹层（系统 UI，合成点击点不到） | 2 | D6-01、E3-02 |
| 文本输入（无输入法/虚拟键盘） | 1 | D5-01 |
| 开发期调试钩子 | 1 | I5-04 |

> 与 v1 的差异：v1 是 21 条，其"文件选择"4 条只算了 F4-01/02 与 E2-01/02；v2 把 E2-06（未选图点按钮唤起文件框）单列，因为它是独立入口且同样手势无效。另外 A—D 的 6 条未变动。

---

# A 手部感知与建模

把摄像头画面变成「21 个点的数据结构」，再把这 21 个点画成一只看得见的手。

## A1 关键点检测

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| A1-01 | 21 点手部关键点检测，最多同时 2 只手 | MediaPipe HandLandmarker，本地 wasm + 本地模型 | ✅ |
| A1-02 | 推理在 Web Worker 内完成，主线程不做推理 | `handWorker.ts`，主线程只做 `createImageBitmap` + 传帧 | ✅ |
| A1-03 | GPU delegate 优先，失败自动退回 CPU | `handWorker` init 失败切另一条；`localStorage.sc_delegate="CPU"` 可强制 | ✅（隐藏开关） |
| A1-04 | 送帧前缩到 640×360 | `createImageBitmap({resizeWidth:640})` | ✅ |
| A1-05 | 送帧节流 26ms | `MIN_SEND_MS` | ✅ |
| A1-06 | 推理期间只排队最新一帧（延迟恒定 1 次推理） | `pending` 单槽，结果回来立刻 flush | ✅ |
| A1-07 | 检测阈值固定 0.5 / 0.5 / 0.4 | `handWorker` 内 handLandmarker options | ✅ |
| A1-08 | 主手粘性选择（双手切换时指针不跳） | `stickyPrimary` | ✅ |
| A1-09 | 左右手标签识别 + 镜像时翻转 | `flipHandedness` | ✅ |

## A2 三维虚拟手

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| A2-01 | 21 个关节球 | `HandRig.tsx` | ✅ |
| A2-02 | 22 根骨骼柱（含 2 根掌骨） | `BONES` 数组 | ✅ |
| A2-03 | 掌面三角扇填充（腕 + 4 指根） | `palmGeo`，每帧重算顶点 | ✅ |
| A2-04 | 5 个指尖光晕 | 加法混合球体 | ✅ |
| A2-05 | 整手挂在相机坐标系，随视角转 | `g.position/quaternion` 每帧取相机 | ✅ |
| A2-06 | 按掌宽自适应大小，夹在 0.55–1.6 | `scaleRef` | ✅ |
| A2-07 | 丢帧时保持最后姿态并压暗到 0.35 | `ghost` 系数，500ms 内有效 | ✅ |
| A2-08 | 指针压在 UI 上时整手淡出到 0.38 | `uiPointer.overUi` | ✅ |
| A2-09 | 逐指伸展变色（亮/暗/捏合白） | 每关节 material.color | ✅ |
| A2-10 | 不参与射线拾取（不会挡住点击） | `raycast={() => null}` | ✅ |

## A3 摄像头面板 2D 回显

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| A3-01 | 21 点骨架线叠加在预览画面上 | `CameraPanel` canvas 逐帧绘制 | ✅ |
| A3-02 | 拇指尖/食指尖放大高亮 | 半径 3.2 vs 1.6 | ✅ |
| A3-03 | 捏合时骨架变白 | `hand.pinched` | ✅ |
| A3-04 | 骨架显隐开关 | 设置项 `showHandSkeleton` 已接逻辑 | ⛔ 无 UI 控件 |

## A4 姿态与手势分类

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| A4-01 | 五指伸展度归一化到 0..1 | `fingerState()`，解剖比例归一 | ✅ |
| A4-02 | 逐指时序稳定器（EMA + 滞回 0.55/0.42） | `FingerStabilizer`，每手一实例 | ✅ |
| A4-03 | 六类手势分类：捏合/单指/双指/张开/握拳/多指 | `classifyGesture()` | ✅（仅分类，见 A4-04） |
| A4-04 | 姿态面板显示手势类别文字 | 摄像头面板 `.cp-gesture` | ✅ |
| A4-05 | 手指数 0~5 显示 + 五指逐指亮灭 | `.cp-fingers` 五个点 | ✅ |
| A4-06 | 捏合强度进度条 + 触发阈值竖线 | `.cp-pinch`，阈值线固定 0.62 | ✅ |

> 注：A4-03 的六类手势里，**只有"捏合"驱动了行为**。单指/双指/张开/握拳/多指的判定结果只用于显示，没有绑定任何操作。

## A5 手部校准

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| A5-01 | 4 秒倒计时采集，食指划过四角 | 面板「校准」按钮 → `CalibrationCollector` | ✅ |
| A5-02 | 把可达矩形线性映射铺满视口（4% 内缩） | `mapCalibrated()` | ✅ |
| A5-03 | 采集范围太小判失败并提示重来 | `result()` 返回 null → toast | ✅ |
| A5-04 | 校准状态提示文字（已校准/未校准） | Inspector 设置区底部 | ✅ |

---

# B 手势控制与指针

一层「把手的坐标变成屏幕上可点击的指针」的中间层。所有手势点击、拖动、滚动都在这里。

## B1 指针定位

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B1-01 | 指针位置取食指尖（点 8）投影 | `handTracker.ingest` → `view/ndc` | ✅ |
| B1-02 | 镜像开关（摄像头画面左右对调） | Inspector「镜像 开/关」 | ✅ |
| B1-03 | 每个关键点 x/y 各一个一欧元滤波器（共 42 个） | `OneEuro(3.0, 2.0)` | ✅ |
| B1-04 | 平滑度滑杆 0–1，映射 5.2Hz↔1.2Hz | Inspector「平滑」 | ✅ |
| B1-05 | 手/鼠标输入源自动切换 | 每帧按 `handFresh` 判定 | ✅ |
| B1-06 | 空格暂停手部输入（临时换鼠标） | 全局 keydown | 🖱 |
| B1-07 | 450ms 无新数据自动退回鼠标 | `Interaction` 内 `handFresh` | ✅ |

## B2 指针可视化

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B2-01 | DOM 圆环光标 + 中心点，浮在所有 UI 之上 | `HandCursor.tsx` | ✅ |
| B2-02 | 目标名标签（≤18 字，跟指针下方 26px） | `uiPointer.label` | ✅ |
| B2-03 | 悬停放大 1.75×，拖动放大 1.5× | CSS transform | ✅ |
| B2-04 | 拖动时标签改为显示实时数值 | `uiPointer.dragLabel` | ✅ |
| B2-05 | 3D 空间圆环（钉在命中表面或绘制平面上） | `PointerCursor` | ✅ |
| B2-06 | 3D 圆环捏合时缩小 0.55 并变青 | `pointerRuntime.pinched` | ✅ |

## B3 捏合判定

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B3-01 | 捏合强度 = 拇指尖-食指尖距离 / 掌宽，归一 0..1 | `pinchValueFromRatio` | ✅ |
| B3-02 | 带滞回开关（on 阈值可调，off = on − 0.14） | `decidePinch` | ✅ |
| B3-03 | 握力阈值滑杆 0.3–0.9（默认 0.62） | Inspector「握力」 | ✅ |

## B4 UI 点击

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B4-01 | 命中解析：button / `[data-hand-hit]` / input / select / textarea / `.obj-item` | `resolve()` | ✅ |
| B4-02 | 磁性吸附：两圈 8px / 16px、8 方向，只吸 ≤32px 高且 ≤140px 宽的控件 | `search()` | ✅ |
| B4-03 | 进入目标后需停留 140ms 才允许触发 | `ARM_MS` | ✅ |
| B4-04 | 两次点击最小间隔 340ms | `COOLDOWN_MS` | ✅ |
| B4-05 | 捏合上升沿 → 派发真实 `click()` | `pinchUi()` → `press()` | ✅ |
| B4-06 | 按下视觉反馈（`hand-press` 类 300ms） | `press()` | ✅ |
| B4-07 | 指针几乎不动时复用上一帧命中结果 | `hitAt` 缓存，省 17 次布局读取/帧 | ✅ |
| B4-08 | 滚出视口或尺寸 <4px 的控件视为不可达 | `isUsable()` | ✅ |

## B5 悬停

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B5-01 | `hand-hover` 类模拟 :hover（CSS 的 :hover 只认真鼠标） | `syncUiPointer` | ✅ |
| B5-02 | `body.hand-over-ui` 全局状态类 | 同上 | ✅ |

## B6 滑杆拖动

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B6-01 | 捏住 range 控件拖动改值（按轨道矩形线性映射） | `startRange` / `applyRange` | ✅ |
| B6-02 | 用原生 setter + `input` 事件，React onChange 能收到 | `setNativeValue` | ✅ |
| B6-03 | 松开派发 `change` 提交 | `endDrag(true)` | ✅ |
| B6-04 | 可手势拖动的滑杆：雕刻半径 / 强度 / 平滑度 / 握力 | `data-hand-label` 标注 | ✅ |

## B7 面板滚动

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B7-01 | 捏住可滚动容器空白处上下拖动 = 滚动 | `[data-hand-scroll]`，如 `.inspector-scroll`、`.tasks` | ✅ |
| B7-02 | 滚动时显示当前 scrollTop | `dragLabel` | ✅ |
| B7-03 | 容器内有内容可滚时才启用（scrollHeight > clientHeight + 4） | `scrollHostAt()` | ✅ |
| B7-04 | 面板空白处优先判滚动，不做磁性吸附 | `hitAt(x,y,!host)` | ✅ |

## B8 场景抑制

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| B8-01 | 指针压在控件 / 滚动区 / 面板皮面上时禁止 3D 拾取 | `uiPointer.blockScene` + `onUiSurface()` | ✅ |
| B8-02 | 被 UI 消费的捏合不再触达 3D | `pinchEdge && !uiConsumed` | ✅ |
| B8-03 | 捏合释放兜底结束拖动（防释放沿丢失） | `releaseUi()` | ✅ |

---

# C 三维交互与工具

四个工具下的具体操作语义。

## C1 选择与抓取

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C1-01 | 捏合射线命中即选中 | `Interaction.tsx` select 分支 | ✅ |
| C1-02 | 按住拖动移动（沿相机朝向平面投影） | `mode: "grab"` | ✅ |
| C1-03 | 拖动时 y 不小于 0（不穿地） | `Math.max(0, p.y)` | ✅ |
| C1-04 | 锁定对象拒绝抓取并 toast 提示 | `obj.locked` 检查 | ✅ |
| C1-05 | 空白处捏合取消选中 | `select(null)` | ✅ |
| C1-06 | 松开时把 transform 提交到 store 并存盘 | `setTransform` | ✅ |

## C2 绘制

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C2-01 | 捏合起笔（落点在相机前方 3.2 的平面上） | `DRAW_DISTANCE` | ✅ |
| C2-02 | 拖动采样，点距阈值 0.012 | 去重防密集点 | ✅ |
| C2-03 | 单条笔迹上限 420 点 | `MAX_STROKE_POINTS` | ✅ |
| C2-04 | 绘制中实时 ribbon 预览（预分配缓冲，不触发 React） | `LiveRibbon` | ✅ |
| C2-05 | 松手成型为独立场景对象（CatmullRom 管状体，≤600 段） | `buildStrokeGeometry` | ✅ |
| C2-06 | 笔迹自动命名带时分秒 | `笔迹 HH:MM:SS` | ✅ |
| C2-07 | 笔迹是真实几何体，可选中/移动/删除/导出 | 与其它对象同一套管线 | ✅ |

## C3 雕刻 · 按压凹陷

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C3-01 | 捏住表面按压产生凹陷 | `dent()`，衰减 (1-d/R)² | ✅ |
| C3-02 | 按压深度跟捏合强度联动（0.6→1 归一化） | `tight` 系数 | ✅ |
| C3-03 | 半径可调 0.04–0.5 | Inspector 滑杆 | ✅ |
| C3-04 | 强度可调 0.2–2.5 | Inspector 滑杆 | ✅ |
| C3-05 | 只对 primitive / model 生效，笔迹跳过雕刻 | `isStroke` 检查 | ✅ |

## C4 雕刻 · 拖动拉伸

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C4-01 | 捏住拖动拉出形体 | `displace()` | ✅ |
| C4-02 | 两种模式切换分段控件 | Inspector「按压凹陷 / 拖动拉伸」 | ✅ |

## C5 形变历史

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C5-01 | base + offset 双缓冲，形变可叠加不重建几何 | `MeshSculptData` | ✅ |
| C5-02 | 撤销形变（栈深 24 步） | `undo()` | ✅ |
| C5-03 | 重做形变（新操作清空重做链） | `redo()` | ✅ |
| C5-04 | 快捷键 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | 全局 keydown | 🖱 |
| C5-05 | 面板按钮「撤销形变 / 重做形变」 | Inspector 雕刻区 | ✅ |
| C5-06 | 重置单个对象的全部形变 | Inspector「重置形变」 | ✅ |
| C5-07 | 一次操作结束后统一重算法线 | `endSculptOp()` | ✅ |
| C5-08 | 撤销/重做结果有 toast 反馈 | `已撤销/没有可撤销的形变` | ✅ |

## C6 双手变换

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C6-01 | 双手同时捏合 → 按两手间距比缩放（夹在 0.25–4×） | `mode: "twohand"` | ✅ |
| C6-02 | 双手连线角度 → 绕 Y 轴旋转 | `dA` 归一化到 ±π | ✅ |
| C6-03 | 前置条件：必须已有选中对象 | `st.selectedId` | ✅ |

## C7 选中反馈

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C7-01 | 选中框按真实世界包围盒（含形变后） | `SelectionOverlay`，3 帧节流 | ✅ |

## C8 工具切换

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| C8-01 | 四工具：选择 / 绘制 / 雕刻 / 生成 | `ToolRail` | ✅ |
| C8-02 | 快捷键 1 / 2 / 3 / 4 | 全局 keydown | 🖱 |
| C8-03 | 每个工具悬停显示操作提示 | `.tool-hint` | ✅ |
| C8-04 | 选中「生成」时 toast 引导 | `setTool("ai")` | ✅ |
| C8-05 | 当前工具高亮 `aria-pressed` | `.tool.active` | ✅ |

---

# D 场景与对象管理

对象的创建、列表、属性、可见性。

## D1 创建基础几何体

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| D1-01 | 立方体 / 球体 / 圆柱 / 圆锥 / 圆环 五种 | Inspector「创建基础几何体」 | ✅ |
| D1-02 | 自动落在网格面上（按自身高度算 y） | `h/2 + 0.01` | ✅ |
| D1-03 | 新对象自动错位摆放，不重叠 | `(idx%3-1)*0.9` 等 | ✅ |
| D1-04 | 每种几何体带不同预设色 | `PRIMS[].color` | ✅ |

## D2 对象列表

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| D2-01 | 列表展示 + 点击选中 | `.obj-list` / `.obj-item` | ✅ |
| D2-02 | 按类型显示色点（primitive / model / stroke） | `.kind` 类 | ✅ |
| D2-03 | 隐藏对象名字降透明度 | `opacity: 0.45` | ✅ |
| D2-04 | 空列表时给引导文案 | 「还没有对象…」 | ✅ |
| D2-05 | 面板头显示对象总数 | `N OBJ` | ✅ |

## D3 行内操作

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| D3-01 | 显示 / 隐藏对象（眼睛图标） | `data-hand-hit` 小按钮 | ✅ |
| D3-02 | 锁定 / 解锁对象（锁图标） | 同上 | ✅ |
| D3-03 | 删除对象（垃圾桶图标） | 同上 | ✅ |

## D4 变换属性

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| D4-01 | 位置 XYZ 数值输入 | `VecRow` | ✅ |
| D4-02 | 旋转 XYZ（以度显示，内部弧度） | 同上，step=5° | ✅ |
| D4-03 | 缩放 XYZ 数值输入 | 同上 | ✅ |
| D4-04 | 数值框 ↑↓ 键步进、Enter 提交、失焦提交 | `Num` 组件 | 🖱 |

## D5 重命名

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| D5-01 | 属性区名称输入框实时改名 | `patchObject({name})` | 🖱 |

## D6 颜色

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| D6-01 | 系统取色器（原生弹窗） | `<input type="color">` | 🖱 |
| D6-02 | 8 个预设色块（为手势用户准备的替代） | `.swatches` + `data-hand-hit` | ✅ |
| D6-03 | 当前色高亮 | `.swatch.on` | ✅ |

## D7 对象复制

| # | 功能 | 实现 / 触发 | 状态 |
|---|---|---|---|
| D7-01 | 复制选中对象（x 偏移 +0.6，命名加「副本」） | Inspector「复制」 | ✅ |

---

# E AI 生成

接 Aholo Lux3D 云服务，把文字/图片变成 GLB 并送进场景。

**组级事实（一次说清，不在每行重复）**

- 全部生成都走服务端网关 `/api/lux3d/*`，浏览器不直连 `api.aholo3d.cn`，API Key 只在服务端（`server/lux3d.mjs`）。
- 前端异步模型是**单线程轮询**，不是 WebSocket/SSE：`waitForTask()` 每 3s 打一次 `GET /api/lux3d/task/:id`，直到 `status=3`（成功，且 outputs 非空）/ `status=4`（失败）/ 超过 12 分钟（超时）。三者都抛错，由 `AiPanel.finish()` 统一 catch。
- **没有取消**：`AiPanel` 里没有 `AbortController`，任务提交后只有"等到底"或"刷新页面"两条路；刷新后任务列表也会清空（`tasks` 不进持久化载荷）。
- **没有重试**：失败后只能手动再点一次提交（会新建一个 task，不是续跑原 task）。
- 生成结果进入场景的唯一路径：`downloadGlb()` → `idb.putAsset()` → `addAsset()` → `addObject()`，与本地导入、内置示例共用同一条模型渲染管线（`ObjectNode` → `parseGlb`）。
- **生成物不可继续生成式编辑**：模型入场景后只能被选择/移动/缩放/雕刻（几何层位移），没有"改提示词再生成""局部重绘""多轮迭代同一 task"的能力。

## E1 文生 3D

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| E1-01 | 填描述 → 点「文生 3D」→ 建任务 → 轮询 → 下载 → 自动入场景（主链路） | `src/ui/AiPanel.tsx` `runText()` → `src/lib/lux3dClient.ts` `createTextTo3D()` → `waitForTask()` → `finish()` → `addObject()`；按钮带 `data-hand-hit`，手势可点 | 交互 | ✅ |
| E1-02 | 任务行状态随服务端返回更新（提交任务 / `task N` / 排队中 / 生成中 / 下载模型中 / 已加入场景） | `finish()` 内 `patchTask()`：`status 3→success`、`1→running`、其余→`queued`；`setState` 文案在 `stateLabel()` | 界面反馈 | ✅ |
| E1-03 | 面板头显示当前模式：`TEXT → 3D` / `N REF` | `AiPanel` `.panel-head` 右上，取决于 `images.length` | 界面反馈 | ✅ |
| E1-04 | Ctrl / Cmd + Enter 提交 | `textarea.onKeyDown` 判 `e.metaKey \|\| e.ctrlKey` | 交互 | 🖱 |
| E1-05 | 空描述拦截 + 引导文案 | `runText()` 首行 `prompt.trim()` 判空 → `toast("先描述你想要的物体","warn")` | 界面反馈 | ✅ |
| E1-06 | 生成期间单飞：两个提交按钮 `disabled={busy}`（不可并发生成） | `busy` 在 `runText`/`runImage` 起止置位，`finally` 复位 | 交互 | ✅ |
| E1-07 | 建任务请求失败（HTTP 非 2xx / 服务端 `{error}`）→ 任务置 `failed` + 红色 toast | `lux3dClient.json()` 抛 `Error(body.error ?? "请求失败 HTTP x")` → `runText()` catch → `patchTask` + `toast(err)` | 界面反馈 | ✅ |
| E1-08 | 轮询 3s / 12 分钟超时判失败（超时抛"生成超时（超过 12 分钟）"） | `waitForTask(intervalMs=3000, timeoutMs=12*60*1000)` | 系统内部 | ✅ |
| E1-09 | 服务端 `status=4` 立即判失败并给出原因 | `waitForTask()` 内 `throw new Error("生成任务失败（服务端返回 status=4）")` | 系统内部 | ✅ |
| E1-10 | 生成参数：`style` 透传；`faceCount` 恒为 200000（前端无入口）；版本默认 `G1`；`outputFormat:["glb"]` | `createTextTo3D(prompt, style)` 未传 faceCount；`server/index.mjs` `Math.min(3e5, Math.max(1e4, Number(faceCount) \|\| 2e5))`；`server/lux3d.mjs` `createTextTo3D({version="G1"})` | 服务能力 | ⛔ 面数无入口 |

## E2 图生 3D

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| E2-01 | 选图上传，最多 4 张，转 base64 dataURL | `AiPanel.onFiles()` → `fileToDataUrl()`；`<input type="file" accept="image/png,image/jpeg,image/webp" multiple>` | 交互 | 🖱 |
| E2-02 | 拖拽图片进面板即载入 | `section.onDrop` → `onFiles(e.dataTransfer.files)`；拖入时 `.drop-hint` 覆盖提示 | 交互 | 🖱 |
| E2-03 | 46×46 缩略图预览 + 单张删除 + 一键清空 | `images.map(...)` 渲染；删除 `setImages(filter)`；清空按钮 | 交互 | ✅ |
| E2-04 | 提交成功后自动清空参考图 | `runImage()` 末尾 `setImages([])`（仅成功路径；失败则保留，便于重试） | 界面反馈 | ✅ |
| E2-05 | 非图片类型过滤 | `if (!f.type.startsWith("image/")) continue`；全部被过滤时 `toast("请选择 JPG / PNG 图片","warn")` | 系统内部 | ✅ |
| E2-06 | 未选图时点图片按钮 = 唤起文件选择框 | `runImage()` 首行 `if (!images.length) fileRef.current?.click()` | 交互 | 🖱 |
| E2-07 | 图生固定 `version:"G1-Turbo"`，不传 style；服务端单图写 `img`、多图写 `imgs` | `createImgTo3D(images)`；`server/lux3d.mjs` `createImgTo3D({imageUrls, version="G1-Turbo"})` 分支 | 服务能力 | ⚙ |
| E2-08 | 上传阶段专用文案（`上传中` / "上传素材"） | `addTask({state:"uploading", message:"上传素材"})` | 界面反馈 | ✅ |
| E2-09 | 张数上限双端各截 4 张（超出的静默丢弃，不提示） | 前端 `Array.from(files).slice(0,4)`；服务端 `images.slice(0,4)` | 系统内部 | ✅ |

> 图生真实链路已跑通（task 7137496，111.9s，14.3MB / 126,059 顶点，magic=`glTF`，见 `docs/04-testing.md` 记录 5）。上传 1.5s，URL 可 HTTP 206 访问。

## E3 风格

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| E3-01 | 7 种风格：写实 / 赛博 / 奇想 / 卡通 / 手绘 / 玻璃 / 动漫 | `AiPanel.tsx` `STYLES` = `photorealistic · cyberpunk · fantasy · cartoon · hand_painted · glass · anime` | 交互 | ✅ |
| E3-02 | 原生 `<select>` 下拉选择 | `AiPanel` select（宽 62 × 高 26） | 交互 | 🖱 |
| E3-03 | 循环按钮「风格 X」——原生弹层不接受合成点击，这是手势替代路径 | `data-hand-hit` 按钮，点一次取 `STYLES[(i+1)%7]` | 交互 | ✅ |
| E3-04 | 切换后 toast 回显当前风格 | `toast("风格：X","info")` | 界面反馈 | ✅ |

> 风格只作用于文生 3D（`createTextTo3D` 带 style），图生 3D 不带 style——这不是遗漏，是上游接口的参数差异（`docs/02-api.md`）。服务端不做风格白名单校验，任意字符串透传。

## E4 预设短语

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| E4-01 | 4 条预设描述，点一下填入输入框（珊瑚椅 / 雪山地形 / 青瓷猫 / 赛博街灯） | `PRESETS`；仅 `tool === "ai"` 时渲染（面板每多一行就多挡一块画布） | 交互 | ✅ |
| E4-02 | 填入后 toast 提示下一步（"已填入描述，点「文生 3D」提交"） | `onClick` → `setPrompt` + `toast` | 界面反馈 | ✅ |
| E4-03 | 填入是**覆盖**而非追加 | `setPrompt(p.prompt)` 直接赋值 | 系统内部 | ⚙ |

> E4 存在的唯一目的是让纯手势用户走通"描述 → 提交"：手势层没有输入法（`uiPointer.pinchUi()` 对 textarea 只 `focus()`，打不出字）。

## E5 任务队列

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| E5-01 | 任务列表（最多 12 条，新的在前） | `src/store.ts` `addTask`：`[t, ...s.tasks].slice(0,12)` | 数据管理 | ✅ |
| E5-02 | 五态显示：上传中 / 排队 / 生成中 / 完成 / 失败 | `stateLabel()` 映射 `uploading / queued / running / success / failed` | 界面反馈 | ✅ |
| E5-03 | 显示服务端 task id 与错误原文（单行、超长省略） | `t.message`（`maxWidth:120` + `ellipsis`） | 界面反馈 | ✅ |
| E5-04 | 失败与超时都有红色 toast | `finish()` catch + `waitForTask()` 抛错 | 界面反馈 | ✅ |
| E5-05 | 任务不持久化：刷新后任务列表为空，历史不可查 | `store.save()` 只写 `{objects, settings, assets}`，`tasks` 不在载荷内 | 数据管理 | ⚙ |

## E6 生成物落盘与入场景

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| E6-01 | GLB 经服务端代理下载（绕 CORS）→ 存 IndexedDB | `downloadGlb(url)` → `GET /api/asset?url=` → `idb.putAsset("asset_"+taskId, Blob)` | 数据管理 | ✅ |
| E6-02 | 生成物自动加入场景，按九宫格错位摆放（y=0.85） | `AiPanel.placeNew()`：`col=((n-1)%3)-1`，`row=floor((n-1)/3)`，z 每行 -0.9 | 数据管理 | ✅ |
| E6-03 | 生成物元数据入 assets（taskId / sourceUrl / bytes / prompt / createdAt），上限 40 条 | `store.addAsset()` `.slice(0,40)` | 数据管理 | ✅ |
| E6-04 | 资产库界面（查看历史生成物、删除） | `assets` 数组 + `removeAsset()` 已实现，**无任何组件渲染它** | 数据管理 | ⛔ |
| E6-05 | 产物选择策略：`.glb` > `.ply` > `.zip`（G1 会同时返回 zip 与 glb） | `waitForTask()` 内 `score(url)` 排序后取 `urls[0]` | 系统内部 | ⚙ |
| E6-06 | 资产 id 幂等 `asset_{taskId}`：同一任务重复下载覆盖同一 Blob，不产生重复资产 | `finish()` 固定 assetId；`putAsset` 为 put 语义 | 数据管理 | ⚙ |

## E7 服务状态

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| E7-01 | 顶栏 LUX3D 芯片：ONLINE / OFFLINE / ...，随探活结果变色 | `TopBar.tsx` `apiHealth()` — **只在组件挂载时调一次**，不轮询、不随提交失败更新 | 界面反馈 | ✅ |
| E7-02 | 探活失败 → OFFLINE + 红点（不阻断任何操作） | `.catch(() => setLux("fail"))`；`runText` 不读 `lux`，离线也能提交，失败靠 E1-07 兜 | 界面反馈 | ✅ |

---
# F 导入导出与持久化

**组级事实**

- 持久化只有两层：IndexedDB（`spatial-creator` v1，`kv` 单键 `project` + `assets` Blob store，`src/lib/idb.ts`）与"下载到磁盘"（GLB / JSON）。**没有服务端存储、没有账号、没有多存档、没有版本记录。**
- **保存得住**：对象清单、每个对象的 `kind/name/transform/color/visible/locked/primitive 参数/stroke 点集/width/assetId`、全局 settings、assets 元数据、assets 的 GLB 二进制。
- **保存不住**：雕刻形变（`SceneObject` 只有 `deformed:true` 标记；顶点偏移在 `mesh.userData.__sculpt` 里，不进载荷，见 `docs/03-progress.md` 未完成项）、AI 任务列表、`selectedId`、面板显隐、当前工具、撤销栈。
- **能导出但不能导回**：`saveProjectFile()` 产出 JSON，但项目里没有任何"导入 JSON"入口，也没有对应解析器。JSON 里只有 `assetId`，没有 GLB 二进制——换台机器/清过浏览器数据后，这份 JSON 无法复原模型。
- 文件格式只认 GLB；`.gltf` 从扩展名上放行，但解析走 `GLTFLoader.parseAsync(buf, "")`（无资源基址），引用外部 `.bin`/贴图的 glTF 大概率失败（未实测，见 §五 存疑）。

## F1 自动保存

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| F1-01 | 对象增删改、设置变更后自动写 IndexedDB | `store.save()` 挂在 `addObject / removeObject / patchObject / setTransform / duplicateObject / clearScene / updateSettings / addAsset / removeAsset` 末尾（`void get().save()`，不 await） | 数据管理 | ✅ |
| F1-02 | 启动时恢复上次的 objects / settings / assets | `store.hydrate()` 读 `kv["project"]`，`settings` 与 `defaultSettings` 做浅合并 | 数据管理 | ✅ |
| F1-03 | 恢复期间显示 INITIALIZING 遮罩（不闪空场景） | `App.tsx` `hydrated` 为 false 时渲染 `.boot`；`hydrate().finally()` 只为置位 | 界面反馈 | ✅ |
| F1-04 | 保存/读取失败只 `console.warn`，不打断使用 | `hydrate` / `save` 各自 try/catch | 系统内部 | ✅ |
| F1-05 | 保存内容边界：几何参数 / 笔迹点集 / 变换 / 颜色 / 可见性 / 锁定 / assetId / settings；**不含**形变偏移、tasks、选中态、撤销栈 | `types.ts` `SceneObject`；`save()` 载荷 `{objects, settings, assets, savedAt}` | 数据管理 | ⚙ |

## F2 手动保存

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| F2-01 | 顶栏保存按钮 + 确认 toast（"项目已保存到本地"） | `TopBar.tsx` `onClick={() => (save(), toast(...))}`；`IconSave` | 交互 | ✅ |

> 该按钮不改变保存内容，只是立刻触发一次已经自动发生的写入。**注意**：`save()` 是 async 且没被 await，toast 先于落盘弹出；写入失败时用户仍会看到"已保存"（`save()` 内部 catch 掉了异常）。属反馈失真，不是功能缺失。

## F3 导出

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| F3-01 | 导出整个场景为单个 GLB 并下载（文件名 `spatial-scene-<ts>.glb`） | `TopBar.doExport()` → `src/lib/exporter.ts` `exportSceneGlb()` → `GLTFExporter.parseAsync({binary:true, onlyVisible:true})` → `downloadBlob()` | 数据管理 | ✅ |
| F3-02 | 导出前检查空场景并提示 | `if (!objects.length) toast("场景为空，没有可导出的对象","warn")` | 界面反馈 | ✅ |
| F3-03 | 导出完成显示文件体积 | `toast("已导出 GLB · x.xx MB")`，取自 `blob.size` | 界面反馈 | ✅ |
| F3-04 | 导出项目为 JSON 文件（`{version:1, objects, settings}`） | `store.saveProjectFile()` 已实现，**无调用方**（全仓 grep 只有定义与接口声明） | 数据管理 | ⛔ |
| F3-05 | 导出范围：仅 `objectRegistry` 中 `visible` 的对象（克隆 Object3D）+ 自建 ambient/key 两盏灯；**不含**相机、天幕、网格、柔光池、光环、粒子、手 | `exportSceneGlb()`：遍历注册表 `obj.clone(true)`，另加 2 盏灯 | 数据管理 | ⚙ |
| F3-06 | 导出包含形变后顶点与笔迹管体（clone 共享同一 geometry，偏移已写进 position 数组） | `clone(true)` 不复制 geometry，直接引用；`deformation.displace()` 就地改 `position.array` | 数据管理 | ⚙ |
| F3-07 | 导出文件可被外部 DCC/查看器打开 | 基准断言 magic=`glTF`、9,277,652 B（`bench-features`）；**Blender 复核未做**（`docs/04-testing.md` 未覆盖项） | 数据管理 | ✅⚠ |

## F4 导入与示例

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| F4-01 | 导入本地 GLB / GLTF，二进制存 IndexedDB 后作为独立对象入场景 | `Inspector.tsx` `importGlb(f)`：`idb.putAsset(asset_import_<ts>)` → `addObject(makeObject("model",…))` | 数据管理 | 🖱 |
| F4-02 | 扩展名拦截（只收 .glb/.gltf）；>60MB 只警告仍继续 | 同函数：正则 `/\.(glb\|gltf)$/i`；`f.size > 60MB` → warn toast 但不 return | 界面反馈 | 🖱 |
| F4-03 | 内置示例 1：文生 3D 陶瓷椅（8.4MB / 64,707 顶点，本地 `/samples/ceramic-chair.glb`） | `src/lib/samples.ts` `SAMPLES[0]`；Inspector「载入示例 · 文生3D 陶瓷椅」 | 数据管理 | ✅ |
| F4-04 | 内置示例 2：图生 3D 青瓷（14.3MB / 126,059 顶点） | `SAMPLES[1]`；Inspector「载入示例 · 图生3D 青瓷」 | 数据管理 | ✅ |
| F4-05 | 示例重复载入时只选中、不重复添加 | `loadSample()` 按 `assetId` 在 `objects` 中查重 → `select(dup.id)` + toast "已在场景中" | 数据管理 | ✅ |
| F4-06 | 资产删除（删 Blob + 删列表项） | `store.removeAsset()` 已实现，**无任何 UI 调用** | 数据管理 | ⛔ |
| F4-07 | 模型对象可共享同一资产（复制对象只复制 `assetId`，不复制 Blob） | `duplicateObject()` 浅拷贝 `assetId`；`ObjectNode` 每次 `getAsset` 独立解析 | 数据管理 | ⚙ |

> 未做成"行"但影响使用的事实（源码依据在括号里）：模型解析失败只有 `console.warn`，界面上表现为"对象在列表里但画布空着"（`ObjectNode.tsx` catch）；删对象不删其 IndexedDB Blob，资产会残留（`removeObject` 只删对象条目，`delAsset` 仅在 `removeAsset` 里）；示例首载需通过网络拉 8.4–14.3MB 文件，期间只有一条 toast，无进度（`loadSample()`）。

---
# G 视图与渲染

**组级事实**

- 渲染栈：`@react-three/fiber` + `three 0.180`，`Canvas` 于 `src/scene/Viewport.tsx`。**无后期处理管线**（`EffectComposer`/`postprocessing` 未引入）；扫描线与暗角是两张 CSS 叠加层（`.fx-scan` / `.fx-vignette`），不参与渲染图。
- 相机：单一透视相机（fov 45、near 0.05、far 120），由 `OrbitControls` 驱动。**视角只有鼠标**，没有任何手势绑定（`06-feature-acceptance.md` Ⅰ-5 明确未做），也没有视角预设、复位、聚焦选中对象。
- **左键在画布上被显式禁用**（`LEFT: undefined`），因为左键等价于"捏合"，要留给拾取/落笔/抓取。副作用：不能用左键拖拽旋转视角。
- 性能手段是"逐帧不碰 React + BVH + 自适应 DPR + 一次 raycast"，**没有** LOD、实例化、视锥剔除调优、对象数上限、帧率上限或降级开关。场景复杂度阈值实测只到 16 万顶点模型（单模型 60 FPS 报数来自 headless 之外的记录，见 `docs/04-testing.md` 记录 4）。
- 场景加载期间 `Suspense fallback={null}`：模型解析不出来时，用户看到的是"列表里有对象、画布上没有"，没有任何加载态（大模型实测解析 5.0s / 16.8s）。

## G1 相机控制

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| G1-01 | 右键拖动旋转视角 | `Viewport.tsx` `OrbitControls mouseButtons={{RIGHT: THREE.MOUSE.ROTATE}}` | 交互 | 🖱 |
| G1-02 | 中键拖动平移 | `MIDDLE: THREE.MOUSE.PAN` | 交互 | 🖱 |
| G1-03 | 滚轮缩放（距离 1.2–14） | `minDistance={1.2} maxDistance={14}`，缩放用 OrbitControls 默认滚轮 | 交互 | 🖱 |
| G1-04 | 俯仰限制：不穿到地面以下 | `maxPolarAngle={Math.PI/2.05}`（无 minPolarAngle，可从正上方俯视） | 系统内部 | 🖱 |
| G1-05 | 阻尼平滑（松手后惯性收敛） | `enableDamping dampingFactor={0.08}` | 界面反馈 | 🖱 |
| G1-06 | 左键在 3D 上不抢事件（留给手势/拾取） | `LEFT: undefined`；鼠标左键按下被 `Interaction` 当作"捏合"处理（`handState.mouse.down`） | 系统内部 | ✅ |
| G1-07 | 相机固定参数：fov 45 / near 0.05 / far 120 / 初始位 (0,1.6,4.8) / target (0,0.9,0) | `Canvas camera={{...}}` + `OrbitControls target` | 系统内部 | ⚙ |

## G2 环境与光照

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| G2-01 | 天幕垂直渐变（自定义 shader，BackSide 球，60 倍缩放） | `src/scene/Environment.tsx` `backdropVert/backdropFrag` | 界面反馈 | ✅ |
| G2-02 | 三点布光：环境光 + 2 盏平行光（1 盏投影，正交阴影 ±11）+ 1 盏点光 | `<ambientLight 0.42>` / `<directionalLight 1.45 castShadow>` / `<directionalLight 1.0>` / `<pointLight 9 distance 7>` | 界面反馈 | ✅ |
| G2-03 | 地面柔光池（512² CanvasTexture 径向渐变，加法混合） | `useGlowTexture()` + 18×18 平面 | 界面反馈 | ✅ |
| G2-04 | 无限网格，可显隐 | drei `<Grid infiniteGrid cellSize 0.5 fadeDistance 26>`；`settings.showGrid` ← Inspector「网格 显示/隐藏」 | 交互 | ✅ |
| G2-05 | 两圈缓慢旋转的光环 | `rings`：z 轴 0.04 rad/s + x 轴 sin 摆动 | 界面反馈 | ✅ |
| G2-06 | 1100 个背景粒子（半径 7–20，缓慢绕 Y 旋转） | `points` 一次性 Float32Array + `dt*0.012` | 界面反馈 | ✅ |
| G2-07 | 雾效（10–34，颜色 `#050a12`） | `<fog attach="fog" args={["#050a12",10,34]}>` | 界面反馈 | ✅ |
| G2-08 | 扫描线 + 暗角装饰（CSS 叠加，非渲染图） | `App.tsx` `.fx-scan` / `.fx-vignette`；样式在 `styles.css:89/105` | 界面反馈 | ✅ |

## G3 材质与画质

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| G3-01 | ACES Filmic 色调映射，曝光 1.05 | `Viewport.tsx` `onCreated`：`gl.toneMapping = ACESFilmicToneMapping` | 界面反馈 | ✅ |
| G3-02 | 阴影（平行光正交阴影相机 ±11，0.5–34；几何体 cast+receive，地面 receive） | `<directionalLight castShadow><orthographicCamera attach="shadow-camera">` | 界面反馈 | ✅ |
| G3-03 | 基础几何体材质：roughness 0.34 / metalness 0.24 + 颜色 ×0.14 自发光 | `ObjectNode.tsx` `<meshStandardMaterial>` | 界面反馈 | ✅ |
| G3-04 | 基础几何体额外一层 1.002 倍线框描边（不参与拾取） | 第二个 `<mesh scale={1.002} raycast={()=>null}>` wireframe opacity 0.14 | 界面反馈 | ✅ |
| G3-05 | 笔迹发光材质：加法混合、不写深度、不参与色调映射；选中转白 | `<meshBasicMaterial blending={AdditiveBlending} depthWrite={false} toneMapped={false}>` | 界面反馈 | ✅ |
| G3-06 | 自适应 DPR（1–2，按负载降级，`pixelated`） | `Canvas dpr={[1,2]}` + `<AdaptiveDpr pixelated>` | 界面反馈 | ✅⚠ |
| G3-07 | 模型导入自动归一化到 1.2 单位、水平居中、底部贴地 | `src/lib/glb.ts` `parseGlb(buf, targetSize=1.2)`：`scale = 1.2/maxDim`，`position -= center`，`position.y += h/2` | 系统内部 | ✅ |
| G3-08 | 模型保留自身材质与贴图，只强制 `FrontSide` + `needsUpdate`，不重着色 | `parseGlb()` 遍历材质 | 系统内部 | ⚙ |

## G4 拾取加速

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| G4-01 | 全局安装 three-mesh-bvh 加速射线检测（改写 `Mesh.prototype.raycast`） | `glb.ts` `setupBVH()`，幂等 | 系统内部 | ✅ |
| G4-02 | GLB 载入时逐 mesh 建 BVH；形变后 `refit()` + 重算包围球 | `geo.computeBoundsTree()`；`deformation.refit()` | 系统内部 | ✅ |
| G4-03 | 递归拾取模型子网格（命中后沿父链回落到 `objectId`） | `Interaction.tsx` `raycaster.intersectObjects(targets,true)` + `findId()` | 系统内部 | ✅ |

## G5 渲染循环与性能组织

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| G5-01 | 所有逐帧逻辑走 `useFrame`，不触发 React 重渲染 | `Interaction` / `HandRig` / `PointerCursor` / `SelectionOverlay` / `LiveStroke` / `Environment` | 系统内部 | ✅ |
| G5-02 | 临时向量 / 矩阵 / 射线器预分配复用（消 GC 抖动） | `Interaction` 的 `tmp`、`PointerCursor` 的 `scratch`、`useMemo` 几何 | 系统内部 | ✅ |
| G5-03 | 低频 UI 更新聚合：选中框 3 帧一次、HUD 500ms、姿态回显仅在文本变化时写 DOM | `SelectionOverlay` `frame%3`；`startHudSync()` 500ms 窗口；`CameraPanel` 比较 `textContent` | 系统内部 | ✅ |
| G5-04 | 指针几乎不动时复用上一帧命中结果（省每帧 17 次布局读取） | `uiPointer.hitAt()`：位移 <1.5px 且元素仍 `isConnected` 时直接返回缓存 | 系统内部 | ✅ |
| G5-05 | 场景加载无 fallback UI（`fallback={null}`），无对象数上限 / 无 LOD / 无实例化 | `Viewport.tsx` `<Suspense fallback={null}>` | 界面反馈 | ⛔ |

> 帧率相关实测只在特定环境成立：headless + SwiftShader 软渲染下 25–30 FPS（雕刻中）、13 FPS（12.6 万顶点模型首次加载后）；真机 GPU 数字未在本轮复测（`docs/04-testing.md` 记录 3/6）。

---

# H 相机硬件

**组级事实**

- 采集入口唯一：`navigator.mediaDevices.getUserMedia`，约束 `{facingMode:"user"}` 或 `{deviceId:{exact}}`，分辨率 `ideal 1280×720`。**用户无法配置分辨率、帧率、镜像源设备**（镜像只是个坐标翻转开关，见 B1-02）。
- 权限：无 `navigator.permissions.query` 预检，直接调 `getUserMedia`；拒绝/占用统一走 catch → 鼠标模式 + 红色 toast（已实测：`test-acceptance-gaps.mjs` 8/8）。
- 设备切换靠 `enumerateDevices()` 轮转 `deviceIndex`，**未处理"未授权时 deviceId 为空"这一浏览器行为**（首授权前枚举到的 videoinput 可能无有效 deviceId），也未处理设备中途拔出（无 `track.onended`）。
- 送进模型的帧是 640×360（`createImageBitmap resizeWidth/Height`），节流 26ms，推理期间只排队最新一帧——这三点决定了"跟手但不抖"的手感，属内部能力。

## H1 设备控制

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| H1-01 | 启用 / 关闭摄像头（顶栏图钉 + 摄像头面板按钮，两处入口） | `TopBar` / `CameraPanel` → `src/lib/cameraService.ts` `startCamera()` / `stopCamera()` | 交互 | ✅ |
| H1-02 | 多摄像头轮流切换 | `startCameraDevice()`：`listCameras()` → `deviceIndex=(i+1)%n` → 先 `stop()` 再 `startCamera(deviceId)` | 交互 | ✅⚠ |
| H1-03 | 只有 1 个设备时提示「没有检测到其他摄像头」 | `devices.length <= 1 → return false` → `CameraPanel` toast | 界面反馈 | ✅ |
| H1-04 | 权限拒绝 / 设备占用 → 回退鼠标模式 + 红色 toast（写明原因） | `startCamera()` catch → `handState.status="error"`、`setCameraReady(false)`、`toast("摄像头不可用：…已切换到鼠标模式。","err")` | 界面反馈 | ✅ |
| H1-05 | 采集约束：facingMode user 或 exact deviceId，ideal 1280×720 | `HandTracker.startCamera()` `getUserMedia({video:{…}})` | 系统内部 | ✅ |
| H1-06 | 送帧规格：缩到 640×360、26ms 节流、推理期间只排队最新一帧（延迟恒定 1 次推理） | `handTracker.ts` `FEED_W/H`、`MIN_SEND_MS`、`capture()`/`flushPending()` | 系统内部 | ✅ |
| H1-07 | 手部模型加载 20s 超时判失败 | `HandTracker.init()` `setTimeout(()=>reject("手部模型加载超时（20s）"),20000)` | 系统内部 | ✅⚠ |

## H2 预览与状态

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| H2-01 | 实时视频预览 + 取景框 | `CameraPanel` `<video muted playsInline>` + `.cam-frame` | 界面反馈 | ✅ |
| H2-02 | 状态文字五态：STANDBY / LOADING MODEL… / TRACKING / SEARCHING · N FPS · MIRROR\|RAW / ERROR | `CameraPanel.tsx` `cameras(mirror, fps, hands)` | 界面反馈 | ✅ |
| H2-03 | 未启用时的空态文案「当前为鼠标模式，功能完全可用」 | `.cam-empty`，条件 `!cameraReady` | 界面反馈 | ✅ |

---

# I 界面框架与反馈

**组级事实**

- 单页应用，无路由。DOM 结构：`TopBar` + `stage`（`Canvas` / `.fx-scan` / `.fx-vignette` / `ToolRail` / `Inspector` / `CameraPanel` / `AiPanel` / `HandCursor` / `Toasts` / 可选 `MetricsPanel` / `.hint-bar`）+ `BootOverlay` + `HelpOverlay`。
- 状态管理统一在一个 zustand store（`src/store.ts`，30 个 action），高频手部数据刻意放在 React 之外的模块单例（`handState`、`pointerRuntime`、`drawRuntime`、`uiPointer`），靠 500ms/按需同步进 store。
- 交互状态词表：`hover→hand-hover`、`press→hand-press`、`drag→hand-drag`、`blockScene`、`armedAt/lastActionAt`；都是手势层专用类，CSS 的 `:hover` 只认真鼠标。
- **没有 React ErrorBoundary**：任何组件抛错 = 整页白屏，没有降级界面。
- 加载反馈不统一：启动用遮罩、AI 用任务行文案、示例/保存/导出用 toast、模型解析**什么都没有**。

## I1 顶栏

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| I1-01 | 输入源状态芯片：HAND TRACK / MOUSE FALLBACK | `TopBar` `cameraReady`；点颜色随 `hud.pointerActive` 变 warn | 界面反馈 | ✅ |
| I1-02 | HANDS 数量、HB 手部帧率、RENDER 渲染帧率 | `hud`（`startHudSync` 500ms 聚合） | 界面反馈 | ✅ |
| I1-03 | LUX3D ONLINE/OFFLINE、OBJ 对象数 | `apiHealth()` / `objects.length` | 界面反馈 | ✅ |
| I1-04 | 三个面板显隐按钮（工具栏 / 属性区 / AI 区），带 `aria-pressed` | `togglePanel("rail"\|"inspector"\|"ai")` → `.app.no-*` | 交互 | ✅ |
| I1-05 | 高对比模式开关，localStorage 持久化（`sc-contrast`） | `TopBar` `highContrast` → `body.contrast-high`；对比度基准 19.78:1（`check-contrast.mjs`） | 交互 | ✅ |
| I1-06 | 摄像头 / 保存 / 导出 / 帮助 四个图标按钮 | `TopBar` `status-chips` 区 | 交互 | ✅ |
| I1-07 | 顶栏 8 个图标按钮手势可达（含悬停高亮） | `bench-hand` C-03 断言 8/8；命中靠 `button` + 磁性吸附 ≤32px 高控件 | 交互 | ✅ |

## I2 面板布局

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| I2-01 | 三面板可独立收起，布局让出画布空间 | `App` class 拼接 `.no-rail/.no-inspector/.no-ai`；`styles.css:1100` | 界面反馈 | ✅ |
| I2-02 | 面板统一视觉（标题栏 + 内容区 + 玻璃模糊 + 统一间距） | `.panel / .panel-head / .panel-title`，`backdrop-filter: blur(16px)` | 界面反馈 | ✅ |
| I2-03 | 面板收起是 CSS `display:none`，组件仍挂载——AI 面板隐藏时任务轮询不受影响 | 同 I2-01；`AiPanel` 恒在 React 树中 | 系统内部 | ⚙ |

## I3 提示与反馈

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| I3-01 | Toast 通知：4 种语义色、最多堆叠 4 条、4.2s 自动消失 | `store.toast()` `slice(-4)` + `setTimeout(4200)`；`Toasts.tsx` | 界面反馈 | ✅ |
| I3-02 | 点 Toast 可手动关闭 | `onClick={() => dismiss(t.id)}` | 交互 | ✅ |
| I3-03 | 底部常驻提示条（捏合=确认/落笔/抓取 · 张开=释放 · 右键旋转 · H 看指引） | `App.tsx` `.hint-bar` | 界面反馈 | ✅ |
| I3-04 | 空态引导文案（对象列表"还没有对象…"、摄像头"当前为鼠标模式"、启动页四条能力） | `Inspector.tsx` / `CameraPanel.tsx` / `BootOverlay.tsx` | 界面反馈 | ✅ |

## I4 遮罩层

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| I4-01 | 启动页：标题 + 4 条能力说明 + 2 个入口 | `BootOverlay.tsx` `ITEMS` | 界面反馈 | ✅ |
| I4-02 | 「启用摄像头并进入」自动申请权限 | `enterWithCamera()`：`phase="requesting"` → `startCamera()` → `onEnter()`；失败也进入 | 交互 | ✅ |
| I4-03 | 「鼠标模式」跳过摄像头 | `onClick={onEnter}` | 交互 | ✅ |
| I4-04 | 启动页阶段文字（请求摄像头权限… / 加载手部模型… / 默认提示） | `phase` state + `handState.status` 判红 | 界面反馈 | ✅ |
| I4-05 | 帮助浮层：手势 5 条 / 鼠标回退 5 条 / 推荐工作流 5 步 | `HelpOverlay.tsx` 三个 `<dl>` | 界面反馈 | ✅ |
| I4-06 | H 或 ? 键开关帮助；点遮罩关闭 | `App.tsx` keydown `e.key==="?"\|\|"h"`；`.help onClick={onClose}` | 交互 | 🖱 |
| I4-07 | 帮助浮层右上 ✕ 关闭按钮手势可达 | `.icon-btn`（`button`），走通用命中 | 交互 | ✅ |

## I5 调试与度量

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| I5-01 | 指标面板（M 键）：推理 p50/p95、输入帧率、手在画面占比、丢手次数、捏合延迟与 p95、捏合次数、指针静止抖动、笔迹落点速率、渲染 fps | `MetricsPanel.tsx`（400ms 刷新）+ `src/lib/metrics.ts` | 界面反馈 | 🖱 |
| I5-02 | 指标重置 | `metrics.reset()`；面板「重置」按钮 | 交互 | ✅ |
| I5-03 | 快捷键说明区（Inspector 底部 4 行） | `Inspector.tsx` 末尾 `.section` | 界面反馈 | ✅ |
| I5-04 | `window.__spatial`（含 useApp / objectRegistry / exporter / deformation / handState / metrics / gesture / THREE）与 `window.__three`，**仅 DEV 注入** | `App.tsx` `import.meta.env.DEV`；`Viewport.tsx` 同 | 系统内部 | 🖱 |
| I5-05 | 键盘快捷键全集：1–4 / Esc / Delete / Backspace / Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / 空格 / H / ? / M | `App.tsx` 全局 keydown（输入框内只响应 Esc 失焦） | 交互 | 🖱 |

---

# J 后端服务

**组级事实**

- 单文件 Fastify 网关（`server/index.mjs`，124 行）+ 上游适配层（`server/lux3d.mjs`，165 行）。默认 8787，同时承担 API 代理与生产静态托管；开发期由 Vite 把 `/api` 反代到 127.0.0.1:8787（`vite.config.ts`）。
- 一共 **5 个 HTTP 路由**，没有数据库、没有队列、没有任务表——任务状态完全由上游持有，服务端只做透传。
- **无鉴权**：任何人可调 `/api/lux3d/*`（消耗的是服务端 Key 对应额度）；CORS 为 `*`；无速率限制。
- 上游每次生成都会消耗 Aholo 额度；图生还会先消耗一次 OUS 上传。这是本服务最实质的外部依赖与成本项。
- 已知工程债（事实，不是判断）：`lux3d.mjs:18` 在环境变量缺失时回退到硬编码 Key；`/api/asset?url=` 接受任意 http(s) URL（开放代理面）；`bodyLimit 32MB` 与"4×12MB base64"的前端上限不自洽。

## J1 业务接口

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| J1-01 | `GET /api/health` → `{ok, service, lux3dBase, keyConfigured, keyTail(末 4 位)}` | `server/index.mjs`；用于顶栏 LUX3D 芯片 | 服务能力 | ✅ |
| J1-02 | `POST /api/lux3d/text-to-3d`：空 prompt 400；prompt 截 800 字；style 缺省 `photorealistic`；faceCount 夹 1 万–30 万 | 同文件；上游 `POST /lux3d/v1/generate/text-to-3d/task/create`，`outputFormat:["glb"]`，返回 `{taskId: d}` | 服务能力 | ✅ |
| J1-03 | `POST /api/lux3d/img-to-3d`：最多 4 张、只接受 base64 dataURL、单张 ≤12MB、逐张上传 OUS 后建任务，回传 `imageUrls` | 同文件 + `lux3d.mjs uploadImage()`（md5 + FormData + `ous-token-v2`） | 服务能力 | ✅ |
| J1-04 | `GET /api/lux3d/task/:taskId` 透传；`outputs` 归一化成字符串数组（兼容 `string` 与 `{content\|url}`） | `lux3d.mjs getTask()` | 服务能力 | ✅ |
| J1-05 | `GET /api/asset?url=` 代理下载产物（绕 CORS），强制 `Content-Type: model/gltf-binary`，`Cache-Control: max-age=3600` | `index.mjs` + `fetchBinary()`（120s 超时） | 服务能力 | ✅ |

## J2 服务治理

| # | 功能 | 实际实现 / 触发与源码位置 | 类型 | 状态 |
|---|---|---|---|---|
| J2-01 | 全站 CORS 头 + `OPTIONS /*` 返回 204 | `onSend` hook；`app.options("/*")` | 服务能力 | ✅ |
| J2-02 | 统一错误处理：`ApiError` 映射为上游状态（<400 归 502）与 `code`，其余 500；响应体 `{error, code}` | `setErrorHandler` | 服务能力 | ✅ |
| J2-03 | 请求体上限 32MB | `Fastify({bodyLimit: 32*1024*1024})` | 服务能力 | ⚙ |
| J2-04 | 生产静态托管 `dist`（仅当目录存在），含 9 类 MIME 映射（html/js/css/wasm/json/task/glb/png/svg/woff2）；`fastify-static` 未安装 → 走自写流式 handler | `index.mjs` 末尾：`existsSync(dist)` → `import("fastify-static").catch(()=>null)` → `types` 表 + `createReadStream` | 服务能力 | ✅ |
| J2-05 | SPA 回退：路径不存在或为目录时返回 `index.html` | 自写 handler：`if (!existsSync(p) \|\| statSync(p).isDirectory()) p = index.html` | 服务能力 | ✅ |
| J2-06 | 监听 `0.0.0.0`，端口由 `PORT` 覆盖（默认 8787） | `app.listen({port, host:"0.0.0.0"})` | 服务能力 | ✅ |
| J2-07 | 上游超时三档：常规调用 60s / 产物下载 120s / OUS 状态查询 30s | `AbortSignal.timeout(...)`（`lux3d.mjs call/fetchBinary/uploadImage`） | 服务能力 | ⚙ |
| J2-08 | OUS 上传状态轮询：40 次 × 400ms（≈16s），超时抛 `UPLOAD_TIMEOUT`；status 6/-1 判失败 | `uploadImage()` | 服务能力 | ⚙ |
| J2-09 | 请求日志（pino，level info）+ 错误日志带 `msg/code`；**无**业务埋点、无 task 状态记录、无 trace id | `Fastify({logger:{level:"info"}})` | 服务能力 | ⚙ |
| J2-10 | 无鉴权、无速率限制、无请求配额（CORS `*`，任何来源可调） | 全文无认证中间件 | 服务能力 | ⚙ |
| J2-11 | 密钥管理：`.env` / `.env.local` 极简解析注入 `LUX3D_API_KEY`；**缺失时回退到源码内硬编码 Key** | `lux3d.mjs:5-19`（`key: process.env.LUX3D_API_KEY \|\| "<内置 Key>"`） | 服务能力 | ⚙⚠ |

---

# 五、无法确认 / 未运行验证 / 存在疑问

> 这一节是评审时**唯一可能推翻前面结论**的地方，逐条写清"为什么不确定"，不给推测性结论。

| 编号 | 项 | 状态 | 具体不确定点 | 怎么才能确认 |
|---|---|---|---|---|
| Q-01 | E1 组无取消、无重试 | 代码事实确定 | 代码里确实没有 `AbortController`、没有 retry；但**上游是否支持取消任务**未查（`openapi.json` 未审完），所以"取消"是没做，不是做不到 | 查上游 OpenAPI 是否有 cancel 端点 |
| Q-02 | J1-03 图生 3D 图片体积上限 | **矛盾** | 服务端校验单张 ≤12MB；`docs/03-progress.md` 记「OUS 单文件上限 5MB，未接分片」；`bodyLimit` 32MB 又限制了 4 张合计 | 用 6MB、11MB 图片各打一次 `/api/lux3d/img-to-3d`，看哪一步 400 |
| Q-03 | F4-01 `.gltf` 导入 | 未验证 | `accept` 放行 `.gltf` 且写死 `Blob type: model/gltf-binary`；`parseAsync(buf,"")` 无资源基址，引用外部 `.bin`/贴图时预期失败，但**没实测** | 导入一个带外部 bin 的 .gltf 与一个自包含 .gltf 各一次 |
| Q-04 | G3-06 Adaptive DPR 是否真的降级 | 未验证 | 代码在（drei `AdaptiveDpr`），但 headless 软渲染下无法判定是否触发降档；无日志输出 | 真机开摄像头 30 分钟后看 `gl.getPixelRatio()` 变化 |
| Q-05 | H1-02 多摄像头切换 | 未验证 | 首次授权前 `enumerateDevices()` 的 `deviceId` 可能为空串，`deviceId:{exact:""}` 会抛错；开发机只有 1 个虚拟设备，`devices.length<=1` 直接 return，切换到另一台设备这条路径**从未执行过** | 两个物理摄像头 + 先授权再切换 |
| Q-06 | H1-07 模型加载 20s 超时 | 未验证 | 只有 `setTimeout` 分支存在；本机 7.8MB 模型本地加载远小于 20s，超时分支从未触发 | 断点或限速到 <100KB/s |
| Q-07 | F3-07 导出文件外部可打开 | 部分验证 | 断言到 magic=`glTF` + 字节数；**没有在任何 DCC（Blender/Windows 3D 查看器）里打开过** | 用 Blender 打开 `spatial-scene-*.glb` |
| Q-08 | E1-08 服务端 `status` 取值全集 | 存疑 | 代码注释写「0 排队 1 运行 3 成功 4 失败」，前端把"其余值"都当 queued。若上游存在 2 或其他中间态，UI 会错误显示"排队中" | 抓一次长任务的全量状态序列 |
| Q-09 | E7-01 探活时效 | 事实 | 只在 `TopBar` 挂载时调一次，之后永不刷新；服务中途挂掉，芯片仍显示 ONLINE | ——（这是实现事实，不是不确定） |
| Q-10 | I 组错误反馈 | 事实 | 全仓无 `ErrorBoundary`、无 `window.onerror` 上报。渲染期异常 = 白屏，无提示无日志落盘 | —— |
| Q-11 | J2-11 硬编码密钥 | **需业务确认** | `lux3d.mjs:18` 在 `LUX3D_API_KEY` 缺失时回退到源码内的 Key；`.env` 当前有值，所以回退分支未生效，但代码里确实存在一份可用凭证 | 确认该 Key 是否已作废；是否接受"源码内含兜底密钥" |
| Q-12 | J1-05 / J2-10 开放代理 | 需安全确认 | `/api/asset?url=` 只校验协议，不校验域名，可被当作任意 URL 代理（SSRF/带宽滥用面）；同时 CORS `*` 且无鉴权 | 安全评审定性；未做渗透测试 |
| Q-13 | 真机手部链路 | 未验证 | 开发机无摄像头，全部手部结论来自假视频流 + 合成 21 点注入。E1/E3/E4 的"手势可点"由此推出，真手命中率未测 | 交付后真机跑第二轮（`06-feature-acceptance.md` §5） |
| Q-14 | G5 场景复杂度上限 | 未测 | 无对象数上限、无 LOD；只测过单模型 16 万顶点。20 个 16 万顶点对象能否交互未测 | 压测：批量入 10/20 个大模型，记 rAF p95 |

---

# 六、已确认缺失（不是"没达标"，是没做）

这些不进功能表，避免把"计划"算成"资产"。每条给出源码依据，证明是"不存在"而不是"没找到"。

| # | 缺失 | 源码依据 | 影响 |
|---|---|---|---|
| 1 | 取消 / 中止生成 | `AiPanel.tsx` 无 `AbortController`，`waitForTask` 无中断参数 | 提交后只能等 12 分钟或刷新 |
| 2 | 失败重试（复用同一 task） | 只有 `runText/runImage` 重新提交 | 失败即重新消耗额度 |
| 3 | 资产库界面 | `assets` 有数据、`removeAsset` 有实现，无渲染组件 | 生成物只能靠对象列表间接感知 |
| 4 | 项目 JSON 导入 / 项目文件恢复 | 只有 `saveProjectFile()` 导出；无解析器、无入口 | 导出的 JSON 无回路 |
| 5 | 形变持久化 | `SceneObject.deformed:boolean`；偏移在 `mesh.userData.__sculpt`，不进 `save()` 载荷 | 刷新后雕刻全部丢失 |
| 6 | 视角手势（旋转/缩放/平移） | `OrbitControls` 仅鼠标；`Interaction` 无相机改写 | 纯手势用户无法换视角（`06` Ⅰ-5） |
| 7 | 手势类别驱动行为（握拳/双指等） | `classifyGesture()` 结果只用于回显 | 4/6 类手势是"看得见、没用" |
| 8 | 文本输入（虚拟键盘） | `uiPointer.pinchUi()` 对 textarea 只 `focus()` | 改名、自由描述必须键盘 |
| 9 | 文件选择手势路径 | `press()` 内 `t.click()` 无用户激活，浏览器拦截文件框 | 导入本地 GLB 必须鼠标 |
| 10 | 场景清空入口 | `store.clearScene()` 无调用方 | 只能逐个删除 |
| 11 | 对象分组 / 对齐 / 版本记录 | 无相关代码 | —— |
| 12 | 多存档 / 账号 / 云端同步 | 只有单键 IndexedDB | 换浏览器即清空项目 |
| 13 | 撤销（非形变） | `undo/redo` 只管 `deformation` 顶点偏移 | 删对象/改颜色/移动都不可撤销 |
| 14 | 截图 / 导出图片 | 无 `canvas.toDataURL` 调用 | 只能导出 GLB |
| 15 | 后处理（Bloom/SSAO） | 未引入 `postprocessing` | 画面靠材质与 CSS 叠层 |
| 16 | 模型解析失败的界面提示 | `ObjectNode.tsx` `catch { console.warn }` | 失败表现为"空画布" |
| 17 | 摄像头拔出/中断自动恢复 | 无 `track.onended` 监听 | 拔线后需手动重开 |

---

# 七、修改记录

## 7.1 与 v1 的数字对照

| 模块 | v1 功能项 | v2 功能项 | 差额 | 原因 |
|---|---:|---:|---:|---|
| E AI 生成 | 24 | 39 | +15 | 原表把「提交→轮询→下载→入场景→状态回显」压成 2 条、把「超时/失败/单飞」并进相邻条目。v2 拆出 6 条边界行为（E1-06/07/08/09、E2-09、E5-05）与 4 条服务参数事实（E1-10、E2-07、E6-05/06），另把 E2-01 中的"唤起文件框"单列（E2-06）。**没有一条是未实现的计划功能。** |
| F 导入导出与持久化 | 15 | 20 | +5 | 全是补漏：F1-05 保存内容边界（含"形变不持久化"这一关键事实）、F3-05 导出范围、F3-06 导出含形变与笔迹、F3-07 导出文件可打开（验证状态）、F4-07 资产共享。v1 把这些只写在正文夹注里，没有独立编号。 |
| G 视图与渲染 | 25 | 31 | +6 | 补记相机固定参数（G1-07）、模型材质不被改写（G3-08）、递归拾取子网格（G4-03）、HUD/选中框节流（G5-03）、命中缓存（G5-04）、无 loading fallback（G5-05）——这些都存在于源码但 v1 未列。 |
| H 相机硬件 | 7 | 10 | +3 | 补 H1-05 采集约束（v1 把"分辨率帧率"这一问留空，实际是"固定 ideal 1280×720，无 UI"）、H1-06 送帧规格（v1 只在 A1-04/05 记了缩帧与节流，H 侧缺）、H1-07 模型加载 20s 超时。 |
| I 界面框架与反馈 | 22 | 26 | +4 | 补记顶栏手势可达（I1-07）、面板隐藏仍挂载（I2-03）、空态文案（I3-04）、帮助浮层 ✕ 手势可达（I4-07）。 |
| J 后端服务 | 11 | 16 | +5 | v1 只列"有哪些路由 + 6 条治理"，v2 补 5 条治理事实：上游超时三档（J2-07）、OUS 轮询上限（J2-08）、日志与无任务记录（J2-09）、无鉴权/无速率限制（J2-10）、密钥回退（J2-11）；并把 MIME 映射并入 J2-04 描述。 |
| **E—J 合计** | **104** | **142** | **+38** | 新增 38 条中：**32 条是 v1 未记的已实现事实**，**6 条是原复合条目的拆分**；其中 2 条为 ⛔（代码存在、无界面入口）。逐条清单见 §7.5。 |

## 7.2 修正（v1 描述与源码不符）

| 编号 | v1 说法 | 实际 | 依据 |
|---|---|---|---|
| E7-01 | 「顶栏 LUX3D 芯片：`apiHealth()` 探活」 | 探活**只在挂载时执行一次**，无周期刷新、无失败重试；服务中途下线时芯片不会变 | `TopBar.tsx:43-47` |
| F2-01 | 「顶栏保存按钮 + toast 确认」 | 保存本就是自动的；按钮只是强制再写一次，且 toast 不等写入结果（失败也提示成功） | `TopBar.tsx:140`、`store.save()` 内部 catch |
| F3-01 | 「导出整个场景为单个 GLB」 | 只导出**可见**对象 + 自建 2 盏灯；不含相机、天幕、网格、粒子、手。不可见对象被静默排除 | `exporter.exportSceneGlb()` |
| F4-01 | 「导入本地 GLB/GLTF」 | `.gltf` 仅放行扩展名，解析无资源基址，外部引用资源不可用；且失败无界面提示 | `Inspector.importGlb()`、`GLTFLoader.parseAsync(buf,"")` |
| H1-02 | 「多摄像头轮流切换」 | 逻辑在，但首次授权前 `deviceId` 可能为空；该路径从未实测 | `cameraService.startCameraDevice()` |
| J2-08 | v1 未提 | OUS 上传状态轮询上限 40×400ms（≈16s）后抛 `UPLOAD_TIMEOUT`；status 6/-1 判失败 | `lux3d.mjs:141-156` |

## 7.3 新增章节

- **状态图例**新增 `⚙`（内部能力）与 `⚠`（未运行验证）。v1 把服务端/渲染内部机制一律标 ✅，导致"用户能用"和"系统在做"混在一起。按新口径，E—J 中有 18 条归 `⚙`（v1 全部记作 ✅）。
- **每模块新增「组级事实」段**：把"用户从哪里发起、调用什么模型/API、异步模型、结果如何入场景、失败/超时/取消怎么办"一次性答完，避免在表格里重复。
- **新增 §五 存疑（14 条）、§六 已确认缺失（17 条）、§七 修改记录、§八 A—D 复核备注、§九 证据索引**。
- 表格新增「类型」列（交互 / 界面反馈 / 数据管理 / 服务能力 / 系统内部），A—D 保留 v1 四列不动。

## 7.4 未做的事（明确边界）

- 未修改任何业务代码（只读审计）；未 `npm run build`、未启动 dev server 做新的运行验证——本轮所有"运行过"的结论均引自 `docs/04-testing.md`、`test-artifacts/`（含 `bench-features.json`、`bench-hand.json`、`bench-gesture.json` 与 7 张截图）。
- 未逐条重核 A—D（除 E—J 交叉引用到的 `parseGlb`、`OrbitControls`、`uiPointer` 等公共路径）。A—D 的 128 条与 v1 完全一致。

---

## 7.5 新增条目清单（38 条，逐条可查）

| 编号 | 新增原因 | 类别 |
|---|---|---|
| E1-06 | 生成中单飞（按钮 disabled） | 拆分 |
| E1-07 | 建任务失败的处理路径 | 补漏（边界） |
| E1-08 | 轮询 3s + 12 分钟超时 | 补漏（边界） |
| E1-09 | 服务端 status=4 判失败 | 补漏（边界） |
| E1-10 | faceCount 固定 20 万、版本 G1（无 UI） | 补漏（参数） |
| E2-06 | 未选图点按钮 = 唤起文件框（独立入口） | 拆分 |
| E2-07 | 图生版本 G1-Turbo、单/多图参数分支 | 补漏（服务参数） |
| E2-08 | 上传阶段专用文案 | 拆分 |
| E2-09 | 张数双端各截 4 张（静默丢弃） | 补漏（限制） |
| E3-04 | 切换风格 toast 回显 | 拆分 |
| E4-03 | 预设为覆盖式填入 | 补漏（行为细节） |
| E5-05 | 任务不持久化（刷新即清空） | 补漏（数据边界） |
| E6-05 | 产物选择 glb>ply>zip | 补漏（边界） |
| E6-06 | 资产 id 幂等 | 补漏 |
| E7-02 | 离线不阻断提交 | 拆分 |
| F1-05 | 保存内容边界（形变/任务/选中态不保存） | 补漏（关键） |
| F3-05 | 导出范围（仅可见对象 + 2 盏灯） | 补漏 |
| F3-06 | 导出含形变顶点与笔迹管体 | 补漏 |
| F3-07 | 导出文件可被外部软件打开（含验证状态） | 补漏 |
| F4-07 | 模型对象共享同一资产 | 补漏 |
| G1-07 | 相机固定参数（fov/near/far/target） | 补漏 |
| G3-08 | 模型材质不被改写（仅 FrontSide） | 补漏 |
| G4-03 | 递归拾取模型子网格 + objectId 回落 | 拆分 |
| G5-03 | 选中框 3 帧节流 / HUD 500ms / DOM 写入抑制 | 补漏 |
| G5-04 | 命中结果帧间复用（1.5px 缓存） | 补漏 |
| G5-05 | 无加载 fallback、无对象数上限/LOD | 补漏（现状） |
| H1-05 | 采集约束 ideal 1280×720 | 补漏 |
| H1-06 | 送帧 640×360 / 26ms / 单槽排队 | 补漏 |
| H1-07 | 模型加载 20s 超时 | 补漏 |
| I1-07 | 顶栏 8 个图标按钮手势可达 | 补漏 |
| I2-03 | 面板隐藏是 CSS 隐藏，组件仍挂载 | 补漏 |
| I3-04 | 空态引导文案（三处） | 补漏 |
| I4-07 | 帮助浮层 ✕ 按钮手势可达 | 补漏 |
| J2-07 | 上游超时三档（60s/120s/30s） | 补漏（治理） |
| J2-08 | OUS 上传轮询上限 16s | 补漏（治理） |
| J2-09 | 日志与无任务状态记录 | 补漏 |
| J2-10 | 无鉴权/无速率限制 | 补漏（治理） |
| J2-11 | 密钥回退到源码内置 Key | 补漏（治理） |

> 注：J1 组未新增（v1 的 5 条已覆盖 5 个路由）；I5 组未新增。

# 八、A—D 复核备注（正文未改动）

读到公共路径时顺带发现 A—D 有 1 处与源码不符，按要求**不擅自改 v1 正文**，在此登记，下轮修订时处理：

| 编号 | v1 说法 | 实际 | 依据 |
|---|---|---|---|
| A2-02 | 「22 根骨骼柱（含 2 根掌骨）」 | `BONES` 数组 21 条 + 掌骨 2 条（`[0,9]`、`[0,13]`）= **23 根** | `src/scene/HandRig.tsx:6-20` |

另有两处 v1 已写对、但容易被误读，附注以免评审时吵：

- A1-03 的「GPU delegate 优先」是 `handTracker` 的默认入参决定的（`delegate: forced === "CPU" ? "CPU" : "GPU"`），而 `handWorker` 内部注释写的是"默认 CPU"。**实际行为以调用方为准 = GPU 优先，失败切 CPU**。`localStorage.sc_delegate` 是隐藏开关，无 UI。
- A2-05「整手挂在相机坐标系」属实（每帧取相机 `position/quaternion`，距离 1.28m），但手心朝向由关键点决定，不做 IK 校正。

---

# 九、证据索引（本轮引用到的可复现产物）

| 证据 | 位置 | 用途 |
|---|---|---|
| 功能基准 30 组断言 | `test-artifacts/bench-features.json`（29→30 组） | 导出 GLB 字节数/magic、导入顶点数、刷新恢复误差、锁定拦截、密钥不外泄 |
| 手势点 UI 基准 12 组 | `test-artifacts/bench-hand.json` | 顶栏 8 按钮可达、行内图标 24×24、滑杆拖动、短语与风格、面板滚动 |
| 判定层基准 7 组 | `test-artifacts/bench-gesture.json` | 捏合延迟、误触发、校准覆盖率、手势分类 |
| 对比度 10 组 | `test-artifacts/contrast.json` | 正文 13.88:1、高对比 19.78:1 |
| 真实生成截图 | `test-artifacts/30-ai-result.png`、`22-model.png`、`23-sculpted-model.png`、`50/51-before|after-reload.png`、`52-no-camera.png`、`53-img2model.png` | 生成物入场景、雕刻、刷新恢复、无摄像头回退 |
| 测试记录 | `docs/04-testing.md`（9 条记录 + 未覆盖项表） | 端到端任务 id、耗时、顶点数、失败降级 8/8 |
| 上游接口差异 | `docs/02-api.md` | 任务状态取值、产物 zip/glb 并存、OUS 凭证层级 |
| 上游 OpenAPI | `E:\C_Projects\Aholo Lux3D\openapi.json`（888KB，80 路径） | 仅确认路由存在性，未逐条审计（见 Q-01） |

---

# 附：不统计在内的东西（沿用 v1，已按 v2 核查）

| 项目 | 说明 |
|---|---|
| `scripts/bench-features.mjs`（30 条）、`bench-hand.mjs`（12 条）、`bench-gesture.mjs`（7 组） | 自动化验收基准，走真实运行路径，输出 JSON。属验收工具，不是产品功能 |
| `scripts/test-*.mjs`、`e2e-lux3d.mjs`、`smoke.mjs`、`check-contrast.mjs` | 各阶段测试脚本 |
| `src/lib/metrics.ts` | 指标采集器（已由 I5-01 暴露为面板） |
| `settings.autoRotate` | 类型与默认值存在，**无任何消费方**，且无 UI（grep 确认） |
| `deformation.canUndo / canRedo / resetSculptHistory` | 有实现，无调用方 |
| `samples.loadSampleModel` | 旧兼容入口，无调用方 |
| `handState.twoHand.midNdc` | 每帧计算，无消费方 |
| `store.removeTask / clearScene / saveProjectFile / removeAsset` | 有实现，**无 UI 调用方**（对应 E6-04、F3-04、F4-06 与 §六 第 3/4/10 条） |
| `AiTask.progress` | 字段恒为 0，无 UI 消费（故不列"进度条"功能） |
| `dist/`、`public/models`、`public/wasm`、`public/samples` | 构建产物与本地化资源（模型 7.8MB、wasm 3 份、示例 GLB 两枚），属运行时资源 |
