#!/usr/bin/env bash
# generate-pending-context.sh
# 读取 pending-translations.json，生成要注入到 additionalContext 的中文翻译任务
set -euo pipefail

PENDING_FILE="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/claude-code-zh-cn}/pending-translations.json"

if [ ! -f "$PENDING_FILE" ] || [ ! -s "$PENDING_FILE" ]; then
    exit 0
fi

node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$PENDING_FILE', 'utf8'));
const items = Object.entries(data);
if (items.length === 0) process.exit(0);

let msg = '\\\\n\\\\n## AI 翻译兜底：待汉化的 Skill/Command 描述\\\\n\\\\n';
msg += '以下描述尚未在翻译表中，请在本次会话中用 Edit 工具将其翻译为简体中文并更新对应文件：\\\\n\\\\n';

let count = 0;
for (const [filePath, info] of items) {
    if (count >= 15) break;
    const en = typeof info === 'string' ? info : (info.en || info);
    const name = (info.name) ? ' [' + info.name + ']' : '';
    msg += '- \\\`' + filePath + '\\\`' + name + '\\\\n';
    msg += '  ' + en.substring(0, 200).replace(/\\\"/g, '\\\\\"') + '\\\\n\\\\n';
    count++;
}
if (items.length > 15) msg += '...等共 ' + items.length + ' 项，用 \\\`cat ' + '$PENDING_FILE' + '\\\` 查看全部。\\\\n';
msg += '\\\\n翻译要点：1-2句中文，简洁准确。翻译完成后删除 ' + '$PENDING_FILE' + ' 中对应条目。';

process.stdout.write(msg);
" 2>/dev/null || true
