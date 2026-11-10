"""Generates structural-integrity fixtures:
  tests/fixtures/rich.pdf    - mixed page sizes + rotations, URI + internal links, text annotation,
                               embedded file, Arabic/English metadata, bookmarks, a form field
  tests/fixtures/signed.pdf  - the same document, digitally signed (self-signed test certificate)
Run: python3 scripts/make-structure-fixtures.py <key.pem> <cert.pem>   (needs reportlab, pypdf, pyhanko)"""
import io, os, sys
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Text
from pypdf.generic import NameObject, NumberObject

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')
buf = io.BytesIO()
c = canvas.Canvas(buf)
sizes = [(595, 842), (842, 595), (612, 792), (420, 595)]  # A4, A4 landscape, Letter, A5
for i, size in enumerate(sizes, 1):
    c.setPageSize(size)
    c.setFont('Helvetica', 20); c.drawString(40, size[1] - 60, f'Page {i} {size[0]}x{size[1]}')
    c.bookmarkPage(f'p{i}'); c.addOutlineEntry(f'Chapter {i}', f'p{i}', level=0)
    if i == 1:
        c.drawString(40, size[1] - 120, 'External link'); c.linkURL('https://example.org/', (40, size[1] - 125, 200, size[1] - 100), relative=0)
        c.drawString(40, size[1] - 160, 'Go to page 3'); c.linkRect('', 'p3', (40, size[1] - 165, 200, size[1] - 140), relative=0)
        c.acroForm.textfield(name='applicant', x=40, y=size[1] - 260, width=200, height=24, value='Mohammed')
    c.showPage()
c.save()

w = PdfWriter(clone_from=PdfReader(io.BytesIO(buf.getvalue())))
w.pages[1][NameObject('/Rotate')] = NumberObject(90)
w.add_annotation(page_number=2, annotation=Text(text='Reviewer note', rect=(50, 400, 70, 420)))
w.add_attachment('notes.txt', b'Attached notes for the structure test.\n')
w.add_metadata({'/Title': 'تقرير سنوي — Annual report', '/Author': 'محمد عبدالله', '/Subject': 'Structure fixture', '/Keywords': 'freepdf, test'})
with open(os.path.join(OUT, 'rich.pdf'), 'wb') as f: w.write(f)

if len(sys.argv) == 3:
    from pyhanko.sign import signers
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    signer = signers.SimpleSigner.load(sys.argv[1], sys.argv[2])
    with open(os.path.join(OUT, 'rich.pdf'), 'rb') as inf:
        out = signers.sign_pdf(IncrementalPdfFileWriter(inf), signers.PdfSignatureMetadata(field_name='Signature1'), signer=signer)
    with open(os.path.join(OUT, 'signed.pdf'), 'wb') as f: f.write(out.getvalue())
print('structure fixtures written')
