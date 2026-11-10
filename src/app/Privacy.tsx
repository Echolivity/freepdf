import { useEffect } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { LIMITS, LOW_MEMORY, MB } from '../config'

const POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'cpu',
    title: 'Processing happens on your device',
    body: 'Every tool on this site runs inside your browser using JavaScript and Web Workers. Your PDFs and images are read into your computer’s memory, processed there, and handed back to you as a download. They are never sent to our server or anyone else’s.',
  },
  {
    icon: 'lock',
    title: 'Third parties are blocked by the browser',
    body: 'The site sends a Content-Security-Policy that tells your browser to refuse network connections to any other website, so a third-party script or service can’t receive your files. The app itself is designed never to send files back to this site either: its only requests load the app’s own code and fonts, and our automated tests fail if a document is ever sent anywhere. The site’s hosting has no endpoint that accepts uploads.',
  },
  {
    icon: 'trash',
    title: 'Temporary files disappear',
    body: 'Results exist only as temporary in-memory files in this tab. Pressing “Start over”, leaving the tool or closing the tab releases them. Nothing is written to browser storage. Each job runs in a fresh worker that is shut down when it finishes.',
  },
  {
    icon: 'shield',
    title: 'Nothing to track',
    body: 'No accounts, no analytics scripts, no advertising, no third-party fonts or CDNs. The only things saved in your browser are your theme choice and the list of tools you used recently, which you can clear from the home page.',
  },
]

export function Privacy() {
  useEffect(() => {
    document.title = 'How FreePDF works — privacy'
  }, [])
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-12 sm:px-6">
      <h1 className="text-4xl font-bold sm:text-5xl">How FreePDF works</h1>
      <p className="mt-4 text-lg text-muted">
        FreePDF is free because it doesn’t need servers to process your files. Your browser does the work.
      </p>
      <ul className="mt-10 space-y-8">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name={p.icon} size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold">{p.title}</h2>
              <p className="mt-1.5 text-muted">{p.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-14 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold">Which tools need a server?</h2>
        <p className="mt-2 text-muted">
          None of the tools currently on this site do. If a future tool needs one (converting Word, Excel or
          PowerPoint files needs an office suite that can’t run in a browser), its page will say so clearly before you
          add a file.
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold">Size safeguards</h2>
        <p className="mt-2 text-muted">
          These aren’t usage limits. They stop a very large file from crashing your browser tab: up to{' '}
          {LIMITS.maxFileBytes / MB} MB per file, {LIMITS.maxJobBytes / MB} MB per job, and images up to{' '}
          {LIMITS.maxImagePixels / 1_000_000} megapixels{LOW_MEMORY ? ' (lower than on computers, because this looks like a phone or low-memory device)' : ' (phones and low-memory devices get lower limits)'}. Files are checked by their actual contents, not just their names.
          Very large or unusual PDFs can still need a lot of memory, so the page warns you before processing big batches.
        </p>
      </section>
    </div>
  )
}
