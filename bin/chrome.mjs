// Prend une capture avec Chrome sans fenêtre. Un jeu qui tourne en boucle n'arrête jamais
// Chrome tout seul : on attend que l'image soit écrite, puis on le coupe.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]

export function findChrome() {
  const found = CANDIDATES.find(p => existsSync(p))
  if (!found) throw new Error('Chrome introuvable')
  return found
}

export async function screenshot(url, out, { width, height, waitMs = 3000, limitMs = 30000 }) {
  rmSync(out, { force: true })
  const profile = mkdtempSync(join(tmpdir(), 'buildreel-'))
  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--allow-file-access-from-files',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    `--virtual-time-budget=${waitMs}`,
    `--screenshot=${out}`,
    url,
  ], { stdio: 'ignore' })
  const started = Date.now()
  let lastSize = -1
  try {
    while (Date.now() - started < limitMs) {
      await new Promise(r => setTimeout(r, 250))
      if (chrome.exitCode !== null && !existsSync(out)) throw new Error('Chrome a quitté sans capture')
      if (!existsSync(out)) continue
      const size = statSync(out).size
      if (size > 0 && size === lastSize) return out
      lastSize = size
    }
    throw new Error('capture trop longue')
  } finally {
    chrome.kill('SIGKILL')
    if (chrome.exitCode === null) await new Promise(r => chrome.once('exit', r))
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // un profil temporaire oublié n'empêche pas la capture
    }
  }
}
