import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { IconName } from '../components/Icon'
import { LANGS, translate, type MessageKey } from '../i18n/core'

export type Category = 'organize' | 'edit' | 'convert' | 'security' | 'optimize' | 'advanced' | 'ai'

/** Home-page order. Categories without working tools (security, ai for now) are not shown. */
export const CATEGORIES: Category[] = ['organize', 'edit', 'convert', 'security', 'optimize', 'advanced', 'ai']

/** Each category's colour (a CSS variable from index.css), used for its dot, card tile and tool header. */
export const CAT_VAR: Record<Category, string> = {
  organize: 'var(--cat-organize)',
  edit: 'var(--cat-from)',
  convert: 'var(--cat-to)',
  security: 'var(--cat-organize)',
  optimize: 'var(--cat-optimize)',
  advanced: 'var(--cat-advanced)',
  ai: 'var(--cat-advanced)',
}

/** Tools whose address changed. Old links keep working (Cloudflare 301 in public/_redirects, plus an in-app redirect). */
export const RENAMED: Record<string, string> = { 'extract-pages': 'extract-pdf', 'remove-pages': 'delete-pages' }

export interface ToolDef {
  slug: string
  category: Category
  icon: IconName
  /** What the tool accepts and produces (shown on the tool page). */
  input: 'pdf' | 'images' | 'text' | 'docx' | 'xlsx' | 'html'
  output: 'pdf' | 'pdfs' | 'images' | 'report' | 'text' | 'html' | 'docx' | 'xlsx' | 'pptx'
  /** Search keywords in every language (titles and descriptions are searched too). */
  keywords: { en: string[]; ar: string[] }
  component: LazyExoticComponent<ComponentType<{ tool: ToolDef }>>
}

const Merge = lazy(() => import('./merge/MergeTool'))
const Split = lazy(() => import('./split/SplitTool'))
const Extract = lazy(() => import('./pages/ExtractTool'))
const Remove = lazy(() => import('./pages/RemoveTool'))
const Organize = lazy(() => import('./organize/OrganizeTool'))
const Rotate = lazy(() => import('./rotate/RotateTool'))
const Compress = lazy(() => import('./compress/CompressTool'))
const PdfToImage = lazy(() => import('./pdf-to-image/PdfToImageTool'))
const ImageToPdf = lazy(() => import('./image-to-pdf/ImageToPdfTool'))
const Resize = lazy(() => import('./resize/ResizeTool'))
const Compare = lazy(() => import('./compare/CompareTool'))
const Crop = lazy(() => import('./crop/CropTool'))
const PageNumbers = lazy(() => import('./page-numbers/PageNumbersTool'))
const Watermark = lazy(() => import('./watermark/WatermarkTool'))
const TextToPdf = lazy(() => import('./txt-to-pdf/TextToPdfTool'))
const PdfToText = lazy(() => import('./pdf-to-txt/PdfToTextTool'))
const OfficeToPdf = lazy(() => import('./office-to-pdf/OfficeToPdfTool'))
const PdfToOffice = lazy(() => import('./pdf-to-office/PdfToOfficeTool'))

