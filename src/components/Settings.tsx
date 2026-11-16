import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { Icon } from './Icon'

export type Look = { font: 'sans' | 'serif' | 'mono'; width: 'narrow' | 'wide' }

type Props = {
  open: boolean
  look: Look
  vaultName: string
  vaultPath: string
  onLook: (look: Look) => void
  onReveal: () => void
  onSwitch: () => void
  onClose: () => void
}

const FONTS: { id: Look['font']; label: string; sample: string }[] = [
  { id: 'sans', label: 'Sans', sample: 'Aa' },
  { id: 'serif', label: 'Serif', sample: 'Aa' },
  { id: 'mono', label: 'Mono', sample: 'Aa' },
]

export function Settings({ open, look, vaultName, vaultPath, onLook, onReveal, onSwitch, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay settings-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            className="settings"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="settings-header">
              <h2>Settings</h2>
              <button className="icon-button small" onClick={onClose} aria-label="Close">
                <Icon name="close" size={13} />
              </button>
            </header>

            <section className="settings-section">
              <div className="settings-label">Typeface</div>
              <div className="font-choices">
                {FONTS.map((font) => (
                  <button key={font.id} className={look.font === font.id ? 'font-choice on' : 'font-choice'} onClick={() => onLook({ ...look, font: font.id })}>
                    <span className={`font-sample font-${font.id}`}>{font.sample}</span>
                    <span>{font.label}</span>
                    {look.font === font.id && <motion.span layoutId="font-ring" className="font-ring" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-section settings-row">
              <div className="settings-label">Line width</div>
              <div className="segmented">
                {(['narrow', 'wide'] as const).map((width) => (
                  <button key={width} className={look.width === width ? 'on' : ''} onClick={() => onLook({ ...look, width })}>
                    {look.width === width && <motion.span layoutId="width-pill" className="segmented-pill" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
                    <span>{width === 'narrow' ? 'Narrow' : 'Wide'}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-label">Vault</div>
              <div className="settings-vault">
                <span className="settings-vault-text">
                  <strong>{vaultName}</strong>
                  <code>{vaultPath}</code>
                </span>
                <span className="settings-vault-actions">
                  <button className="text-button" onClick={onReveal}>
                    Show in Finder
                  </button>
                  <button className="text-button" onClick={onSwitch}>
                    Switch…
                  </button>
                </span>
              </div>
            </section>

            <footer className="settings-keys">
              <span><kbd>⌘N</kbd> new note</span>
              <span><kbd>⇧⌘N</kbd> new folder</span>
              <span><kbd>⌘K</kbd> find</span>
              <span><kbd>⌘[</kbd><kbd>⌘]</kbd> back, forward</span>
              <span><kbd>⌘/</kbd> markdown</span>
              <span><kbd>⌘\</kbd> sidebar</span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
