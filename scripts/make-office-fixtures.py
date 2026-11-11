"""Office fixtures for the conversion tools (batch 2). Re-run: python3 scripts/make-office-fixtures.py
Needs python-docx, openpyxl, Pillow; LibreOffice (soffice) recalculates the workbook so formulas carry cached values."""
import io, shutil, subprocess, tempfile, datetime
from pathlib import Path
from PIL import Image, ImageDraw
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

out = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "office"
out.mkdir(parents=True, exist_ok=True)

def png(w, h, colour):
    im = Image.new("RGB", (w, h), colour)
    d = ImageDraw.Draw(im)
    d.ellipse([w * 0.2, h * 0.2, w * 0.8, h * 0.8], fill=(255, 255, 255))
    b = io.BytesIO(); im.save(b, "PNG"); b.seek(0); return b

def shade(cell, hex_fill):
    tc = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hex_fill); tc.append(shd)

# --- report.docx: headings, styled runs, lists, a bordered table, an image, a page break.
d = Document()
for s in d.sections: s.page_height, s.page_width, s.left_margin, s.right_margin = Cm(29.7), Cm(21.0), Cm(2.5), Cm(2.5)
d.add_heading("Quarterly Report", 0)
p = d.add_paragraph("This report has ")
r = p.add_run("bold"); r.bold = True
p.add_run(", "); r = p.add_run("italic"); r.italic = True
p.add_run(" and "); r = p.add_run("blue"); r.font.color.rgb = RGBColor(0x1F, 0x3F, 0xCF)
p.add_run(" text. " + "It is long enough to wrap onto several lines so that line breaking is exercised by the converter. " * 2)
d.add_heading("Highlights", 1)
for t in ["Revenue grew 12%", "Two new markets", "Costs held flat"]: d.add_paragraph(t, style="List Bullet")
d.add_heading("Steps", 2)
for t in ["Collect the data", "Check the totals", "Publish the report"]: d.add_paragraph(t, style="List Number")
table = d.add_table(rows=4, cols=3); table.style = "Table Grid"
for i, row in enumerate([("Region", "Q1", "Q2"), ("North", "1,200", "1,350"), ("South", "980", "1,010"), ("Total", "2,180", "2,360")]):
    for j, v in enumerate(row):
        table.cell(i, j).text = v
        if i == 0: shade(table.cell(i, j), "D9E2F3"); table.cell(i, j).paragraphs[0].runs[0].bold = True
d.add_paragraph()
d.add_picture(png(300, 150, (31, 63, 207)), width=Cm(6))
c = d.add_paragraph("Centred closing line."); c.alignment = WD_ALIGN_PARAGRAPH.CENTER
d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
d.add_heading("Appendix", 1)
rp = d.add_paragraph("Right-aligned note on page two."); rp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
d.sections[0].footer.paragraphs[0].text = "FreePDF test footer"
d.save(out / "report.docx")

# --- arabic.docx: right-to-left paragraphs with numbers, and an RTL table.
a = Document()
def rtl(par):
    pPr = par._p.get_or_add_pPr(); b = OxmlElement("w:bidi"); pPr.append(b)
    for run in par.runs:
        rPr = run._r.get_or_add_rPr(); x = OxmlElement("w:rtl"); rPr.append(x)
    return par
h = a.add_heading("تقرير المبيعات", 1); rtl(h)
rtl(a.add_paragraph("بلغت المبيعات 24,000 ريال في الربع الأول من عام 2026، بزيادة 12% عن العام الماضي."))
rtl(a.add_paragraph("هذه فقرة ثانية طويلة بما يكفي لتلتف على أكثر من سطر واحد حتى نتحقق من التفاف الأسطر العربية واتجاهها من اليمين إلى اليسار في الملف الناتج."))
t = a.add_table(rows=3, cols=2); t.style = "Table Grid"
tblPr = t._tbl.tblPr; bv = OxmlElement("w:bidiVisual"); tblPr.append(bv)
for i, row in enumerate([("المنطقة", "المبلغ"), ("الشمال", "1,200"), ("الجنوب", "980")]):
    for j, v in enumerate(row): t.cell(i, j).text = v; rtl(t.cell(i, j).paragraphs[0])
a.save(out / "arabic.docx")

