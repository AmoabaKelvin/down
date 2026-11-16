import type { Editor } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { diff3Merge } from 'node-diff3'

/** A note split into its YAML front matter, which the editor never sees, and the body it edits. */
export function splitFrontMatter(markdown: string) {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)
  if (!match) return { front: '', body: markdown }
  const rest = markdown.slice(match[0].length)
  const gap = /^(?:[ \t]*\r?\n)*/.exec(rest)![0]
  return { front: match[0] + gap, body: rest.slice(gap.length) }
}

export function joinFrontMatter(front: string, body: string) {
  if (!front) return body
  return front.endsWith('\n') ? front + body : `${front}\n${body}`
}

/** Editor output collapses runs of blank lines left by empty paragraphs. */
export function tidyMarkdown(markdown: string) {
  return markdown.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Three-way merge of a note edited here (local) and on disk (remote), from the version both started
 * at. Where both changed the same lines, ours win and lines only the disk had are kept after them.
 */
export function mergeMarkdown(local: string, base: string, remote: string) {
  return diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'))
    .flatMap((region) => {
      if (region.ok) return region.ok
      const { a, b } = region.conflict!
      return [...a, ...b.filter((line) => !a.includes(line))]
    })
    .join('\n')
}

/** Replaces only the part of the document that differs, so the cursor and undo history survive. */
export function applyMarkdown(editor: Editor, markdown: string) {
  const json = editor.markdown?.parse(markdown)
  if (!json) return
  const { state } = editor
  const next = state.schema.nodeFromJSON(json)
  const start = state.doc.content.findDiffStart(next.content)
  if (start == null) return
  const end = state.doc.content.findDiffEnd(next.content)!
  let { a: endOld, b: endNew } = end
  const overlap = start - Math.min(endOld, endNew)
  if (overlap > 0) {
    endOld += overlap
    endNew += overlap
  }
  editor.view.dispatch(state.tr.replace(start, endOld, next.slice(start, endNew)))
}

const PUNCTUATION = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u

/**
 * Escapes only what would change meaning when the note is read back, so plain text stays plain:
 * "snake_case", "5 * 3", "C:\Users" and "a < b" are written as they are, not as "snake\_case".
 */
export function escapeText(text: string) {
  let out = ''
  const tildes = (text.match(/~/g) ?? []).length
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const prev = text[i - 1] ?? ' '
    const next = text[i + 1] ?? ' '
    const rest = text.slice(i)
    switch (c) {
      case '\\':
        out += PUNCTUATION.test(next) ? '\\\\' : '\\'
        break
      case '`':
        out += '\\`'
        break
      case '*':
        out += /\s/.test(prev) && /\s/.test(next) ? '*' : '\\*'
        break
      case '_':
        out += (WORD.test(prev) && WORD.test(next)) || (/\s/.test(prev) && /\s/.test(next)) ? '_' : '\\_'
        break
      case '~':
        out += tildes > 1 ? '\\~' : '~'
        break
      case '[':
        out += next === '[' || prev === '[' || /^\[[^\]]*\]\s?[([:]/.test(rest) ? '\\[' : '['
        break
      case ']':
        out += next === ']' || prev === ']' ? '\\]' : ']'
        break
      case '<':
        out += /[A-Za-z/!?]/.test(next) ? '&lt;' : '<'
        break
      case '&':
        out += /^&(#\d+|#x[\da-f]+|\w+);/i.test(rest) ? '&amp;' : '&'
        break
      default:
        out += c
    }
  }
  return out
}

type CodeAware = { codeTypes: Set<string> }
type TextNode = { marks?: (string | { type: string })[] }

// The stock serializer escapes every *, _, [ and ] it meets, which rewrites ordinary notes on save.
const proto = MarkdownManager.prototype as unknown as {
  encodeTextForMarkdown: (this: CodeAware, text: string, node: TextNode, parent?: { type?: string }) => string
}
proto.encodeTextForMarkdown = function (text, node, parent) {
  const inCode = (parent?.type != null && this.codeTypes.has(parent.type)) || (node.marks ?? []).some((m) => this.codeTypes.has(typeof m === 'string' ? m : m.type))
  return inCode ? text : escapeText(text)
}
