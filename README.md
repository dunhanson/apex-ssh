<div align="center">

# ⚡ Apex SSH

**简洁、现代的跨平台桌面 SSH 客户端**

终端连接 · 会话管理 · SFTP 传输 · 中英双语

**简体中文** | [English](README_EN.md)

[![Release](https://img.shields.io/github/v/release/dunhanson/apex-ssh?style=for-the-badge&logo=github&label=Release)](https://github.com/dunhanson/apex-ssh/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/dunhanson/apex-ssh/%E5%8F%91%E5%B8%83.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=Build)](https://github.com/dunhanson/apex-ssh/actions/workflows/%E5%8F%91%E5%B8%83.yml)
[![License](https://img.shields.io/github/license/dunhanson/apex-ssh?style=for-the-badge&color=blue)](LICENSE)

![Windows](https://img.shields.io/badge/Windows-0078d4?style=flat-square&logo=windows&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-fcc624?style=flat-square&logo=linux&logoColor=black)
![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white)
![简体中文 / English](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%2F%20English-跟随系统-5b5bd6?style=flat-square)

<img src="docs/images/软件界面.png" alt="Apex SSH 连接管理界面" width="960">

</div>

## ✨ 亮点功能

<table>
  <tr>
    <td width="50%">
      <h3>🗂 多会话工作区</h3>
      标签页同时管理多个 SSH 会话，支持左右分屏、会话复制和迁移到独立窗口。
    </td>
    <td width="50%">
      <h3>🖥 完整终端体验</h3>
      支持 ANSI 色彩、vim、方向键历史、Tab 补全、Home/End、文本选择以及复制粘贴。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>📁 SFTP 文件管理</h3>
      远程面板与本地/远程双栏模式，支持上传、下载、拖拽、暂停、断点续传和冲突处理。
    </td>
    <td width="50%">
      <h3>🔗 灵活的连接管理</h3>
      密码与私钥认证、主机分组和搜索、最近连接，支持从 <code>~/.ssh/config</code> 导入配置。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🔐 安全凭证库</h3>
      密码通过系统安全存储加密，应用管理的私钥限制文件权限，敏感信息不暴露给渲染进程。
    </td>
    <td width="50%">
      <h3>📦 配置迁移</h3>
      支持导入和导出主机配置，备份时自动排除密码、私钥和私钥口令。
    </td>
  </tr>
</table>

## 📥 下载

前往 [GitHub Releases](https://github.com/dunhanson/apex-ssh/releases/latest) 下载最新版本：

| 平台 | 架构 | 格式 |
| --- | --- | --- |
| 🪟 Windows | x64 / arm64 | NSIS 安装程序 |
| 🐧 Linux | x64 / arm64 | `.deb` / `.rpm` |
| 🍎 macOS | x64 / Apple Silicon | DMG |

> [!NOTE]
> 当前公开安装包尚未配置商业代码签名，首次运行时操作系统可能显示安全提示。

## 🛠 技术概览

![Electron](https://img.shields.io/badge/Electron-191970?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-20232a?style=flat-square&logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![xterm.js](https://img.shields.io/badge/xterm.js-000000?style=flat-square&logo=windowsterminal&logoColor=white)
![ssh2](https://img.shields.io/badge/ssh2-539e43?style=flat-square&logo=node.js&logoColor=white)

主进程负责 SSH、SFTP、凭证与本地数据，渲染进程通过受限 IPC 接口访问这些能力。

## 📖 文档

- [开发指南](docs/开发指南.md)
- [构建与发布指南](docs/发布指南.md)
- [参与贡献](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 📄 许可证

本项目使用 [MIT License](LICENSE)。
