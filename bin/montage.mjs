// node montage.mjs <plan.json> <out.mp4>
// Chaque plan devient une image 1080×1920 (HTML capturé par Chrome), puis ffmpeg
// les enchaîne avec un léger zoom et des fondus. Un plan qui a un clip le joue à la place de l'image fixe.
// Pas de musique : on met le son tendance au moment de poster.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { screenshot } from './chrome.mjs'

const [planPath, out] = process.argv.slice(2)
const plan = JSON.parse(readFileSync(planPath, 'utf8'))
const en = plan.lang === 'en'
const work = join(dirname(out), 'frames')
mkdirSync(work, { recursive: true })

const SECONDS = { hook: 2.8, shot: 3.2, 'bug-red': 1.8, 'bug-green': 2.2, stats: 3, final: 3.6 }
const FADE = 0.35
const FPS = 30

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const img = p => pathToFileURL(p).href

const css = `
*{box-sizing:border-box;margin:0}
html,body{width:1080px;height:1920px;overflow:hidden}
body{background:#12131a;color:#fff;font-family:-apple-system,"SF Pro Display","Helvetica Neue",sans-serif;position:relative}
.bg{position:absolute;inset:-80px;background-size:cover;background-position:center;filter:blur(46px) brightness(.42) saturate(1.3)}
.cap{position:absolute;left:70px;right:70px;top:300px;font-weight:900;font-size:86px;line-height:1.04;letter-spacing:-2px;text-wrap:balance;text-shadow:0 6px 30px #0009}
.cap mark{background:#f2a93b;color:#14151c;padding:0 14px;border-radius:12px}
.shot{position:absolute;border-radius:14px;overflow:hidden;box-shadow:0 40px 90px #000c;border:4px solid #ffffff22}
.shot.tall{border-radius:44px;border-width:10px;border-color:#0b0c10}
.shot img{display:block;width:100%;height:100%;object-fit:cover}
.chip{position:absolute;top:150px;left:70px;font:700 34px ui-monospace,Menlo,monospace;background:#000a;color:#f2a93b;padding:8px 18px;border-radius:12px}
.wm{position:absolute;bottom:120px;left:0;right:0;text-align:center;font:600 30px ui-monospace,Menlo,monospace;color:#ffffff80;letter-spacing:2px}
.center{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 80px;gap:40px}
.title{font-weight:900;font-size:124px;line-height:1;letter-spacing:-4px;text-wrap:balance}
.title mark{background:#f2a93b;color:#14151c;padding:0 16px;border-radius:16px}
.sub{font-size:44px;color:#ffffffb0;font-weight:600}
.rows{display:flex;flex-direction:column;gap:22px;margin-top:20px}
.rows div{font:700 48px ui-monospace,Menlo,monospace;padding:26px 34px;border-radius:20px}
.red .rows div{background:#ff6b5e26;color:#ff8f84}
.green .rows div{background:#5fd68e26;color:#7fe6a6}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.tiles div{background:#ffffff12;border-radius:28px;padding:44px 36px;font-weight:900;font-size:120px;line-height:1;font-variant-numeric:tabular-nums}
.tiles small{display:block;font-size:36px;font-weight:600;color:#ffffffa0;margin-top:16px}
`

// Où poser la capture dans le cadre 1080×1920 : paysage (web, Mac) en pleine largeur,
// portrait (iPhone) en téléphone centré. Le même rectangle sert à poser le clip par-dessus.
function frameRect(file) {
  let w = 16
  let h = 9
  try {
    const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' })
    w = Number(info.match(/pixelWidth: (\d+)/)?.[1]) || w
    h = Number(info.match(/pixelHeight: (\d+)/)?.[1]) || h
  } catch {
    // image illisible : on garde le 16:9
  }
  if (h > w) {
    const border = 10
    const height = 1140
    const width = Math.round((height * w) / h)
    return { tall: true, border, x: Math.round((1080 - width) / 2) - border, y: 650, w: width, h: height }
  }
  const border = 4
  const width = 1000 - 2 * border
  return { tall: false, border, x: 40, y: 760, w: width, h: Math.round((width * h) / w) }
}

