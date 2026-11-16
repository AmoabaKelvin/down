import type { Editor as TiptapEditor } from '@tiptap/core'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NoteMeta } from '../lib/api'
import { folderOf, relativeTime, title } from '../lib/vault'
import { Editor } from './Editor'
import { Icon } from './Icon'

type Props = {
  path: string
  body: string
  rev: number
  source: boolean
  /** A new note starts in its title, with the name selected. */
  fresh: boolean
  meta: NoteMeta | undefined
  words: number
  backlinks: NoteMeta[]
  onChange: (body: string) => void
  onReady: (editor: TiptapEditor | null) => void
  onRename: (name: string) => Promise<boolean>
  onLink: (href: string, kind: 'wiki' | 'href') => void
  onOpen: (path: string) => void
  onError: (message: string) => void
  onExtract: (name: string, markdown: string) => Promise<string | null>
  onSearch: (text: string) => void
}

export function NoteView({ path, body, rev, source, fresh, meta, words, backlinks, onChange, onReady, onRename, onLink, onOpen, onError, onExtract, onSearch }: Props) {
  const editor = useRef<TiptapEditor | null>(null)
  const sourceBox = useRef<HTMLTextAreaElement>(null)
  const ready = (instance: TiptapEditor | null) => {
    editor.current = instance
    onReady(instance)
  }

  function focusBody() {
    if (source) sourceBox.current?.focus()
    else editor.current?.commands.focus('start')
  }

  const folder = folderOf(path)

  return (
    <>
      <header className="note-header">
        <TitleField key={path} name={title(path)} fresh={fresh} onRename={onRename} onEnter={focusBody} />
        <div className="note-meta">
          {folder && (
            <span className="meta-folder">
              <Icon name="folder" size={13} />
              {folder.split('/').join(' / ')}
            </span>
          )}
          {meta && meta.modified > 0 && <span>Edited {relativeTime(meta.modified)}</span>}
          <span>
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
          </span>
        </div>
      </header>

      {source ? (
        <textarea
          ref={sourceBox}
          key={`${path}:${rev}:source`}
          className="source"
          defaultValue={body}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={!fresh}
          spellCheck={false}
          placeholder="Plain markdown…"
        />
      ) : (
        <Editor
          key={`${path}:${rev}`}
          path={path}
          initial={body}
          onChange={onChange}
          onReady={ready}
          onLink={onLink}
          onError={onError}
          onExtract={onExtract}
          onSearch={onSearch}
          autofocus={!fresh}
        />
      )}

      <AnimatePresence initial={false}>
        {backlinks.length > 0 && (
          <motion.section className="backlinks" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="backlinks-label">
              <Icon name="backlink" size={13} />
              {backlinks.length === 1 ? '1 note links here' : `${backlinks.length} notes link here`}
            </div>
            <div className="backlinks-list">
              {backlinks.map((note) => (
                <button key={note.path} className="backlink" onClick={() => onOpen(note.path)}>
                  <span className="backlink-title">{title(note.path)}</span>
                  {note.excerpt && <span className="backlink-excerpt">{note.excerpt}</span>}
                </button>
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}

/** The note's name, as its title. Changing it renames the file. */
function TitleField({ name, fresh, onRename, onEnter }: { name: string; fresh: boolean; onRename: (name: string) => Promise<boolean>; onEnter: () => void }) {
  const [value, setValue] = useState(name)
  const box = useRef<HTMLTextAreaElement>(null)
  // Return and the blur after it both commit; only the first one renames.
  const sent = useRef<string | null>(null)

  useEffect(() => {
    setValue(name)
    sent.current = null
  }, [name])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  useEffect(() => {
    if (!fresh) return
    const el = box.current
    el?.focus()
    el?.select()
  }, [fresh])

  async function commit() {
    const next = value.replace(/\s+/g, ' ').trim()
    if (!next || next === name) return setValue(name)
    if (next === sent.current) return
    sent.current = next
    if (!(await onRename(next))) {
      sent.current = null
      setValue(name)
    }
  }

  return (
    <textarea
      ref={box}
      className="note-title"
      value={value}
      rows={1}
      spellCheck={false}
      placeholder="Untitled"
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && box.current?.selectionStart === value.length)) {
          e.preventDefault()
          commit()
          onEnter()
        } else if (e.key === 'Escape') {
          setValue(name)
          box.current?.blur()
        }
      }}
    />
  )
}
