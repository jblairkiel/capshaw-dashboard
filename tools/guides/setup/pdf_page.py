"""The first page of a PDF as a PNG, for a scene to show on screen.

    python3 setup/pdf_page.py <in.pdf> <out.png>
"""
import sys
import pymupdf

pymupdf.open(sys.argv[1])[0].get_pixmap(dpi=110).save(sys.argv[2])
