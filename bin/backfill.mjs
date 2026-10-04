// node backfill.mjs <dépôt> <dossier de sortie> <depuis, en ms> <recette.json>
// Pour chaque commit depuis le début de la session : extrait le commit à part (git worktree),
// lance son serveur Vite, capture l'écran, range tout. Sort [{ at, sha, label, image, thumb }].
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [repo, out, since, recipe] = process.argv.slice(2)
const shoot = fileURLToPath(new URL('./shoot.mjs', import.meta.url))
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
const vite = join(repo, 'node_modules/.bin/vite')
const shots = []
const log = line => {
  process.stderr.write(line + '\n')
  appendFileSync(join(out, 'buildreel.log'), `${new Date().toISOString()} ${line}\n`)
}

if (!existsSync(vite)) {
  process.stdout.write('[]')
  process.exit(0)
}

const commits = git('log', '--reverse', '--no-merges', '--format=%H %ct %s', `--since=@${Math.floor(Number(since) / 1000)}`)
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const [sha, ct, ...subject] = line.split(' ')
    return { sha, at: Number(ct) * 1000, label: subject.join(' ') }
  })

// Un commit qui ne touche que la doc ne change pas l'écran : pas de capture.
const CODE = /\.(ts|tsx|js|jsx|mjs|css|scss|html|svelte|vue|txt|json|png|svg)$/
const touchesCode = sha => git('show', '--name-only', '--format=', sha).split('\n').some(f => CODE.test(f))

async function waitFor(url, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)
    if (ok) return true
    await new Promise(r => setTimeout(r, 300))
  }
  return false
}

let port = 5291
for (const commit of commits) {
  if (!touchesCode(commit.sha)) {
    shots.push({ ...commit })
    continue
  }
  const tree = mkdtempSync(join(tmpdir(), 'buildreel-tree-'))
  let server = null
  try {
    git('worktree', 'add', '--detach', '-f', tree, commit.sha)
    symlinkSync(join(repo, 'node_modules'), join(tree, 'node_modules'))
    port += 1
    server = spawn(vite, ['--port', String(port), '--strictPort'], { cwd: tree, stdio: 'ignore' })
    const url = `http://localhost:${port}`
    if (!(await waitFor(url, 15000))) throw new Error('le serveur ne démarre pas')
    // Même recette qu'en direct, seule l'adresse change.
    let answer = { ok: false, reason: 'pas essayé' }
    for (let attempt = 0; attempt < 2 && !answer.ok; attempt++) {
      try {
        answer = JSON.parse(
          execFileSync('node', [shoot, recipe, join(out, `commit-${commit.sha.slice(0, 7)}`), '', url], {
            encoding: 'utf8',
            timeout: 150_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        )
      } catch (error) {
        answer = { ok: false, reason: `${error.message} ${String(error.stderr ?? '').slice(-300)}` }
      }
      if (!answer.ok) log(`essai ${attempt + 1} raté ${commit.sha.slice(0, 7)} : ${answer.reason}`)
    }
    if (!answer.ok) throw new Error(answer.reason)
    shots.push({ ...commit, image: answer.image, thumb: answer.thumb, clip: answer.clip })
    log(`capturé ${commit.sha.slice(0, 7)} ${commit.label}`)
  } catch (error) {
    log(`raté ${commit.sha.slice(0, 7)} : ${error.message}`)
    shots.push({ ...commit })
  } finally {
    server?.kill('SIGKILL')
    try {
      git('worktree', 'remove', '--force', tree)
    } catch {
      rmSync(tree, { recursive: true, force: true })
      git('worktree', 'prune')
    }
  }
}
process.stdout.write(JSON.stringify(shots))