# --- sheet.xlsx: formats, merged title, formulas, widths, two sheets (one right-to-left).
wb = Workbook(); ws = wb.active; ws.title = "Sales"
ws.merge_cells("A1:D1"); ws["A1"] = "Sales 2026"; ws["A1"].font = Font(bold=True, size=16); ws["A1"].alignment = Alignment(horizontal="center")
hdr = ["Region", "Date", "Amount", "Share"]
thin = Side(style="thin", color="999999")
for j, v in enumerate(hdr, 1):
    c = ws.cell(row=2, column=j, value=v); c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F3FCF"); c.border = Border(bottom=thin)
rows = [("North", datetime.date(2026, 1, 15), 1234.5), ("South", datetime.date(2026, 2, 3), 987.25), ("East", datetime.date(2026, 3, 30), 15000)]
for i, (reg, dt, amt) in enumerate(rows, 3):
    ws.cell(row=i, column=1, value=reg)
    ws.cell(row=i, column=2, value=dt).number_format = "yyyy-mm-dd"
    ws.cell(row=i, column=3, value=amt).number_format = "#,##0.00"
    ws.cell(row=i, column=4, value=f"=C{i}/SUM($C$3:$C$5)").number_format = "0.0%"
ws.cell(row=6, column=1, value="Total").font = Font(bold=True)
ws.cell(row=6, column=3, value="=SUM(C3:C5)").number_format = "#,##0.00"
ws.cell(row=6, column=3).font = Font(bold=True)
ws.column_dimensions["A"].width = 14; ws.column_dimensions["B"].width = 12; ws.column_dimensions["C"].width = 14
w2 = wb.create_sheet("عربي"); w2.sheet_view.rightToLeft = True
for i, (k, v) in enumerate([("البند", "القيمة"), ("الإيجار", 24000), ("الكهرباء", 1500)], 1):
    w2.cell(row=i, column=1, value=k); w2.cell(row=i, column=2, value=v)
w2["A1"].font = Font(bold=True); w2["B1"].font = Font(bold=True); w2["B2"].number_format = "#,##0"
raw = out / "sheet-raw.xlsx"; wb.save(raw)
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", tmp, str(raw)], check=True, capture_output=True)
    shutil.move(Path(tmp) / "sheet-raw.xlsx", out / "sheet.xlsx")
raw.unlink()

# --- page.html: styles, list, table, an inline image, plus things the sanitiser must remove.
img = png(120, 60, (13, 116, 84)).getvalue()
import base64
(out / "page.html").write_text(f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test page</title>
<style>body{{font-family:Georgia,serif;color:#222}} h1{{color:#1f3fcf}} .box{{background:#eef2ff;border:2px solid #1f3fcf;padding:8px}} td,th{{border:1px solid #888;padding:4px}} table{{border-collapse:collapse}}</style>
<link rel="stylesheet" href="https://example.com/evil.css"><script>document.title='pwned'</script></head>
<body><h1>HTML to PDF</h1><p class="box">A styled box with <b>bold</b> and <i>italic</i> text.</p>
<ul><li>First item</li><li>Second item</li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>
<table><tr><th>Name</th><th>Value</th></tr><tr><td>Alpha</td><td>1</td></tr><tr><td>Beta</td><td>2</td></tr></table>
<p><img src="data:image/png;base64,{base64.b64encode(img).decode()}" alt="inline" width="120" height="60"></p>
<p><img src="https://example.com/tracker.png" alt="remote image"> <img src="local.png" alt="relative image"></p>
<p onclick="alert(1)" style="background:url(https://example.com/bg.png)">Handlers and remote backgrounds are removed.</p>
<p dir="rtl">فقرة عربية في صفحة HTML مع رقم 2026.</p>
<iframe src="https://example.com"></iframe><a href="javascript:alert(1)">a link</a>
</body></html>""", encoding="utf-8")
print("written to", out)

# --- PDFs made by another program (LibreOffice), as inputs for PDF → Word / Excel / PowerPoint.
with tempfile.TemporaryDirectory() as tmp:
    for src, dst in [("report.docx", "report-lo.pdf"), ("arabic.docx", "arabic-lo.pdf"), ("sheet.xlsx", "sheet-lo.pdf")]:
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp, str(out / src)], check=True, capture_output=True)
        shutil.move(Path(tmp) / (Path(src).stem + ".pdf"), out / dst)
print("PDF inputs written")
