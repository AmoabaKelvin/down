import type { Index, NoteMeta } from './api'

export type FolderNode = { kind: 'folder'; path: string; name: string; children: TreeNode[]; count: number }
export type NoteNode = { kind: 'note'; path: string; name: string; meta: NoteMeta }
export type TreeNode = FolderNode | NoteNode

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** A note's title: its file name without ".md". */
export function title(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

/** The folder something is in, "" for the vault itself. */
export function folderOf(path: string) {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

export function nameOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Every folder above a path, outermost first. */
export function ancestors(path: string) {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** The path something has after `from` moved to `to`, for it or anything inside it. */
export function remap(path: string, from: string, to: string) {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length)
  return path
}

export function isInside(path: string, folder: string) {
  return path === folder || path.startsWith(`${folder}/`)
}

/** Folders first, then notes, each in natural order ("Note 2" before "Note 10"). */
export function buildTree(index: Index): FolderNode {
  const root: FolderNode = { kind: 'folder', path: '', name: index.name, children: [], count: 0 }
  const folders = new Map<string, FolderNode>([['', root]])
  const folderFor = (path: string): FolderNode => {
    const known = folders.get(path)
    if (known) return known
    const node: FolderNode = { kind: 'folder', path, name: nameOf(path), children: [], count: 0 }
    folders.set(path, node)
    folderFor(folderOf(path)).children.push(node)
    return node
  }
  for (const folder of index.folders) folderFor(folder)
  for (const meta of index.notes) folderFor(folderOf(meta.path)).children.push({ kind: 'note', path: meta.path, name: title(meta.path), meta })
  const sort = (node: FolderNode): number => {
    node.children.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1))
    node.count = node.children.reduce((sum, child) => sum + (child.kind === 'folder' ? sort(child) : 1), 0)
    return node.count
  }
  sort(root)
  return root
}

/** Notes in the order the sidebar shows them, with folders opened or not. */
export function visibleNotes(node: FolderNode, expanded: Set<string>): string[] {
  return node.children.flatMap((child) =>
    child.kind === 'note' ? [child.path] : expanded.has(child.path) ? visibleNotes(child, expanded) : [],
  )
}

/** Splits "Note#Heading|Alias" into its parts. */
export function parseTarget(raw: string) {
  const [beforeAlias, alias] = raw.split('|', 2)
  const [target, heading] = beforeAlias.split('#', 2)
  return { target: target.trim(), heading: heading?.trim() || null, alias: alias?.trim() || null }
}

/**
 * Which note a [[link]] means, the way Obsidian reads it: a path if it has one, otherwise the note
 * with that name, preferring one in the same folder as the link, then the shallowest.
 */
export function resolveLink(target: string, from: string | null, index: Index | null): string | null {
  if (!index || !target) return null
  const wanted = target.replace(/\.md$/i, '').toLowerCase()
  if (wanted.includes('/')) {
    const exact = index.notes.find((n) => n.path.slice(0, -3).toLowerCase() === wanted)
    if (exact) return exact.path
    const ending = index.notes.filter((n) => n.path.slice(0, -3).toLowerCase().endsWith(`/${wanted}`))
    return ending[0]?.path ?? null
  }
  const named = index.notes.filter((n) => title(n.path).toLowerCase() === wanted)
  if (named.length <= 1) return named[0]?.path ?? null
  const here = from ? folderOf(from) : ''
  return (named.find((n) => folderOf(n.path) === here) ?? named.sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0]).path
}

/** Notes that link to this one, by [[name]] or by a markdown link. */
export function backlinks(path: string, index: Index | null): NoteMeta[] {
  if (!index) return []
  return index.notes.filter(
    (note) => note.path !== path && (note.links.includes(path) || note.wikilinks.some((target) => resolveLink(target, note.path, index) === path)),
  )
}

/** A path relative to a folder, as a markdown link writes it. */
export function relativePath(fromFolder: string, to: string) {
  const from = fromFolder ? fromFolder.split('/') : []
  const parts = to.split('/')
  let shared = 0
  while (shared < from.length && shared < parts.length - 1 && from[shared] === parts[shared]) shared++
  return [...from.slice(shared).map(() => '..'), ...parts.slice(shared)].join('/')
}

/** A markdown link's path made into a vault path, from the folder of the note it's in. */
export function joinPath(folder: string, rel: string) {
  const parts = rel.startsWith('/') ? [] : folder.split('/').filter(Boolean)
  for (const part of decodeURIComponent(rel).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

export type Match = { score: number; indices: number[] }

/**
 * Fuzzy match of a query against text: every character in order, scored higher for matches at the
 * start of words and runs of consecutive characters. Null when it doesn't match.
 */
export function fuzzy(query: string, text: string): Match | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, indices: [] }
  const t = text.toLowerCase()
  const contains = t.indexOf(query.toLowerCase().trim())
  if (contains >= 0) {
    const length = query.trim().length
    const atWord = contains === 0 || /[\s\-_/.]/.test(t[contains - 1])
    return { score: 1000 - contains + (atWord ? 400 : 0) - t.length, indices: Array.from({ length }, (_, i) => contains + i) }
  }
  const indices: number[] = []
  let score = 0
  let ti = 0
  // Letters picked from the middle of words, far apart, aren't a match anyone means ("repl" in "Designing").
  let stray = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    const atWord = found === 0 || /[\s\-_/.]/.test(t[found - 1])
    const follows = indices.length > 0 && found === indices[indices.length - 1] + 1
    if (!atWord && !follows) stray++
    score += atWord ? 30 : 0
    score += follows ? 20 : 0
    score -= found - ti
    indices.push(found)
    ti = found + 1
  }
  if (stray > 1) return null
  return { score: score - t.length * 0.5, indices }
}

export function relativeTime(ms: number) {
  const seconds = (Date.now() - ms) / 1000
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const date = new Date(ms)
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}