/** Only tools that actually work are listed. Nothing here is a placeholder. Texts live in src/i18n. */
export const TOOLS: ToolDef[] = [
  { slug: 'merge-pdf', input: 'pdf', output: 'pdf', icon: 'merge', category: 'organize', component: Merge,
    keywords: { en: ['combine', 'join', 'append', 'concatenate'], ar: ['دمج', 'جمع', 'ضم', 'توحيد', 'ملف واحد'] } },
  { slug: 'split-pdf', input: 'pdf', output: 'pdfs', icon: 'split', category: 'organize', component: Split,
    keywords: { en: ['separate', 'divide', 'cut', 'ranges'], ar: ['تقسيم', 'فصل', 'تجزئة', 'نطاقات', 'قص'] } },
  { slug: 'extract-pdf', input: 'pdf', output: 'pdf', icon: 'extract', category: 'organize', component: Extract,
    keywords: { en: ['select', 'pick', 'save pages', 'subset'], ar: ['استخراج', 'اختيار', 'حفظ صفحات', 'صفحات محددة'] } },
  { slug: 'delete-pages', input: 'pdf', output: 'pdf', icon: 'remove', category: 'organize', component: Remove,
    keywords: { en: ['delete', 'drop', 'erase'], ar: ['حذف', 'إزالة', 'مسح', 'حذف صفحات'] } },
  { slug: 'organize-pdf', input: 'pdf', output: 'pdf', icon: 'organize', category: 'organize', component: Organize,
    keywords: { en: ['reorder', 'rearrange', 'sort', 'move pages', 'thumbnails'], ar: ['تنظيم', 'ترتيب', 'إعادة ترتيب', 'نقل الصفحات', 'صور مصغرة'] } },
  { slug: 'rotate-pdf', input: 'pdf', output: 'pdfs', icon: 'rotate', category: 'edit', component: Rotate,
    keywords: { en: ['turn', 'orientation', 'landscape', 'portrait', 'flip'], ar: ['تدوير', 'اتجاه', 'أفقي', 'عمودي', 'قلب'] } },
  { slug: 'resize-pdf', input: 'pdf', output: 'pdfs', icon: 'resize', category: 'edit', component: Resize,
    keywords: { en: ['page size', 'a4', 'letter', 'a3', 'scale', 'paper size', 'fit'], ar: ['تغيير الحجم', 'مقاس الصفحة', 'حجم الورق', 'A4', 'تكبير', 'تصغير الصفحة'] } },
  { slug: 'crop-pdf', input: 'pdf', output: 'pdf', icon: 'crop', category: 'edit', component: Crop,
    keywords: { en: ['trim', 'margins', 'cut edges', 'crop box', 'whitespace'], ar: ['قص', 'اقتصاص', 'هوامش', 'تشذيب', 'حواف'] } },
  { slug: 'add-page-numbers', input: 'pdf', output: 'pdf', icon: 'hash', category: 'edit', component: PageNumbers,
    keywords: { en: ['page numbers', 'numbering', 'paginate', 'footer', 'header', 'roman'], ar: ['ترقيم', 'أرقام الصفحات', 'ترقيم الصفحات', 'تذييل', 'ترويسة'] } },
  { slug: 'watermark-pdf', input: 'pdf', output: 'pdf', icon: 'stamp', category: 'edit', component: Watermark,
    keywords: { en: ['stamp', 'confidential', 'draft', 'logo', 'overlay', 'brand'], ar: ['علامة مائية', 'ختم', 'سري', 'مسودة', 'شعار'] } },
  { slug: 'compress-pdf', input: 'pdf', output: 'pdfs', icon: 'compress', category: 'optimize', component: Compress,
    keywords: { en: ['reduce', 'shrink', 'smaller', 'optimize', 'size'], ar: ['ضغط', 'تصغير', 'تقليل الحجم', 'حجم', 'تحسين'] } },
  { slug: 'jpg-to-pdf', input: 'images', output: 'pdfs', icon: 'imageIn', category: 'convert', component: ImageToPdf,
    keywords: { en: ['jpeg', 'image', 'photo', 'picture', 'scan', 'png', 'webp'], ar: ['صور', 'صورة', 'جي بي جي', 'تحويل صور', 'مسح ضوئي', 'سكان'] } },
  { slug: 'png-to-pdf', input: 'images', output: 'pdfs', icon: 'imageIn', category: 'convert', component: ImageToPdf,
    keywords: { en: ['image', 'screenshot', 'picture', 'jpg', 'webp'], ar: ['صور', 'صورة', 'لقطة شاشة', 'بي إن جي', 'تحويل صور'] } },
  { slug: 'word-to-pdf', input: 'docx', output: 'pdfs', icon: 'docIn', category: 'convert', component: OfficeToPdf,
    keywords: { en: ['word', 'docx', 'document', 'office', 'convert', 'doc'], ar: ['وورد', 'مستند', 'أوفيس', 'تحويل', 'ملف وورد'] } },
  { slug: 'excel-to-pdf', input: 'xlsx', output: 'pdfs', icon: 'sheetIn', category: 'convert', component: OfficeToPdf,
    keywords: { en: ['excel', 'xlsx', 'spreadsheet', 'sheet', 'table', 'office', 'convert'], ar: ['إكسل', 'جدول', 'جدول بيانات', 'أوفيس', 'تحويل'] } },
  { slug: 'html-to-pdf', input: 'html', output: 'pdfs', icon: 'htmlIn', category: 'convert', component: OfficeToPdf,
    keywords: { en: ['html', 'web page', 'webpage', 'htm', 'website', 'convert'], ar: ['صفحة ويب', 'إتش تي إم إل', 'موقع', 'تحويل'] } },
  { slug: 'tiff-to-pdf', input: 'images', output: 'pdfs', icon: 'tiffIn', category: 'convert', component: ImageToPdf,
    keywords: { en: ['tif', 'tiff', 'scan', 'fax', 'multipage', 'multi-page', 'image'], ar: ['تيف', 'صور', 'مسح ضوئي', 'فاكس', 'متعدد الصفحات'] } },
  { slug: 'txt-to-pdf', input: 'text', output: 'pdfs', icon: 'textIn', category: 'convert', component: TextToPdf,
    keywords: { en: ['text', 'txt', 'notepad', 'plain text', 'log', 'convert'], ar: ['نص', 'ملف نصي', 'نص عادي', 'مفكرة', 'تحويل'] } },
  { slug: 'pdf-to-jpg', input: 'pdf', output: 'images', icon: 'imageOut', category: 'convert', component: PdfToImage,
    keywords: { en: ['jpeg', 'image', 'picture', 'export', 'convert'], ar: ['صور', 'صورة', 'تحويل إلى صور', 'جي بي جي', 'تصدير'] } },
  { slug: 'pdf-to-png', input: 'pdf', output: 'images', icon: 'imageOut', category: 'convert', component: PdfToImage,
    keywords: { en: ['image', 'picture', 'export', 'lossless', 'convert'], ar: ['صور', 'صورة', 'تحويل إلى صور', 'بي إن جي', 'تصدير'] } },
  { slug: 'pdf-to-word', input: 'pdf', output: 'docx', icon: 'docOut', category: 'convert', component: PdfToOffice,
    keywords: { en: ['word', 'docx', 'edit', 'editable', 'document', 'office', 'convert'], ar: ['وورد', 'مستند', 'تحرير', 'قابل للتعديل', 'تحويل'] } },
  { slug: 'pdf-to-excel', input: 'pdf', output: 'xlsx', icon: 'sheetOut', category: 'convert', component: PdfToOffice,
    keywords: { en: ['excel', 'xlsx', 'table', 'tables', 'spreadsheet', 'extract tables', 'convert'], ar: ['إكسل', 'جدول', 'جداول', 'استخراج الجداول', 'تحويل'] } },
  { slug: 'pdf-to-powerpoint', input: 'pdf', output: 'pptx', icon: 'slidesOut', category: 'convert', component: PdfToOffice,
    keywords: { en: ['powerpoint', 'pptx', 'slides', 'presentation', 'ppt', 'convert'], ar: ['باوربوينت', 'شرائح', 'عرض تقديمي', 'تحويل'] } },
  { slug: 'pdf-to-webp', input: 'pdf', output: 'images', icon: 'imageOut', category: 'convert', component: PdfToImage,
    keywords: { en: ['webp', 'image', 'picture', 'export', 'web', 'convert'], ar: ['صور', 'صورة', 'ويب بي', 'تحويل إلى صور', 'تصدير'] } },
  { slug: 'pdf-to-txt', input: 'pdf', output: 'text', icon: 'textOut', category: 'convert', component: PdfToText,
    keywords: { en: ['text', 'txt', 'extract text', 'copy text', 'plain text'], ar: ['نص', 'استخراج النص', 'نسخ النص', 'ملف نصي'] } },
  { slug: 'pdf-to-html', input: 'pdf', output: 'html', icon: 'htmlOut', category: 'convert', component: PdfToText,
    keywords: { en: ['html', 'web page', 'website', 'export', 'convert'], ar: ['صفحة ويب', 'إتش تي إم إل', 'موقع', 'تصدير', 'تحويل'] } },
  { slug: 'compare-pdf', input: 'pdf', output: 'report', icon: 'compare', category: 'advanced', component: Compare,
    keywords: { en: ['diff', 'difference', 'changes', 'versions', 'redline', 'track changes'], ar: ['مقارنة', 'فرق', 'الفروق', 'تغييرات', 'نسخ', 'مطابقة'] } },
]

export const toolBySlug = (slug: string) => TOOLS.find((t) => t.slug === slug)

export const toolKey = (slug: string, field: 'title' | 'short' | 'description') => `tool.${slug}.${field}` as MessageKey

/** Fold case, Arabic diacritics/tatweel and letter variants so “إدماج” finds “ادماج” etc. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064a')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Search titles, descriptions and keywords in both languages, whatever the interface language is. */
export function searchTools(query: string): ToolDef[] {
  const q = normalizeSearch(query.trim())
  if (!q) return TOOLS
  const terms = q.split(/\s+/)
  return TOOLS.filter((t) => {
    const parts = LANGS.flatMap((l) => [translate(l, toolKey(t.slug, 'title')), translate(l, toolKey(t.slug, 'short'))])
    const hay = normalizeSearch([...parts, ...t.keywords.en, ...t.keywords.ar].join(' '))
    return terms.every((term) => hay.includes(term))
  })
}
