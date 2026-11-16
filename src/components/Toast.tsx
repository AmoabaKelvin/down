import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef } from 'react'

export type ToastMessage = {
  text: string
  /** Something to do about it, like Undo. It keeps the toast up for longer, and ⌘Z does it too. */
  action?: { label: string; run: () => void }
  ms?: number
}

const USUAL = 2200
const WITH_ACTION = 6000

/** From Daybook. */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  const timer = useRef<number | undefined>(undefined)
  const action = toast?.action
  const life = toast && (toast.ms ?? (action ? WITH_ACTION : USUAL))
  const arm = useCallback(() => {
    window.clearTimeout(timer.current)
    if (life) timer.current = window.setTimeout(onDone, life)
  }, [life, onDone])
  useEffect(() => {
    arm()
    return () => window.clearTimeout(timer.current)
  }, [toast, arm])

  useEffect(() => {
    if (!action) return
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
      if ((event.target as HTMLElement).closest?.('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      onDone()
      action!.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [action, onDone])

  return (
    <div className="toasts">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.text}
            layout="position"
            className="toast"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            onMouseEnter={() => action && window.clearTimeout(timer.current)}
            onMouseLeave={() => action && arm()}
          >
            <span>{toast.text}</span>
            {action && (
              <button
                className="toast-action"
                onClick={() => {
                  onDone()
                  action.run()
                }}
              >
                {action.label}
                <kbd>⌘Z</kbd>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
