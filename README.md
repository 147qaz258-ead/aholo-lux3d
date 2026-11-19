# Aholo Lux3D · Aether Studio

PC 浏览器三维创作工作台，支持摄像头手势与鼠标操作、空间绘制、局部雕刻、材质编辑、零件装配，以及通过 Aholo Lux3D 服务生成三维模型。

当前为 **Draft 1.0 开发版**，尚未通过全部产品验收。功能边界、操作说明与回归方法见 [应用说明](spatial-creator/README.md) 和 [阶段验收记录](spatial-creator/docs/11-gesture-workspace-acceptance.md)。

## 本地运行

需要 Node.js 22+、npm 和支持 WebGL2 的桌面 Chrome / Edge。

```sh
git clone https://github.com/147qaz258-ead/aholo-lux3d.git
cd aholo-lux3d/spatial-creator
npm ci
npm run dev:all
```

打开 <http://localhost:5173>。前端开发服务器使用 5173 端口，Node API 使用 8787 端口。

鼠标模式不需要摄像头。手部追踪所需模型与 WASM 随源码提供，摄像头画面在浏览器本地处理。

## AI 服务配置

将 `spatial-creator/.env.example` 复制为同目录的 `.env`，填入自己的 `LUX3D_API_KEY`，然后重启 API 服务。密钥只在服务端使用，`.env` 不提交到 Git。

没有密钥时仍可使用本地建模、示例模型、装配和项目管理；AI 生成请求需要有效的服务端密钥，并可能产生供应商费用。

## 生产运行

在 `spatial-creator` 目录执行：

```sh
npm run build
npm start
```

Node 服务在 8787 端口同时提供前端静态文件和 API，可通过 `PORT` 环境变量修改。远程摄像头访问需要 HTTPS。

本次发布提供源码。完整应用需要 Node 后端，GitHub Pages 只能托管静态前端，无法直接运行 AI API。

## 仓库内容

- [spatial-creator](spatial-creator/)：应用源码、后端、示例资产、测试脚本与开发记录。
- [Draft 1.0 规格](Aether_Studio_Detailed_Requirements_Draft1.0/)：应用引用的产品需求与验收规范。

本地凭证、依赖目录、构建产物、运行日志、测试输出和工作区中的其他工具及草稿不纳入仓库。
