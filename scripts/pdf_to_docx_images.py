
import sys, json, os, tempfile
from pdf2image import convert_from_path
from docx import Document
from docx.shared import Inches, Cm
from docx.enum.section import WD_ORIENT
infile = sys.argv[1]
output = sys.argv[2]
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200

images = convert_from_path(infile, dpi=dpi)
doc = Document()

# 设置窄边距
for section in doc.sections:
    section.top_margin = Cm(0.5)
    section.bottom_margin = Cm(0.5)
    section.left_margin = Cm(0.5)
    section.right_margin = Cm(0.5)

tmpdir = tempfile.mkdtemp()
for i, img in enumerate(images):
    img_path = os.path.join(tmpdir, f'page_{i+1}.png')
    img.save(img_path, 'PNG')
    # 每页图片宽度设为页面宽度的 95%
    doc.add_picture(img_path, width=Inches(6.0))
    # 如果不是最后一页，加分页符
    if i < len(images) - 1:
        doc.add_page_break()

# 清理临时文件
for f in os.listdir(tmpdir):
    os.remove(os.path.join(tmpdir, f))
os.rmdir(tmpdir)

doc.save(output)
print(json.dumps({"success": True, "pages": len(images)}))
