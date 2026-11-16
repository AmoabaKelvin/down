import type { Editor as TiptapEditor } from '@tiptap/core'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './components/Icon'
import { Menu, type MenuState } from './components/Menu'
import { NoteView } from './components/NoteView'
import { Palette } from './components/Palette'
import { Settings, type Look } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { SuggestMenu } from './components/SuggestMenu'
import { Toast, type ToastMessage } from './components/Toast'
import { Welcome } from './components/Welcome'
import { setVaultContext } from './editor/context'
import {
  createFolder,
  createNote,
  createVault,
  forgetVault,
  getVault,
  moveEntry,
  openVault,
  readNote,
  renameEntry,
  restoreEntry,
  reveal,
  saveNote,
  trashEntry,
  vaultIndex,
  type Index,
  type VaultInfo,
} from './lib/api'
import { applyMarkdown, joinFrontMatter, mergeMarkdown, splitFrontMatter } from './lib/markdown'
import { onQuit, onVaultChanged, openLink, pickFolder, type VaultChange } from './lib/native'
import { ancestors, backlinks, buildTree, folderOf, isInside, joinPath, nameOf, remap, resolveLink, title } from './lib/vault'

export default function App() {
  const [info, setInfo] = useState<VaultInfo | null>(null)
  // The welcome screen, shown over an open vault when switching to another or making a new one.
  const [welcome, setWelcome] = useState<{ creating: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getVault()
      .then(setInfo)
      .catch((e) => setError(String(e)))
  }, [])

  const settle = (promise: Promise<VaultInfo>) =>
    promise
      .then((next) => {
        setInfo(next)
        setWelcome(null)
        setError(null)
      })
      .catch((e) => setError(String(e)))

  const open = useCallback((path: string) => settle(openVault(path)), [])
  const openFolder = useCallback(async () => {
    const path = await pickFolder('Open a folder as a vault')
    if (path) open(path)
  }, [open])

  if (!info) return <div className="app loading" data-tauri-drag-region />

  if (!info.path || welcome) {
    return (
      <Welcome
        key={welcome?.creating ? 'create' : 'welcome'}
        recent={info.recent}
        home={info.home}
        creating={welcome?.creating ?? false}
        error={error}
        onOpen={open}
        onCreate={(parent, name) => settle(createVault(parent, name))}
        onForget={(path) => forgetVault(path).then(setInfo)}
        onBack={info.path ? () => setWelcome(null) : null}
      />
    )
  }

  return (
    <Workspace
      key={info.path}
      info={info}
      onSwitchVault={open}
      onOpenFolder={openFolder}
      onNewVault={() => setWelcome({ creating: true })}
      onVaults={() => setWelcome({ creating: false })}
    />
  )
}

type Doc = {
  path: string
  front: string
  body: string
  /** Bumped to rebuild the editor from `body`, e.g. after switching to or from the source view. */
  rev: number
  /** Which load this is: stays the same across a rename, so the editor keeps its place. */
  key: number
  fresh: boolean
}

const SAVE_DELAY = 400
const LOOK_KEY = 'down.look'
const MIN_SIDEBAR = 210
const MAX_SIDEBAR = 420

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Without storage, the sidebar just forgets how it was left.
  }
}

function countWords(text: string) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length
}

const isUntitled = (path: string) => /^Untitled( \d+)?$/.test(title(path))

