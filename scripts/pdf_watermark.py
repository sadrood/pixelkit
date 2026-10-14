
import sys, json, io
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import Color
infile = sys.argv[1]
output = sys.argv[2]
text = sys.argv[3]
opacity = float(sys.argv[4]) if len(sys.argv) > 4 else 0.15
color_hex = sys.argv[5] if len(sys.argv) > 5 else '#ff0000'
r = int(color_hex[1:3], 16) / 255
g = int(color_hex[3:5], 16) / 255
b = int(color_hex[5:7], 16) / 255
# 创建水印页
packet = io.BytesIO()
c = canvas.Canvas(packet, pagesize=A4)
c.setFillColor(Color(r, g, b, alpha=opacity))
c.setFont("Helvetica", 48)
c.saveState()
c.translate(300, 400)
c.rotate(45)
c.drawString(-200, 0, text)
c.restore()
c.save()
packet.seek(0)
watermark = PdfReader(packet)
reader = PdfReader(infile)
writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark.pages[0])
    writer.add_page(page)
writer.write(output)
print(json.dumps({"success": True}))
