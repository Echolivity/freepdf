import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { IconName } from '../components/Icon'

export type Category = 'organize' | 'optimize' | 'convert-to' | 'convert-from'

export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  { id: 'organize', label: 'Organize', blurb: 'Combine, split and rearrange pages' },
  { id: 'optimize', label: 'Optimize', blurb: 'Make files smaller' },
  { id: 'convert-to', label: 'Convert to PDF', blurb: 'Turn images into PDFs' },
  { id: 'convert-from', label: 'Convert from PDF', blurb: 'Turn PDF pages into images' },
]

export interface ToolDef {
  slug: string
  title: string
  /** One line for cards. */
  short: string
  /** Fuller description on the tool page. */
  description: string
  category: Category
  icon: IconName
  keywords: string[]
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

/** Only tools that actually work are listed. Nothing here is a placeholder. */
export const TOOLS: ToolDef[] = [
  {
    slug: 'merge-pdf', title: 'Merge PDF', icon: 'merge', category: 'organize', component: Merge,
    short: 'Combine several PDFs into one, in the order you choose.',
    description: 'Combine PDFs into a single document. Drag files to set the order. Bookmarks and fillable form fields aren’t carried over yet — form contents stay visible but become non-editable.',
    keywords: ['combine', 'join', 'append', 'concatenate'],
  },
  {
    slug: 'split-pdf', title: 'Split PDF', icon: 'split', category: 'organize', component: Split,
    short: 'Break a PDF into separate files by range or page count.',
    description: 'Split a PDF into several files: by custom ranges, every page, or every N pages.',
    keywords: ['separate', 'divide', 'cut', 'ranges'],
  },
  {
    slug: 'extract-pages', title: 'Extract pages', icon: 'extract', category: 'organize', component: Extract,
    short: 'Pull selected pages out into a new PDF.',
    description: 'Pick the pages you want and save them as a new PDF.',
    keywords: ['select', 'pick', 'save pages', 'subset'],
  },
  {
    slug: 'remove-pages', title: 'Remove pages', icon: 'remove', category: 'organize', component: Remove,
    short: 'Delete pages you don’t need.',
    description: 'Select pages to delete. Remaining form fields, bookmarks and links are kept; any that pointed at a removed page are cleaned up.',
    keywords: ['delete', 'drop', 'erase'],
  },
  {
    slug: 'organize-pdf', title: 'Organize PDF', icon: 'organize', category: 'organize', component: Organize,
    short: 'Reorder, rotate and delete pages visually.',
    description: 'See every page as a thumbnail. Drag to reorder, rotate or delete individual pages.',
    keywords: ['reorder', 'rearrange', 'sort', 'move pages', 'thumbnails'],
  },
  {
    slug: 'rotate-pdf', title: 'Rotate PDF', icon: 'rotate', category: 'organize', component: Rotate,
    short: 'Turn pages 90°, 180° or 270°.',
    description: 'Rotate every page of one or more PDFs. To rotate single pages, use Organize PDF.',
    keywords: ['turn', 'orientation', 'landscape', 'portrait', 'flip'],
  },
  {
    slug: 'compress-pdf', title: 'Compress PDF', icon: 'compress', category: 'optimize', component: Compress,
    short: 'Shrink file size by re-encoding images.',
    description: 'Reduce file size by re-encoding embedded images and repacking the file. Text and vector graphics stay sharp.',
    keywords: ['reduce', 'shrink', 'smaller', 'optimize', 'size'],
  },
  {
    slug: 'jpg-to-pdf', title: 'JPG to PDF', icon: 'imageIn', category: 'convert-to', component: ImageToPdf,
    short: 'Turn photos and scans into a PDF.',
    description: 'Convert JPG images (and PNG or WebP) into one PDF. Phone-photo orientation is respected.',
    keywords: ['jpeg', 'image', 'photo', 'picture', 'scan', 'png', 'webp'],
  },
  {
    slug: 'png-to-pdf', title: 'PNG to PDF', icon: 'imageIn', category: 'convert-to', component: ImageToPdf,
    short: 'Turn PNG images and screenshots into a PDF.',
    description: 'Convert PNG images (and JPG or WebP) into one PDF. Transparency is preserved.',
    keywords: ['image', 'screenshot', 'picture', 'jpg', 'webp'],
  },
  {
    slug: 'pdf-to-jpg', title: 'PDF to JPG', icon: 'imageOut', category: 'convert-from', component: PdfToImage,
    short: 'Save each page as a JPG image.',
    description: 'Convert every page of a PDF into a JPG image at the resolution you choose.',
    keywords: ['jpeg', 'image', 'picture', 'export', 'convert'],
  },
  {
    slug: 'pdf-to-png', title: 'PDF to PNG', icon: 'imageOut', category: 'convert-from', component: PdfToImage,
    short: 'Save each page as a lossless PNG.',
    description: 'Convert every page of a PDF into a PNG image at the resolution you choose.',
    keywords: ['image', 'picture', 'export', 'lossless', 'convert'],
  },
]

export const toolBySlug = (slug: string) => TOOLS.find((t) => t.slug === slug)

export function searchTools(query: string): ToolDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return TOOLS
  const terms = q.split(/\s+/)
  return TOOLS.filter((t) => {
    const hay = [t.title, t.short, ...t.keywords].join(' ').toLowerCase()
    return terms.every((term) => hay.includes(term))
  })
}
