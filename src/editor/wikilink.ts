import { Extension, Node, nodeInputRule, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { folderOf, fuzzy, parseTarget, resolveLink, title } from '../lib/vault'
import { LINKS_CHANGED, resolves, vaultContext } from './context'
import { suggestRenderer, type SuggestItem } from './suggest'

/** "Projects/Plan#Goals" reads as "Plan › Goals". */
export function linkLabel(target: string, alias: string | null) {
  if (alias) return alias
  const { target: note, heading } = parseTarget(target)
  const name = note.slice(note.lastIndexOf('/') + 1) || note
  return heading ? (name ? `${name} › ${heading}` : heading) : name
}

function format(target: string, alias: string | null) {
  return `[[${target}${alias ? `|${alias}` : ''}]]`
}

const TOKEN = /^\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/

/**
 * `[[Note]]`, `[[Note#Heading]]` and `[[Note|shown as]]`: a link to another note in the vault, kept
 * in the file exactly as written. It reads as one word; backspace opens it back up for editing.
 */
export const WikiLink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { target: { default: '' }, alias: { default: null } }
  },

  parseHTML() {
    return [{ tag: 'a[data-wikilink]', getAttrs: (el) => ({ target: el.getAttribute('data-target') ?? '', alias: el.getAttribute('data-alias') }) }]
  },

  renderHTML({ node }) {
    const { target, alias } = node.attrs
    return ['a', { 'data-wikilink': '', 'data-target': target, ...(alias ? { 'data-alias': alias } : {}), class: 'wikilink' }, linkLabel(target, alias)]
  },

  renderText({ node }) {
    return format(node.attrs.target, node.attrs.alias)
  },

  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize(src: string) {
      const match = TOKEN.exec(src)
      if (!match) return undefined
      return { type: 'wikilink', raw: match[0], target: match[1].trim(), alias: match[2]?.trim() ?? null }
    },
  },

  parseMarkdown: (token, h) => h.createNode('wikilink', { target: token.target, alias: token.alias ?? null }),

  renderMarkdown: (node) => format(node.attrs?.target ?? '', node.attrs?.alias ?? null),

  addNodeView() {
    return ({ node: initial }) => {
      let node = initial
      const dom = document.createElement('a')
      dom.setAttribute('data-wikilink', '')
      const draw = () => {
        const { target, alias } = node.attrs
        dom.textContent = linkLabel(target, alias)
        dom.dataset.target = target
        dom.className = resolves(parseTarget(target).target) || !parseTarget(target).target ? 'wikilink' : 'wikilink unresolved'
        dom.title = resolves(parseTarget(target).target) ? target : `${target} · not written yet, click to make it`
      }
      draw()
      window.addEventListener(LINKS_CHANGED, draw)
      return {
        dom,
        update: (updated) => {
          if (updated.type !== node.type) return false
          node = updated
          draw()
          return true
        },
        destroy: () => window.removeEventListener(LINKS_CHANGED, draw),
      }
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]$/,
        type: this.type,
        getAttributes: (match) => ({ target: match[1].trim(), alias: match[2]?.trim() ?? null }),
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      // Backspace into a link opens it back up as text, with the suggestions showing again.
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        if (!selection.empty) return false
        const before = selection.$from.nodeBefore
        if (before?.type.name !== this.name) return false
        const { target, alias } = before.attrs
        const from = selection.from - before.nodeSize
        return editor.chain().insertContentAt({ from, to: selection.from }, `[[${target}${alias ? `|${alias}` : ''}`).run()
      },
    }
  },
})

const linkKey = new PluginKey('wikilinkSuggest')

/** Notes for the [[ menu: by title, recent ones first when nothing's typed, and a "new note" choice. */
function linkItems(query: string): SuggestItem[] {
  const index = vaultContext.index
  if (!index) return []
  const { target, heading } = parseTarget(query)
  const scored = index.notes
    .filter((n) => n.path !== vaultContext.note)
    .flatMap((n) => {
      const name = title(n.path)
      const match = target ? fuzzy(target, name) : { score: n.modified / 1e12, indices: [] }
      return match ? [{ n, name, match }] : []
    })
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 8)
  const items: SuggestItem[] = scored.map(({ n, name, match }) => ({
    id: n.path,
    label: heading != null ? `${name} › ${heading}` : name,
    hint: folderOf(n.path) || undefined,
    detail: n.excerpt || undefined,
    matched: match.indices,
    icon: 'note',
  }))
  const exact = target && resolveLink(target, vaultContext.note, index)
  if (target && !exact) items.push({ id: `new:${target}`, label: target, hint: 'New note', icon: 'plus', create: true })
  return items
}

/** The link text for a picked note: just its name, unless another note shares it. */
function targetFor(item: SuggestItem, query: string) {
  if (item.create) return query.trim()
  const index = vaultContext.index
  const name = title(item.id)
  const { heading } = parseTarget(query)
  const unique = resolveLink(name, vaultContext.note, index) === item.id
  const target = unique ? name : item.id.slice(0, -3)
  return heading != null ? `${target}#${heading}` : target
}

export const WikiLinkSuggest = Extension.create({
  name: 'wikilinkSuggest',
  addProseMirrorPlugins() {
    let query = ''
    return [
      Suggestion<SuggestItem, SuggestItem>({
        editor: this.editor,
        pluginKey: linkKey,
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        items: ({ query: q }) => {
          query = q
          return linkItems(q)
        },
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SuggestItem }) => {
          // Swallow a closing "]]" typed ahead or left from editing, so it doesn't double up.
          const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 2, editor.state.doc.content.size - 1))
          const to = after === ']]' ? range.to + 2 : range.to
          const { alias } = parseTarget(query)
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to }, [{ type: 'wikilink', attrs: { target: targetFor(props, query), alias } }, { type: 'text', text: ' ' }])
            .run()
        },
        render: suggestRenderer('link'),
      }),
    ]
  },
})
