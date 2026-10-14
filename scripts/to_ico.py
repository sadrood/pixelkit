
import sys, json
from PIL import Image
infile = sys.argv[1]
output = sys.argv[2]
img = Image.open(infile)
if img.mode != 'RGBA':
    img = img.convert('RGBA')
# 最大尺寸保持原图，其余等比缩放
w, h = img.size
max_dim = max(w, h)
# 计算各尺寸：最大 256，但不超过原图
base_sizes = [16, 32, 48, 64, 128, 256]
sizes = []
for s in base_sizes:
    if s <= max_dim:
        ratio = s / max_dim
        sizes.append((max(1, round(w * ratio)), max(1, round(h * ratio))))
    else:
        break
# 确保至少有一个尺寸
if not sizes:
    sizes = [(w, h)]
# 加上原图尺寸（如果原图大于最大预设尺寸则用原图）
if max_dim > 256:
    sizes.append((w, h))
img.save(output, format='ICO', sizes=sizes)
print(json.dumps({"success": True, "sizes": len(sizes)}))
