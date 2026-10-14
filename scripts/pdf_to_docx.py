
import sys, json
from pdf2docx import Converter
infile = sys.argv[1]
output = sys.argv[2]
cv = Converter(infile)
cv.convert(output, start=0, end=None)
cv.close()
print(json.dumps({"success": True}))
