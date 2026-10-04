// node shoot.mjs <recette.json> <base de sortie> [hash précédent] [adresse à la place de celle de la recette]
// Ouvre la page dans Chrome piloté (protocole DevTools), rejoue les étapes de la recette,
// prend une image et, si la recette le demande, un clip de quelques secondes.
// Sort {"ok":true,"hash","dup","image","thumb","clip"} ou {"ok":false,"reason"}.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findChrome } from './chrome.mjs'

const [recipePath, base, previous = '', urlOverride] = process.argv.slice(2)
let answered = false
const say = value => {
  if (answered) return
  answered = true
  process.stdout.write(JSON.stringify(value))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const recipe = JSON.parse(readFileSync(recipePath, 'utf8'))
const url = urlOverride || recipe.url
const width = recipe.largeur ?? 1280
const height = recipe.hauteur ?? 720

const KEYS = {
  Enter: 13, Escape: 27, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Tab: 9, Backspace: 8, ShiftLeft: 16, ControlLeft: 17,
}
function keyInfo(name) {
  if (name === ' ' || name === 'Space') return { key: ' ', code: 'Space', keyCode: 32 }
  if (/^[a-zA-Z]$/.test(name)) return { key: name.toLowerCase(), code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0) }
  if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0) }
  if (name === 'ShiftLeft' || name === 'Shift') return { key: 'Shift', code: 'ShiftLeft', keyCode: 16 }
  return { key: name, code: name, keyCode: KEYS[name] ?? 0 }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.waiting = new Map()
    this.listeners = new Map()
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id)
        this.waiting.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      } else if (msg.method) {
        this.listeners.get(msg.method)?.(msg.params)
      }
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }))
  }
  on(method, fn) {
    this.listeners.set(method, fn)
  }
}

async function key(cdp, name, type) {
  const k = keyInfo(name)
  const text = type === 'keyDown' && k.key.length === 1 ? k.key : undefined
  await cdp.send('Input.dispatchKeyEvent', {
    type: text ? 'keyDown' : type === 'keyDown' ? 'rawKeyDown' : 'keyUp',
    key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, text,
  })
}

async function click(cdp, step) {
  const x = Math.round((step.x ?? 0.5) * width)
  const y = Math.round((step.y ?? 0.5) * height)
  const button = step.bouton ?? 'left'
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 })
  if (step.ms) await sleep(step.ms)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 })
}

// Une étape : { touche }, { maintenir, ms }, { clic: {x, y, bouton, ms} } (x et y de 0 à 1),
// { defiler: pixels }, { attendre: ms }. Plusieurs touches maintenues ensemble : { maintenir: ["ArrowRight", "Space"], ms }.
async function play(cdp, steps = []) {
  for (const step of steps) {
    if (step.touche) {
      await key(cdp, step.touche, 'keyDown')
      await sleep(60)
      await key(cdp, step.touche, 'keyUp')
    } else if (step.maintenir) {
      const names = [step.maintenir].flat()
      for (const n of names) await key(cdp, n, 'keyDown')
      await sleep(step.ms ?? 500)
      for (const n of names) await key(cdp, n, 'keyUp')
    } else if (step.clic) {
      await click(cdp, step.clic)
    } else if (step.defiler) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: step.defiler })
    }
    await sleep(step.attendre ?? 120)
  }
}

const reachable = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(r => r.ok, () => false)
if (!reachable) {
  say({ ok: false, unreachable: true, reason: `nothing answers on ${url}` })
  process.exit(0)
}

const profile = mkdtempSync(join(tmpdir(), 'buildreel-'))
const chrome = spawn(findChrome(), [
  '--headless=new', '--hide-scrollbars', '--mute-audio', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
  '--force-device-scale-factor=1', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

const killer = setTimeout(() => {
  say({ ok: false, reason: 'capture trop longue' })
  chrome.kill('SIGKILL')
  process.exit(0)
}, 120_000)

try {
  const endpoint = await new Promise((resolve, reject) => {
    let buf = ''
    chrome.stderr.on('data', d => {
      buf += d
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (m) resolve(m[1])
    })
    chrome.on('exit', () => reject(new Error('Chrome a quitté')))
  })
  const port = new URL(endpoint).port
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = pages.find(p => p.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const loaded = new Promise(r => cdp.on('Page.loadEventFired', r))
  await cdp.send('Page.navigate', { url })
  await Promise.race([loaded, sleep(10_000)])
  await sleep(recipe.attente ?? 1500)
  await play(cdp, recipe.etapes)

  // Le clip se filme d'abord, l'image fixe se prend aussitôt après (le dernier état de l'écran),
  // l'encodage vient en dernier : un clip raté ne coûte jamais l'image.
  const clipSeconds = recipe.clip?.secondes ?? 0
  const frames = `${base}-frames`
  let n = 0
  let elapsed = 0
  if (clipSeconds > 0) {
    rmSync(frames, { recursive: true, force: true })
    mkdirSync(frames, { recursive: true })
    const started = Date.now()
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      n += 1
      writeFileSync(join(frames, `f${String(n).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'))
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
    await Promise.all([play(cdp, recipe.clip.etapes), sleep(clipSeconds * 1000)])
    await cdp.send('Page.stopScreencast')
    elapsed = (Date.now() - started) / 1000
  }

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const png = Buffer.from(data, 'base64')
  const hash = createHash('md5').update(png).digest('hex')
  if (hash === previous && n === 0) {
    say({ ok: true, hash, dup: true })
    throw new Error('déjà dit')
  }
  const image = `${base}.png`
  const thumb = `${base}.thumb.png`
  writeFileSync(image, png)
  execFileSync('sips', ['-Z', '320', image, '--out', thumb], { stdio: 'ignore' })

  let clip = null
  if (n >= 10) {
    try {
      execFileSync('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-framerate', (n / elapsed).toFixed(2), '-i', join(frames, 'f%05d.jpg'),
        '-vf', `fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', `${base}.mp4`,
      ], { timeout: 45_000 })
      clip = `${base}.mp4`
    } catch (error) {
      process.stderr.write(`clip raté : ${error.message}\n`)
    }
  }
  rmSync(frames, { recursive: true, force: true })
  clearTimeout(killer)
  say({ ok: true, hash, dup: false, image, thumb, clip })
} catch (error) {
  clearTimeout(killer)
  say({ ok: false, reason: String(error.message ?? error) })
} finally {
  chrome.kill('SIGKILL')
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // profil temporaire oublié : sans conséquence
  }
  process.exit(0)
}
