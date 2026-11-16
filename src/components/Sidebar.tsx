import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useRef, useState } from 'react'
import type { RecentVault } from '../lib/api'
import { folderOf, isInside, title, type FolderNode, type TreeNode } from '../lib/vault'
import { Icon, VaultMark } from './Icon'
import { Menu, type MenuEntry, type MenuState } from './Menu'

export const DRAG_TYPE = 'application/x-down-path'

type Props = {
  vaultName: string
  recent: RecentVault[]
  vaultPath: string
  tree: FolderNode | null
  current: string | null
  expanded: Set<string>
  pinned: string[]
  /** The row being renamed in place, if any. */
  renaming: string | null
  onRenaming: (path: string | null) => void
  onToggle: (path: string) => void
  onExpand: (path: string) => void
  onOpen: (path: string) => void
  onNewNote: (folder: string) => void
  onNewFolder: (parent: string) => void
  onRename: (path: string, name: string) => void
  onMove: (path: string, folder: string) => void
  onTrash: (path: string) => void
  onTogglePin: (path: string) => void
  onReveal: (path?: string) => void
  onSearch: () => void
  onSettings: () => void
  onSwitchVault: (path: string) => void
  onOpenFolder: () => void
  onNewVault: () => void
}

const highlight = { type: 'spring', stiffness: 520, damping: 40 } as const
const INDENT = 14

