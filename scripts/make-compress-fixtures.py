"""Generates tests/fixtures/compress/*.pdf — the compression test matrix.
Run: python3 scripts/make-compress-fixtures.py   (needs Pillow + reportlab)"""
import io, math, os, random
from PIL import Image, ImageCms, ImageDraw, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'compress')
os.makedirs(OUT, exist_ok=True)
random.seed(7)

def photo(w, h, seed):
    """Smooth photographic-looking image (gradients + blurred shapes): realistic to JPEG-compress."""
    rnd = random.Random(seed)
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(0, w):
            px[x, y] = (int(128 + 100 * math.sin(x / 97 + seed)), int(128 + 90 * math.cos(y / 71)), int((x * y) / (w * h) * 255))
    d = ImageDraw.Draw(im)
    for _ in range(40):
        x, y, r = rnd.randrange(w), rnd.randrange(h), rnd.randrange(20, 160)
        d.ellipse((x - r, y - r, x + r, y + r), fill=(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)))
    return im.filter(ImageFilter.GaussianBlur(3))

def jpeg_bytes(im, q, **kw):
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q, **kw); return b.getvalue()

A4 = (595, 842)

# 1. image-heavy: three different large high-quality photos
c = canvas.Canvas(os.path.join(OUT, 'photos.pdf'), pagesize=A4)
for i, size in enumerate([(4000, 3000), (2600, 1800), (1600, 1200)]):
    c.drawImage(ImageReader(io.BytesIO(jpeg_bytes(photo(*size, i), 95))), 30, 200, 535, 400)
    c.setFont('Helvetica', 16); c.drawString(30, 780, f'Photo page {i + 1}'); c.showPage()
c.save()

# 2. vector-heavy: thousands of paths and text, no images
c = canvas.Canvas(os.path.join(OUT, 'vector.pdf'), pagesize=A4)
for p in range(3):
    for i in range(1500):
        c.setStrokeColorRGB(random.random(), random.random(), random.random())
        c.line(random.uniform(0, 595), random.uniform(0, 842), random.uniform(0, 595), random.uniform(0, 842))
    c.setFont('Times-Roman', 9)
    for y in range(40, 800, 12): c.drawString(30, y, f'Vector page {p + 1} line {y} — the quick brown fox jumps over the lazy dog 0123456789')
    c.showPage()
c.save()

# 3. scanned (greyscale) document
c = canvas.Canvas(os.path.join(OUT, 'scan-gray.pdf'), pagesize=A4)
for i in range(2):
    g = photo(2480, 3508, 10 + i).convert('L')
    c.drawImage(ImageReader(io.BytesIO(jpeg_bytes(g, 92))), 0, 0, *A4); c.showPage()
c.save()

# 4. transparency: large RGBA image (becomes image + soft mask)
rgba = photo(1800, 1200, 20).convert('RGBA')
alpha = Image.new('L', rgba.size)
ap = alpha.load()
for y in range(rgba.size[1]):
    for x in range(rgba.size[0]): ap[x, y] = int(255 * (x / rgba.size[0]))
rgba.putalpha(alpha)
c = canvas.Canvas(os.path.join(OUT, 'transparent.pdf'), pagesize=A4)
c.setFillColorRGB(0.9, 0.2, 0.2); c.rect(0, 0, 595, 842, fill=1, stroke=0)
c.drawImage(ImageReader(rgba), 30, 200, 535, 400, mask='auto'); c.showPage(); c.save()

# 5. mixed colour spaces: RGB JPEG, CMYK JPEG, grey JPEG, lossless RGB (Flate)
c = canvas.Canvas(os.path.join(OUT, 'mixed-colour.pdf'), pagesize=A4)
src = photo(2400, 1600, 30)
c.drawImage(ImageReader(io.BytesIO(jpeg_bytes(src, 95))), 30, 440, 535, 360); c.drawString(30, 810, 'RGB JPEG'); c.showPage()
c.drawImage(ImageReader(io.BytesIO(jpeg_bytes(src.convert('CMYK'), 95))), 30, 440, 535, 360); c.drawString(30, 810, 'CMYK JPEG'); c.showPage()
c.drawImage(ImageReader(io.BytesIO(jpeg_bytes(src.convert('L'), 95))), 30, 440, 535, 360); c.drawString(30, 810, 'Grey JPEG'); c.showPage()
c.drawImage(ImageReader(photo(1400, 900, 31)), 30, 440, 535, 360); c.drawString(30, 810, 'Lossless RGB'); c.showPage()
c.save()

# 6. an sRGB ICC profile, used by a test to build an ICCBased image with pdf-lib
with open(os.path.join(OUT, 'srgb.icc'), 'wb') as f:
    f.write(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
print('compression fixtures written to', os.path.abspath(OUT))
