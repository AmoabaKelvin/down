import { call } from './native'

export type NoteMeta = {
  path: string
  modified: number
  created: number
  size: number
  /** `[[wikilink]]` targets, without `#heading` or `|alias`. */
  wikilinks: string[]
  /** Markdown links to other notes, as vault paths. */
  links: string[]
  excerpt: string
}

export type Index = { name: string; root: string; folders: string[]; notes: NoteMeta[] }

export type RecentVault = { path: string; name: string; display: string }

export type VaultInfo = { path: string | null; name: string | null; recent: RecentVault[]; /** The home folder, for showing paths as ~/… */ home: string }

export type Hit = { path: string; snippet: string; count: number }

/** Where something ended up after a rename or move, and which other notes had links to it updated. */
export type Moved = { path: string; updated: string[] }

export const getVault = () => call<VaultInfo>('get_vault')
export const openVault = (path: string) => call<VaultInfo>('open_vault', { path })
export const createVault = (parent: string, name: string) => call<VaultInfo>('create_vault', { parent, name })
export const closeVault = () => call<VaultInfo>('close_vault')
export const forgetVault = (path: string) => call<VaultInfo>('forget_vault', { path })

export const vaultIndex = () => call<Index>('vault_index')
export const readNote = (path: string) => call<string>('read_note', { path })
export const saveNote = (path: string, content: string) => call<void>('save_note', { path, content })
export const createNote = (folder: string, name: string, content?: string) => call<string>('create_note', { folder, name, content })
export const createFolder = (parent: string, name: string) => call<string>('create_folder', { parent, name })
export const renameEntry = (path: string, name: string) => call<Moved>('rename_entry', { path, name })
export const moveEntry = (path: string, folder: string) => call<Moved>('move_entry', { path, folder })
/** Returns where in the Trash it went, for Undo. */
export const trashEntry = (path: string) => call<string>('trash_entry', { path })
export const restoreEntry = (trashed: string, path: string) => call<void>('restore_entry', { trashed, path })
export const searchVault = (query: string) => call<Hit[]>('search_vault', { query })
export const saveAttachment = (name: string, data: string) => call<string>('save_attachment', { name, data })
export const reveal = (path?: string) => call<void>('reveal', { path: path ?? null })
