import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { IconName } from '../components/Icon'
import { LANGS, translate, type MessageKey } from '../i18n/core'

export type Category = 'organize' | 'optimize' | 'convert-to' | 'convert-from'

export const CATEGORIES: Category[] = ['organize', 'optimize', 'convert-to', 'convert-from']

export interface ToolDef {
  slug: string
  category: Category
  icon: IconName
  /** What the tool accepts and produces (shown on the tool page). */
  input: 'pdf' | 'images'
  output: 'pdf' | 'pdfs' | 'images'
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

/** Only tools that actually work are listed. Nothing here is a placeholder. Texts live in src/i18n. */
export const TOOLS: ToolDef[] = [
  { slug: 'merge-pdf', input: 'pdf', output: 'pdf', icon: 'merge', category: 'organize', component: Merge,
    keywords: { en: ['combine', 'join', 'append', 'concatenate'], ar: ['دمج', 'جمع', 'ضم', 'توحيد', 'ملف واحد'] } },
  { slug: 'split-pdf', input: 'pdf', output: 'pdfs', icon: 'split', category: 'organize', component: Split,
    keywords: { en: ['separate', 'divide', 'cut', 'ranges'], ar: ['تقسيم', 'فصل', 'تجزئة', 'نطاقات', 'قص'] } },
  { slug: 'extract-pages', input: 'pdf', output: 'pdf', icon: 'extract', category: 'organize', component: Extract,
    keywords: { en: ['select', 'pick', 'save pages', 'subset'], ar: ['استخراج', 'اختيار', 'حفظ صفحات', 'صفحات محددة'] } },
  { slug: 'remove-pages', input: 'pdf', output: 'pdf', icon: 'remove', category: 'organize', component: Remove,
    keywords: { en: ['delete', 'drop', 'erase'], ar: ['حذف', 'إزالة', 'مسح', 'حذف صفحات'] } },
  { slug: 'organize-pdf', input: 'pdf', output: 'pdf', icon: 'organize', category: 'organize', component: Organize,
    keywords: { en: ['reorder', 'rearrange', 'sort', 'move pages', 'thumbnails'], ar: ['تنظيم', 'ترتيب', 'إعادة ترتيب', 'نقل الصفحات', 'صور مصغرة'] } },
  { slug: 'rotate-pdf', input: 'pdf', output: 'pdfs', icon: 'rotate', category: 'organize', component: Rotate,
    keywords: { en: ['turn', 'orientation', 'landscape', 'portrait', 'flip'], ar: ['تدوير', 'اتجاه', 'أفقي', 'عمودي', 'قلب'] } },
  { slug: 'compress-pdf', input: 'pdf', output: 'pdfs', icon: 'compress', category: 'optimize', component: Compress,
    keywords: { en: ['reduce', 'shrink', 'smaller', 'optimize', 'size'], ar: ['ضغط', 'تصغير', 'تقليل الحجم', 'حجم', 'تحسين'] } },
  { slug: 'jpg-to-pdf', input: 'images', output: 'pdfs', icon: 'imageIn', category: 'convert-to', component: ImageToPdf,
    keywords: { en: ['jpeg', 'image', 'photo', 'picture', 'scan', 'png', 'webp'], ar: ['صور', 'صورة', 'جي بي جي', 'تحويل صور', 'مسح ضوئي', 'سكان'] } },
  { slug: 'png-to-pdf', input: 'images', output: 'pdfs', icon: 'imageIn', category: 'convert-to', component: ImageToPdf,
    keywords: { en: ['image', 'screenshot', 'picture', 'jpg', 'webp'], ar: ['صور', 'صورة', 'لقطة شاشة', 'بي إن جي', 'تحويل صور'] } },
  { slug: 'pdf-to-jpg', input: 'pdf', output: 'images', icon: 'imageOut', category: 'convert-from', component: PdfToImage,
    keywords: { en: ['jpeg', 'image', 'picture', 'export', 'convert'], ar: ['صور', 'صورة', 'تحويل إلى صور', 'جي بي جي', 'تصدير'] } },
  { slug: 'pdf-to-png', input: 'pdf', output: 'images', icon: 'imageOut', category: 'convert-from', component: PdfToImage,
    keywords: { en: ['image', 'picture', 'export', 'lossless', 'convert'], ar: ['صور', 'صورة', 'تحويل إلى صور', 'بي إن جي', 'تصدير'] } },
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
