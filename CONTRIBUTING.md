# 参与贡献

感谢你参与 Apex SSH。提交改动前，请先确认没有把真实主机、密码、私钥或其他敏感信息加入仓库。

## 开发环境

- Node.js 24
- pnpm 11.17.0
- Windows、Linux 或 macOS
- 需要验证真实 SSH/SFTP 链路时安装 Docker

```bash
pnpm install
pnpm dev
```

完整的本地 SSH 验证环境与验收脚本见 [README.md](README.md)。

## 提交改动

1. 从 `main` 创建功能分支。
2. 保持改动聚焦，并同步更新相关文档。
3. 执行 `pnpm build`；涉及平台行为时，在对应操作系统完成启动和核心链路验证。
4. 提交信息使用 Conventional Commits，主题采用中文，例如 `fix: 修复连接断开后的终端状态`。
5. 发起 Pull Request，说明问题、实现方式和验证结果。

## 平台相关改动

打包或窗口行为改动必须分别考虑 Windows、Linux 和 macOS。仅在单一平台验证通过，不代表跨平台发布已经完成。

## 安全问题

请不要通过公开 Issue 报告未修复漏洞，报告方式见 [SECURITY.md](SECURITY.md)。