export const Sidebar = memo(function Sidebar(props: Props) {
  const { tree, current, expanded, pinned, renaming, vaultName } = props
  const [menu, setMenu] = useState<MenuState>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const scroller = useRef<HTMLDivElement>(null)

  // The open note scrolls into view when it's opened from elsewhere, like search.
  useEffect(() => {
    if (!current) return
    const row = scroller.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(current)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const noteMenu = (path: string): MenuEntry[] => [
    { label: 'Open', icon: 'note', onSelect: () => props.onOpen(path) },
    { label: 'Rename', icon: 'rename', onSelect: () => props.onRenaming(path) },
    { label: pinned.includes(path) ? 'Unpin' : 'Pin to top', icon: pinned.includes(path) ? 'unpin' : 'pin', onSelect: () => props.onTogglePin(path) },
    { label: 'Show in Finder', icon: 'reveal', onSelect: () => props.onReveal(path) },
    { separator: true },
    { label: 'Move to Trash', icon: 'trash', danger: true, onSelect: () => props.onTrash(path) },
  ]

  const folderMenu = (path: string): MenuEntry[] => [
    { label: 'New note', icon: 'compose', onSelect: () => props.onNewNote(path) },
    { label: 'New folder', icon: 'folder-plus', onSelect: () => props.onNewFolder(path) },
    { separator: true },
    { label: 'Rename', icon: 'rename', onSelect: () => props.onRenaming(path) },
    { label: 'Show in Finder', icon: 'reveal', onSelect: () => props.onReveal(path) },
    { separator: true },
    { label: 'Move to Trash', icon: 'trash', danger: true, onSelect: () => props.onTrash(path) },
  ]

  const rootMenu: MenuEntry[] = [
    { label: 'New note', icon: 'compose', hint: '⌘N', onSelect: () => props.onNewNote('') },
    { label: 'New folder', icon: 'folder-plus', hint: '⇧⌘N', onSelect: () => props.onNewFolder('') },
    { separator: true },
    { label: 'Show vault in Finder', icon: 'reveal', onSelect: () => props.onReveal() },
  ]

  function vaultMenu(event: React.MouseEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({
      x: box.left,
      y: box.bottom + 6,
      items: [
        { heading: 'Vaults' },
        ...props.recent.map((v) => ({
          label: v.name,
          detail: v.display,
          checked: v.path === props.vaultPath,
          onSelect: () => v.path !== props.vaultPath && props.onSwitchVault(v.path),
        })),
        { separator: true },
        { label: 'Open folder as vault…', icon: 'open', onSelect: props.onOpenFolder },
        { label: 'New vault…', icon: 'plus', onSelect: props.onNewVault },
        { label: 'Show in Finder', icon: 'reveal', onSelect: () => props.onReveal() },
      ],
    })
  }

  function contextMenu(event: React.MouseEvent, items: MenuEntry[]) {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  // Dragging: a note or folder can be dropped on a folder, on anything inside one, or on the vault.

  function canDrop(folder: string) {
    if (dragging == null) return false
    if (folderOf(dragging) === folder) return false
    return !isInside(folder, dragging)
  }

  function dragStart(event: React.DragEvent, path: string, kind: TreeNode['kind']) {
    setDragging(path)
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(DRAG_TYPE, path)
    event.dataTransfer.setData('text/plain', kind === 'note' ? `[[${title(path)}]]` : path)
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    ghost.textContent = kind === 'note' ? title(path) : path.slice(path.lastIndexOf('/') + 1)
    document.body.append(ghost)
    event.dataTransfer.setDragImage(ghost, 14, 14)
    setTimeout(() => ghost.remove())
  }

  function dragEnd() {
    setDragging(null)
    setDropTarget(null)
    window.clearTimeout(openTimer.current)
  }

  function dragOver(event: React.DragEvent, folder: string) {
    if (!canDrop(folder)) {
      if (dropTarget !== null) setDropTarget(null)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget !== folder) {
      setDropTarget(folder)
      window.clearTimeout(openTimer.current)
      // Hovering a closed folder opens it, so you can drop deeper.
      if (folder && !expanded.has(folder)) openTimer.current = window.setTimeout(() => props.onExpand(folder), 650)
    }
  }

  function drop(event: React.DragEvent, folder: string) {
    event.preventDefault()
    event.stopPropagation()
    const path = dragging
    dragEnd()
    if (path != null && canDrop(folder)) props.onMove(path, folder)
  }

  let rowIndex = 0

  function renderRow(node: TreeNode, depth: number, pinnedRow = false): React.ReactNode {
    const active = node.path === current
    const isFolder = node.kind === 'folder'
    const open = isFolder && expanded.has(node.path)
    const dropHere = isFolder && dropTarget === node.path
    const key = pinnedRow ? `pin:${node.path}` : node.path
    const delay = Math.min(rowIndex++, 14) * 0.018
    return (
      <motion.div
        key={key}
        className="tree-item"
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0, transition: { delay, type: 'spring', stiffness: 520, damping: 40 } }}
        exit={{ opacity: 0, transition: { duration: 0.1 } }}
      >
        <div
          role="treeitem"
          aria-expanded={isFolder ? open : undefined}
          aria-selected={active}
          tabIndex={-1}
          data-path={pinnedRow ? undefined : node.path}
          className={`row ${node.kind}${active ? ' active' : ''}${dropHere ? ' drop' : ''}${dragging === node.path ? ' dragging' : ''}`}
          style={{ paddingLeft: 26 + depth * INDENT }}
          draggable={renaming !== node.path}
          onDragStart={(e) => dragStart(e, node.path, node.kind)}
          onDragEnd={dragEnd}
          onDragOver={(e) => dragOver(e, isFolder ? node.path : folderOf(node.path))}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) window.clearTimeout(openTimer.current)
          }}
          onDrop={(e) => drop(e, isFolder ? node.path : folderOf(node.path))}
          onClick={() => (isFolder ? props.onToggle(node.path) : props.onOpen(node.path))}
          onDoubleClick={() => isFolder || props.onRenaming(node.path)}
          onContextMenu={(e) => contextMenu(e, isFolder ? folderMenu(node.path) : noteMenu(node.path))}
        >
          {active && <motion.span layoutId={pinnedRow ? 'pin-highlight' : 'row-highlight'} className="row-highlight" transition={highlight} />}
          {isFolder ? (
            <span className="row-chevron" style={{ left: 8 + depth * INDENT }}>
              <Icon name="chevron" size={11} strokeWidth={1.8} />
            </span>
          ) : pinnedRow ? (
            <span className="row-chevron pin-glyph" style={{ left: 8 + depth * INDENT }}>
              <Icon name="note" size={12} />
            </span>
          ) : null}
          {renaming === node.path ? (
            <RenameField
              initial={node.name}
              onDone={(name) => {
                props.onRenaming(null)
                if (name != null && name.trim() && name !== node.name) props.onRename(node.path, name)
              }}
            />
          ) : (
            <span className="row-label">{node.name}</span>
          )}
          {isFolder && renaming !== node.path && (
            <span className="row-end">
              <span className="row-count">{node.count || ''}</span>
              <button
                className="row-add"
                title="New note here"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onNewNote(node.path)
                }}
              >
                <Icon name="plus" size={12} strokeWidth={1.7} />
              </button>
            </span>
          )}
        </div>
        {isFolder && (
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="branch"
                className="branch"
                style={{ ['--guide' as string]: `${13.5 + depth * INDENT}px` }}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 520, damping: 44, opacity: { duration: 0.16 } }}
              >
                {node.children.length ? node.children.map((child) => renderRow(child, depth + 1)) : <div className="row-empty" style={{ paddingLeft: 26 + (depth + 1) * INDENT }}>Empty</div>}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>
    )
  }

  const pinnedNotes = tree ? pinned.map((path) => findNote(tree, path)).filter((n): n is TreeNode => !!n) : []

  return (
    <nav className="sidebar">
      <div className="sidebar-top" data-tauri-drag-region />
      <div className="vault-row" data-tauri-drag-region>
        <button className="vault-switch" onClick={vaultMenu} title="Switch vault">
          <VaultMark name={vaultName} size={22} />
          <span className="vault-name">{vaultName}</span>
          <Icon name="updown" size={12} className="vault-updown" strokeWidth={1.6} />
        </button>
        <button className="icon-button compose" onClick={() => props.onNewNote(current ? folderOf(current) : '')} title="New note (⌘N)">
          <Icon name="compose" size={16} />
        </button>
      </div>

      <button className="search-pill" onClick={props.onSearch}>
        <Icon name="search" size={14} strokeWidth={1.6} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>

      <div
        ref={scroller}
        className={`tree${dragging != null ? ' is-dragging' : ''}${dropTarget === '' ? ' drop-root' : ''}`}
        role="tree"
        onContextMenu={(e) => contextMenu(e, rootMenu)}
        onDragOver={(e) => dragOver(e, '')}
        onDrop={(e) => drop(e, '')}
      >
        <AnimatePresence initial={false}>
          {pinnedNotes.length > 0 && (
            <motion.section key="pinned" className="tree-section" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <div className="section-label">
                <span>Pinned</span>
              </div>
              <AnimatePresence initial={false}>{pinnedNotes.map((node) => renderRow(node, 0, true))}</AnimatePresence>
            </motion.section>
          )}
        </AnimatePresence>

        <section className="tree-section">
          <div className="section-label">
            <span>Notes</span>
            <span className="section-actions">
              <button className="mini-button" onClick={() => props.onNewNote('')} title="New note (⌘N)">
                <Icon name="compose" size={13} />
              </button>
              <button className="mini-button" onClick={() => props.onNewFolder('')} title="New folder (⇧⌘N)">
                <Icon name="folder-plus" size={13} />
              </button>
            </span>
          </div>
          {tree && (
            <AnimatePresence initial={false}>
              {tree.children.map((child) => renderRow(child, 0))}
            </AnimatePresence>
          )}
          {tree && tree.children.length === 0 && (
            <button className="tree-empty" onClick={() => props.onNewNote('')}>
              <Icon name="compose" size={14} />
              Write your first note
            </button>
          )}
        </section>
      </div>

      <footer className="sidebar-footer">
        <span className="note-count">{tree ? `${tree.count} ${tree.count === 1 ? 'note' : 'notes'}` : ''}</span>
        <button className="icon-button small" onClick={props.onSettings} title="Settings (⌘,)">
          <Icon name="settings" size={15} />
        </button>
      </footer>

      <Menu menu={menu} onClose={() => setMenu(null)} />
    </nav>
  )
})

function findNote(node: FolderNode, path: string): TreeNode | null {
  for (const child of node.children) {
    if (child.path === path) return child
    if (child.kind === 'folder' && path.startsWith(`${child.path}/`)) return findNote(child, path)
  }
  return null
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      className="row-rename"
      value={value}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
    />
  )
}
