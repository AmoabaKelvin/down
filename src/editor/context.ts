import type { Index } from '../lib/api'
import { resolveLink } from '../lib/vault'

/**
 * What the editor needs to know about the vault: the index, for link suggestions and for telling
 * resolved links from new ones, and the note being edited, which relative paths start from.
 */
export const vaultContext = {
  index: null as Index | null,
  note: null as string | null,
  root: '',
}

export const LINKS_CHANGED = 'down:links'

export function setVaultContext(next: Partial<typeof vaultContext>) {
  Object.assign(vaultContext, next)
  window.dispatchEvent(new Event(LINKS_CHANGED))
}

export function resolves(target: string) {
  return resolveLink(target, vaultContext.note, vaultContext.index) != null
}
