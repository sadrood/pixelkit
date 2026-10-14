
import sys, json, os
from PyPDF2 import PdfReader, PdfWriter
infile = sys.argv[1]
outdir = sys.argv[2]
pages_per = int(sys.argv[3]) if len(sys.argv) > 3 else 1
reader = PdfReader(infile)
total = len(reader.pages)
results = []
for i in range(0, total, pages_per):
    writer = PdfWriter()
    end = min(i + pages_per, total)
    for j in range(i, end):
        writer.add_page(reader.pages[j])
    outname = f"split_{i+1}-{end}.pdf"
    outpath = os.path.join(outdir, outname)
    writer.write(outpath)
    results.append(outname)
print(json.dumps({"success": True, "files": results, "total": total}))
