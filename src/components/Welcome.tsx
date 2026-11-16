import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { RecentVault } from '../lib/api'
import { pickFolder } from '../lib/native'
import { Icon, VaultMark } from './Icon'

type Props = {
  recent: RecentVault[]
  home: string
  /** Opens with the new vault form showing, e.g. from "New vault…" in the sidebar. */
  creating: boolean
  error: string | null
  onOpen: (path: string) => void
  onCreate: (parent: string, name: string) => void
  onForget: (path: string) => void
  onBack: (() => void) | null
}

const enter = (i: number) => ({
  initial: { opacity: 0, y: 10, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { delay: 0.05 + i * 0.06, type: 'spring' as const, stiffness: 300, damping: 30 } },
})

/** The first thing you see: open a folder as a vault, make a new one, or go back to one. */
export function Welcome({ recent, home, creating: startCreating, error, onOpen, onCreate, onForget, onBack }: Props) {
  const [creating, setCreating] = useState(startCreating)
  const [name, setName] = useState('Notes')
  const [parent, setParent] = useState(home)

  async function openFolder() {
    const path = await pickFolder('Open a folder as a vault')
    if (path) onOpen(path)
  }

  async function chooseParent() {
    const path = await pickFolder('Where should the vault go?')
    if (path) setParent(path)
  }

  const shown = (path: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)

  return (
    <div className="welcome" data-tauri-drag-region>
      {onBack && (
        <button className="welcome-back" onClick={onBack}>
          <Icon name="back" size={14} />
          Back
        </button>
      )}
      <div className="welcome-inner">
        <motion.div className="welcome-mark" {...enter(0)}>
          <Logo />
        </motion.div>
        <motion.h1 {...enter(1)}>Down</motion.h1>
        <motion.p className="welcome-lede" {...enter(2)}>
          Write it down. Notes in a folder of plain markdown, yours to keep, sync and open anywhere.
        </motion.p>

        <motion.div className="welcome-actions" {...enter(3)}>
          <button className="welcome-card" onClick={openFolder}>
            <span className="welcome-card-icon">
              <Icon name="open" size={18} />
            </span>
            <span className="welcome-card-text">
              <strong>Open a folder</strong>
              <span>Any folder of notes, or an Obsidian vault</span>
            </span>
          </button>
          <button className={creating ? 'welcome-card on' : 'welcome-card'} onClick={() => setCreating(true)}>
            <span className="welcome-card-icon">
              <Icon name="plus" size={18} />
            </span>
            <span className="welcome-card-text">
              <strong>Create a vault</strong>
              <span>A fresh folder with a note to start from</span>
            </span>
          </button>
        </motion.div>

        <AnimatePresence initial={false}>
          {creating && (
            <motion.form
              className="welcome-create"
              style={{ paddingTop: 1 }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
              onAnimationComplete={() => document.querySelector<HTMLInputElement>('.welcome-create input')?.focus()}
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) onCreate(parent, name.trim())
              }}
            >
              <div className="welcome-create-inner">
                <label className="field">
                  <span>Name</span>
                  <input value={name} autoComplete="off" autoCorrect="off" name="vault-name" onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
                </label>
                <div className="field">
                  <span>Location</span>
                  <div className="field-row">
                    <code>
                      {shown(parent)}/{name.trim() || '…'}
                    </code>
                    <button type="button" className="text-button" onClick={chooseParent}>
                      Change…
                    </button>
                  </div>
                </div>
                <button type="submit" className="primary-button" disabled={!name.trim()}>
                  Create vault
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.p className="welcome-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {recent.length > 0 && (
          <motion.div className="welcome-recent" {...enter(4)}>
            <div className="welcome-recent-label">Recent</div>
            {recent.map((vault) => (
              <div key={vault.path} className="recent-row">
                <button className="recent-open" onClick={() => onOpen(vault.path)}>
                  <VaultMark name={vault.name} size={26} />
                  <span className="recent-text">
                    <strong>{vault.name}</strong>
                    <span>{vault.display}</span>
                  </span>
                </button>
                <button className="icon-button small recent-forget" title="Remove from this list" onClick={() => onForget(vault.path)}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}

/** Down's mark: a pen signing on a line. The same picture as the app icon. */
export function Logo({ size = 76 }: { size?: number }) {
  return <img src="/logo.png" width={size} height={size} alt="" draggable={false} />
}
