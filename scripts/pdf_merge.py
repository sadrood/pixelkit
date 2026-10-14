
import sys, json
from PyPDF2 import PdfReader, PdfWriter
files = json.loads(sys.argv[1])
output = sys.argv[2]
writer = PdfWriter()
for f in files:
    reader = PdfReader(f)
    for page in reader.pages:
        writer.add_page(page)
writer.write(output)
print(json.dumps({"success": True, "pages": len(writer.pages)}))
