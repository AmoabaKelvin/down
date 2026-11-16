import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'

export type SuggestItem = {
  id: string
  label: string
  /** Shown faint after the label: a folder, a shortcut. */
  hint?: string
  /** An icon name from the menu's set. */
  icon?: string
  /** A second line, like a note's first sentence. */
  detail?: string
  /** Which characters of the label matched, for highlighting. */
  matched?: number[]
  /** Makes something new rather than picking what's there. */
  create?: boolean
}

export type SuggestState = {
  kind: 'link' | 'slash'
  items: SuggestItem[]
  index: number
  rect: DOMRect | null
  query: string
  select: (item: SuggestItem) => void
}

let state: SuggestState | null = null
const listeners = new Set<() => void>()

function set(next: SuggestState | null) {
  state = next
  listeners.forEach((listener) => listener())
}

export const suggestStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  hover(index: number) {
    if (state && state.index !== index) set({ ...state, index })
  },
}

/** The popup for a suggestion plugin, drawn by <SuggestMenu />. */
export function suggestRenderer(kind: SuggestState['kind']) {
  return () => {
    const show = (props: SuggestionProps<SuggestItem, SuggestItem>, keep: boolean) =>
      set({
        kind,
        items: props.items,
        index: keep && state ? Math.min(state.index, Math.max(props.items.length - 1, 0)) : 0,
        rect: props.clientRect?.() ?? null,
        query: props.query,
        select: (item) => props.command(item),
      })
    return {
      onStart: (props: SuggestionProps<SuggestItem, SuggestItem>) => show(props, false),
      onUpdate: (props: SuggestionProps<SuggestItem, SuggestItem>) => show(props, props.query === state?.query),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (!state) return false
        const { items, index } = state
        if (event.key === 'Escape') return true
        if (!items.length) return false
        const step = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n') ? 1 : event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p') ? -1 : 0
        if (step) {
          set({ ...state, index: (index + step + items.length) % items.length })
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          state.select(items[index])
          return true
        }
        return false
      },
      onExit: () => set(null),
    }
  }
}
