# Apex SSH

简洁、现代的跨平台桌面 SSH 客户端，专注于终端连接、会话管理和 SFTP 文件传输。

[![Release](https://img.shields.io/github/v/release/dunhanson/apex-ssh?style=flat-square)](https://github.com/dunhanson/apex-ssh/releases/latest) [![Build](https://img.shields.io/github/actions/workflow/status/dunhanson/apex-ssh/%E5%8F%91%E5%B8%83.yml?branch=main&style=flat-square&label=build)](https://github.com/dunhanson/apex-ssh/actions/workflows/%E5%8F%91%E5%B8%83.yml) [![License](https://img.shields.io/github/license/dunhanson/apex-ssh?style=flat-square)](LICENSE)

## 界面预览

**连接管理**

<img src="docs/images/软件界面.png" alt="Apex SSH 连接管理界面" width="960">

## 亮点功能

- **多会话工作区**：使用标签页同时管理多个 SSH 会话，支持左右分屏、会话复制和迁移到独立窗口。
- **完整终端体验**：支持 ANSI 色彩、vim、方向键历史、Tab 补全、Home/End、文本选择以及复制粘贴。
- **SFTP 文件管理**：提供远程面板和本地/远程双栏模式，支持上传、下载、拖拽、暂停、断点续传和冲突处理。
- **灵活的连接管理**：支持密码与私钥认证、主机分组和搜索、最近连接，以及从 `~/.ssh/config` 导入配置。
- **安全凭证库**：密码通过系统安全存储加密，应用管理的私钥限制文件权限，敏感信息不暴露给渲染进程。
- **配置迁移**：支持导入和导出主机配置，备份时自动排除密码、私钥和私钥口令。
- **跨平台与双语**：提供 Windows、Linux、macOS 安装包，界面支持简体中文、英文和跟随系统语言。

## 下载

前往 [GitHub Releases](https://github.com/dunhanson/apex-ssh/releases/latest) 下载最新版本：

- Windows x64：NSIS 安装程序
- Linux x64：AppImage 或 Debian 安装包
- macOS x64 / Apple Silicon：DMG 或 ZIP

当前公开安装包尚未配置商业代码签名，首次运行时操作系统可能显示安全提示。

## 技术概览

Apex SSH 基于 Electron、React、TypeScript、xterm.js 和 ssh2 构建，主进程负责 SSH、SFTP、凭证与本地数据，渲染进程通过受限 IPC 接口访问这些能力。

## 文档

- [开发指南](docs/开发指南.md)
- [构建与发布指南](docs/发布指南.md)
- [参与贡献](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 许可证

本项目使用 [MIT License](LICENSE)。
