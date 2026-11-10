"""Builds the real-world QA inputs in qa/.inputs/ (git-ignored; regenerated on every QA run).
All content is synthetic: random pixels, generated text, test certificates. No personal data."""
import io, os, random, sys
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

OUT = os.path.join(os.path.dirname(__file__), '.inputs')
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(42)

def noise_jpeg(w, h, q=92):
    im = Image.frombytes('RGB', (w, h), rnd.randbytes(w * h * 3))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q); return b.getvalue()

# 1) >100 MB image-heavy PDF (incompressible photos: worst case for memory)
path = os.path.join(OUT, 'large.pdf')
c = canvas.Canvas(path, pagesize=(595, 842))
size = 0; page = 0
while size < 120 * 1024 * 1024:
    jpg = noise_jpeg(3000, 2200)
    c.drawImage(ImageReader(io.BytesIO(jpg)), 20, 120, 555, 600)
    c.drawString(20, 800, f'Large QA page {page + 1}'); c.showPage()
    size += len(jpg); page += 1
c.save()
print('large.pdf', os.path.getsize(path), 'bytes,', page, 'pages')

# 2) 800-page text document
path = os.path.join(OUT, 'pages-800.pdf')
c = canvas.Canvas(path, pagesize=(595, 842))
for i in range(1, 801):
    c.setFont('Helvetica', 28); c.drawString(60, 760, f'Page {i} of 800')
    c.setFont('Times-Roman', 10)
    for y in range(100, 720, 14): c.drawString(60, y, f'Line {y} of page {i}: lorem ipsum dolor sit amet, consectetur adipiscing elit.')
    c.showPage()
c.save()
print('pages-800.pdf', os.path.getsize(path), 'bytes')

# 3) malformed variants derived from a valid file
src = open(os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'text-8p.pdf'), 'rb').read()
open(os.path.join(OUT, 'zero-bytes.pdf'), 'wb').close()
open(os.path.join(OUT, 'header-then-garbage.pdf'), 'wb').write(b'%PDF-1.7\n' + rnd.randbytes(50_000))
open(os.path.join(OUT, 'truncated-half.pdf'), 'wb').write(src[: len(src) // 2])
xref = src.rfind(b'xref')
open(os.path.join(OUT, 'xref-destroyed.pdf'), 'wb').write(src[:xref] + b'xref\n0 0 GARBAGE\ntrailer\n<<>>\n%%EOF\n')
open(os.path.join(OUT, 'png-renamed.pdf'), 'wb').write(open(os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'alpha.png'), 'rb').read())
print('malformed inputs written')
