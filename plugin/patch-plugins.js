#!/usr/bin/env node
// patch-plugins.js — 插件/命令/技能描述中文化 patch
// 在 session-start hook 中调用，翻译 plugin.json / marketplace.json / SKILL.md / commands/*.md
// 增量模式：仅当内容与备份不同时才重新 patch
// AI 兜底：未翻译项写入 .pending-translations.json，由 Claude 在会话中自动翻译

const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.join(require("os").homedir(), ".claude/plugins/claude-code-zh-cn");
const HOME = require("os").homedir();

const pluginTranslationsFile = path.join(PLUGIN_ROOT, "plugin-descriptions-zh.json");
const skillTranslationsFile = path.join(PLUGIN_ROOT, "skill-descriptions-zh.json");
const pendingFile = path.join(PLUGIN_ROOT, ".pending-translations.json");

// 源仓库路径（AI 翻译回写目标），翻译优先从源仓库加载
const sourceRepoFile = path.join(PLUGIN_ROOT, ".source-repo");
let SOURCE_REPO = "";
try {
    if (fs.existsSync(sourceRepoFile)) {
        SOURCE_REPO = fs.readFileSync(sourceRepoFile, "utf8").trim();
    }
} catch (e) {}

let translations = {};
let skillTranslations = {};

// 加载顺序：先安装目录，再源仓库覆盖（源仓库优先，包含 AI 翻译回写）
function loadJsonMerge(file) {
    let obj = {};
    // 安装目录（发布时的预制翻译）
    const installed = path.join(PLUGIN_ROOT, file);
    if (fs.existsSync(installed)) {
        try { obj = JSON.parse(fs.readFileSync(installed, "utf8")); } catch (e) {}
    }
    // 源仓库覆盖（AI 翻译回写 + 人工维护）
    if (SOURCE_REPO && SOURCE_REPO !== PLUGIN_ROOT) {
        const source = path.join(SOURCE_REPO, "plugin", file);
        if (fs.existsSync(source)) {
            try {
                const sourceObj = JSON.parse(fs.readFileSync(source, "utf8"));
                Object.assign(obj, sourceObj);
            } catch (e) {}
        }
    }
    return obj;
}

translations = loadJsonMerge("plugin-descriptions-zh.json");
skillTranslations = loadJsonMerge("skill-descriptions-zh.json");

let patchCount = 0;
let pendingMap = {}; // filePath → englishDescription — 待 Claude 翻译

// ============================================================================
// 文件发现 Helpers
// ============================================================================

function findPluginJsons(baseDir) {
    const results = [];
    try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const full = path.join(baseDir, e.name);
            const pluginJson = path.join(full, ".claude-plugin", "plugin.json");
            if (fs.existsSync(pluginJson)) results.push(pluginJson);
            const pluginDirs = fs.readdirSync(full, { withFileTypes: true }).filter(s => s.isDirectory());
            for (const pluginDir of pluginDirs) {
                const pluginFull = path.join(full, pluginDir.name);
                try {
                    const versionDirs = fs.readdirSync(pluginFull, { withFileTypes: true }).filter(s => s.isDirectory());
                    for (const versionDir of versionDirs) {
                        const versionFull = path.join(pluginFull, versionDir.name);
                        const pj = path.join(versionFull, ".claude-plugin", "plugin.json");
                        if (fs.existsSync(pj)) results.push(pj);
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}
    return results;
}

function findMarketplaceJsons() {
    const results = [];
    const dir = path.join(HOME, ".claude/plugins/marketplaces");
    try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            const mp = path.join(dir, e.name, ".claude-plugin", "marketplace.json");
            if (fs.existsSync(mp)) results.push(mp);
        }
    } catch (e) {}
    return results;
}

function findMarketplacePluginJsons() {
    const results = [];
    const dir = path.join(HOME, ".claude/plugins/marketplaces");
    try {
        for (const mp of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!mp.isDirectory()) continue;
            const pluginsDir = path.join(dir, mp.name, "plugins");
            if (!fs.existsSync(pluginsDir)) continue;
            for (const plugin of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
                if (!plugin.isDirectory()) continue;
                const pj = path.join(pluginsDir, plugin.name, ".claude-plugin", "plugin.json");
                if (fs.existsSync(pj)) results.push(pj);
            }
        }
    } catch (e) {}
    return results;
}

