# 摄像头开启后卡顿：定位与优化

日期：2026-11-18。用户反馈开启摄像头或手势后整页明显卡顿。本次改动针对性能，不增加业务功能。源码备份：`E:\C_Projects\Aholo Lux3D\logs\source-before-performance-20261118.zip`。

## 定位结果

本机识别到 Intel Core i7-10875H、Intel UHD Graphics 与 RTX 3060 Laptop GPU。隔离 Chrome 通过 WebGL 报告实际使用 Intel UHD / D3D11；这证明该测试浏览器使用核显，不能据此断言所有浏览器或应用窗口都使用同一块显卡。

程序存在以下可复现的额外开销：

1. `handTracker.ts` 默认传入 GPU delegate，覆盖了 Worker 中原本默认 CPU 的逻辑。摄像头推理与三维场景争用 GPU。现在默认 CPU，保留显式 `sc_delegate=GPU` 覆盖。
2. 多个复杂面板和装配覆盖层订阅整个 Zustand 状态；手势 HUD 更新会触发无关组件提交。现在使用字段级浅比较订阅，项目控件增加 memo，HUD 发布上限为每秒 5 次。
3. 虚拟手的关节、骨骼、指尖分别提交几十个独立网格。现在用 3 个实例化网格加掌面批量绘制，保留五指/捏合反馈、鼠标与手势输入。
4. Worker 忙碌时仍不断抓取视频并创建/丢弃位图。现在一条链最多有一个取帧或推理任务，空闲后才采集当前视频；默认申请 640×360、最高 30 FPS，保持单调时间戳。
5. 空格暂停以前仅屏蔽交互，推理仍运行。现在暂停或页面隐藏时不再抓帧，并丢弃返回的旧结果；关闭/重开通过 generation 隔离旧会话。
6. 摄像头骨架预览每个渲染帧读取布局并重画。现在 ResizeObserver 管理尺寸，只在新结果或状态改变时重画，上限 30 FPS；主视口 DPR 上限由 2 调为 1.5。

## 一轮同机测量

1600×900、Chrome 无头模式、实际 Intel 核显、同一个立方体；每个条件测量 6 秒，测量前预热。手势场景使用 30 Hz 合成关键点，**该对比只覆盖输入后的 UI 与三维渲染，不是物理摄像头跟踪质量验收**。

| 条件或指标 | 优化前 | 优化后 |
|---|---:|---:|
| 无手场景平均渲染 FPS | 25.1 | 43.6 |
| 合成手场景平均渲染 FPS | 21.2 | 39.3 |
| 合成手场景 P95 帧间隔 | 78.9 ms | 38.4 ms |
| 合成手场景绘制调用 | 64 | 18 |
| 合成手场景 6 秒内主线程任务耗时 | 3.953 秒 | 1.187 秒 |
| 装配面板提交计数（测试钩子） | 125 | 0 |

数据文件：`test-artifacts/performance/before.json` 与 `after.json`。FPS 受窗口、GPU 调度、温度、其他程序和设备影响；单轮结果不作为普遍性能保证。

另用浏览器假摄像头运行真实 MediaPipe Worker（图像中没有真实手）：优化前显式 CPU 条件约 19.5 FPS、6 秒创建 74 个位图；优化后 CPU 条件约 36.9 FPS、创建 27 个位图。该条件需要持续执行整图手掌检测，推理 P95 仍约 248 ms，不能用于宣称已达到实时手势延迟目标。原默认 GPU 条件在本次采样等待期内没有结果，因此未把它当成可用的前后 FPS 基线。详见 `before-camera.json`、`after.json`。

## 验证和复现

```powershell
# 保持 npm run dev:all 运行
$env:PERF_LABEL='local-retest'
node scripts/bench-camera-performance.mjs
node scripts/test-camera-performance.mjs
npm run test:draft1
node scripts/test-expansion.mjs
npm run build
node scripts/test-production.mjs
```

性能脚本使用隔离浏览器与假摄像头，不读取用户真实视频，不修改现有浏览器工程。`PW_PATH` 默认 `D:/npm-global/node_modules/playwright/index.js`。可用 `PERF_MODES=idle,synthetic-hand,camera-default` 缩小采样范围。

新增回归覆盖：慢 Worker 背压、默认 CPU、暂停恢复、隐藏页面、关闭时旧结果隔离、重开会话、透视/正交下完整虚拟手实例和有限矩阵。结果在 `test-artifacts/performance/regression.json`；既有功能和生产包结果仍在原测试产物目录。

## 用户复测

1. 刷新 `http://localhost:5173`，关闭再重新启用摄像头，以加载新的 Worker 和默认推理后端。
2. 按 M 查看渲染帧率；分别比较摄像头关闭、开启无手、出现单手及双手时的表现。空格可暂停手势推理进行对照。
3. 若仍卡顿，检查 Windows 图形设置中当前浏览器是否选中“高性能（RTX 3060）”，再重启浏览器复测。程序无法用 WebGL 参数强制指定物理显卡。

本次确认软件存在性能问题并已减少其开销。真实摄像头、真实单/双手与当前应用内浏览器的流畅度仍需要用户复测；未完成长期稳定性或全部设备性能验收。
