import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export type MenuEntry =
  | { label: string; icon?: string; hint?: string; danger?: boolean; checked?: boolean; detail?: string; onSelect: () => void }
  | { separator: true }
  | { heading: string }

export type MenuState = { x: number; y: number; items: MenuEntry[]; /** Opens upward from the point, e.g. from a footer. */ above?: boolean } | null

/** A context menu or popover menu at a point, with the arrow keys and return working on it. */
export function Menu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  return <AnimatePresence>{menu && <MenuPanel key={`${menu.x},${menu.y}`} menu={menu} onClose={onClose} />}</AnimatePresence>
}

function MenuPanel({ menu, onClose }: { menu: NonNullable<MenuState>; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: menu.x, top: menu.y })
  const [active, setActive] = useState(-1)
  const actions = menu.items.flatMap((item, i) => ('onSelect' in item ? [i] : []))

  // Keep it on screen.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const top = menu.above ? menu.y - height : menu.y
    setPlace({ left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - height - 8)) })
  }, [menu])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const at = actions.indexOf(active)
        const next = event.key === 'ArrowDown' ? (at + 1) % actions.length : (at - 1 + actions.length) % actions.length
        setActive(actions[at < 0 && event.key === 'ArrowUp' ? actions.length - 1 : next])
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault()
        const item = menu.items[active]
        if ('onSelect' in item) {
          onClose()
          item.onSelect()
        }
      }
    }
    const onDown = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  })

  return (
    <motion.div
      ref={panel}
      className="menu"
      role="menu"
      style={{ left: place.left, top: place.top, transformOrigin: menu.above ? 'bottom left' : 'top left' }}
      initial={{ opacity: 0, scale: 0.96, y: menu.above ? 4 : -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 700, damping: 40 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="menu-separator" />
        ) : 'heading' in item ? (
          <div key={i} className="menu-heading">
            {item.heading}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}${i === active ? ' active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon && <Icon name={item.icon} size={15} className="menu-icon" />}
            <span className="menu-label">
              {item.label}
              {item.detail && <span className="menu-detail">{item.detail}</span>}
            </span>
            {item.checked && <Icon name="check" size={13} className="menu-check" strokeWidth={1.8} />}
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </motion.div>
  )
}
