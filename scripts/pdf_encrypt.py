
import sys, json
from PyPDF2 import PdfReader, PdfWriter
infile = sys.argv[1]
output = sys.argv[2]
password = sys.argv[3]
reader = PdfReader(infile)
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
writer.encrypt(password)
writer.write(output)
print(json.dumps({"success": True}))
