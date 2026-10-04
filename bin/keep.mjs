// echo <base64> | node keep.mjs <base de sortie> [hash précédent]
// Garde une image que la session vient de voir (capture de Chrome, du simulateur, d'une fenêtre) :
// l'écrit en PNG, écarte les icônes et les doublons, fait la vignette.
// Sort {"ok":true,"image","thumb","width","height","hash"} ou {"ok":false,"reason"}.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const [base, previous = ''] = process.argv.slice(2)
const say = value => process.stdout.write(JSON.stringify(value))

try {
  const bytes = Buffer.from(readFileSync(0, 'utf8').trim(), 'base64')
  const hash = createHash('md5').update(bytes).digest('hex')
  if (hash === previous) {
    say({ ok: false, reason: 'déjà gardée' })
    process.exit(0)
  }
  const raw = `${base}.raw`
  const image = `${base}.png`
  const thumb = `${base}.thumb.png`
  writeFileSync(raw, bytes)
  execFileSync('sips', ['-s', 'format', 'png', raw, '--out', image], { stdio: 'ignore' })
  rmSync(raw, { force: true })
  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', image], { encoding: 'utf8' })
  const width = Number(info.match(/pixelWidth: (\d+)/)?.[1] ?? 0)
  const height = Number(info.match(/pixelHeight: (\d+)/)?.[1] ?? 0)
  if (Math.max(width, height) < 400) {
    rmSync(image, { force: true })
    say({ ok: false, reason: 'trop petite (icône ?)' })
    process.exit(0)
  }
  execFileSync('sips', ['-Z', '320', image, '--out', thumb], { stdio: 'ignore' })
  say({ ok: true, image, thumb, width, height, hash })
} catch (error) {
  say({ ok: false, reason: String(error.message ?? error) })
}
