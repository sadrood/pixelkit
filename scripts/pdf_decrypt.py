
import sys, json
from PyPDF2 import PdfReader, PdfWriter
infile = sys.argv[1]
output = sys.argv[2]
password = sys.argv[3] if len(sys.argv) > 3 else ''
reader = PdfReader(infile)
if reader.is_encrypted:
    reader.decrypt(password)
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
writer.write(output)
print(json.dumps({"success": True}))
