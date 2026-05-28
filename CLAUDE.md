# claude-code-zh-cn

Claude Code CLI 中文本地化插件。

## 项目结构

- `patch-cli.sh` — CLI 硬编码文字 patch（被 install.sh 和 session-start hook 调用）
- `cli-translations.json` — 1696 条 UI 翻译对照表（英文→中文），patch-cli.sh 从此文件读取
- `install.sh` / `uninstall.sh` — 安装/卸载脚本
- `compute-patch-revision.sh` — patch 规则指纹计算，供 install.sh 和 session-start hook 共用
- `settings-overlay.json` — 合并到 settings.json 的中文设置（只含 language、spinnerTipsEnabled 等独有配置，**不含** verbs 和 tips 数据）
- `plugin/` — 插件（manifest、hooks、output-styles）
- `verbs/zh-CN.json` — 187 个 spinner 动词翻译（**唯一数据源**）
- `tips/zh-CN.json` — 41 条 spinner 提示翻译（**唯一数据源**）
- `CHANGELOG.md` — 版本变更记录

## 数据流

翻译数据**单一来源**，不允许重复维护：

- `verbs/zh-CN.json` 是动词的**唯一数据源**
- `tips/zh-CN.json` 是提示的**唯一数据源**
- `settings-overlay.json` **不重复存放** verbs 和 tips 数据
- `install.sh` 安装时从上述两个 JSON 文件动态读取，现场组装合并到 `~/.claude/settings.json`

**禁止**把 verbs 或 tips 的内容复制到 settings-overlay.json 里。如果要修改翻译，只改 verbs/ 或 tips/ 里的文件。

## 技术要点

- patch-cli.sh 使用**内容匹配**（匹配英文原文），不依赖变量名，跨版本稳定
- 从 `cli-translations.json` 批量读取翻译，按字符串长度**降序**替换（长字符串优先，避免子串冲突）
- cli.js 里的 `…` 是真实 U+2026 字符，不是 `\u2026` 转义序列
- node -e 在 bash 单引号里，用 Unicode 转义（`\uXXXX`）写中文，避免引号嵌套问题
- Hook 等技术术语保留英文（Hook 不是"钩子"，同 API、PR）
- Windows 兼容：NTFS 上 `fs.renameSync` 先 unlink 再 rename

## 插件描述翻译系统（Layer 5）

`patch-plugins.js` 在每次 session-start 时扫描已安装和市场插件，将英文描述替换为中文。

### 扫描覆盖

| 数据源 | 路径 | 作用 |
|--------|------|------|
| 已安装 plugin.json | `cache/*/.claude-plugin/plugin.json` | 已安装插件描述 |
| 市场 plugin.json | `marketplaces/*/plugins/*/.claude-plugin/plugin.json` | **`/plugin` UI 数据源** |
| 市场 marketplace.json | `marketplaces/*/.claude-plugin/marketplace.json` | 市场列表描述 |
| 已安装 Skill | `cache/*/SKILL.md` | Skill 描述 |
| 命令 | `cache/*/commands/*.md` | 命令 description |
| 本地 Skill | `~/.claude/skills/*/SKILL.md` | 用户自定义 Skill |

### 翻译词典

- `plugin/plugin-descriptions-zh.json` — 插件名 → 中文描述
- `plugin/skill-descriptions-zh.json` — Skill/Command 名 → 中文描述

加载优先级：源仓库覆盖安装目录（`loadJsonMerge`），AI 翻译回写到源仓库，`install.sh` 的 `sync_plugin_payload` 清空 `! -name '.*'` 的非隐藏文件，所以 `.pending-translations.json` 必须以 `.` 开头才能存活。

### 待翻译回写闭环

词典无匹配 → 写入 `.pending-translations.json`（带 `type` 字段） → session-start hook 注入提示词 → AI 翻译回写词典 → 删除 pending 条目 → 下次启动直接 patch

### `/zh` 命令

用户级命令 `~/.claude/commands/zh.md`，三阶段流程：扫描 → 翻译回写 → 重新 patch。`install.sh` 自动部署，`uninstall.sh` 自动清理。

## 版本发布流程

每完成一批有意义的改动后，按以下步骤发布新版本：

1. **升版本号** — 修改 `plugin/manifest.json` 里的 `version`（语义化版本）
2. **更新 CHANGELOG** — 在 `CHANGELOG.md` 顶部新增版本段落，分"新增/改进/修复"
3. **提交** — `git commit`，提交信息带上版本号
4. **打 tag** — `git tag vX.Y.Z`
5. **推送** — `git push origin main --tags`
6. **发 Release** — `gh release create vX.Y.Z --title "vX.Y.Z" --notes "变更摘要"`
7. **发布状态校验** — `bash scripts/preflight.sh --release-state`，确认 manifest / CHANGELOG / tag / GitHub Release 对齐
