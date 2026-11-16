import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/markdown'
import App from './App.tsx'
import { isNative } from './lib/native'

// `?chrome` in dev draws the page as the Mac app does, for screenshots taken in a browser.
if (isNative || (import.meta.env.DEV && new URLSearchParams(location.search).has('chrome'))) document.documentElement.classList.add('native')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
