import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { Menu, type MenuState } from './Menu'

type Props = {
  editor: Editor
  /** Makes a note from the selection; resolves to the new note's title, or null if it wasn't made. */
  onExtract: (name: string, markdown: string) => Promise<string | null>
  onSearch: (text: string) => void
}

type Place = { from: number; to: number; box: { top: number; bottom: number; left: number; right: number }; oneBlock: boolean }

const BLOCKS = [
  { id: 'paragraph', label: 'Text', icon: 'text', active: (e: Editor) => e.isActive('paragraph') && !e.isActive('taskItem') && !e.isActive('listItem') && !e.isActive('blockquote'), run: (e: Editor) => e.chain().focus().clearNodes().run() },
  { id: 'h1', label: 'Heading 1', icon: 'h1', active: (e: Editor) => e.isActive('heading', { level: 1 }), run: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', icon: 'h2', active: (e: Editor) => e.isActive('heading', { level: 2 }), run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', icon: 'h3', active: (e: Editor) => e.isActive('heading', { level: 3 }), run: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'todo', label: 'To-do list', icon: 'todo', active: (e: Editor) => e.isActive('taskItem'), run: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { id: 'bullet', label: 'Bulleted list', icon: 'bullet', active: (e: Editor) => e.isActive('bulletList'), run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', icon: 'ordered', active: (e: Editor) => e.isActive('orderedList'), run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { id: 'quote', label: 'Quote', icon: 'quote', active: (e: Editor) => e.isActive('blockquote'), run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: 'Code', icon: 'code', active: (e: Editor) => e.isActive('codeBlock'), run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
]

const MARKS = [
  { mark: 'bold', icon: 'bold', title: 'Bold (⌘B)', toggle: (e: Editor) => e.chain().focus().toggleBold().run() },
  { mark: 'italic', icon: 'italic', title: 'Italic (⌘I)', toggle: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { mark: 'strike', icon: 'strike', title: 'Strikethrough (⇧⌘S)', toggle: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { mark: 'code', icon: 'source', title: 'Code (⌘E)', toggle: (e: Editor) => e.chain().focus().toggleCode().run() },
]

/** A name for a note made from some text: its first line, a few words long, without what a file name can't hold. */
function suggestName(text: string) {
  const line = text.split('\n').find((l) => l.trim()) ?? ''
  const words = line.replace(/[/:\\[\]#|^*_`>]/g, ' ').trim().split(/\s+/).slice(0, 7).join(' ')
  return words.length > 60 ? words.slice(0, 60).trimEnd() : words
}

function withScheme(url: string) {
  const trimmed = url.trim()
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('.')) return trimmed
  return /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(trimmed) ? `https://${trimmed}` : trimmed
}

/**
 * A small toolbar over selected text: what the text is (a heading, a list…), how it's styled, and what
 * to do with it in the vault: link it to a note, move it into a new note, or find it elsewhere.
 */
export function SelectionMenu({ editor, onExtract, onSearch }: Props) {
  const [place, setPlace] = useState<Place | null>(null)
  const [mode, setMode] = useState<'tools' | 'link' | 'extract'>('tools')
  const [field, setField] = useState('')
  const [menu, setMenu] = useState<MenuState>(null)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const panel = useRef<HTMLDivElement>(null)
  const pointerDown = useRef(false)
  const held = useRef(false)
  held.current = mode !== 'tools' || menu != null

  // Where the selection is, or nothing when there's no text selected in the editor.
  useEffect(() => {
    const { view } = editor
    function measure() {
      if (held.current) return
      const { selection, doc } = editor.state
      const focused = view.hasFocus()
      if (pointerDown.current || !focused || selection.empty || !(selection instanceof TextSelection) || selection.$from.parent.type.spec.code) return setPlace(null)
      if (!doc.textBetween(selection.from, selection.to, ' ').trim()) return setPlace(null)
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null
      const rect = range?.getBoundingClientRect()
      const box = rect && rect.width > 0 ? rect : (() => {
        const a = view.coordsAtPos(selection.from)
        const b = view.coordsAtPos(selection.to)
        return { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) }
      })()
      setPlace({
        from: selection.from,
        to: selection.to,
        box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
        oneBlock: selection.$from.sameParent(selection.$to),
      })
    }
    const onDown = () => {
      pointerDown.current = true
      if (!held.current) setPlace(null)
    }
    const onUp = () => {
      if (!pointerDown.current) return
      pointerDown.current = false
      requestAnimationFrame(measure)
    }
    const onBlur = ({ event }: { event: FocusEvent }) => {
      if (panel.current?.contains(event.relatedTarget as Node)) return
      if (held.current) return
      setPlace(null)
    }
    const onTransaction = () => {
      measure()
      redraw()
    }
    view.dom.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    editor.on('selectionUpdate', measure)
    editor.on('transaction', onTransaction)
    editor.on('focus', measure)
    editor.on('blur', onBlur)
    return () => {
      view.dom.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      editor.off('selectionUpdate', measure)
      editor.off('transaction', onTransaction)
      editor.off('focus', measure)
      editor.off('blur', onBlur)
    }
  }, [editor])

  // Above the selection, centred on it, kept inside the window; below it when there's no room above.
  const [pos, setPos] = useState({ left: 0, top: 0, below: false })
  useLayoutEffect(() => {
    const el = panel.current
    if (!place || !el) return
    const { width, height } = el.getBoundingClientRect()
    const centre = (place.box.left + place.box.right) / 2
    const below = place.box.top - height - 10 < 56
    setPos({
      left: Math.round(Math.max(12, Math.min(centre - width / 2, window.innerWidth - width - 12))),
      top: Math.round(below ? place.box.bottom + 10 : place.box.top - height - 10),
      below,
    })
  }, [place, mode])

  function close() {
    setMode('tools')
    setMenu(null)
  }

  function back() {
    close()
    if (place) editor.chain().focus().setTextSelection({ from: place.from, to: place.to }).run()
  }

  function startLink() {
    setField(editor.getAttributes('link').href ?? '')
    setMode('link')
  }

  function applyLink(remove = false) {
    if (!place) return
    const href = remove ? '' : withScheme(field)
    const chain = editor.chain().focus().setTextSelection({ from: place.from, to: place.to }).extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    setMode('tools')
  }

  function linkAsNote() {
    if (!place) return
    const text = editor.state.doc.textBetween(place.from, place.to, ' ')
    const target = text.replace(/[[\]#|^]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!target) return
    editor.chain().focus().insertContentAt({ from: place.from, to: place.to }, { type: 'wikilink', attrs: { target, alias: null } }).run()
  }

  function startExtract() {
    if (!place) return
    setField(suggestName(editor.state.doc.textBetween(place.from, place.to, '\n')))
    setMode('extract')
  }

  async function extract() {
    if (!place || !field.trim()) return
    const { from, to, oneBlock } = place
    const slice = editor.state.doc.slice(from, to)
    const markdown = editor.markdown?.serialize({ type: 'doc', content: slice.content.toJSON() }) ?? editor.state.doc.textBetween(from, to, '\n')
    // A line that becomes the note's name would only repeat it as the body.
    const body = markdown.trim() === field.trim() ? '' : markdown.trim()
    const made = await onExtract(field.trim(), body)
    setMode('tools')
    if (!made) return
    const link = { type: 'wikilink', attrs: { target: made, alias: null } }
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, oneBlock ? link : { type: 'paragraph', content: [link] })
      .run()
  }

  function blockMenu(event: React.MouseEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({
      x: box.left,
      y: box.bottom + 8,
      items: [
        { heading: 'Turn into' },
        ...BLOCKS.map((block) => ({
          label: block.label,
          icon: block.icon,
          checked: block.active(editor),
          onSelect: () => {
            if (place) editor.chain().focus().setTextSelection({ from: place.from, to: place.to }).run()
            block.run(editor)
          },
        })),
      ],
    })
  }

  const current = BLOCKS.find((b) => b.id !== 'paragraph' && b.active(editor)) ?? BLOCKS[0]
  const isLink = editor.isActive('link')
  const keep = (event: React.MouseEvent) => event.preventDefault()

  // In the body, not the page: the page animates with a transform, which would make `fixed` mean the page.
  return createPortal(
    <>
      <AnimatePresence>
        {place && (
          <motion.div
            ref={panel}
            className="selection-menu"
            style={{ left: pos.left, top: pos.top, transformOrigin: pos.below ? 'top center' : 'bottom center' }}
            initial={{ opacity: 0, scale: 0.96, y: pos.below ? -4 : 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 700, damping: 40 }}
            onMouseDown={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && keep(e)}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {mode === 'tools' ? (
                <motion.div key="tools" className="selection-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
                  <button className="selection-block" onClick={blockMenu} title="Turn into">
                    <span>{current.label}</span>
                    <Icon name="down" size={12} strokeWidth={1.7} />
                  </button>
                  <span className="selection-divider" />
                  {MARKS.map((m) => (
                    <button key={m.mark} className={editor.isActive(m.mark) ? 'selection-button on' : 'selection-button'} onClick={() => m.toggle(editor)} title={m.title}>
                      <Icon name={m.icon} size={15} strokeWidth={m.mark === 'bold' ? 1.9 : 1.6} />
                    </button>
                  ))}
                  <button className={isLink ? 'selection-button on' : 'selection-button'} onClick={startLink} title={isLink ? 'Edit link' : 'Add a link'}>
                    <Icon name="link" size={15} strokeWidth={1.6} />
                  </button>
                  <span className="selection-divider" />
                  {place.oneBlock && (
                    <button className="selection-button wide" onClick={linkAsNote} title="Make this a [[link]] to a note with this name">
                      <Icon name="brackets" size={15} strokeWidth={1.6} />
                      <span>Link note</span>
                    </button>
                  )}
                  <button className="selection-button wide" onClick={startExtract} title="Move this into a new note and link to it">
                    <Icon name="extract" size={15} strokeWidth={1.6} />
                    <span>New note</span>
                  </button>
                  <button
                    className="selection-button"
                    onClick={() => {
                      const text = editor.state.doc.textBetween(place.from, place.to, ' ').trim().slice(0, 80)
                      if (text) onSearch(text)
                    }}
                    title="Find this across the vault"
                  >
                    <Icon name="search" size={15} strokeWidth={1.6} />
                  </button>
                </motion.div>
              ) : (
                <motion.form
                  key={mode}
                  className="selection-row selection-field"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (mode === 'link') applyLink()
                    else extract()
                  }}
                >
                  <Icon name={mode === 'link' ? 'link' : 'extract'} size={15} strokeWidth={1.6} className="selection-field-icon" />
                  <input
                    autoFocus
                    value={field}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={mode === 'link' ? 'Paste a link…' : 'Name the new note'}
                    onChange={(e) => setField(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        back()
                      }
                    }}
                    onBlur={(e) => {
                      if (!panel.current?.contains(e.relatedTarget as Node)) {
                        close()
                        setPlace(null)
                      }
                    }}
                  />
                  {mode === 'link' && isLink && (
                    <button type="button" className="selection-text-button" onClick={() => applyLink(true)}>
                      Remove
                    </button>
                  )}
                  <button type="submit" className="selection-text-button primary" disabled={!field.trim() && mode === 'extract'}>
                    {mode === 'link' ? 'Apply' : 'Move'}
                    <kbd>↵</kbd>
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      <Menu
        menu={menu}
        onClose={() => {
          setMenu(null)
          requestAnimationFrame(() => editor.view.focus())
        }}
      />
    </>,
    document.body,
  )
}
