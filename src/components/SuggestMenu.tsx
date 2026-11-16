import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { suggestStore, type SuggestState } from '../editor/suggest'
import { Icon } from './Icon'

/** The menu under the caret for [[ links and / blocks. */
export function SuggestMenu() {
  const state = useSyncExternalStore(suggestStore.subscribe, suggestStore.get)
  const visible = state && state.rect && (state.items.length > 0 || state.kind === 'link')
  return <AnimatePresence>{visible && <Panel key={state.kind} state={state} />}</AnimatePresence>
}

function Panel({ state }: { state: SuggestState }) {
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean }>({ left: state.rect!.left, top: state.rect!.bottom + 6, above: false })

  useLayoutEffect(() => {
    const rect = state.rect
    const el = panel.current
    if (!rect || !el) return
    const height = el.offsetHeight
    const above = rect.bottom + 6 + height > window.innerHeight - 12 && rect.top - height - 6 > 12
    setPlace({ left: Math.min(rect.left - 8, window.innerWidth - el.offsetWidth - 12), top: above ? rect.top - height - 6 : rect.bottom + 6, above })
  }, [state.rect, state.items.length])

  useEffect(() => {
    panel.current?.querySelector('.suggest-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [state.index])

  return (
    <motion.div
      ref={panel}
      className={`suggest suggest-${state.kind}`}
      style={{ left: place.left, top: place.top, transformOrigin: place.above ? 'bottom left' : 'top left' }}
      initial={{ opacity: 0, scale: 0.97, y: place.above ? 4 : -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 700, damping: 42 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {state.kind === 'link' && <div className="suggest-heading">{state.query.trim() ? 'Link to' : 'Link to a note'}</div>}
      {state.kind === 'slash' && <div className="suggest-heading">Blocks</div>}
      {state.items.length === 0 && <div className="suggest-empty">Type a note's name</div>}
      {state.items.map((item, i) => (
        <button
          key={item.id}
          className={i === state.index ? 'suggest-row active' : 'suggest-row'}
          onMouseMove={() => suggestStore.hover(i)}
          onClick={() => state.select(item)}
        >
          {i === state.index && <motion.span layoutId={`suggest-highlight-${state.kind}`} className="suggest-highlight" transition={{ type: 'spring', stiffness: 800, damping: 48 }} />}
          <span className={item.create ? 'suggest-icon create' : 'suggest-icon'}>
            <Icon name={item.icon ?? 'note'} size={state.kind === 'slash' ? 15 : 14} />
          </span>
          <span className="suggest-main">
            <span className="suggest-label">
              <Label text={item.label} matched={item.matched} />
            </span>
            {state.kind === 'link' && item.detail && <span className="suggest-detail">{item.detail}</span>}
          </span>
          {item.hint && <span className={item.create ? 'suggest-hint create' : 'suggest-hint'}>{item.hint}</span>}
        </button>
      ))}
    </motion.div>
  )
}

function Label({ text, matched }: { text: string; matched?: number[] }) {
  if (!matched?.length) return <>{text}</>
  const set = new Set(matched)
  return <>{[...text].map((ch, i) => (set.has(i) ? <mark key={i} className="match">{ch}</mark> : ch))}</>
}
