# Apex SSH

跨平台桌面 SSH 客户端（Electron + React + xterm.js + ssh2）。

## 技术栈与 UI

- 桌面与渲染：Electron、React、TypeScript
- 终端与连接：xterm.js、ssh2
- UI 组件：[shadcn/ui](https://github.com/shadcn-ui/ui)，组件文档见 [shadcn/ui Components](https://ui.shadcn.com/docs/components)
- UI 底层：Radix UI 提供无样式交互与可访问性基础，Tailwind CSS 负责样式实现，Lucide 提供图标；三者不是与 shadcn/ui 并列的 UI 组件库

项目唯一的 UI 组件方案是 shadcn/ui，组件源码维护在 `src/renderer/src/components/ui/`，配置见 `components.json`。颜色、圆角、间距和字体等视觉令牌以项目 Figma 设计稿为准，不直接使用 shadcn/ui 默认主题。

## 快速开始

```bash
# 1. 安装依赖（Electron 二进制已配置 npmmirror 镜像，见 .npmrc）
pnpm install

# 2. 启动本地验证环境（两个真实 SSH 容器：密码认证 2222 / 密钥认证 2223）
powershell -File deploy/生成密钥.ps1          # 首次：生成测试密钥对
docker compose -f deploy/docker-compose.yml up -d
sh deploy/准备测试数据.sh apex-ssh-pass        # 首次：生成 SFTP 测试数据集
sh deploy/准备测试数据.sh apex-ssh-key

# 3. 启动应用（开发模式，HMR）
pnpm dev
```

本地验证连接参数：

- 密码认证：`127.0.0.1:2222`，用户名 `apex`，密码 `apex123`
- 密钥认证：`127.0.0.1:2223`，用户名 `apex`，私钥 `deploy/keys/id_ed25519`

## 验收脚本

应用带 `--remote-debugging-port=9222` 启动后，可用 CDP 自动化验收（针对真实容器）：

```bash
pnpm dev -- --remote-debugging-port=9222

node scripts/验收M1.mjs       # 核心链路 10 项：连接/彩色输出/多标签/错误提示/持久化等
node scripts/验收交互.mjs      # vim 编辑保存、方向键历史、Tab 补全
node scripts/验收HomeEnd.mjs   # Home / End 行首行尾
```

> Windows 注意：若环境变量 `ELECTRON_RUN_AS_NODE=1` 存在，Electron 会以纯 Node 模式运行导致启动失败，需先移除该变量再启动。

## 打包 Windows 可执行文件

```bash
# 先确保依赖已安装
pnpm install

# 构建并打包为 Windows NSIS 安装包（产物在 release/ 目录）
pnpm dist
```

打包完成后，可在 `release/` 目录下找到：

- `Apex SSH Setup x.x.x.exe` —— Windows 安装包
- `Apex SSH x.x.x.exe` —— 便携版可执行文件（若配置 portable 目标）

当前 `package.json` 中 `electron-builder` 配置为 `nsis` 单目标，运行安装程序后会在开始菜单与桌面创建快捷方式。

### Electron 下载加速

首次打包时 `electron-builder` 会下载 Electron 二进制，国内网络可能较慢。提供两种加速方案：

**方案 1：临时设置环境变量（单次生效）**

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
pnpm dist
```

**方案 2：写入 `.npmrc` 持久化（推荐）**

在 [`.npmrc`](.npmrc) 末尾添加：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
```

保存后重新执行 `pnpm dist` 即可自动走加速镜像。

## 目录结构

```text
apex-ssh/
├── deploy/       # 本地 Docker SSH 验证环境
├── resources/    # 应用图标等打包资源
├── scripts/      # 自动化验收与资源生成脚本
└── src/          # Electron 主进程、预加载脚本与 React 渲染层
```

## 许可证

开源许可证尚未确定。许可证文件加入仓库前，本项目源码不视为已授予复制、修改或分发许可。
