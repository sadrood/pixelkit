
import sys, json, os, re
import fitz  # pymupdf

infile = sys.argv[1]
output = sys.argv[2]

doc = fitz.open(infile)
md_pages = []

for page_num, page in enumerate(doc):
    # 获取文字块（pymupdf 的 get_text("blocks") 保留段落结构）
    blocks = page.get_text("blocks")
    page_lines = []

    for block in blocks:
        # block = (x0, y0, x1, y1, text, block_no, block_type)
        if len(block) < 5:
            continue
        text = block[4].strip()
        if not text:
            continue

        block_type = block[6] if len(block) > 6 else 0
        # block_type: 0=text, 1=image

        if block_type == 0:
            # 检测是否为标题（字体大、文字短）
            # pymupdf 的 dict 模式能拿字体信息
            lines = text.split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                # 简单启发式：全大写短句可能是标题
                if len(line) < 80 and (line.isupper() or re.match(r'^第[一二三四五六七八九十\d]+[章节]', line)):
                    page_lines.append('## ' + line)
                elif len(line) < 60 and re.match(r'^[\d]+[\.、]', line):
                    page_lines.append('### ' + line)
                else:
                    page_lines.append(line)

    if page_lines:
        md_pages.append('\n\n'.join(page_lines))

doc.close()

result = '\n\n---\n\n'.join(md_pages)

with open(output, 'w', encoding='utf-8') as f:
    f.write(result)

print(json.dumps({"success": True}))
