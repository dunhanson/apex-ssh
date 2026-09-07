# 项目特定约定

## 仓库协作

- UI 按“Figma 设计稿 → 同级 apex-ssh-prototype 原型确认 → 本仓库正式实现”推进；旧 HTML 原型不作为当前还原依据。
- 开始还原前读取 [正式还原流程](../apex-internal/PROJECT.md#正式还原流程)、[原型交互还原清单](../apex-ssh-prototype/docs/交互还原清单.md)及 [落地进度](../apex-internal/docs/功能待办.md)。仅修改指定页面，保留真实业务与配置兼容，在真实 Electron 中完成截图对照、交互及持久化验证，用户确认后再推进其他页面。
- 已实现功能同步到同级 `apex-internal/docs/功能清单.md`，验收结果与用户确认记录到其功能待办；不为迁就正式实现反向修改设计稿或原型。仅用户明确要求时提交，各仓库分别核对变更范围。
- 项目文档、提交说明和协作记忆使用中文；提交信息遵循 Conventional Commits，格式为 `类型(可选范围): 中文描述`。

## 项目记忆

> 后续追加的、与正式程序绑定的永久记忆放在此处。

## 版本发布规则

- 发布 `vX.Y.Z` 前，必须确认 `main` 已包含本次发布内容，工作区干净，并同步核对已确认的 Figma 状态稿、同级 `apex-ssh-prototype` 交互还原清单与 `apex-internal` 功能清单。
- 补丁版本发布使用 `release/vX.Y.Z` 短期分支；只允许进行版本号、发布说明、验收和发布缺陷修复，不在发布分支新增无关功能。
- 发布 `v0.1.1` 时，将 `package.json` 版本从 `0.1.0` 更新为 `0.1.1`，提交版本变更，合并发布分支回 `main`，再在合并后的 `main` 提交上创建带注释标签 `v0.1.1`。
- 创建标签前必须通过 `pnpm test` 和 `pnpm run build`，并在真实目标平台验证安装、升级、连接、凭证、备份、SFTP 和终端核心流程。
- 推送 `main` 和 `vX.Y.Z` 标签后，核对 GitHub Actions 构建结果和 GitHub Release；Windows 更新所需的 `latest.yml`、`latest-arm64.yml` 及对应 `.blockmap` 文件不得从 Release 中删除。
