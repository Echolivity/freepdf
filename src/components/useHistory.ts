import { useCallback, useEffect, useState } from 'react'

/**
 * Undo/redo for a piece of editor state (page order, selections, crop boxes…). `set` records a step;
 * `replace` changes the present without a step (e.g. loading a new file). Ctrl/Cmd+Z and
 * Ctrl/Cmd+Shift+Z (or Ctrl+Y) work while focus isn't in a text field.
 */
export function useHistory<T>(initial: T, limit = 200) {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] })

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(s.present) : next
      if (Object.is(value, s.present)) return s
      return { past: [...s.past, s.present].slice(-limit), present: value, future: [] }
    })
  }, [limit])
  const replace = useCallback((value: T) => setState({ past: [], present: value, future: [] }), [])
  const undo = useCallback(() => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), [])
  const redo = useCallback(() => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return { value: state.present, set, replace, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }
}
