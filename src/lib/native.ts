import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'

/** True inside the Mac app, false when running in a browser via `pnpm dev`. */
export const isNative = '__TAURI_INTERNALS__' in window

/** Runs a command in the app, or against the dev server's copy of it in the browser. */
export async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isNative) return invoke<T>(command, args)
  const res = await fetch(`/api/${command}`, { method: 'POST', body: JSON.stringify(args) })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function openLink(href: string) {
  if (isNative) openUrl(href)
  else window.open(href, '_blank', 'noopener')
}

/** A URL the page can load a file in the vault from. */
export function fileUrl(root: string, path: string) {
  if (isNative) return convertFileSrc(`${root}/${path}`)
  return `/api/file?path=${encodeURIComponent(path)}`
}

/** The app asks before quitting so the last keystrokes get saved. */
export function onQuit(save: () => Promise<void> | void) {
  if (!isNative) return () => {}
  const stop = listen('down://quit', async () => {
    await save()
    await invoke('quit')
  })
  return () => {
    stop.then((unlisten) => unlisten())
  }
}

export type VaultChange = { notes: { path: string; content: string | null }[]; structure: boolean }

/** Something other than the app changed the vault: another editor, a sync, git. */
export function onVaultChanged(handle: (change: VaultChange) => void) {
  if (isNative) {
    const stop = listen<VaultChange>('down://changed', (event) => handle(event.payload))
    return () => {
      stop.then((unlisten) => unlisten())
    }
  }
  // The dev server streams the same events.
  const source = new EventSource('/api/events')
  source.onmessage = (event) => handle(JSON.parse(event.data))
  return () => source.close()
}

/** Asks for a folder. In the browser there's no picker, so it asks for a path. */
export async function pickFolder(title: string): Promise<string | null> {
  if (isNative) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title })
    return typeof picked === 'string' ? picked : null
  }
  return window.prompt(title)
}
