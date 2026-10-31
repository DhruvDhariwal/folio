from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
import pypdfium2 as pdfium
from io import BytesIO

OUT=Path(__file__).resolve().parents[1]/'public'/'samples'
OUT.mkdir(exist_ok=True,parents=True)

def invoice(filename,vendor,reference,po,net,tax,total,quantity=None,unit=None,description='Brand design services',scan=False,included=False,style=0,date='2026-10-20'):
    data=BytesIO(); c=canvas.Canvas(data,pagesize=(595,842),invariant=1);c.setTitle(f'{reference} Sample invoice');
    ink=HexColor('#27392e');muted=HexColor('#6f796e');accent=HexColor('#416048' if style==0 else '#986849')
    c.setFillColor(accent);c.rect(0,824,595,18,fill=1,stroke=0)
    c.setFillColor(muted);c.setFont('Helvetica',8);c.drawString(48,799,'SAMPLE INVOICE  /  FICTIONAL SUPPLIER AND BUYER DATA')
    c.setFillColor(ink);c.setFont('Times-Roman' if style else 'Helvetica-Bold',29);c.drawString(48,747,vendor)
    c.setFont('Helvetica',10);c.setFillColor(muted);c.drawString(48,720,'Professional services')
    c.setFillColor(ink);c.setFont('Helvetica-Bold',13);c.drawString(48,671,'INVOICE')
    c.setFont('Helvetica',11)
    values=[f'Vendor: {vendor}','Bill to: Demo Company',f'Invoice number: {reference}',f'Invoice date: {date}','Currency: USD','Service period: 2026-10']
    if po: values.append(f'Purchase order: {po}')
    y=640
    for line in values:c.drawString(48,y,line);y-=25
    y-=25;c.setFillColor(HexColor('#eef1e8'));c.rect(42,y-9,511,25,fill=1,stroke=0);c.setFillColor(muted);c.setFont('Helvetica-Bold',8)
    c.drawString(50,y,'LINE  DESCRIPTION');c.drawRightString(544,y,'NET USD')
    y-=36;c.setFillColor(ink);c.setFont('Helvetica',10)
    code='BUNDLE' if not po else 'L1'
    text=f'{code}  {description}'
    if quantity is not None:text+=f'  {quantity}  {unit:.2f}'
    text+=f'  {net:,.2f}';c.drawString(48,y,text)
    y-=50;c.setStrokeColor(HexColor('#d8dfd2'));c.line(48,y,547,y);y-=30
    if not included:c.drawString(320,y,f'Subtotal: {net:,.2f}');y-=25
    c.drawString(320,y,f'{"Included tax" if included else "Tax"}: {tax:,.2f}');y-=31
    c.setFillColor(HexColor('#eef3e7'));c.rect(309,y-12,240,34,fill=1,stroke=0);c.setFillColor(ink);c.setFont('Helvetica-Bold',12);c.drawString(320,y,f'Total USD: {total:,.2f}')
    c.setFont('Helvetica',9);c.setFillColor(muted);c.drawString(48,171,'Payment terms: Net 30')
    if included:c.drawString(48,148,'Tax included in the stated invoice total. See the included tax amount above.')
    if scan:c.drawString(48,125,'Reference contains the letter O. Please check the source before confirming.')
    c.setFont('Helvetica',8);c.drawString(48,75,'This fictional document is for testing invoice processing. No payment is requested.')
    c.save()
    if scan:
        doc=pdfium.PdfDocument(data.getvalue());image=doc[0].render(scale=1.8).to_pil().convert('L')
        target=canvas.Canvas(str(OUT/filename),pagesize=(595,842),invariant=1);target.setTitle(f'{reference} Scanned sample invoice');target.drawImage(ImageReader(image),0,0,width=595,height=842);target.save()
    else:(OUT/filename).write_bytes(data.getvalue())

invoice('clean-invoice.pdf','Cedar Systems','CS-2201','PO1043',1000,0,1000,10,100,'Implementation support hours')
invoice('po-overrun.pdf','Northstar Studio','NS-0419','PO1042',3100,0,3100,style=1)
invoice('reissued-invoice.pdf','Northstar Studio','NS-0418-R','PO1042',2400,0,2400,style=1)
invoice('missing-po.pdf','Northstar Studio','NS-0520',None,1800,0,1800,description='Monthly design support',style=1)
invoice('tax-included-scan.pdf','Cedar Systems','CS-22O8','PO1043',1000,180,1180,10,100,'Implementation support hours',scan=True,included=True)
invoice('original-NS-0418.pdf','Northstar Studio','NS-0418','PO1042',2400,0,2400,date='2026-10-12')
print('Created six fictional invoice PDFs, including an image-only scan.')
