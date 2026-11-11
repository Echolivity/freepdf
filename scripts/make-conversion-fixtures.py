"""Fixtures for the conversion tools (TIFF and TXT inputs). Re-run with: python3 scripts/make-conversion-fixtures.py"""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "convert"
out.mkdir(parents=True, exist_ok=True)


def colour(w, h, label):
    im = Image.new("RGB", (w, h), (250, 248, 240))
    d = ImageDraw.Draw(im)
    for i in range(0, w, 20):
        d.rectangle([i, 0, i + 9, h // 3], fill=((i * 3) % 255, 90, 200 - (i % 150)))
    d.rectangle([20, h // 2, w - 20, h - 20], outline=(20, 40, 160), width=6)
    d.text((30, h // 2 + 20), label, fill=(0, 0, 0))
    return im


# Two pages, LZW, 150 dpi: page 1 landscape, page 2 portrait.
p1, p2 = colour(600, 400, "page one"), colour(400, 600, "page two")
p1.save(out / "two-pages-lzw.tif", compression="tiff_lzw", dpi=(150, 150), save_all=True, append_images=[p2])

# A fax-style bilevel scan, CCITT Group 4, 200 dpi (US Letter at 200 dpi = 1700 x 2200).
fax = Image.new("1", (1700, 2200), 1)
d = ImageDraw.Draw(fax)
for y in range(200, 2000, 60):
    d.rectangle([150, y, 150 + (y * 7) % 1300 + 100, y + 18], fill=0)
fax.save(out / "fax-g4.tif", compression="group4", dpi=(200, 200))

# Greyscale PackBits, JPEG-in-TIFF, Deflate with transparency.
colour(320, 240, "gray").convert("L").save(out / "gray-packbits.tif", compression="packbits", dpi=(72, 72))
colour(320, 240, "jpeg").save(out / "rgb-jpeg.tif", compression="jpeg", quality=90)
rgba = colour(240, 240, "alpha").convert("RGBA")
rgba.putalpha(Image.linear_gradient("L").resize((240, 240)))
rgba.save(out / "rgba-deflate.tif", compression="tiff_adobe_deflate")

# A TIFF cut off half-way: must fail cleanly.
data = (out / "two-pages-lzw.tif").read_bytes()
(out / "truncated.tif").write_bytes(data[: len(data) // 3])

# Text inputs.
(out / "notes.txt").write_text(
    "Meeting notes\n\nFirst paragraph with enough words to wrap across more than one line when it is laid out on an A4 page at eleven points, so wrapping is exercised.\n\tIndented with a tab.\n\nمرحبا بالعالم، هذا سطر عربي مع رقم 2026.\nMixed: invoice رقم 15 paid.\n\fSecond page after a form feed.\n",
    encoding="utf-8",
)
(out / "utf16.txt").write_bytes("Hello UTF-16 — ok\nسطر عربي\n".encode("utf-16"))
(out / "latin1.txt").write_bytes("Café crème — naïve résumé\n".encode("cp1252"))
(out / "arabic-1256.txt").write_bytes("نص بترميز ويندوز 1256\n".encode("cp1256"))
(out / "binary.txt").write_bytes(bytes(range(256)) * 4)
print("written to", out)
