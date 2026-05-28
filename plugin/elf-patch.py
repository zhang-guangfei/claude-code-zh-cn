#!/usr/bin/env python3
"""ELF 直接 patch — 扫描所有 JS 代码段，按字节长度替换英文→中文。"""
import hashlib, json, os, shutil, sys

def find_js_sections(data):
    """扫描 binary→text 转换找到所有 JS 代码段（Bun 可能拆成多段）"""
    sections = []
    i = 80 * 1024 * 1024
    while i < len(data) - 4096:
        chunk = data[i:i + 4096]
        printable = sum(1 for b in chunk if 32 <= b < 127 or b in (9, 10, 13))
        if printable / len(chunk) > 0.8:
            # 找到段起始
            start = i
            for j in range(i - 1, i - 4096, -1):
                if data[j] == 0 or data[j] >= 128:
                    start = j + 1
                    break
            # 找真正的段结束（>50 个连续低可打印块 = 二进制区间）
            for end in range(i + 4096, len(data) - 4096, 4096):
                chunk2 = data[end:end + 4096]
                printable2 = sum(1 for b in chunk2 if 32 <= b < 127 or b in (9, 10, 13))
                if printable2 / len(chunk2) < 0.1:
                    # 确认是否真实结束
                    low_count = 1
                    for k in range(end + 4096, min(end + 409600, len(data)), 4096):
                        ck = data[k:k + 4096]
                        pk = sum(1 for b in ck if 32 <= b < 127 or b in (9, 10, 13))
                        if pk / len(ck) < 0.1:
                            low_count += 1
                        else:
                            break
                    if low_count > 50:
                        sections.append((start, end - start))
                        i = end + 4096
                        break
            else:
                i += 4096
                continue
        i += 4096
    return sections

def main(binary_path, translations_file):
    backup_path = binary_path + '.zh-cn-backup'
    marker_path = binary_path + '.zh-cn-elf-marker'

    with open(binary_path, 'rb') as f:
        data = f.read()

    current_hash = hashlib.sha256(data).hexdigest()
    if os.path.exists(marker_path):
        try:
            with open(marker_path) as f:
                if f.read().strip() == current_hash:
                    return 0
        except Exception:
            pass

    sections = find_js_sections(data)
    if not sections:
        print("ERROR: 未找到 JS 代码段", file=sys.stderr)
        return 1

    if not os.path.exists(backup_path):
        shutil.copy2(binary_path, backup_path)

    with open(translations_file) as f:
        translations = json.load(f)

    total_patched = 0
    with open(binary_path, 'r+b') as fout:
        for js_start, js_size in sections:
            js_bytes = bytearray(data[js_start:js_start + js_size])

            candidates = []
            for item in translations:
                en_b = item['en'].encode('utf-8')
                zh_b = item['zh'].encode('utf-8')
                if len(zh_b) <= len(en_b) and en_b in js_bytes:
                    candidates.append((en_b, zh_b + b' ' * (len(en_b) - len(zh_b))))

            candidates.sort(key=lambda x: len(x[0]), reverse=True)

            for en_b, zh_b in candidates:
                count = js_bytes.count(en_b)
                if count > 0:
                    js_bytes = js_bytes.replace(en_b, zh_b)
                    total_patched += count

            if len(js_bytes) != js_size:
                print(f"ERROR: SIZE MISMATCH at {js_start}", file=sys.stderr)
                return 1

            fout.seek(js_start)
            fout.write(bytes(js_bytes))

    with open(marker_path, 'w') as f:
        f.write(current_hash)

    print(f"ELF patch: {total_patched} 处替换, {len(sections)} 代码段")
    return 0

if __name__ == '__main__':
    binary = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        '~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
    binary = os.path.realpath(binary)
    trans = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), 'cli-translations.json')
    sys.exit(main(binary, trans))
