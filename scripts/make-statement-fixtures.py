"""Synthetic bank statements for the bank-statement tool. Re-run: python3 scripts/make-statement-fixtures.py
Every name, bank, account and amount here is invented. Builds HTML, converts with LibreOffice (soffice),
and writes <name>.expected.json with the transactions the converter should find."""
import json, random, shutil, subprocess, tempfile, datetime
from pathlib import Path

out = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "statements"
out.mkdir(parents=True, exist_ok=True)
rnd = random.Random(20261118)

EN_DESC = ["POS PURCHASE GROCERY MART RIYADH", "SALARY TRANSFER EXAMPLE TRADING CO", "ATM WITHDRAWAL KING FAHD RD",
           "ONLINE TRANSFER TO SAVINGS ACCOUNT FOR MONTHLY BUDGET AND EMERGENCY FUND", "UTILITY BILL ELECTRICITY",
           "MOBILE BILL PAYMENT", "CARD PAYMENT COFFEE HOUSE", "REFUND ONLINE STORE ORDER", "RENT PAYMENT APARTMENT 12",
           "INTERNATIONAL TRANSFER FEE AND CORRESPONDENT BANK CHARGES FOR OUTGOING WIRE", "FUEL STATION", "PHARMACY"]
AR_DESC = ["شراء من نقاط البيع - سوبرماركت", "راتب شهري - شركة المثال للتجارة", "سحب نقدي من الصراف",
           "تحويل داخلي إلى حساب التوفير الخاص بالميزانية الشهرية والطوارئ", "فاتورة كهرباء", "سداد فاتورة جوال",
           "مقهى - دفع بالبطاقة", "استرداد مبلغ - متجر إلكتروني", "دفعة إيجار الشقة", "رسوم تحويل دولي"]

def txns(n, start, opening, descs):
    d, bal, rows = start, opening, []
    for i in range(n):
        d += datetime.timedelta(days=rnd.choice([0, 1, 1, 2]))
        desc = rnd.choice(descs)
        credit = ("SALARY" in desc or "REFUND" in desc or "راتب" in desc or "استرداد" in desc)
        amt = round(rnd.choice([12000, 8500]) if ("SALARY" in desc or "راتب" in desc) else rnd.uniform(5, 900), 2)
        net = amt if credit else -amt
        bal = round(bal + net, 2)
        rows.append({"date": d.isoformat(), "description": desc, "reference": f"FT{26000000 + rnd.randint(0, 999999)}",
                     "debit": None if credit else amt, "credit": amt if credit else None, "balance": bal})
    return rows

def money(v): return "" if v is None else f"{v:,.2f}"

def pdf(name, html):
    tmp = Path(tempfile.mkdtemp())
    (tmp / f"{name}.html").write_text(html, encoding="utf-8")
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf:writer_web_pdf_Export", "--outdir", str(tmp), str(tmp / f"{name}.html")], check=True, capture_output=True)
    shutil.copy(tmp / f"{name}.pdf", out / f"{name}.pdf")
    shutil.rmtree(tmp)

CSS = "body{font-family:'DejaVu Sans';font-size:8.5pt} table{border-collapse:collapse;width:100%} th,td{padding:2pt 3pt;border-bottom:0.5pt solid #bbb;vertical-align:top} th{background:#e8eef7} .n{text-align:right;white-space:nowrap} .d{white-space:nowrap}"

