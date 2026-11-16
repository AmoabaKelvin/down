// The app's commands for `pnpm dev` in a browser, against a real folder. The Mac app uses the Rust
// versions in src-tauri; these follow them closely enough to work on the UI.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

let vault: string | null = process.env.DOWN_VAULT ?? null
const recent = new Set<string>(vault ? [vault] : [])
const trashDir = path.join(os.tmpdir(), 'down-dev-trash')
const written = new Map<string, string>()
const clients = new Set<ServerResponse>()

const tilde = (p: string) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p)

function info() {
  return {
    path: vault,
    name: vault ? path.basename(vault) : null,
    recent: [...recent].filter((p) => fs.existsSync(p)).map((p) => ({ path: p, name: path.basename(p), display: tilde(p) })),
    home: os.homedir(),
  }
}

function root() {
  if (!vault) throw new Error('No vault is open.')
  return vault
}

function resolve(rel: string) {
  const full = path.resolve(root(), rel)
  if (full !== root() && !full.startsWith(root() + path.sep)) throw new Error(`not a path inside the vault: ${rel}`)
  return full
}

const hidden = (name: string) => name.startsWith('.') || name === 'node_modules'

function wikilinks(content: string) {
  return [...content.matchAll(/\[\[([^[\]|#\n]+)(?:[#|][^[\]\n]*)?\]\]/g)].map((m) => m[1].trim())
}

function excerpt(content: string) {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || /^(#|```|---|\|)/.test(line)) continue
    const text = line.replace(/^[-*+> ]+/, '').replace(/^\[[ x]\] /, '').replace(/[*_`]/g, '').replace(/\[\[|\]\]/g, '')
    if (text.trim()) return text.slice(0, 140)
  }
  return ''
}

function index() {
  const folders: string[] = []
  const notes: object[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (hidden(entry.name)) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root(), full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        folders.push(rel)
        walk(full)
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf8')
        const stat = fs.statSync(full)
        notes.push({ path: rel, modified: stat.mtimeMs, created: stat.birthtimeMs, size: stat.size, wikilinks: wikilinks(content), links: [], excerpt: excerpt(content) })
      }
    }
  }
  walk(root())
  return { name: path.basename(root()), root: root(), folders: folders.sort(), notes }
}

function freeName(dir: string, stem: string, ext: string) {
  const names = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => n.toLowerCase()) : [])
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}${ext}` : `${stem} ${n}${ext}`
    if (!names.has(name.toLowerCase())) return name
  }
}

const clean = (name: string) => name.replace(/[/:\\[\]#|^]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim()
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)
const stemOf = (rel: string) => path.basename(rel).replace(/\.md$/i, '')

function write(rel: string, content: string) {
  const body = content && !content.endsWith('\n') ? `${content}\n` : content
  fs.mkdirSync(path.dirname(resolve(rel)), { recursive: true })
  fs.writeFileSync(resolve(rel), body)
  written.set(rel, body)
  return body
}

function relink(oldRel: string, newRel: string) {
  const updated: string[] = []
  const oldStem = stemOf(oldRel).toLowerCase()
  const newStem = stemOf(newRel)
  for (const note of index().notes as { path: string }[]) {
    const content = fs.readFileSync(resolve(note.path), 'utf8')
    const next = content.replace(/\[\[([^[\]|#\n]+)([#|][^[\]\n]*)?\]\]/g, (all, target: string, rest = '') =>
      target.trim().toLowerCase() === oldStem ? `[[${newStem}${rest}]]` : all,
    )
    if (next !== content) {
      write(note.path, next)
      updated.push(note.path)
    }
  }
  return updated
}

function search(query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: { path: string; snippet: string; count: number }[] = []
  for (const note of index().notes as { path: string }[]) {
    const body = fs.readFileSync(resolve(note.path), 'utf8').replace(/^---\n[\s\S]*?\n---\n?/, '')
    const count = body.toLowerCase().split(needle).length - 1
    if (!count) continue
    const line = body.split('\n').find((l) => l.toLowerCase().includes(needle))!.trim().replace(/^[#\-*> ]+/, '')
    const at = Math.max(0, line.toLowerCase().indexOf(needle) - 40)
    hits.push({ path: note.path, snippet: (at ? '…' : '') + line.slice(at, at + 110) + (line.length > at + 110 ? '…' : ''), count })
  }
  return hits.sort((a, b) => b.count - a.count).slice(0, 40)
}

let watcher: fs.FSWatcher | null = null
let queued = new Set<string>()
let timer: NodeJS.Timeout | undefined

function watch() {
  watcher?.close()
  if (!vault) return
  watcher = fs.watch(vault, { recursive: true }, (_event, file) => {
    if (!file || file.split(path.sep).some(hidden)) return
    queued.add(file.split(path.sep).join('/'))
    clearTimeout(timer)
    timer = setTimeout(() => {
      const files = [...queued]
      queued = new Set()
      const notes = []
      let structure = false
      for (const rel of files) {
        let content: string | null = null
        try {
          content = fs.statSync(resolve(rel)).isFile() ? fs.readFileSync(resolve(rel), 'utf8') : null
        } catch {
          content = null
        }
        if (!rel.endsWith('.md')) {
          structure = true
          continue
        }
        if (content != null && written.get(rel) === content) continue
        if (content == null) structure = true
        notes.push({ path: rel, content })
      }
      if (!notes.length && !structure) return
      const data = `data: ${JSON.stringify({ notes, structure })}\n\n`
      clients.forEach((client) => client.write(data))
    }, 160)
  })
}
watch()

type Args = Record<string, string | null>

const commands: Record<string, (args: Args) => unknown> = {
  get_vault: () => info(),
  open_vault: ({ path: p }) => {
    if (!fs.existsSync(p!) || !fs.statSync(p!).isDirectory()) throw new Error(`${p} isn't a folder.`)
    vault = path.resolve(p!)
    recent.add(vault)
    watch()
    return info()
  },
  create_vault: ({ parent, name }) => {
    const p = path.join(parent!, clean(name!))
    fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, 'Welcome.md'), 'A fresh vault.\n')
    vault = p
    recent.add(p)
    watch()
    return info()
  },
  close_vault: () => {
    vault = null
    return info()
  },
  forget_vault: ({ path: p }) => {
    recent.delete(p!)
    return info()
  },
  vault_index: () => index(),
  read_note: ({ path: p }) => fs.readFileSync(resolve(p!), 'utf8'),
  save_note: ({ path: p, content }) => void write(p!, content!),
  create_note: ({ folder, name, content }) => {
    const rel = join(folder!, freeName(resolve(folder!), clean(name!) || 'Untitled', '.md'))
    write(rel, content ?? '')
    return rel
  },
  create_folder: ({ parent, name }) => {
    const rel = join(parent!, freeName(resolve(parent!), clean(name!) || 'New folder', ''))
    fs.mkdirSync(resolve(rel), { recursive: true })
    return rel
  },
  rename_entry: ({ path: p, name }) => {
    const isDir = fs.statSync(resolve(p!)).isDirectory()
    const file = isDir ? clean(name!) : `${clean(name!)}.md`
    const to = join(path.posix.dirname(p!) === '.' ? '' : path.posix.dirname(p!), file)
    if (to !== p && fs.existsSync(resolve(to)) && to.toLowerCase() !== p!.toLowerCase()) throw new Error(`There's already something called “${clean(name!)}” here.`)
    fs.renameSync(resolve(p!), resolve(to))
    return { path: to, updated: isDir ? [] : relink(p!, to) }
  },
  move_entry: ({ path: p, folder }) => {
    if (folder === p || folder!.startsWith(`${p}/`)) throw new Error("A folder can't go inside itself.")
    const to = join(folder!, path.posix.basename(p!))
    if (fs.existsSync(resolve(to))) throw new Error(`There's already something called “${stemOf(p!)}” in there.`)
    fs.renameSync(resolve(p!), resolve(to))
    return { path: to, updated: [] }
  },
  trash_entry: ({ path: p }) => {
    fs.mkdirSync(trashDir, { recursive: true })
    const at = path.join(trashDir, `${Date.now()}-${path.basename(p!)}`)
    fs.renameSync(resolve(p!), at)
    return at
  },
  restore_entry: ({ trashed, path: p }) => {
    if (fs.existsSync(resolve(p!))) throw new Error('Something else has its place now.')
    fs.renameSync(trashed!, resolve(p!))
  },
  search_vault: ({ query }) => search(query!),
  save_attachment: ({ name, data }) => {
    const dir = resolve('attachments')
    fs.mkdirSync(dir, { recursive: true })
    const ext = path.extname(name!) || '.png'
    const file = freeName(dir, clean(path.basename(name!, ext)), ext)
    fs.writeFileSync(path.join(dir, file), Buffer.from(data!, 'base64'))
    return `attachments/${file}`
  },
  reveal: () => undefined,
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export function downApi(): Plugin {
  return {
    name: 'down-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()
        const name = url.pathname.slice(5)
        try {
          if (name === 'events') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
            res.write(': ok\n\n')
            clients.add(res)
            req.on('close', () => clients.delete(res))
            return
          }
          if (name === 'file') {
            const file = resolve(url.searchParams.get('path') ?? '')
            res.setHeader('Content-Type', { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
            return res.end(fs.readFileSync(file))
          }
          const command = commands[name]
          if (!command) return next()
          const text = await body(req)
          const result = await command(text ? JSON.parse(text) : {})
          res.setHeader('Content-Type', 'application/json')
          res.end(result === undefined ? '' : JSON.stringify(result))
        } catch (error) {
          res.statusCode = 400
          res.end(error instanceof Error ? error.message : String(error))
        }
      })
    },
  }
}
