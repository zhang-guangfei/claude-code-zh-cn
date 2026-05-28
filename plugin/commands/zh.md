---
description: 刷新插件描述中文化 — 扫描、翻译、回写、patch 全自动
allowed-tools: Bash(node:*), Read, Write, Edit
---

## 阶段 1: 扫描

Run patch-plugins.js: !`node ~/.claude/plugins/claude-code-zh-cn/patch-plugins.js`

Check pending file size: !`wc -c ~/.claude/plugins/claude-code-zh-cn/.pending-translations.json 2>/dev/null || echo "0"`

## 阶段 2: 翻译并回写

If .pending-translations.json has entries:
1. Read its content with the Read tool
2. Translate each entry's English description to Chinese:
   - Keep technical terms (API, React, npm, etc.) in English
   - Make descriptions concise and natural in Chinese
   - For `type: "plugin"` entries → write to plugin/plugin-descriptions-zh.json
   - For `type: "skill"` entries → write to plugin/skill-descriptions-zh.json
   - Format: `"name": "中文描述"`
3. After saving all translations, delete .pending-translations.json: !`rm -f ~/.claude/plugins/claude-code-zh-cn/.pending-translations.json`

## 阶段 3: 重新 patch

Run patch-plugins.js again to apply new translations: !`node ~/.claude/plugins/claude-code-zh-cn/patch-plugins.js`

Report final patch count and confirm all pending items resolved.
