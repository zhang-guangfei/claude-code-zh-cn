#!/usr/bin/env python3
"""ELF 直接 patch — 不需要 tweakcc trailer。在 session-start hook 中调用。"""
import json, os, sys, time

def find_js_section(data):
    """扫描 binary→text 转换找到 JS 代码段"""
    # 找第一个高可打印比的大块（>80% printable）在 80MB 之后
    for i in range(80 * 1024 * 1024, len(data) - 4096, 4096):
        chunk = data[i:i + 4096]
        printable = sum(1 for b in chunk if 32 <= b < 127 or b in (9, 10, 13))
        if printable / len(chunk) > 0.8:
            # 找到起始 — 往前退到上一段可打印区域的开始
            start = i
            for j in range(i - 1, i - 4096, -1):
                if data[j] == 0 or data[j] >= 128:
                    start = j + 1
                    break
            # 找结束 — 往后找 text→binary 转换
            for end in range(i + 4096, len(data) - 4096, 4096):
                chunk2 = data[end:end + 4096]
                printable2 = sum(1 for b in chunk2 if 32 <= b < 127 or b in (9, 10, 13))
                if printable2 / len(chunk2) < 0.1:
                    return start, end - start
    return None, None

def main(binary_path, translations_file):
    backup_path = binary_path + '.zh-cn-backup'
    
    with open(binary_path, 'rb') as f:
        data = f.read()
    
    js_start, js_size = find_js_section(data)
    if not js_start:
        print("ERROR: 未找到 JS 代码段", file=sys.stderr)
        return 1
    
    # 创建备份
    if not os.path.exists(backup_path):
        import shutil
        shutil.copy2(binary_path, backup_path)
    
    with open(translations_file) as f:
        translations = json.load(f)
    
    # 读取 JS 段
    js_bytes = data[js_start:js_start + js_size]
    
    # 构建候选翻译（byte-level）
    candidates = []
    for item in translations:
        en_b = item['en'].encode('utf-8')
        zh_b = item['zh'].encode('utf-8')
        if len(zh_b) <= len(en_b) and en_b in js_bytes:
            candidates.append((en_b, zh_b + b' ' * (len(en_b) - len(zh_b))))
    
    candidates.sort(key=lambda x: len(x[0]), reverse=True)
    
    patched = 0
    for en_b, zh_b in candidates:
        count = js_bytes.count(en_b)
        if count > 0:
            js_bytes = js_bytes.replace(en_b, zh_b)
            patched += count
    
    assert len(js_bytes) == js_size, f"SIZE MISMATCH: {len(js_bytes)} != {js_size}"
    
    # 写回
    with open(binary_path, 'r+b') as f:
        f.seek(js_start)
        f.write(js_bytes)
    
    print(f"ELF patch: {patched} 处替换, {len(candidates)} 翻译")
    return 0

if __name__ == '__main__':
    binary = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        '~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
    trans = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'cli-translations.json')
    sys.exit(main(binary, trans))