function findFrontmatterFiles(baseDir, fileName) {
    const results = [];
    function walk(dir, depth) {
        if (depth > 9) return;
        try {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) { walk(full, depth + 1); }
                else if (e.isFile() && e.name === fileName) { results.push(full); }
            }
        } catch (e) {}
    }
    walk(baseDir, 1);
    return results;
}

// ============================================================================
// 通用 YAML Frontmatter Patch
// ============================================================================

function parseFrontmatter(content) {
    if (!content.startsWith("---\n")) return null;
    const fmEnd = content.indexOf("\n---\n", 4);
    if (fmEnd === -1) return null;
    return {
        body: content.slice(4, fmEnd),           // YAML between markers
        rest: content.slice(fmEnd + 5),          // everything after ---
        fullFm: content.slice(0, fmEnd + 5),
    };
}

function resolveName(frontmatterBody, filePath) {
    // Try YAML 'name:' field first
    const nameMatch = frontmatterBody.match(/^name:\s*(.+)$/m);
    if (nameMatch) return nameMatch[1].trim();
    // For SKILL.md files, use parent directory name (skill name)
    // For commands/*.md, use filename without .md (command name)
    const basename = path.basename(filePath, ".md");
    const parentDir = path.basename(path.dirname(filePath));
    if (basename === "SKILL") {
        return parentDir || basename;
    }
    return basename || parentDir;
}

function resolveTranslation(name, filePath, translationMap) {
    // Direct match
    if (translationMap[name]) return translationMap[name];
    // Try with SKILL.md parent directory
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir && translationMap[parentDir]) return translationMap[parentDir];
    return null;
}

