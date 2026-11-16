import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { searchVault, type Hit, type Index } from '../lib/api'
import { folderOf, fuzzy, title } from '../lib/vault'
import { Icon } from './Icon'

type Props = {
  open: boolean
  index: Index | null
  recent: string[]
  /** What's already typed when it opens, e.g. text selected in a note. */
  query?: string
  onOpen: (path: string) => void
  onCreate: (title: string) => void
  onClose: () => void
}

export function Palette({ open, ...props }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay palette-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={props.onClose}>
          <PaletteCard {...props} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

type Row =
  | { kind: 'note'; path: string; matched: number[]; detail: string }
  | { kind: 'text'; path: string; snippet: string; count: number }
  | { kind: 'create'; title: string }

function PaletteCard({ index, recent, query: initial, onOpen, onCreate, onClose }: Omit<Props, 'open'>) {
  const [query, setQuery] = useState(initial ?? '')
  const [active, setActive] = useState(0)
  const [hits, setHits] = useState<{ query: string; hits: Hit[] }>({ query: '', hits: [] })
  const list = useRef<HTMLDivElement>(null)
  const trimmed = query.trim()

  // Inside notes: asked of the vault as you type, a moment after you stop.
  useEffect(() => {
    if (trimmed.length < 2) return
    let stale = false
    const timer = window.setTimeout(() => {
      searchVault(trimmed)
        .then((found) => !stale && setHits({ query: trimmed, hits: found }))
        .catch(() => {})
    }, 90)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [trimmed])

  const rows = useMemo<Row[]>(() => {
    if (!index) return []
    const notes = index.notes
    if (!trimmed) {
      const known = new Set(notes.map((n) => n.path))
      const recents = recent.filter((p) => known.has(p))
      const rest = [...notes].sort((a, b) => b.modified - a.modified).filter((n) => !recents.includes(n.path))
      return [...recents, ...rest.map((n) => n.path)].slice(0, 9).map((path) => ({ kind: 'note', path, matched: [], detail: folderOf(path) }))
    }
    const byTitle = notes
      .flatMap((n) => {
        const name = title(n.path)
        const byName = fuzzy(trimmed, name)
        // A folder's name finds the notes in it, but only as written.
        const inFolder = !byName && folderOf(n.path).toLowerCase().includes(trimmed.toLowerCase())
        const match = byName ?? (inFolder ? { score: -500, indices: [] } : null)
        return match ? [{ n, match }] : []
      })
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 7)
    const titled = new Set(byTitle.map(({ n }) => n.path))
    const text = (trimmed.length >= 2 && hits.query && trimmed.toLowerCase().startsWith(hits.query.toLowerCase()) ? hits.hits : [])
      .filter((h) => !titled.has(h.path))
      .slice(0, 6)
    const exact = notes.some((n) => title(n.path).toLowerCase() === trimmed.toLowerCase())
    return [
      ...byTitle.map(({ n, match }): Row => ({ kind: 'note', path: n.path, matched: match.indices, detail: folderOf(n.path) })),
      ...text.map((h): Row => ({ kind: 'text', path: h.path, snippet: h.snippet, count: h.count })),
      ...(exact ? [] : [{ kind: 'create', title: trimmed } as Row]),
    ]
  }, [index, recent, trimmed, hits])

  useEffect(() => setActive(0), [trimmed])
  useEffect(() => {
    list.current?.querySelector('.palette-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(row: Row | undefined) {
    if (!row) return
    onClose()
    if (row.kind === 'create') onCreate(row.title)
    else onOpen(row.path)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault()
      setActive((a) => Math.min(a + 1, rows.length - 1))
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (trimmed) {
        onClose()
        onCreate(trimmed)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(rows[active])
    }
  }

  const firstText = rows.findIndex((r) => r.kind === 'text')

  return (
    <motion.div
      className="palette"
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="palette-input">
        <Icon name="search" size={17} strokeWidth={1.6} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder="Find or create a note…" spellCheck={false} />
      </div>
      <div className="palette-list" ref={list}>
        {!trimmed && rows.length > 0 && <div className="palette-heading">Recent</div>}
        {rows.map((row, i) => (
          <div key={row.kind === 'create' ? 'create' : `${row.kind}:${row.path}`}>
            {i === firstText && <div className="palette-heading">In notes</div>}
            <button className={i === active ? 'palette-row active' : 'palette-row'} onMouseMove={() => setActive(i)} onClick={() => choose(row)}>
              {i === active && <motion.span layoutId="palette-highlight" className="palette-highlight" transition={{ type: 'spring', stiffness: 700, damping: 45 }} />}
              <Icon name={row.kind === 'create' ? 'plus' : 'note'} size={15} className="palette-icon" />
              {row.kind === 'note' && (
                <>
                  <span className="palette-title">
                    <Highlighted text={title(row.path)} indices={row.matched} />
                  </span>
                  {row.detail && <span className="palette-folder">{row.detail}</span>}
                </>
              )}
              {row.kind === 'text' && (
                <span className="palette-text">
                  <span className="palette-title">
                    {title(row.path)}
                    {row.count > 1 && <span className="palette-count">{row.count}</span>}
                  </span>
                  <span className="palette-snippet">
                    <Snippet text={row.snippet} query={trimmed} />
                  </span>
                </span>
              )}
              {row.kind === 'create' && (
                <span className="palette-title">
                  New note <span className="palette-quote">“{row.title}”</span>
                </span>
              )}
              {i === active && <Icon name="enter" size={13} className="palette-enter" />}
            </button>
          </div>
        ))}
        {index && rows.length === 0 && <div className="palette-empty">Your vault is empty. Type a name to make the first note.</div>}
      </div>
      <div className="palette-footer">
        <span>
          <kbd>↑↓</kbd> move
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
        <span>
          <kbd>⌘↵</kbd> new note
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </div>
    </motion.div>
  )
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>
  const set = new Set(indices)
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className="match">
            {ch}
          </mark>
        ) : (
          ch
        ),
      )}
    </>
  )
}

function Snippet({ text: raw, query }: { text: string; query: string }) {
  // Snippets are raw lines; emphasis and link brackets would read as noise.
  const text = raw.replace(/\*\*|__|`|\[\[|\]\]/g, '')
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="match">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  )
}
