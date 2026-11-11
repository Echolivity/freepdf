/**
 * Minimal, valid Office Open XML packages (DOCX, XLSX, PPTX) written with JSZip. Only the parts each
 * format requires are produced; every piece of text is XML-escaped, and characters XML can't carry
 * (control codes, lone surrogates) are dropped.
 */
import JSZip from 'jszip'
import { isRtlText, type BlockKind } from './pdfText'
import { parseNumber, type Grid } from './pdfTables'

export function xmlText(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex -- XML 1.0 can't carry these characters
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const EMU = 12700 // per point

function core(title: string): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(title)}</dc:title><dc:creator>FreePDF</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
}
const APP = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FreePDF</Application><DocSecurity>0</DocSecurity></Properties>`

function rootRels(main: string): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
}

async function finish(zip: JSZip): Promise<Uint8Array> {
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' })
}

// ---------------------------------------------------------------------------------------- DOCX

export type DocxPart =
  | { type: 'p'; kind: BlockKind; text: string; size: number; rtl: boolean; align: 'start' | 'center' | 'end' }
  | { type: 'image'; bytes: Uint8Array; ext: 'png' | 'jpeg'; width: number; height: number }
  | { type: 'pageBreak' }

export interface DocxOptions { title: string; pageWidth: number; pageHeight: number; margins: { top: number; right: number; bottom: number; left: number }; bodySize: number }

export async function buildDocx(parts: DocxPart[], o: DocxOptions): Promise<Uint8Array> {
  const zip = new JSZip()
  const rels: string[] = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>']
  const contentW = o.pageWidth - o.margins.left - o.margins.right
  let img = 0
  const body: string[] = []
  const half = (pt: number) => Math.max(2, Math.round(pt * 2))
  for (const part of parts) {
    if (part.type === 'pageBreak') { body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); continue }
    if (part.type === 'image') {
      img++
      const name = `image${img}.${part.ext === 'png' ? 'png' : 'jpeg'}`
      zip.file(`word/media/${name}`, part.bytes)
      rels.push(`<Relationship Id="rIdImg${img}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`)
      const scale = Math.min(1, contentW / part.width)
      const cx = Math.round(part.width * scale * EMU)
      const cy = Math.round(part.height * scale * EMU)
      body.push(`<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${img}" name="Picture ${img}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${img}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${img}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`)
      continue
    }
    const style = part.kind === 'p' ? '' : `<w:pStyle w:val="Heading${part.kind.slice(1)}"/>`
    const jc = part.align === 'center' ? 'center' : part.align === 'end' ? (part.rtl ? 'left' : 'right') : ''
    const pPr = `<w:pPr>${style}${part.rtl ? '<w:bidi/>' : ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>`
    const size = part.kind === 'p' && Math.abs(part.size - o.bodySize) > 0.6 ? `<w:sz w:val="${half(part.size)}"/><w:szCs w:val="${half(part.size)}"/>` : ''
    // Tabs (column gaps) become real tabs; text otherwise in one run.
    const runs = part.text.split('\t').map((t, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}<w:r><w:rPr>${part.rtl || isRtlText(t) ? '<w:rtl/>' : ''}${size}</w:rPr><w:t xml:space="preserve">${xmlText(t)}</w:t></w:r>`).join('')
    body.push(`<w:p>${pPr}${runs}</w:p>`)
  }
  const tw = (pt: number) => Math.round(pt * 20)
  const sect = `<w:sectPr><w:pgSz w:w="${tw(o.pageWidth)}" w:h="${tw(o.pageHeight)}"${o.pageWidth > o.pageHeight ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(o.margins.top)}" w:right="${tw(o.margins.right)}" w:bottom="${tw(o.margins.bottom)}" w:left="${tw(o.margins.left)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`
  zip.file('word/document.xml', `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}${sect}</w:body></w:document>`)
  const b = half(o.bodySize)
  const heading = (n: number, size: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  zip.file('word/styles.xml', `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="${b}"/><w:szCs w:val="${b}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, Math.round(b * 1.8))}${heading(2, Math.round(b * 1.45))}${heading(3, Math.round(b * 1.2))}</w:styles>`)
  zip.file('word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`)
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
  zip.file('_rels/.rels', rootRels('word/document.xml'))
  zip.file('docProps/core.xml', core(o.title))
  zip.file('docProps/app.xml', APP)
  return finish(zip)
}

// ---------------------------------------------------------------------------------------- XLSX

export interface XlsxSheet { name: string; grid: Grid }

/** Sheet names: ≤ 31 characters, none of []:*?/\, unique. */
export function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = base
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 31 - String(i).length - 1)} ${i}`
  used.add(n.toLowerCase())
  return n
}

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export async function buildXlsx(sheets: XlsxSheet[], o: { title: string; numbers: boolean }): Promise<Uint8Array> {
  const zip = new JSZip()
  const formats: string[] = []
  const fmtId = (code: string) => {
    let i = formats.indexOf(code)
    if (i < 0) { formats.push(code); i = formats.length - 1 }
    return i + 1 // cellXfs index (0 is the default style)
  }
  const used = new Set<string>()
  const names = sheets.map((s) => sheetName(s.name, used))
  sheets.forEach((s, si) => {
    const cols = s.grid.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.min(80, (w / 0.75 / 7) + 2)).toFixed(2)}" customWidth="1"/>`).join('')
    const rows = s.grid.rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            if (v === null || v === '') return ''
            const ref = `${colName(c)}${r + 1}`
            const num = o.numbers ? parseNumber(v) : null
            if (num) return `<c r="${ref}" s="${fmtId(num.format)}"><v>${num.value}</v></c>`
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`
          })
          .join('')
        return cells ? `<row r="${r + 1}">${cells}</row>` : ''
      })
      .join('')
    zip.file(`xl/worksheets/sheet${si + 1}.xml`, `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${s.grid.rtl ? ' rightToLeft="1"' : ''}${si === 0 ? ' tabSelected="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`)
  })
  const numFmts = formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xmlText(f)}"/>`).join('')
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', ...formats.map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`)].join('')
  zip.file('xl/styles.xml', `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${formats.length ? `<numFmts count="${formats.length}">${numFmts}</numFmts>` : ''}<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${formats.length + 1}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  zip.file('xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
  zip.file('_rels/.rels', rootRels('xl/workbook.xml'))
  zip.file('docProps/core.xml', core(o.title))
  zip.file('docProps/app.xml', APP)
  return finish(zip)
}

// ---------------------------------------------------------------------------------------- PPTX

export interface Slide { image: Uint8Array; ext: 'jpeg' | 'png'; width: number; height: number }

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FreePDF"><a:themeElements><a:clrScheme name="FreePDF"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="1F3FCF"/></a:accent1><a:accent2><a:srgbClr val="0D7454"/></a:accent2><a:accent3><a:srgbClr val="A4520F"/></a:accent3><a:accent4><a:srgbClr val="6B44B8"/></a:accent4><a:accent5><a:srgbClr val="A8326A"/></a:accent5><a:accent6><a:srgbClr val="595B62"/></a:accent6><a:hlink><a:srgbClr val="1F3FCF"/></a:hlink><a:folHlink><a:srgbClr val="6B44B8"/></a:folHlink></a:clrScheme><a:fontScheme name="FreePDF"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="FreePDF"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`

export async function buildPptx(slides: Slide[], o: { title: string }): Promise<Uint8Array> {
  const zip = new JSZip()
  // Slide size from the first page, within PowerPoint's limits (1–56 inches).
  const first = slides[0]
  const clamp = (v: number) => Math.min(51206400, Math.max(914400, Math.round(v)))
  let cx = clamp(first.width * EMU)
  let cy = clamp(first.height * EMU)
  const fitScale = Math.min(cx / (first.width * EMU), cy / (first.height * EMU))
  cx = clamp(first.width * EMU * fitScale)
  cy = clamp(first.height * EMU * fitScale)
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  const emptyTree = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>'
  slides.forEach((s, i) => {
    const n = i + 1
    const name = `image${n}.${s.ext === 'png' ? 'png' : 'jpeg'}`
    zip.file(`ppt/media/${name}`, s.image)
    // Fit the page inside the slide, centred (pages of another size keep their proportions).
    const k = Math.min(cx / (s.width * EMU), cy / (s.height * EMU))
    const w = Math.round(s.width * EMU * k)
    const h = Math.round(s.height * EMU * k)
    const x = Math.round((cx - w) / 2)
    const y = Math.round((cy - h) / 2)
    zip.file(`ppt/slides/slide${n}.xml`, `${XML}<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${n}" descr="Page ${n}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/></Relationships>`)
  })
  zip.file('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${ns}>${emptyTree}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`)
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${ns} type="blank" preserve="1">${emptyTree.replace('<p:cSld>', '<p:cSld name="Blank">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`)
  zip.file('ppt/theme/theme1.xml', THEME)
  zip.file('ppt/presentation.xml', `${XML}<p:presentation ${ns} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`)
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
  zip.file('_rels/.rels', rootRels('ppt/presentation.xml'))
  zip.file('docProps/core.xml', core(o.title))
  zip.file('docProps/app.xml', APP)
  return finish(zip)
}
