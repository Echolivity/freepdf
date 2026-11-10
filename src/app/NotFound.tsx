import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-7xl font-bold text-accent">404</p>
      <h1 className="mt-4 text-3xl font-bold">This page doesn't exist</h1>
      <p className="mt-3 text-muted">The link may be mistyped, or the tool may not be available yet.</p>
      <Link to="/" className="mt-8 inline-flex rounded-xl bg-accent px-5 py-3 font-semibold text-on-accent hover:bg-accent-hover">
        See all tools
      </Link>
    </div>
  )
}