const pageMotion = {
  initial: { opacity: 0, y: 8, filter: 'blur(3px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.1 } },
  transition: { type: 'spring', stiffness: 380, damping: 34 },
} as const

type WorkspaceProps = {
  info: VaultInfo
  onSwitchVault: (path: string) => void
  onOpenFolder: () => void
  onNewVault: () => void
  /** Shows the welcome screen, with the other vaults. */
  onVaults: () => void
}

function Workspace({ info, onSwitchVault, onOpenFolder, onNewVault, onVaults }: WorkspaceProps) {
  const root = info.path!
  const vaultKey = useCallback((name: string) => `down:${root}:${name}`, [root])

  const [index, setIndex] = useState<Index | null>(null)
  const tree = useMemo(() => index && buildTree(index), [index])
  const [expanded, setExpanded] = useState(() => new Set(stored<string[]>(vaultKey('expanded'), [])))
  const [pinned, setPinned] = useState(() => stored<string[]>(vaultKey('pinned'), []))
  const [recent, setRecent] = useState(() => stored<string[]>(vaultKey('recent'), []))
  const [nav, setNav] = useState<{ stack: string[]; at: number }>(() => {
    const last = stored<string | null>(vaultKey('open'), null)
    return last ? { stack: [last], at: 0 } : { stack: [], at: -1 }
  })
  const current = nav.stack[nav.at] ?? null
  const [doc, setDoc] = useState<Doc | null>(null)
  const [words, setWords] = useState(0)
  const [source, setSource] = useState(false)
  const [sidebar, setSidebar] = useState(() => stored('down.sidebar', true))
  const [sidebarWidth, setSidebarWidth] = useState(() => stored('down.sidebarWidth', 264))
  const [resizing, setResizing] = useState(false)
  const [palette, setPalette] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [look, setLook] = useState<Look>(() => stored<Look>(LOOK_KEY, { font: 'sans', width: 'narrow' }))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [menu, setMenu] = useState<MenuState>(null)

  const editor = useRef<TiptapEditor | null>(null)
  const docRef = useRef<Doc | null>(null)
  docRef.current = doc
  // The open note's body as of the last keystroke, and the whole note waiting to be saved.
  const text = useRef<{ path: string; body: string } | null>(null)
  const pending = useRef<{ path: string; content: string } | null>(null)
  // What each note looked like on disk when we last read or wrote it: the base for merges.
  const base = useRef(new Map<string, string>())
  const saveTimer = useRef<number | undefined>(undefined)
  const saving = useRef<Promise<void> | undefined>(undefined)
  // Notes made here this session: an untouched "Untitled" one is cleared away when you leave it.
  const created = useRef(new Set<string>())
  const fresh = useRef<string | null>(null)
  const heading = useRef<string | null>(null)
  const loads = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)

  const notify = useCallback((message: ToastMessage | string) => setToast(typeof message === 'string' ? { text: message } : message), [])
  const clearToast = useCallback(() => setToast(null), [])

  // The index: every note and folder, with links. Loaded once, then again after changes.
  const refreshTimer = useRef<number | undefined>(undefined)
  const refresh = useCallback(
    () =>
      vaultIndex()
        .then(setIndex)
        .catch((e) => notify(String(e))),
    [notify],
  )
  const refreshSoon = useCallback(
    (ms = 250) => {
      window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(refresh, ms)
    },
    [refresh],
  )
  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => setVaultContext({ index, note: current, root }), [index, current, root])

  useEffect(() => store(vaultKey('expanded'), [...expanded]), [expanded, vaultKey])
  useEffect(() => store(vaultKey('pinned'), pinned), [pinned, vaultKey])
  useEffect(() => store(vaultKey('recent'), recent), [recent, vaultKey])
  useEffect(() => store(vaultKey('open'), current), [current, vaultKey])
  useEffect(() => store('down.sidebar', sidebar), [sidebar])
  useEffect(() => store('down.sidebarWidth', sidebarWidth), [sidebarWidth])
  useEffect(() => {
    store(LOOK_KEY, look)
    document.documentElement.dataset.font = look.font
    document.documentElement.dataset.width = look.width
  }, [look])

  // Saving

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const next = pending.current
    pending.current = null
    if (!next) return saving.current
    base.current.set(next.path, next.content)
    saving.current = saveNote(next.path, next.content)
      .then(() => {
        setIndex((idx) => idx && { ...idx, notes: idx.notes.map((n) => (n.path === next.path ? { ...n, modified: Date.now() } : n)) })
        refreshSoon(900)
      })
      .catch((e) => notify(`Couldn't save: ${e}`))
    return saving.current
  }, [notify, refreshSoon])

  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    const stopQuit = onQuit(flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      stopQuit()
    }
  }, [flush])

  const onChange = useCallback(
    (body: string) => {
      const open = docRef.current
      if (!open) return
      text.current = { path: open.path, body }
      pending.current = { path: open.path, content: joinFrontMatter(open.front, body) }
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        flush()
        setWords(countWords(body))
      }, SAVE_DELAY)
    },
    [flush],
  )

  const bodyNow = () => (doc && text.current?.path === doc.path ? text.current.body : (doc?.body ?? ''))

  // Opening notes

  const go = useCallback((path: string) => {
    setNav((n) => {
      if (n.stack[n.at] === path) return n
      const stack = [...n.stack.slice(0, n.at + 1), path].slice(-100)
      return { stack, at: stack.length - 1 }
    })
    setExpanded((e) => {
      const missing = ancestors(path).filter((a) => !e.has(a))
      return missing.length ? new Set([...e, ...missing]) : e
    })
    setRecent((r) => [path, ...r.filter((p) => p !== path)].slice(0, 20))
  }, [])

  const forgetPaths = useCallback((gone: (path: string) => boolean) => {
    setNav((n) => {
      const before = n.stack.slice(0, n.at + 1).filter((p) => !gone(p))
      const after = n.stack.slice(n.at + 1).filter((p) => !gone(p))
      return { stack: [...before, ...after], at: before.length - 1 }
    })
    setPinned((p) => p.filter((x) => !gone(x)))
    setRecent((r) => r.filter((x) => !gone(x)))
  }, [])

  useEffect(() => {
    const leaving = docRef.current
    if (current && leaving?.path === current) return
    let cancelled = false
    // An "Untitled" note made here and never written in goes away when you leave it.
    if (leaving && created.current.has(leaving.path) && isUntitled(leaving.path) && !bodyNow().trim()) {
      created.current.delete(leaving.path)
      pending.current = null
      trashEntry(leaving.path)
        .then(() => refreshSoon(0))
        .catch(() => {})
      const gone = leaving.path
      forgetPaths((p) => p === gone)
    }
    if (!current) {
      setDoc(null)
      return
    }
    Promise.resolve(flush())
      .then(() => readNote(current))
      .then((content) => {
        if (cancelled) return
        base.current.set(current, content)
        const { front, body } = splitFrontMatter(content)
        text.current = { path: current, body }
        const isFresh = fresh.current === current
        fresh.current = null
        setDoc({ path: current, front, body, rev: 0, key: ++loads.current, fresh: isFresh })
        setWords(countWords(body))
        scroller.current?.scrollTo({ top: 0 })
      })
      .catch(() => {
        if (cancelled) return
        forgetPaths((p) => p === current)
      })
    return () => {
      cancelled = true
    }
    // bodyNow reads the doc being left, which is what we want here.
  }, [current, flush, forgetPaths, refreshSoon])

  const onReady = useCallback((instance: TiptapEditor | null) => {
    editor.current = instance
    // Arriving from a [[Note#Heading]] link: scroll to the heading.
    const wanted = heading.current
    if (!instance || !wanted) return
    heading.current = null
    setTimeout(() => {
      const found = [...instance.view.dom.querySelectorAll('h1, h2, h3, h4')].find((h) => h.textContent?.trim().toLowerCase() === wanted.toLowerCase())
      found?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 60)
  }, [])

  // Making, renaming, moving and trashing

  /** Paths after something moved: the open note, history, pins, open folders and what's unsaved. */
  const applyMove = useCallback((from: string, to: string) => {
    const move = (p: string) => remap(p, from, to)
    setNav((n) => ({ ...n, stack: n.stack.map(move) }))
    setPinned((p) => p.map(move))
    setRecent((r) => r.map(move))
    setExpanded((e) => new Set([...e].map(move)))
    const open = docRef.current
    if (open && isInside(open.path, from)) {
      const next = { ...open, path: move(open.path), fresh: false }
      docRef.current = next
      setDoc(next)
    }
    if (text.current) text.current = { ...text.current, path: move(text.current.path) }
    if (pending.current) pending.current = { ...pending.current, path: move(pending.current.path) }
    for (const [path, content] of [...base.current]) {
      if (isInside(path, from)) {
        base.current.delete(path)
        base.current.set(move(path), content)
      }
    }
    created.current = new Set([...created.current].map(move))
  }, [])

  /** Something changed a note on disk; fold it into what's open, keeping both sets of edits. */
  const takeRemote = useCallback(
    (path: string, remote: string, known: string) => {
      const open = docRef.current
      if (!open || open.path !== path) return
      const local = joinFrontMatter(open.front, text.current?.path === path ? text.current.body : open.body)
      const merged = local.trimEnd() === known.trimEnd() ? remote : mergeMarkdown(local, known, remote)
      const { front, body } = splitFrontMatter(merged)
      if (!source && editor.current && front === open.front) {
        applyMarkdown(editor.current, body)
      } else {
        text.current = { path, body }
        setDoc({ ...open, front, body, rev: open.rev + 1 })
        if (merged !== remote) onChange(body)
      }
      setWords(countWords(body))
    },
    [source, onChange],
  )

  async function newNote(folder = current ? folderOf(current) : '', name = 'Untitled') {
    await flush()
    try {
      const path = await createNote(folder, name)
      created.current.add(path)
      if (isUntitled(path)) fresh.current = path
      await refresh()
      go(path)
    } catch (e) {
      notify(String(e))
    }
  }

  async function newFolder(parent = current ? folderOf(current) : '') {
    try {
      const path = await createFolder(parent, 'New folder')
      await refresh()
      setExpanded((e) => new Set([...e, ...ancestors(path), path]))
      setSidebar(true)
      setRenaming(path)
    } catch (e) {
      notify(String(e))
    }
  }

  /** Reloads notes Down rewrote for a rename, if one is open. */
  async function reloadUpdated(updated: string[]) {
    const open = docRef.current
    if (!open || !updated.includes(open.path)) return
    const known = base.current.get(open.path) ?? ''
    const content = await readNote(open.path)
    base.current.set(open.path, content)
    takeRemote(open.path, content, known)
  }

  async function rename(path: string, name: string) {
    await flush()
    try {
      const moved = await renameEntry(path, name)
      applyMove(path, moved.path)
      await reloadUpdated(moved.updated)
      await refresh()
      if (moved.updated.length) notify(`Updated links in ${moved.updated.length} ${moved.updated.length === 1 ? 'note' : 'notes'}`)
      return true
    } catch (e) {
      notify(String(e))
      return false
    }
  }

  async function move(path: string, folder: string) {
    await flush()
    try {
      const moved = await moveEntry(path, folder)
      applyMove(path, moved.path)
      await reloadUpdated(moved.updated)
      if (folder) setExpanded((e) => new Set([...e, ...ancestors(moved.path)]))
      await refresh()
      notify({
        text: `Moved to ${folder ? nameOf(folder) : 'the top'}`,
        action: {
          label: 'Undo',
          run: async () => {
            try {
              const back = await moveEntry(moved.path, folderOf(path))
              applyMove(moved.path, back.path)
              await refresh()
            } catch (e) {
              notify(String(e))
            }
          },
        },
      })
    } catch (e) {
      notify(String(e))
    }
  }

  async function trash(path: string) {
    await flush()
    const wasOpen = current != null && isInside(current, path)
    const openPath = current
    const wasPinned = pinned.filter((p) => isInside(p, path))
    try {
      const trashed = await trashEntry(path)
      created.current.delete(path)
      if (wasOpen) {
        pending.current = null
        docRef.current = null
        setDoc(null)
      }
      forgetPaths((p) => isInside(p, path))
      await refresh()
      notify({
        text: `Moved “${title(path)}” to the Trash`,
        action: {
          label: 'Undo',
          run: async () => {
            try {
              await restoreEntry(trashed, path)
              await refresh()
              setPinned((p) => [...p, ...wasPinned.filter((x) => !p.includes(x))])
              if (wasOpen && openPath) go(openPath)
            } catch (e) {
              notify(String(e))
            }
          },
        },
      })
    } catch (e) {
      notify(String(e))
    }
  }

  const togglePin = (path: string) => setPinned((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]))

  const toggleFolder = useCallback((path: string) => {
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const expand = useCallback((path: string) => setExpanded((e) => (e.has(path) ? e : new Set([...e, path]))), [])

  // Links

  async function followLink(href: string, kind: 'wiki' | 'href') {
    if (kind === 'href') {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return openLink(href)
      const path = joinPath(current ? folderOf(current) : '', href.split('#')[0])
      if (index?.notes.some((n) => n.path === path)) return go(path)
      return notify(`There's no note at ${path}`)
    }
    const [target, anchor] = href.split('|')[0].split('#')
    if (!target.trim()) {
      if (anchor) heading.current = anchor
      return onReady(editor.current)
    }
    const found = resolveLink(target.trim(), current, index)
    if (anchor) heading.current = anchor.trim()
    if (found) return go(found)
    // A link to a note that isn't written yet makes it, next to the note it's in.
    const folder = target.includes('/') ? folderOf(target.trim()) : current ? folderOf(current) : ''
    await newNote(folder, nameOf(target.trim()))
  }

  // Changes made outside the app

  const onExternal = useRef<(change: VaultChange) => void>(() => {})
  onExternal.current = (change) => {
    for (const note of change.notes) {
      const open = docRef.current
      if (note.content == null) {
        if (open?.path === note.path) {
          notify(`“${title(note.path)}” was moved or deleted outside Down`)
          pending.current = null
          docRef.current = null
          setDoc(null)
          forgetPaths((p) => p === note.path)
        }
        continue
      }
      const known = base.current.get(note.path) ?? ''
      if (known.trimEnd() === note.content.trimEnd()) continue
      base.current.set(note.path, note.content)
      if (open?.path === note.path) takeRemote(note.path, note.content, known)
    }
    refreshSoon(120)
  }
  useEffect(() => onVaultChanged((change) => onExternal.current(change)), [])

  // History and keys

  const back = () => setNav((n) => (n.at > 0 ? { ...n, at: n.at - 1 } : n))
  const forward = () => setNav((n) => (n.at < n.stack.length - 1 ? { ...n, at: n.at + 1 } : n))

  function toggleSource() {
    if (!doc) return
    const body = bodyNow()
    setSource((s) => !s)
    setDoc({ ...doc, body, rev: doc.rev + 1 })
  }

  const keys = useRef<(event: KeyboardEvent) => void>(() => {})
  keys.current = (event) => {
    const mod = event.metaKey || event.ctrlKey
    if (!mod) return
    const key = event.key.toLowerCase()
    const run = (action: () => void) => {
      event.preventDefault()
      action()
    }
    if (key === 'n' && event.shiftKey) run(() => newFolder())
    else if (key === 'n') run(() => newNote())
    else if (key === 'k' || key === 'o' || key === 'p' || (key === 'f' && event.shiftKey)) run(() => setPalette((p) => !p))
    else if (key === '\\') run(() => setSidebar((s) => !s))
    else if (key === '/') run(toggleSource)
    else if (key === ',') run(() => setSettingsOpen((s) => !s))
    else if (key === '[' && !event.shiftKey) run(back)
    else if (key === ']' && !event.shiftKey) run(forward)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sidebar width

  function startResize(event: React.PointerEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    setResizing(true)
    const onMove = (e: PointerEvent) => setSidebarWidth(Math.round(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + e.clientX - startX))))
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function moreMenu(event: React.MouseEvent) {
    if (!doc) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const path = doc.path
    setMenu({
      x: box.right - 220,
      y: box.bottom + 6,
      items: [
        { label: pinned.includes(path) ? 'Unpin' : 'Pin to top', icon: pinned.includes(path) ? 'unpin' : 'pin', onSelect: () => togglePin(path) },
        {
          label: 'Rename',
          icon: 'rename',
          onSelect: () => {
            const field = document.querySelector<HTMLTextAreaElement>('.note-title')
            field?.focus()
            field?.select()
          },
        },
        { label: source ? 'Show formatted' : 'Show markdown', icon: 'source', hint: '⌘/', onSelect: toggleSource },
        { label: 'Show in Finder', icon: 'reveal', onSelect: () => reveal(path) },
        { separator: true },
        { label: 'Move to Trash', icon: 'trash', danger: true, onSelect: () => trash(path) },
      ],
    })
  }

  const meta = doc ? index?.notes.find((n) => n.path === doc.path) : undefined
  const links = useMemo(() => (doc ? backlinks(doc.path, index) : []), [doc, index])
  const crumbs = doc ? folderOf(doc.path).split('/').filter(Boolean) : []

  return (
    <div className={`app${sidebar ? '' : ' sidebar-hidden'}${resizing ? ' resizing' : ''}`}>
      <AnimatePresence initial={false}>
        {sidebar && (
          <motion.aside
            className="sidebar-wrap"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: sidebarWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={resizing ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 40 }}
          >
            <div className="sidebar-inner" style={{ width: sidebarWidth }}>
              <Sidebar
                vaultName={info.name ?? 'Vault'}
                vaultPath={root}
                recent={info.recent}
                tree={tree}
                current={current}
                expanded={expanded}
                pinned={pinned}
                renaming={renaming}
                onRenaming={setRenaming}
                onToggle={toggleFolder}
                onExpand={expand}
                onOpen={go}
                onNewNote={(folder) => newNote(folder)}
                onNewFolder={(parent) => newFolder(parent)}
                onRename={rename}
                onMove={move}
                onTrash={trash}
                onTogglePin={togglePin}
                onReveal={(path) => reveal(path)}
                onSearch={() => setPalette(true)}
                onSettings={() => setSettingsOpen(true)}
                onSwitchVault={onSwitchVault}
                onOpenFolder={onOpenFolder}
                onNewVault={onNewVault}
              />
            </div>
            <div className="sidebar-resize" onPointerDown={startResize} onDoubleClick={() => setSidebarWidth(264)} />
          </motion.aside>
        )}
      </AnimatePresence>

      <main className="main">
        <div className="toolbar" data-tauri-drag-region>
          <div className="toolbar-left">
            <button className="icon-button" onClick={() => setSidebar((s) => !s)} title="Toggle sidebar (⌘\)">
              <Icon name="sidebar" />
            </button>
            <button className="icon-button" onClick={back} disabled={nav.at <= 0} title="Back (⌘[)">
              <Icon name="back" size={15} strokeWidth={1.6} />
            </button>
            <button className="icon-button" onClick={forward} disabled={nav.at >= nav.stack.length - 1} title="Forward (⌘])">
              <Icon name="forward" size={15} strokeWidth={1.6} />
            </button>
            <AnimatePresence mode="popLayout" initial={false}>
              {doc && (
                <motion.div key={doc.path} className="crumbs" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  {crumbs.map((part, i) => (
                    <span key={i} className="crumb">
                      <button
                        onClick={() => {
                          const folder = crumbs.slice(0, i + 1).join('/')
                          setSidebar(true)
                          setExpanded((e) => new Set([...e, ...ancestors(`${folder}/x`), folder]))
                        }}
                      >
                        {part}
                      </button>
                      <Icon name="chevron" size={10} className="crumb-sep" strokeWidth={1.6} />
                    </span>
                  ))}
                  <span className="crumb current">{title(doc.path)}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="toolbar-right">
            {doc && (
              <>
                <button className={source ? 'icon-button on' : 'icon-button'} onClick={toggleSource} title="Markdown (⌘/)">
                  <Icon name="source" />
                </button>
                <button className="icon-button" onClick={moreMenu} title="More">
                  <Icon name="more" />
                </button>
              </>
            )}
          </div>
        </div>

        <div ref={scroller} className={doc ? 'scroll' : 'scroll is-empty'}>
          <AnimatePresence mode="wait" initial={false}>
            {doc ? (
              <motion.article key={doc.key} className="page" {...pageMotion}>
                <NoteView
                  path={doc.path}
                  body={doc.body}
                  rev={doc.rev}
                  source={source}
                  fresh={doc.fresh}
                  meta={meta}
                  words={words}
                  backlinks={links}
                  onChange={onChange}
                  onReady={onReady}
                  onRename={(name) => rename(doc.path, name)}
                  onLink={followLink}
                  onOpen={go}
                  onError={notify}
                />
              </motion.article>
            ) : (
              index && (
                <motion.div key="empty" className="empty" {...pageMotion}>
                  <div className="empty-mark">
                    <Icon name="note" size={26} strokeWidth={1.2} />
                  </div>
                  <p>{index.notes.length ? 'Pick a note, or start a new one.' : 'Nothing here yet.'}</p>
                  <div className="empty-actions">
                    <button className="empty-action" onClick={() => newNote('')}>
                      <Icon name="compose" size={15} />
                      New note
                      <kbd>⌘N</kbd>
                    </button>
                    {index.notes.length > 0 && (
                      <button className="empty-action" onClick={() => setPalette(true)}>
                        <Icon name="search" size={15} />
                        Find
                        <kbd>⌘K</kbd>
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            )}
          </AnimatePresence>
        </div>
      </main>

      <Palette
        open={palette}
        index={index}
        recent={recent}
        onOpen={go}
        onCreate={(name) => newNote(current ? folderOf(current) : '', name)}
        onClose={() => setPalette(false)}
      />
      <Settings
        open={settingsOpen}
        look={look}
        vaultName={info.name ?? ''}
        vaultPath={info.recent.find((v) => v.path === root)?.display ?? root}
        onLook={setLook}
        onReveal={() => reveal()}
        onSwitch={() => {
          flush()
          setSettingsOpen(false)
          onVaults()
        }}
        onClose={() => setSettingsOpen(false)}
      />
      <SuggestMenu />
      <Menu menu={menu} onClose={() => setMenu(null)} />
      <Toast toast={toast} onDone={clearToast} />
    </div>
  )
}
