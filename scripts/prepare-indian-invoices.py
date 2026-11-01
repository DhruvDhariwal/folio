"""Prepare attributed, privacy-edited excerpts of institution-published invoices.
Source PDFs are downloaded into ignored work/research, never deployed.
No monetary amounts, invoice identities or tax values are changed.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path("work/pdfdeps").resolve()))
import pymupdf as fitz
from PIL import Image

out = Path("public/samples/india")
out.mkdir(parents=True, exist_ok=True)

def save_excerpt(source, index, name, redactions):
    original = fitz.open(source)
    doc = fitz.open()
    doc.insert_pdf(original, from_page=index, to_page=index)
    page = doc[0]
    w, h = page.rect.width, page.rect.height
    for area in redactions:
        page.add_redact_annot(fitz.Rect(area[0]*w, area[1]*h, area[2]*w, area[3]*h), fill=(1,1,1))
    page.apply_redactions()
    page.insert_text((25, h-21), "Public-source demo copy. Banking, personal contact and handwritten signature details omitted.", fontsize=6.5, color=(.4,.4,.4))
    doc.set_metadata({"title":name, "subject":"Attributed public institutional invoice excerpt; privacy redactions only", "author":"Original issuer; excerpt prepared for Folio"})
    dest=out/(name+".pdf")
    doc.save(dest, garbage=4, deflate=True)
    doc.close()
    check=fitz.open(dest)
    text=check[0].get_text()
    assert "0714093002" not in text and "graval" not in text
    pix=check[0].get_pixmap(matrix=fitz.Matrix(1.65,1.65),alpha=False)
    image=Image.frombytes("RGB", [pix.width,pix.height],pix.samples)
    image.save(out/(name+".webp"),"WEBP",quality=88)
    print(name, len(check), "page", dest.stat().st_size, "bytes")
    check.close()

save_excerpt("work/research/vignan-public.pdf",9,"turnitin-vignan-2023",[
    (.50,.26,.94,.37), # account manager name and contact
    (.055,.211,.30,.224), # separately stated PAN
    (.055,.695,.945,.902), # remittance / bank instructions
    (.79,.57,.91,.67), # handwritten institutional endorsement
])
save_excerpt("work/research/mit-public.pdf",0,"turnitin-mit-einvoice-2024",[
    (.76,.73,.95,.91), # handwritten endorsement; invoice data remains intact
])
