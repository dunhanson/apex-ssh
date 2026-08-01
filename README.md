# Apex SSH

跨平台桌面 SSH 客户端（Electron + React + xterm.js + ssh2）。

[![构建发布](https://github.com/dunhanson/apex-ssh/actions/workflows/%E5%8F%91%E5%B8%83.yml/badge.svg)](https://github.com/dunhanson/apex-ssh/actions/workflows/%E5%8F%91%E5%B8%83.yml)
[![安全检查](https://github.com/dunhanson/apex-ssh/actions/workflows/%E5%AE%89%E5%85%A8%E6%A3%80%E6%9F%A5.yml/badge.svg)](https://github.com/dunhanson/apex-ssh/actions/workflows/%E5%AE%89%E5%85%A8%E6%A3%80%E6%9F%A5.yml)
[![许可证](https://img.shields.io/github/license/dunhanson/apex-ssh)](LICENSE)

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

## 构建安装包

```bash
pnpm install

# 当前操作系统的默认目标
pnpm dist

# 各平台原生构建命令
pnpm run dist:win
pnpm run dist:linux
pnpm run dist:mac
```

产物统一写入 `release/`：

- Windows x64：NSIS `.exe`
- Linux x64：AppImage 和 Debian `.deb`
- macOS x64 / arm64：`.dmg` 和 `.zip`

macOS 构建会先通过系统的 `sips` 和 `iconutil` 从 `resources/icon.png` 生成 `resources/icon.icns`，因此必须在 macOS 上运行。不要在 Windows 上交叉构建 macOS 发布包。

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

## GitHub Actions 发布

[构建并发布安装包](.github/workflows/发布.yml) 支持两种触发方式：

- 在 GitHub Actions 页面手动运行：构建三个平台并保留 14 天，适合发布前验证。
- 推送 `v*` 标签：构建三个平台、校验标签版本与 `package.json` 一致，并自动创建 GitHub Release。

正式发布示例：

```bash
# 先将 package.json 的 version 更新为 0.1.1，并提交该改动
git tag -a v0.1.1 -m "发布 v0.1.1"
git push origin main
git push origin v0.1.1
```

标签必须严格等于 `v` 加 `package.json` 版本，例如 `package.json` 为 `0.1.1` 时只能发布 `v0.1.1`。

### Windows 签名

未配置证书时 CI 会生成无签名测试包。正式发布前在仓库 `Settings > Secrets and variables > Actions` 配置：

- `WINDOWS_CSC_LINK`：代码签名证书的 HTTPS 地址或 Base64 编码内容
- `WINDOWS_CSC_KEY_PASSWORD`：证书密码

### macOS 签名与公证

未配置证书时 CI 会生成无签名测试包。正式发布需要 Apple Developer ID Application 证书，并配置：

- `MACOS_CSC_LINK`：`.p12` 证书的 HTTPS 地址或 Base64 编码内容
- `MACOS_CSC_KEY_PASSWORD`：证书密码
- `APPLE_ID`：Apple 开发者账号
- `APPLE_APP_SPECIFIC_PASSWORD`：Apple ID 专用密码
- `APPLE_TEAM_ID`：Apple Developer Team ID

electron-builder 检测到完整变量后会自动签名并提交 Apple 公证；任何密钥都不得写入仓库。

## 发布前验证

CI 构建成功只证明安装包可以生成。每次正式发布仍需在真实 Windows、Linux 和 macOS 设备上验证：

- 安装、首次启动、卸载或拖入 Applications
- 密码与密钥凭证的保存、读取和删除
- SSH 密码认证、密钥认证、终端交互和断线恢复
- SFTP 上传、下载、暂停、恢复和冲突处理
- 最小化、最大化、关闭和多窗口行为

Linux 的密码加密依赖桌面密钥环；应至少覆盖 GNOME Keyring 或 KWallet。macOS 和 Linux 当前沿用自绘无边框窗口，发布前必须检查窗口控制与系统习惯是否可接受。

## 开源与安全

- 贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题请按 [SECURITY.md](SECURITY.md) 使用 GitHub 私密漏洞报告
- CI 使用 Gitleaks 检查敏感信息，并使用 CodeQL 分析 JavaScript/TypeScript
- Dependabot 每周检查 pnpm 依赖和 GitHub Actions 更新

## 目录结构

```text
apex-ssh/
├── deploy/       # 本地 Docker SSH 验证环境
├── resources/    # 应用图标等打包资源
├── scripts/      # 自动化验收与资源生成脚本
└── src/          # Electron 主进程、预加载脚本与 React 渲染层
```

## 许可证

本项目使用 [MIT License](LICENSE)。
