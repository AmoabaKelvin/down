import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const TAG = /(^|[\s(])(#[\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/gu

function tags(doc: PMNode) {
  const found: Decoration[] = []
  doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return
    for (const match of node.text!.matchAll(TAG)) {
      const from = pos + match.index! + match[1].length
      found.push(Decoration.inline(from, from + match[2].length, { class: 'tag' }))
    }
  })
  return DecorationSet.create(doc, found)
}

const tagKey = new PluginKey<DecorationSet>('tags')

/** #tags read as quiet pills, like in Obsidian and Bear. They stay plain text in the file. */
export const Tags = Extension.create({
  name: 'tags',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tagKey,
        state: { init: (_, state) => tags(state.doc), apply: (tr, old) => (tr.docChanged ? tags(tr.doc) : old) },
        props: { decorations: (state) => tagKey.getState(state) },
      }),
    ]
  },
})

const SETTLES = new Set(['taskItem', 'listItem', 'heading', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'image'])
const settleKey = new PluginKey<number[]>('settle')

/**
 * New blocks ease in. Only nodes a transaction actually inserted animate, so redraws never replay it.
 * (From Daybook.)
 */
export const Settle = Extension.create({
  name: 'settle',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: settleKey,
        state: {
          init: () => [],
          apply(tr) {
            if (!tr.docChanged) return []
            const fresh: number[] = []
            tr.mapping.maps.forEach((map, index) => {
              const rest = tr.mapping.slice(index + 1)
              map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                if (newEnd <= newStart) return
                const from = rest.map(newStart, -1)
                const to = Math.min(rest.map(newEnd, 1), tr.doc.content.size)
                tr.doc.nodesBetween(from, to, (node, pos) => {
                  if (pos >= from && SETTLES.has(node.type.name)) fresh.push(pos)
                })
              })
            })
            return fresh
          },
        },
        view: () => ({
          update(view) {
            const fresh = settleKey.getState(view.state) ?? []
            if (fresh.length > 40 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
            fresh.forEach((pos, i) => {
              const dom = view.nodeDOM(pos)
              if (!(dom instanceof HTMLElement)) return
              dom.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], {
                duration: 280,
                delay: Math.min(i, 10) * 35,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'backwards',
              })
            })
          },
        }),
      }),
    ]
  },
})
