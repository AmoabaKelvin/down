import { Extension, InputRule, type Editor as TiptapEditor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { memo, useEffect, useRef } from 'react'
import { Settle, Tags } from '../editor/decorations'
import { VaultImage } from '../editor/image'
import { SlashMenu } from '../editor/slash'
import { WikiLink, WikiLinkSuggest } from '../editor/wikilink'
import { saveAttachment } from '../lib/api'
import { tidyMarkdown } from '../lib/markdown'
import { folderOf, relativePath } from '../lib/vault'

type Props = {
  /** The note it's editing, which pasted images are placed relative to. */
  path: string
  initial: string
  onChange: (markdown: string) => void
  onReady: (editor: TiptapEditor | null) => void
  /** A link was clicked: a [[target]], a path to a note, or a web address. */
  onLink: (href: string, kind: 'wiki' | 'href') => void
  onError: (message: string) => void
  autofocus: boolean
}

/** Typing "[ ] " in a bullet turns the list into a task list, so "- [ ] " works as it does in markdown. */
const BulletToTask = Extension.create({
  name: 'bulletToTask',
  priority: 200,
  addInputRules() {
    return [
      new InputRule({
        find: /^\[( |x)?\]\s$/,
        handler: ({ state, range, chain, match }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.depth < 2 || $from.node(-1).type.name !== 'listItem') return null
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .command(({ tr }) => {
              if (match[1] === 'x') tr.setNodeAttribute(tr.selection.$from.before(-1), 'checked', true)
              return true
            })
            .run()
        },
      }),
    ]
  },
})

const IMAGE_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' }

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export const Editor = memo(function Editor({ path, initial, onChange, onReady, onLink, onError, autofocus }: Props) {
  // StrictMode can build a spare editor that is never shown; only the live one may save.
  const live = useRef<TiptapEditor | null>(null)
  const handlers = useRef({ onLink, onError, path })
  useEffect(() => {
    handlers.current = { onLink, onError, path }
  })

  /** Saves pasted or dropped images into the vault and puts them in the note. */
  async function insertImages(view: EditorView, files: File[], at?: number) {
    for (const file of files) {
      try {
        const ext = IMAGE_TYPES[file.type] ?? '.png'
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, (c) => (c === 'T' ? ' ' : '.'))
        const name = file.name && file.name !== 'image.png' ? file.name : `Pasted image ${stamp}${ext}`
        const saved = await saveAttachment(name, await toBase64(file))
        const src = relativePath(folderOf(handlers.current.path), saved).split('/').map(encodeURIComponent).join('/')
        const node = view.state.schema.nodes.image.create({ src, alt: '' })
        const pos = at ?? view.state.selection.from
        view.dispatch(view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node))
      } catch (error) {
        handlers.current.onError(`Couldn't add the image: ${error}`)
      }
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: null } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      VaultImage,
      WikiLink,
      WikiLinkSuggest,
      SlashMenu,
      Tags,
      Placeholder.configure({
        placeholder: ({ node, editor }) => (node.type.name === 'heading' ? 'Heading' : editor.isEmpty ? 'Start writing, or press / for blocks and [[ to link a note…' : ''),
        showOnlyCurrent: true,
      }),
      Markdown,
      BulletToTask,
      Settle,
    ],
    content: initial,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement
        const wiki = target.closest<HTMLElement>('[data-wikilink]')
        if (wiki && event.button === 0) {
          handlers.current.onLink(wiki.dataset.target ?? '', 'wiki')
          return true
        }
        const anchor = target.closest('a[href]')
        if (anchor && event.button === 0) {
          handlers.current.onLink(anchor.getAttribute('href') ?? '', 'href')
          return true
        }
        return false
      },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        insertImages(view, files)
        return true
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        insertImages(view, files, at)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      if (editor === live.current) onChange(tidyMarkdown(editor.getMarkdown()))
    },
  })

  useEffect(() => {
    live.current = editor
    onReady(editor)
    return () => onReady(null)
  }, [editor, onReady])

  // Tiptap's own autofocus breaks on a note that starts with a task: focusing moves the DOM
  // selection mid-command, so the command's transaction is stale by the time it's dispatched.
  // Setting the selection first and focusing after avoids that.
  useEffect(() => {
    if (!editor || !autofocus) return
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return
      const { state, view } = editor
      view.dispatch(state.tr.setSelection(TextSelection.atStart(state.doc)).setMeta('addToHistory', false))
      view.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [editor, autofocus])

  return <EditorContent editor={editor} />
})
