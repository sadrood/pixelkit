
import sys, json, os
from PIL import Image

# 解除像素限制，防止大图 DecompressionBomb 报错
Image.MAX_IMAGE_PIXELS = None

files = json.loads(sys.argv[1])
output = sys.argv[2]
MAX_DIM = 4096  # 超大图缩放到此尺寸以内，节省内存

images = []
total = len(files)
for idx, f in enumerate(files):
    img = Image.open(f)
    # 超大图自动缩放，防止 2GB 服务器 OOM
    w, h = img.size
    if max(w, h) > MAX_DIM:
        ratio = MAX_DIM / max(w, h)
        new_w = max(1, int(w * ratio))
        new_h = max(1, int(h * ratio))
        img = img.resize((new_w, new_h), Image.LANCZOS)
    if img.mode != 'RGB':
        img = img.convert('RGB')
    images.append(img)
    # 输出进度（由服务端解析）
    print(json.dumps({"progress": (idx + 1) / total, "current": os.path.basename(f), "index": idx + 1, "total": total}), flush=True)

if images:
    images[0].save(output, save_all=True, append_images=images[1:] if len(images) > 1 else [])
    print(json.dumps({"success": True, "pages": len(images)}))
else:
    print(json.dumps({"success": False, "error": "No valid images"}))
