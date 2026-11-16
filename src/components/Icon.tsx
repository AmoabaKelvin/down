/** Line icons on a 16px grid, drawn to sit with SF Pro text. */
const PATHS: Record<string, React.ReactNode> = {
  sidebar: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.5" />
      <path d="M6 3v10" />
    </>
  ),
  back: <path d="M10 3.5 5.5 8l4.5 4.5" />,
  forward: <path d="M6 3.5 10.5 8 6 12.5" />,
  chevron: <path d="M6 4l4 4-4 4" />,
  updown: <path d="M5.5 6 8 3.5 10.5 6M5.5 10 8 12.5 10.5 10" />,
  compose: (
    <>
      <path d="M13.5 8.5v3.75a1.75 1.75 0 0 1-1.75 1.75h-8A1.75 1.75 0 0 1 2 12.25v-8A1.75 1.75 0 0 1 3.75 2.5H7.5" />
      <path d="M11.8 1.9a1.3 1.3 0 0 1 1.85 1.85L8.2 9.2l-2.45.6.6-2.45Z" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  folder: <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h2.6c.4 0 .78.16 1.06.44l.94.94c.28.28.66.44 1.06.44h3.84c.83 0 1.5.67 1.5 1.5v5.68c0 .83-.67 1.5-1.5 1.5H3.25c-.83 0-1.5-.67-1.5-1.5Z" />,
  'folder-plus': (
    <>
      <path d="M14.25 7.5V6.07c0-.83-.67-1.5-1.5-1.5H8.91c-.4 0-.78-.16-1.06-.44l-.94-.94a1.5 1.5 0 0 0-1.06-.44h-2.6c-.83 0-1.5.67-1.5 1.5v7.5c0 .83.67 1.5 1.5 1.5H8" />
      <path d="M12 10v4M10 12h4" />
    </>
  ),
  note: (
    <>
      <path d="M9.25 1.75H4.5c-.83 0-1.5.67-1.5 1.5v9.5c0 .83.67 1.5 1.5 1.5h7c.83 0 1.5-.67 1.5-1.5V5.5Z" />
      <path d="M9 1.75V5.5h4M5.75 8.5h4.5M5.75 11h3" />
    </>
  ),
  settings: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  source: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
  pin: <path d="M10.2 1.9 14.1 5.8M11.5 3.2 7.7 6.2 4.6 6.4 9.6 11.4l.2-3.1 3-3.8M7.1 8.9 2.5 13.5" />,
  unpin: (
    <>
      <path d="M10.2 1.9 14.1 5.8M11.5 3.2 7.7 6.2 4.6 6.4 9.6 11.4l.2-3.1 3-3.8M7.1 8.9 2.5 13.5" />
      <path d="M2 2l12 12" />
    </>
  ),
  trash: <path d="M2.75 4.25h10.5M6.25 4V2.75h3.5V4M4 4.25l.6 8.6c.06.8.72 1.4 1.5 1.4h3.8c.78 0 1.44-.6 1.5-1.4l.6-8.6M6.75 7v4.25M9.25 7v4.25" />,
  rename: <path d="M10.6 2.4a1.4 1.4 0 0 1 2 2L5 12l-2.75.75L3 10ZM9.5 3.5l2 2" />,
  reveal: (
    <>
      <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5" />
      <path d="M12 9.5v3a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4h3" />
    </>
  ),
  link: (
    <>
      <path d="M6.75 9.25a2.8 2.8 0 0 0 4 0l2-2a2.83 2.83 0 0 0-4-4l-.6.6" />
      <path d="M9.25 6.75a2.8 2.8 0 0 0-4 0l-2 2a2.83 2.83 0 0 0 4 4l.6-.6" />
    </>
  ),
  text: <path d="M3 3.5h10M8 3.5v9.5" />,
  h1: <path d="M2.5 3.5v9M8 3.5v9M2.5 8H8M11 6.5l2-1.5v7.5" />,
  h2: <path d="M2 3.5v9M7 3.5v9M2 8h5M10 6.5a1.75 1.75 0 1 1 3.4.6L10 12.5h3.75" />,
  h3: <path d="M2 3.5v9M7 3.5v9M2 8h5M10.2 5.5a1.6 1.6 0 1 1 1.6 2.25 1.75 1.75 0 1 1-1.75 2.6" />,
  todo: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="m5.25 8.25 2 2 3.5-4" />
    </>
  ),
  bullet: (
    <>
      <circle cx="3" cy="4.5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="11.5" r=".9" fill="currentColor" stroke="none" />
      <path d="M6.5 4.5h7M6.5 11.5h7" />
    </>
  ),
  ordered: <path d="M6.5 4.5h7M6.5 11.5h7M2.25 3.25l1-.5v3.5M2 10.25a1 1 0 1 1 1.75.75L2 12.75h2" />,
  quote: <path d="M3 3.5v9M6.5 5h7M6.5 8h7M6.5 11h4.5" />,
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />,
  table: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M1.75 6.25h12.5M1.75 9.75h12.5M6.25 2.75v10.5" />
    </>
  ),
  divider: <path d="M2 8h12M4.5 4.5h7M4.5 11.5h7" opacity="1" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  vault: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="2.5" />
      <path d="M5.5 2.5v11" />
    </>
  ),
  open: <path d="M1.75 5.25v-1c0-.83.67-1.5 1.5-1.5h2.6c.4 0 .78.16 1.06.44l.94.94c.28.28.66.44 1.06.44h3.84c.83 0 1.5.67 1.5 1.5v.68M2.1 7.25h11.8c.65 0 1.1.62.92 1.24l-1.2 3.85a1.5 1.5 0 0 1-1.43 1.06H3.6a1.5 1.5 0 0 1-1.48-1.25L1.5 8.4a1 1 0 0 1 .6-1.15Z" />,
  backlink: <path d="M6 3.5 2.5 7 6 10.5M2.5 7h7a4 4 0 0 1 4 4v1.5" />,
  sparkle: <path d="M8 1.5c.4 3.3 1.9 5.1 5.5 6.5-3.6 1.4-5.1 3.2-5.5 6.5-.4-3.3-1.9-5.1-5.5-6.5 3.6-1.4 5.1-3.2 5.5-6.5Z" />,
  enter: <path d="M13 3v4.5a2 2 0 0 1-2 2H3M6 6.5l-3 3 3 3" />,
}

export function Icon({ name, size = 16, className, strokeWidth = 1.4 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}

/** A vault's mark: its initial on a soft gradient picked from its name, so each vault looks its own. */
export function VaultMark({ name, size = 22 }: { name: string; size?: number }) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const initial = [...name.trim()][0]?.toUpperCase() ?? '·'
  return (
    <span
      className="vault-mark"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: `linear-gradient(145deg, oklch(0.74 0.13 ${hue}), oklch(0.56 0.15 ${(hue + 40) % 360}))`,
      }}
    >
      {initial}
    </span>
  )
}
