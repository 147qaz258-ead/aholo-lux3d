# 第三阶段（N1 → N3）交互稳定性与 AI 共创扩展交付记录

日期：2026-11-19。源码：`E:\C_Projects\Aholo Lux3D\spatial-creator`。既有审核标准（`docs/05-phase-acceptance.md`、`docs/06-feature-acceptance.md` 与 `Aether_Studio_Detailed_Requirements_Draft1.0`）全部保持不变，最终产品验收由用户审核判定。

## 1. 本轮解决的实机痛点

| 问题 | 根因 | 本轮改动 |
|---|---|---|
| 调用 AI 模型报 `HTTP 500` | `.env` 已配置 `LUX3D_API_KEY`，但只启动了 Vite 前端（5173），未启动 `8787` 后端服务 | 启动 `node server/index.mjs`（8787 端口），前端 `/api/health` 实测返回 `keyConfigured: true` |
| 弯曲食指点击时指针飘到其他控件 | 食指从伸直（0.83）弯到触发阈值（0.72）的过渡期间，指尖已先下坠导致光标离开按钮 | 在 `src/lib/uiPointer.ts` 加入**预弯曲光标锚点锁定**（`0.72 <= angle < 0.83` 即锁定）；同时新增**悬停读条点击（Dwell Click）**辅助模式（`CameraPanel`「悬停点击」开关 + `HandCursor` 600ms 环形进度） |
| 绘制未松手就提前断笔 | `Interaction.tsx` 对 `releaseEdge` 单帧立刻收笔，手掌微侧转或瞬时抖动即中断 | 加入 **150ms 边缘抖动宽限期**（`pinch < 0.25` 明显张手立即收笔，边缘抖动 `0.25..off` 给 150ms 续画宽限） |

## 2. N1 → N3 扩展内容

1. **旧/新双视图量化差异对比（`src/ui/ObjectComparison.tsx`）**
   - 在修改前/后对比视图下实时统计并展示顶点数变化与包围盒尺寸（`顶点 A→B（±Δ） · 尺寸 W×H×D`），便于审核 AI/本地编辑结果。
2. **本地语义指令扩展（`src/lib/sceneCommands.ts`）**
   - 新增旋转（`绕Y旋转45度`）、对齐地面（`贴地` / `放到地面`）以及安全复合指令（如 `把它缩小10%并改为蓝色`），仍受锁定、子对象与上限保护，不越权调用远程生成。

## 3. 本轮验证结果（全部在最后一次代码修改后运行）

- `npm run build`（`tsc --noEmit && vite build`）：**通过**（0 错误）。
- `npm run test:workspace`：**15/15 通过**（0 页面异常）。
- `npm run test:draft1`（`test-idempotency.mjs` **4/4** + `test-draft1.mjs` **24/24**）：**全部通过**。
- `node scripts/test-expansion.mjs`：**15/15 通过**。
- `node scripts/test-production.mjs`：**6/6 通过**。
- `node scripts/test-api-local.mjs`：**5/5 通过**。
- `npm run bench:gesture`：**7/7 通过**。
- 真实浏览器 N3 模拟测试（`test_n3_user_sim.mjs`）：**4/4 通过**（`/api/health` 代理连通、复合指令与对比差异条、抖动悬停 600ms 自动切换工具、0 运行异常）。

## 4. 待用户醒后审核项

- **真机摄像头 + 真实手势手感**：预弯曲锁定与「悬停点击」开关的实际舒适度、150ms 绘制防抖的收笔手感。
- **真实付费文生/图生 3D 任务体验**（本次未消耗积分发起付费远程生成，仅验证 8787 代理与鉴权配置就绪）。
