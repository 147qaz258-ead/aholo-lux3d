# Aether Studio · Draft 1.0 开发版

PC 浏览器三维创作工作台：摄像头/鼠标输入、工作平面绘制、局部雕刻、多选和材质编辑、AI 模型预览确认、零件装配，以及工程保存和版本恢复。

本轮依据 `../Aether_Studio_Detailed_Requirements_Draft1.0/` 的八份规格扩展现有工程。**当前是可运行的开发实现，尚未通过全部产品验收门禁。** 实现、测试证据和未完成项见 [需求对照与验收记录](docs/08-draft1-development.md)。`docs/01` 至 `docs/07` 及 `Feature_Inventory_v2.md` 保留为历史基线；与本页冲突时，以本轮记录和源码为准。

最新扩展、操作路径与验收范围见 [第二阶段交付记录](docs/09-expansion-development.md)。

摄像头卡顿的定位、优化和同机测量见 [摄像头性能记录](docs/10-camera-performance.md)。

## 运行

环境：Node.js 22+，桌面 Chrome / Edge，WebGL2。手部追踪需要摄像头；鼠标可完成绘制、编辑、装配和项目管理。

```powershell
cd 'E:\C_Projects\Aholo Lux3D\spatial-creator'
npm install
npm run dev:all
```

访问 `http://localhost:5173`。前端 5173，API 8787；也可分别执行 `npm run dev`、`npm run dev:api`。

AI 服务在服务端 `.env` 或环境变量配置，修改后重启 API：

```dotenv
LUX3D_BASE_URL=https://api.aholo3d.cn
LUX3D_API_KEY=your_server_side_key
```

没有密钥时本地建模仍可使用，生成请求返回配置错误。密钥不进入前端配置。AI 生成可能产生供应商费用；本轮回归使用本地 GLB 夹具，未发起付费生成。

```powershell
npm run build
npm start
```

生产构建由 8787 同时提供静态文件与 API。远程使用摄像头需要 HTTPS；localhost 可直接调试。MediaPipe 模型与 WASM 位于 `public/models`、`public/wasm`。

## 操作入口

- 工具栏：选择、绘制、雕刻、AI；`1–4` 切换，右键旋转视角，滚轮缩放。
- 绘制：检查器选择相机/XY/XZ/YZ 工作平面和深度，每笔起笔后固定平面；可编辑控制点、拆分、合并，转换管体/细曲线/闭合平面。
- 雕刻：基于操作起始几何计算，静止保持不持续累积；虚拟强度是软件推算值。
- 对象列表：Ctrl/Shift 点击多选、Ctrl+A 全选；支持整体位移/旋转/等比缩放和确认批量删除，一个操作对应一步历史。
- 检查器：材质粗糙度、金属度、不透明度、发光和基础颜色纹理；六标准视图与透视/正交切换。
- 零件：转换为 Part，指定层级、连接点位置/方向，先预览再连接；支持固定、带限位铰接/滑动，同一父子零件可增加一致的固定连接点；可拆卸、整体变换和替换。
- AI：明确选择新增/零件/替换/草图轮廓任务；结果先预览再接受或拒绝；替换绑定目标版本。停止等待只停止本地查询，上游任务可继续查询。
- 场景指令：本地规则支持「把它缩小10%」「把刚才那个改为蓝色」「把「对象名」向右移动0.2」「解释场景」；修改先看旧新双视图。局部编辑可输入对象局部坐标区域和位移。
- 项目按钮：命名、浏览器保存、下载/打开 `.aether.json`、恢复上一快照、最近 20 个命名版本和差异恢复；按选中/装配体/全部可见对象导出 GLB/OBJ/STL。
- 校准：四角采样后九点复测，通过后应用；更换设备或镜像后重新校准。
- `Esc` 取消并回滚，`Ctrl+Z` 撤销，`Ctrl+Shift+Z` / `Ctrl+Y` 重做，`Ctrl+S` 保存，`H` 帮助，`M` 诊断。

## 数据与边界

原生项目 v2 包含对象、内嵌模型资产、已提交雕刻顶点、原始/平滑笔迹、工作平面、层级/连接、相机视图和 AI 来源；可迁移 v1。浏览器保存只属于当前浏览器来源，请下载原生文件用于迁移与备份。撤销最多 50 步，仅当前会话有效。

GLB 用于可见静态几何/材质交换，不保留应用装配约束、任务或撤销记录。支持 GLB、资源内嵌的 glTF、OBJ、STL 导入；导入归一化到 1.2 场景单位并在预览中说明。OBJ 不附带 MTL，OBJ/STL 交换仅几何，不保证制造尺寸或可打印性。文件上限 60MB、网格上限 200 万顶点是保护阈值，尚未认证为设备性能上限。骨骼动画导出尚不支持。

装配及带子对象的层级仅支持等比缩放，拒绝剪切层级；锁定子对象会阻止整体变换。删除父对象解除直接子对象层级并保留世界位置，可撤销。命名版本保存在当前浏览器，原生文件包含当前工程，不包含命名版本列表。

尚未实现：通用语言模型的意图理解和多轮语义编辑、远程区域生成、装配补全、任意复杂装配约束求解。已有局部编辑和多轮指代采用明确本地规则，不能代表这些能力全部完成。参考图保存图片本体、哈希与用途，当前供应商按图片整体生成，不接收用途和文字约束。真实手势质量、用户舒适度、生成质量、长期稳定性和外部 DCC 兼容性仍待验收。

## 验证

```powershell
npm run typecheck
npm run build
# 开启 dev:all 后执行；需 Playwright 与 Chrome
$env:PW_PATH='D:/npm-global/node_modules/playwright/index.js'
npm run test:draft1
node scripts/test-expansion.mjs
node scripts/test-api-local.mjs
node scripts/test-production.mjs
```

`PW_PATH` 可改为本机 Playwright 入口。回归使用隔离浏览器，证据在 `test-artifacts/draft1/`。旧 `bench:*` 针对历史行为，未作为本轮达标依据。

目录：`src/lib` 算法/存储，`src/scene` 场景/交互，`src/ui` 工作台，`server` AI 适配/幂等，`scripts` 回归，`docs` 需求/验收。

当前阶段、手势和真机验收：[Draft 1.0 阶段验收与手势工作区](docs/11-gesture-workspace-acceptance.md)。
