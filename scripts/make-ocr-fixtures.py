"""Scanned test files for OCR. Re-run: python3 scripts/make-ocr-fixtures.py (needs pdftoppm and Pillow).
Renders existing text fixtures to greyscale images the way a scanner would (250 dpi, a slight tilt,
light noise, JPEG) and wraps them in image-only PDFs, so tests know exactly what text OCR should find.
All source documents are synthetic."""
import io, random, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
out = root / "ocr"
out.mkdir(parents=True, exist_ok=True)
rnd = random.Random(42)

def scan(pdf: Path, first: int, last: int, dpi=250, tilt=0.4):
    tmp = Path(tempfile.mkdtemp())
    subprocess.run(["pdftoppm", "-r", str(dpi), "-gray", "-f", str(first), "-l", str(last), "-png", str(pdf), str(tmp / "p")], check=True)
    pages = []
    for f in sorted(tmp.glob("p-*.png")):
        im = Image.open(f).convert("L")
        im = im.rotate(tilt, resample=Image.BICUBIC, expand=False, fillcolor=255)
        px = im.load()
        w, h = im.size
        for _ in range(w * h // 6000):  # a few specks, as a real scanner leaves
            x, y = rnd.randrange(w), rnd.randrange(h)
            px[x, y] = rnd.choice([0, 90, 180])
        im = im.filter(ImageFilter.GaussianBlur(0.3))
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=80); buf.seek(0)
        pages.append(Image.open(buf))
    return pages

def save_pdf(pages, name, dpi=250):
    pages[0].save(out / name, "PDF", save_all=True, append_images=pages[1:], resolution=dpi)

save_pdf(scan(root / "office" / "report-lo.pdf", 1, 1), "scan-en.pdf")
save_pdf(scan(root / "office" / "arabic-lo.pdf", 1, 1, tilt=-0.3), "scan-ar.pdf")
save_pdf(scan(root / "statements" / "en-statement.pdf", 1, 2, tilt=0.25), "scan-statement.pdf")
# A photo-like page as an image file (JPEG), for image input.
scan(root / "office" / "report-lo.pdf", 1, 1, dpi=200, tilt=0.8)[0].save(out / "photo-en.jpg", "JPEG", quality=82)
# A mixed PDF: page 1 has real text (the source page), page 2 is a scan.
from pypdf import PdfReader, PdfWriter  # noqa: E402
w = PdfWriter()
w.add_page(PdfReader(str(root / "office" / "report-lo.pdf")).pages[0])
w.add_page(PdfReader(str(out / "scan-ar.pdf")).pages[0])
w.write(str(out / "mixed.pdf"))
print("ok")
