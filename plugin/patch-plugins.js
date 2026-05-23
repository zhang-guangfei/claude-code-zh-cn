#!/usr/bin/env node
// patch-plugins.js — 插件描述中文化 patch
// 在 claude-launcher pre-launch 阶段调用，将 plugin.json 和 marketplace.json 的 description 翻译为中文
// 增量模式：仅当内容与备份不同时才重新 patch

const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.join(require("os").homedir(), ".claude/plugins/claude-code-zh-cn");
const HOME = require("os").homedir();

const translationsFile = path.join(PLUGIN_ROOT, "plugin-descriptions-zh.json");
if (!fs.existsSync(translationsFile)) {
    process.exit(0);
}

const translations = JSON.parse(fs.readFileSync(translationsFile, "utf8"));

let patchCount = 0;

// ---------------------------------------------------------------------------
// Helper: scan a directory for all .claude-plugin/plugin.json files recursively
// ---------------------------------------------------------------------------
function findPluginJsons(baseDir) {
    const results = [];
    try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const full = path.join(baseDir, e.name);
            const pluginJson = path.join(full, ".claude-plugin", "plugin.json");
            if (fs.existsSync(pluginJson)) {
                results.push(pluginJson);
            }
            // Recurse: cache/<ns>/<plugin>/<version>/.claude-plugin/plugin.json
            const pluginDirs = fs.readdirSync(full, { withFileTypes: true }).filter(s => s.isDirectory());
            for (const pluginDir of pluginDirs) {
                const pluginFull = path.join(full, pluginDir.name);
                const versionDirs = fs.readdirSync(pluginFull, { withFileTypes: true }).filter(s => s.isDirectory());
                for (const versionDir of versionDirs) {
                    const versionFull = path.join(pluginFull, versionDir.name);
                    const pluginJson = path.join(versionFull, ".claude-plugin", "plugin.json");
                    if (fs.existsSync(pluginJson)) {
                        results.push(pluginJson);
                    }
                }
            }
        }
    } catch (e) { /* dir may not exist */ }
    return results;
}

// ---------------------------------------------------------------------------
// Helper: find all marketplace.json files
// ---------------------------------------------------------------------------
function findMarketplaceJsons() {
    const results = [];
    const marketplacesDir = path.join(HOME, ".claude/plugins/marketplaces");
    try {
        const entries = fs.readdirSync(marketplacesDir, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const mpJson = path.join(marketplacesDir, e.name, ".claude-plugin", "marketplace.json");
            if (fs.existsSync(mpJson)) {
                results.push(mpJson);
            }
        }
    } catch (e) { /* dir may not exist */ }
    return results;
}

// ---------------------------------------------------------------------------
// Helper: patch a single plugin.json file
// ---------------------------------------------------------------------------
function patchPluginJson(filePath) {
    let original;
    try {
        original = fs.readFileSync(filePath, "utf8");
    } catch (e) {
        return false;
    }

    let data;
    try {
        data = JSON.parse(original);
    } catch (e) {
        return false;
    }

    if (!data.name || !data.description) return false;

    const zhDesc = translations[data.name];
    if (!zhDesc) return false;

    // Already translated?
    if (data.description === zhDesc) return false;

    // Backup management
    const bakPath = filePath + ".zh-cn-bak";
    if (fs.existsSync(bakPath)) {
        try {
            const bakContent = fs.readFileSync(bakPath, "utf8");
            const bakData = JSON.parse(bakContent);
            // If current description differs from both backup AND translation,
            // it means the plugin was updated. Use current as new baseline.
            if (bakData.description !== data.description && data.description !== zhDesc) {
                // Plugin updated — keep original as new backup
            }
            // Restore from backup (get clean original) if needed
            if (bakData.description !== zhDesc && bakData.name === data.name) {
                data.description = bakData.description;
            }
        } catch (e) { /* backup corrupted, ignore */ }
    }

    // Save backup of original if not exists
    if (!fs.existsSync(bakPath)) {
        try {
            fs.writeFileSync(bakPath, original);
        } catch (e) { /* non-critical */ }
    }

    // Apply translation
    data.description = zhDesc;

    const newContent = JSON.stringify(data, null, 2) + "\n";
    if (newContent === original) return false;

    try {
        const tmpPath = filePath + ".zh-cn-tmp";
        fs.writeFileSync(tmpPath, newContent);
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Helper: patch marketplace.json file (description + plugins[].description)
// ---------------------------------------------------------------------------
function patchMarketplaceJson(filePath) {
    let original;
    try {
        original = fs.readFileSync(filePath, "utf8");
    } catch (e) {
        return false;
    }

    let data;
    try {
        data = JSON.parse(original);
    } catch (e) {
        return false;
    }

    let changed = false;

    // Patch top-level description (if it matches the marketplace name)
    if (data.name && translations[data.name] && data.description !== translations[data.name]) {
        data.description = translations[data.name];
        changed = true;
    }

    // Patch sub-plugin descriptions
    if (Array.isArray(data.plugins)) {
        for (const plugin of data.plugins) {
            if (plugin.name && translations[plugin.name] && plugin.description !== translations[plugin.name]) {
                plugin.description = translations[plugin.name];
                changed = true;
            }
        }
    }

    if (!changed) return false;

    const bakPath = filePath + ".zh-cn-bak";
    if (!fs.existsSync(bakPath)) {
        try {
            fs.writeFileSync(bakPath, original);
        } catch (e) { /* non-critical */ }
    }

    try {
        const tmpPath = filePath + ".zh-cn-tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
    const pluginJsons = findPluginJsons(path.join(HOME, ".claude/plugins/cache"));
    for (const filePath of pluginJsons) {
        if (patchPluginJson(filePath)) {
            patchCount++;
        }
    }

    const marketplaceJsons = findMarketplaceJsons();
    for (const filePath of marketplaceJsons) {
        if (patchMarketplaceJson(filePath)) {
            patchCount++;
        }
    }

    // Output patch count (consumed by claude-launcher for logging)
    console.log(patchCount);
}

main();
