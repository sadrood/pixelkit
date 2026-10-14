
import sys, json, subprocess, os
infile = sys.argv[1]
output = sys.argv[2]
# 用 Ghostscript 或 qpdf 压缩，这里用 PyPDF2 做简单压缩
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader(infile)
writer = PdfWriter()
for page in reader.pages:
    page.compress_content_streams()
    writer.add_page(page)
writer.write(output)
orig = os.path.getsize(infile)
new = os.path.getsize(output)
print(json.dumps({"success": True, "original_size": orig, "compressed_size": new, "ratio": round(new/orig*100, 1)}))