const rects = []
function page(scene, i) {
  const wm = `<div class="wm">${en ? 'made with buildreel' : 'monté avec buildreel'}</div>`
  const mark = (text, hl) => (hl && text.includes(hl) ? esc(text).replace(esc(hl), `<mark>${esc(hl)}</mark>`) : esc(text))
  const chip = scene.chip ? `<div class="chip">${esc(scene.chip)}</div>` : ''
  let body = ''
  if (scene.kind === 'hook') {
    const words = mark(scene.caption, scene.highlight)
    body = `<div class="center"><div class="sub">${esc(plan.project.charAt(0).toUpperCase() + plan.project.slice(1))} · timelapse</div><div class="title">${words}</div></div>`
  } else if (scene.kind === 'shot' || scene.kind === 'final') {
    const cap = mark(scene.caption, scene.highlight)
    const r = frameRect(scene.image)
    rects[i] = r
    const box = `left:${r.x}px;top:${r.y}px;width:${r.w + 2 * r.border}px;height:${r.h + 2 * r.border}px`
    body = `<div class="bg" style="background-image:url('${img(scene.image)}')"></div>${chip}<div class="cap">${cap}</div><div class="shot${r.tall ? ' tall' : ''}" style="${box}"><img src="${img(scene.image)}"></div>`
  } else if (scene.kind === 'bug-red' || scene.kind === 'bug-green') {
    const cls = scene.kind === 'bug-red' ? 'red' : 'green'
    body = `${chip}<div class="center ${cls}"><div class="title">${esc(scene.caption)}</div><div class="rows">${(scene.lines ?? []).map(l => `<div>${esc(l)}</div>`).join('')}</div></div>`
  } else if (scene.kind === 'stats') {
    body = `<div class="center"><div class="title" style="font-size:96px">${esc(scene.caption)}</div><div class="tiles">${(scene.stats ?? []).map(s => `<div>${esc(s.value)}<small>${esc(s.label)}</small></div>`).join('')}</div></div>`
  }
  const file = join(work, `scene-${String(i).padStart(2, '0')}.html`)
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${css}</style><body>${body}${wm}</body>`)
  return file
}

const pngs = []
for (const [i, scene] of plan.scenes.entries()) {
  const html = page(scene, i)
  const png = html.replace(/\.html$/, '.png')
  await screenshot(pathToFileURL(html).href, png, { width: 1080, height: 1920, waitMs: 500, limitMs: 20000 })
  pngs.push({ png, seconds: SECONDS[scene.kind] ?? 3, clip: scene.clip && existsSync(scene.clip) ? scene.clip : null })
  process.stderr.write(`plan ${i + 1}/${plan.scenes.length}\n`)
}

const inputs = []
const chains = []
let n = 0
pngs.forEach((p, i) => {
  const card = n++
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(p.seconds), '-i', p.png)
  if (!p.clip) {
    const frames = Math.round(p.seconds * FPS)
    chains.push(`[${card}:v]scale=2160:3840,zoompan=z='1+0.04*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${FPS},setsar=1,format=yuv420p[v${i}]`)
    return
  }
  const clip = n++
  inputs.push('-stream_loop', '-1', '-t', String(p.seconds), '-i', p.clip)
  chains.push(`[${card}:v]scale=1080:1920,fps=${FPS},setsar=1[c${i}]`)
  const r = rects[i]
  chains.push(`[${clip}:v]scale=${r.w}:${r.h}:force_original_aspect_ratio=increase,crop=${r.w}:${r.h},fps=${FPS},setsar=1,setpts=PTS-STARTPTS[k${i}]`)
  chains.push(`[c${i}][k${i}]overlay=${r.x + r.border}:${r.y + r.border}:eof_action=repeat,trim=duration=${p.seconds},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`)
})
let last = 'v0'
let offset = 0
pngs.slice(1).forEach((p, k) => {
  offset += pngs[k].seconds - FADE
  const label = `x${k + 1}`
  chains.push(`[${last}][v${k + 1}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[${label}]`)
  last = label
})

execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  ...inputs,
  '-filter_complex', chains.join(';'),
  '-map', `[${last}]`,
  '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  out,
], { stdio: ['ignore', 'ignore', 'inherit'] })
process.stdout.write(out)