# 1. English, separate debit and credit columns, oldest first, two pages, wrapped descriptions.
opening = 15230.75
rows = txns(46, datetime.date(2026, 9, 1), opening, EN_DESC)
body = "".join(f"<tr><td class=d>{datetime.date.fromisoformat(r['date']).strftime('%d/%m/%Y')}</td><td class=d>{datetime.date.fromisoformat(r['date']).strftime('%d/%m/%Y')}</td><td>{r['description']}</td><td class=d>{r['reference']}</td><td class=n>{money(r['debit'])}</td><td class=n>{money(r['credit'])}</td><td class=n>{money(r['balance'])}</td></tr>" for r in rows)
pdf("en-statement", f"""<html><head><meta charset=utf-8><style>{CSS}</style></head><body>
<h2>Sahra Example Bank</h2><p>Account statement · Current account ****4821 · Currency: SAR<br>Customer: Test Customer · Period: 01/09/2026 to 30/09/2026</p>
<table><thead><tr><th width='13%'>Date</th><th width='13%'>Value Date</th><th width='28%'>Description</th><th width='13%'>Reference</th><th class=n width='10%'>Debit</th><th class=n width='10%'>Credit</th><th class=n width='13%'>Balance</th></tr></thead>
<tbody><tr><td></td><td></td><td>Opening Balance</td><td></td><td></td><td></td><td class=n>{money(opening)}</td></tr>{body}
<tr><td></td><td></td><td>Closing Balance</td><td></td><td></td><td></td><td class=n>{money(rows[-1]['balance'])}</td></tr></tbody></table>
<p>This is a computer-generated statement. Please report any discrepancy within 30 days. Sahra Example Bank is a fictional bank used for testing.</p></body></html>""")
json.dump({"opening": opening, "closing": rows[-1]["balance"], "currency": "SAR", "transactions": rows}, open(out / "en-statement.expected.json", "w"), ensure_ascii=False, indent=1)

# 2. Arabic, right-to-left, separate columns.
opening = 4120.00
rows = txns(18, datetime.date(2026, 10, 1), opening, AR_DESC)
body = "".join(f"<tr><td class=d>{datetime.date.fromisoformat(r['date']).strftime('%d/%m/%Y')}</td><td>{r['description']}</td><td class=n>{money(r['debit'])}</td><td class=n>{money(r['credit'])}</td><td class=n>{money(r['balance'])}</td></tr>" for r in rows)
pdf("ar-statement", f"""<html dir=rtl lang=ar><head><meta charset=utf-8><style>{CSS} .n{{text-align:left}}</style></head><body dir=rtl>
<h2>بنك الصحراء التجريبي</h2><p>كشف حساب · حساب جاري ****7310 · العملة: ريال سعودي<br>العميل: عميل تجريبي · الفترة: 01/10/2026 إلى 31/10/2026</p>
<table dir=rtl><thead><tr><th width='14%'>التاريخ</th><th width='40%'>البيان</th><th class=n width='14%'>مدين</th><th class=n width='14%'>دائن</th><th class=n width='18%'>الرصيد</th></tr></thead>
<tbody><tr><td></td><td>الرصيد الافتتاحي</td><td></td><td></td><td class=n>{money(opening)}</td></tr>{body}</tbody></table>
<p>هذا كشف حساب صادر آليًا. بنك الصحراء التجريبي بنك وهمي لأغراض الاختبار.</p></body></html>""")
json.dump({"opening": opening, "closing": rows[-1]["balance"], "currency": "SAR", "transactions": rows}, open(out / "ar-statement.expected.json", "w"), ensure_ascii=False, indent=1)

# 3. English, one signed amount column with CR/DR, newest first, "DD Mon YYYY" dates.
opening = 18980.40
rows = txns(14, datetime.date(2026, 8, 3), opening, EN_DESC)
def signed(r): return f"{r['credit']:,.2f} CR" if r["credit"] else f"{r['debit']:,.2f} DR"
body = "".join(f"<tr><td class=d>{datetime.date.fromisoformat(r['date']).strftime('%d %b %Y')}</td><td>{r['description']}</td><td class=n>{signed(r)}</td><td class=n>{money(r['balance'])}</td></tr>" for r in reversed(rows))
pdf("signed-statement", f"""<html><head><meta charset=utf-8><style>{CSS}</style></head><body>
<h2>Example Gulf Bank</h2><p>Statement of account ****0093 · AED</p>
<table><thead><tr><th width='16%'>Date</th><th width='50%'>Transaction Details</th><th class=n width='17%'>Amount</th><th class=n width='17%'>Balance</th></tr></thead><tbody>{body}
<tr><td></td><td>Balance brought forward</td><td></td><td class=n>{money(opening)}</td></tr></tbody></table></body></html>""")
json.dump({"opening": opening, "closing": rows[-1]["balance"], "currency": "AED", "transactions": rows}, open(out / "signed-statement.expected.json", "w"), ensure_ascii=False, indent=1)
print("ok")
