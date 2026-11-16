import Image from '@tiptap/extension-image'
import { fileUrl } from '../lib/native'
import { folderOf, joinPath } from '../lib/vault'
import { vaultContext } from './context'

/** Where an image's src points: the web as it is, a path in the vault through the app. */
export function imageUrl(src: string) {
  if (/^(https?:|data:|blob:)/.test(src)) return src
  const path = joinPath(folderOf(vaultContext.note ?? ''), src.replace(/^<|>$/g, ''))
  return fileUrl(vaultContext.root, path)
}

/** Images keep their path as written in the note, and are shown from the vault. */
export const VaultImage = Image.extend({
  addNodeView() {
    return ({ node: initial }) => {
      let node = initial
      const dom = document.createElement('img')
      dom.className = 'note-image'
      dom.draggable = false
      const draw = () => {
        dom.src = imageUrl(node.attrs.src ?? '')
        dom.alt = node.attrs.alt ?? ''
        if (node.attrs.title) dom.title = node.attrs.title
      }
      draw()
      return {
        dom,
        update: (updated) => {
          if (updated.type !== node.type) return false
          node = updated
          draw()
          return true
        },
      }
    }
  },
}).configure({ inline: false, allowBase64: true })