function patchFrontmatterFile(filePath, translationMap) {
    let content;
    try { content = fs.readFileSync(filePath, "utf8"); } catch (e) { return { patched: false, untranslated: false }; }

    const fm = parseFrontmatter(content);
    if (!fm) return { patched: false, untranslated: false };

    const name = resolveName(fm.body, filePath);
    const zhDesc = resolveTranslation(name, filePath, translationMap);

    const descMatch = fm.body.match(/^(description:\s*)(.+)$/m);
    if (!descMatch) return { patched: false, untranslated: false };

    const descPrefix = descMatch[1];
    const descValue = descMatch[2].trim();
    const descFullLine = descMatch[0];

    // Multiline description (description: | or description: >)
    if (/^[\|>]/.test(descValue)) {
        if (!zhDesc) {
            // Extract body text from multiline description for AI fallback
            const bodyStart = fm.body.indexOf("\n", fm.body.indexOf(descFullLine) + descFullLine.length);
            const bodyLines = fm.body.slice(bodyStart + 1).split("\n");
            let enDesc = "";
            for (const line of bodyLines) {
                const trimmed = line.trim();
                if (trimmed === "" || /^\w[\w-]*:/.test(trimmed)) break;
                enDesc += (enDesc ? " " : "") + trimmed;
            }
            enDesc = enDesc.trim().replace(/^["']|["']$/g, "");
            if (enDesc.length > 2) {
                return { patched: false, untranslated: true, enDesc, name };
            }
            return { patched: false, untranslated: true, enDesc: "(multiline)", name };
        }
        // Replace multiline with inline description
        const newFmBody = fm.body.replace(/^(description:\s*)[\s\S]*?(?=\n\S|\n*$)/m, descPrefix + '"' + zhDesc + '"');
        const newContent = "---\n" + newFmBody + "\n---" + fm.rest;
        if (newContent === content) return { patched: false, untranslated: false };
        applyPatch(filePath, content, newContent);
        return { patched: true, untranslated: false };
    }

    // No translation available — collect for AI fallback
    if (!zhDesc) {
        const rawDesc = descValue.replace(/^["']|["']$/g, "");
        if (rawDesc.length > 3 && name) {
            return { patched: false, untranslated: true, enDesc: rawDesc, name };
        }
        return { patched: false, untranslated: false };
    }

    // Already translated?
    const quoted = /^[`"']/.test(descValue);
    const newLine = quoted ? descPrefix + '"' + zhDesc + '"' : descPrefix + zhDesc;
    if (descFullLine === newLine) return { patched: false, untranslated: false };

    const newYaml = fm.body.replace(descFullLine, newLine);
    const newContent = "---\n" + newYaml + "\n---" + fm.rest;

    applyPatch(filePath, content, newContent);
    return { patched: true, untranslated: false };
}

function applyPatch(filePath, original, newContent) {
    const bakPath = filePath + ".zh-cn-bak";
    if (!fs.existsSync(bakPath)) {
        try { fs.writeFileSync(bakPath, original); } catch (e) {}
    }
    try {
        const tmpPath = filePath + ".zh-cn-tmp";
        fs.writeFileSync(tmpPath, newContent);
        fs.renameSync(tmpPath, filePath);
    } catch (e) {}
}

// ============================================================================
// Plugin / Marketplace JSON Patch
// ============================================================================

function patchPluginJson(filePath) {
    let original, data;
    try {
        original = fs.readFileSync(filePath, "utf8");
        data = JSON.parse(original);
    } catch (e) { return { patched: false, untranslated: false }; }

    if (!data.name || !data.description) return { patched: false, untranslated: false };
    const zhDesc = translations[data.name];
    if (!zhDesc) {
        if (data.description.length > 3 && data.name) {
            return { patched: false, untranslated: true, enDesc: data.description, name: data.name };
        }
        return { patched: false, untranslated: false };
    }
    if (data.description === zhDesc) return { patched: false, untranslated: false };

    const bakPath = filePath + ".zh-cn-bak";
    if (fs.existsSync(bakPath)) {
        try {
            const bakData = JSON.parse(fs.readFileSync(bakPath, "utf8"));
            if (bakData.description !== zhDesc && bakData.name === data.name) {
                data.description = bakData.description;
            }
        } catch (e) {}
    }
    if (!fs.existsSync(bakPath)) {
        try { fs.writeFileSync(bakPath, original); } catch (e) {}
    }

    data.description = zhDesc;
    const newContent = JSON.stringify(data, null, 2) + "\n";
    if (newContent === original) return { patched: false, untranslated: false };

    try {
        const tmpPath = filePath + ".zh-cn-tmp";
        fs.writeFileSync(tmpPath, newContent);
        fs.renameSync(tmpPath, filePath);
        return { patched: true, untranslated: false };
    } catch (e) { return { patched: false, untranslated: false }; }
}

function patchMarketplaceJson(filePath) {
    let original, data;
    try {
        original = fs.readFileSync(filePath, "utf8");
        data = JSON.parse(original);
    } catch (e) { return { patched: false, untranslated: [] }; }

    let changed = false;
    const untranslated = [];

    if (data.name && data.description) {
        const zhDesc = translations[data.name];
        if (zhDesc && data.description !== zhDesc) {
            data.description = zhDesc; changed = true;
        } else if (!zhDesc && data.description.length > 3) {
            untranslated.push({ name: data.name, en: data.description });
        }
    }

    if (Array.isArray(data.plugins)) {
        for (const p of data.plugins) {
            if (!p.name || !p.description) continue;
            const zhDesc = translations[p.name];
            if (zhDesc && p.description !== zhDesc) {
                p.description = zhDesc; changed = true;
            } else if (!zhDesc && p.description.length > 3) {
                untranslated.push({ name: p.name, en: p.description });
            }
        }
    }

    if (!changed) return { patched: false, untranslated };

    const bakPath = filePath + ".zh-cn-bak";
    if (!fs.existsSync(bakPath)) {
        try { fs.writeFileSync(bakPath, original); } catch (e) {}
    }
    try {
        const tmpPath = filePath + ".zh-cn-tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
        fs.renameSync(tmpPath, filePath);
        return { patched: true, untranslated };
    } catch (e) { return { patched: false, untranslated }; }
}

// ============================================================================
// Main
// ============================================================================

function main() {
    const cacheDir = path.join(HOME, ".claude/plugins/cache");

    // 1. Plugin JSON
    for (const fp of findPluginJsons(cacheDir)) {
        const result = patchPluginJson(fp);
        if (result.patched) patchCount++;
        if (result.untranslated && result.enDesc) {
            pendingMap[fp] = { en: result.enDesc, name: result.name || path.basename(fp), type: "plugin" };
        }
    }

    // 2. Marketplace plugin JSONs（marketplaces/*/plugins/*/plugin.json，/plugin UI 数据源）
    for (const fp of findMarketplacePluginJsons()) {
        const result = patchPluginJson(fp);
        if (result.patched) patchCount++;
        if (result.untranslated && result.enDesc) {
            pendingMap[fp] = { en: result.enDesc, name: result.name || path.basename(fp), type: "plugin" };
        }
    }

    // 3. Marketplace JSON（含未安装插件，提前翻译）
    for (const fp of findMarketplaceJsons()) {
        const result = patchMarketplaceJson(fp);
        if (result.patched) patchCount++;
        if (result.untranslated && result.untranslated.length > 0) {
            for (const entry of result.untranslated) {
                if (entry.name && entry.en && entry.en.length > 3) {
                    pendingMap[fp + "::" + entry.name] = { en: entry.en, name: entry.name, type: "plugin" };
                }
            }
        }
    }

    // 3. SKILL.md
    for (const fp of findFrontmatterFiles(cacheDir, "SKILL.md")) {
        const result = patchFrontmatterFile(fp, skillTranslations);
        if (result.patched) patchCount++;
        if (result.untranslated && result.enDesc) {
            pendingMap[fp] = { en: result.enDesc, name: result.name || path.basename(fp), type: "skill" };
        }
    }

    // 4. commands/*.md
    function findCommandFiles(dir) {
        const results = [];
        function walk(d, depth) {
            if (depth > 8) return;
            try {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    const full = path.join(d, e.name);
                    if (e.isDirectory()) {
                        walk(full, depth + 1);
                    } else if (e.isFile() && e.name.endsWith(".md") && full.includes("/commands/")) {
                        results.push(full);
                    }
                }
            } catch (e) {}
        }
        walk(dir, 1);
        return results;
    }
    for (const fp of findCommandFiles(cacheDir)) {
        const result = patchFrontmatterFile(fp, skillTranslations);
        if (result.patched) patchCount++;
        if (result.untranslated && result.enDesc) {
            pendingMap[fp] = { en: result.enDesc, name: result.name || path.basename(fp), type: "skill" };
        }
    }

    // 5. Local skills (~/.claude/skills/)
    const localSkillsDir = path.join(HOME, ".claude/skills");
    if (fs.existsSync(localSkillsDir)) {
        for (const fp of findFrontmatterFiles(localSkillsDir, "SKILL.md")) {
            const result = patchFrontmatterFile(fp, skillTranslations);
            if (result.patched) patchCount++;
            if (result.untranslated && result.enDesc) {
                pendingMap[fp] = { en: result.enDesc, name: result.name || path.basename(fp), type: "skill" };
            }
        }
    }

    // 6. Deduplicate pending: keep only one entry per unique (name + description)
    const deduped = {};
    for (const [fp, info] of Object.entries(pendingMap)) {
        const en = typeof info === 'string' ? info : (info.en || info);
        const name = typeof info === 'string' ? path.basename(path.dirname(fp)) : (info.name || path.basename(path.dirname(fp)));
        const entryType = (typeof info === 'object' && info.type) ? info.type : "skill";
        const key = name + '::' + en.substring(0, 80);
        if (!deduped[key]) {
            deduped[key] = { fp, info: { en, name, type: entryType } };
        }
    }

    // Write deduped pending
    const finalPending = {};
    for (const v of Object.values(deduped)) {
        finalPending[v.fp] = v.info;
    }

    if (Object.keys(finalPending).length > 0) {
        try {
            fs.writeFileSync(pendingFile, JSON.stringify(finalPending, null, 2) + "\n");
        } catch (e) {}
    } else {
        // Remove pending file if empty
        try { fs.unlinkSync(pendingFile); } catch (e) {}
    }

    console.log(patchCount);
}

main();
