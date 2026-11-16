import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { fuzzy } from '../lib/vault'
import { suggestRenderer, type SuggestItem } from './suggest'

type Block = SuggestItem & { keywords: string; run: (editor: Editor, range: Range) => void }

const BLOCKS: Block[] = [
  { id: 'text', label: 'Text', icon: 'text', keywords: 'paragraph plain', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: 'h1', label: 'Heading 1', icon: 'h1', hint: '#', keywords: 'title big', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', icon: 'h2', hint: '##', keywords: 'subtitle', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', icon: 'h3', hint: '###', keywords: 'small', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: 'todo', label: 'To-do list', icon: 'todo', hint: '[ ]', keywords: 'task check box', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { id: 'bullet', label: 'Bulleted list', icon: 'bullet', hint: '-', keywords: 'unordered points', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', icon: 'ordered', hint: '1.', keywords: 'ordered steps', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: 'quote', label: 'Quote', icon: 'quote', hint: '>', keywords: 'blockquote callout', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: 'code', label: 'Code', icon: 'code', hint: '```', keywords: 'snippet pre', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  {
    id: 'table',
    label: 'Table',
    icon: 'table',
    keywords: 'grid rows columns',
    run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: 'divider', label: 'Divider', icon: 'divider', hint: '---', keywords: 'rule line separator hr', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: 'link', label: 'Link to a note', icon: 'link', hint: '[[', keywords: 'wiki reference', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('[[').run() },
]

function blockItems(query: string): SuggestItem[] {
  if (!query) return BLOCKS
  return BLOCKS.flatMap((block) => {
    const byLabel = fuzzy(query, block.label)
    const byWord = block.keywords.split(' ').some((word) => word.startsWith(query.toLowerCase()))
    if (!byLabel && !byWord) return []
    return [{ block, score: byLabel ? byLabel.score + 100 : 0, matched: byLabel?.indices ?? [] }]
  })
    .sort((a, b) => b.score - a.score)
    .map(({ block, matched }) => ({ ...block, matched }))
}

const slashKey = new PluginKey('slash')

/** "/" opens a menu of blocks: headings, lists, quotes, code, tables. */
export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestItem, SuggestItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        startOfLine: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          return !$from.parent.type.spec.code
        },
        items: ({ query }) => blockItems(query),
        command: ({ editor, range, props }) => BLOCKS.find((b) => b.id === props.id)?.run(editor, range),
        render: suggestRenderer('slash'),
      }),
    ]
  },
})
