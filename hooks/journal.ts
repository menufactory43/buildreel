// Logique pure de Buildreel : lire les actions de Claude, choisir les plans de la vidéo.
// Pas de `$` ici, pour pouvoir tout tester sans moteur.
import type { Cut, Edit, Lang, Moment, Recipe, RecipeStep, Scene, Session } from '../types'

const TEST_CMD = /\b(vitest|jest|pytest|(pnpm|npm|yarn|bun)( run)? test|swift test|cargo test|xcodebuild\b.*\btest)\b/
const BUILD_CMD = /\b((pnpm|npm|yarn|bun)( run)? build|vite build|xcodebuild|swift build|cargo build)\b/
const COMMIT_CMD = /\bgit\b[^|;&]*\bcommit\b/
export const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|css|scss|html|svelte|vue|swift|txt|json)$/

export const emptyEdit: Edit = {
  cutId: null,
  name: null,
  from: null,
  to: null,
  picks: null,
  title: null,
  selected: null,
  captions: {},
  dropped: [],
  status: null,
  output: null,
  post: null,
}

// Textes de la vidéo, en français et en anglais.
export const WORDS = {
  fr: {
    hook: (p: string, d: string) => `J'ai avancé ${p} en ${d}`,
    start: 'Ça commence comme ça',
    shape: 'Ça prend forme',
    red: (n: number) => `${n} test${n > 1 ? 's' : ''} rouge${n > 1 ? 's' : ''}…`,
    green: (n: number) => `… ${n || 'tous'} verts`,
    stats: 'La session en chiffres',
    files: 'fichiers touchés',
    edits: 'modifications',
    commits: 'commits',
    tests: 'tests lancés',
    final: 'Fait avec Claude Code',
  },
  en: {
    hook: (p: string, d: string) => `I built ${p} in ${d}`,
    start: 'Where it started',
    shape: 'Taking shape',
    red: (n: number) => `${n} failing test${n > 1 ? 's' : ''}…`,
    green: (n: number) => `… ${n || 'all'} passing`,
    stats: 'The session in numbers',
    files: 'files touched',
    edits: 'edits',
    commits: 'commits',
    tests: 'test runs',
    final: 'Made with Claude Code',
  },
} as const

export function pickLang(option: unknown, envLang: string | undefined): Lang {
  if (option === 'fr' || option === 'en') return option
  return (envLang ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

export function classifyBash(command: string, output: string, isError: boolean, at: number): Moment | null {
  const id = `m${at}`
  if (COMMIT_CMD.test(command)) {
    if (isError) return null
    const fromOutput = output.match(/\[[^\]\n]+ [0-9a-f]{7,}\] (.+)/)
    const fromFlag = command.match(/-m\s+(?:"([^"]+)"|'([^']+)'|\$\(cat <<'?EOF'?\n([^\n]+))/)
    const label = fromOutput?.[1] ?? fromFlag?.[1] ?? fromFlag?.[2] ?? fromFlag?.[3] ?? 'commit'
    return { id, at, kind: 'commit', label: label.trim() }
  }
  if (TEST_CMD.test(command)) {
    // Vitest et Jest écrivent d'abord « Test Files 1 passed », puis « Tests 19 passed » : on veut la ligne des tests.
    const line = output.match(/^\s*Tests:?\s+.*$/m)?.[0] ?? output
    const failed = Number(line.match(/(\d+) (failed|failing|échoués?)/)?.[1] ?? 0)
    const passed = Number(line.match(/(\d+) (passed|passing|réussis?)/)?.[1] ?? 0)
    const ok = !isError && failed === 0
    return { id, at, kind: 'test', label: ok ? 'tests verts' : 'tests rouges', ok, passed, failed }
  }
  if (BUILD_CMD.test(command)) {
    return { id, at, kind: 'build', label: isError ? 'build cassé' : 'build', ok: !isError }
  }
  return null
}

// Un message de commit tient sur deux lignes de vidéo : on coupe au mot.
export function shorten(text: string, max = 52) {
  const one = text.split('\n')[0]!.trim()
  if (one.length <= max) return one
  const cut = one.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).replace(/[\s,:;·–-]+$/, '')}…`
}

// Une commande qui part travailler ailleurs (`cd ~/autre && git commit`, `git -C ~/autre …`)
// ne raconte rien sur ce projet-ci.
export function runsElsewhere(command: string, root: string, home: string) {
  const targets = [
    ...[...command.matchAll(/(?:^|&&|;|\|\|)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)].map(m => m[1]!),
    ...[...command.matchAll(/\bgit\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)].map(m => m[1]!),
  ]
  return targets.some(raw => {
    const path = raw.replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')
    if (!path.startsWith('/')) return false
    return path !== root && !path.startsWith(root + '/')
  })
}

export function relative(file: string, root: string) {
  return file.startsWith(root + '/') ? file.slice(root.length + 1) : file
}

export function formatDuration(ms: number, lang: 'fr' | 'en' = 'fr') {
  const min = Math.max(1, Math.round(ms / 60000))
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return lang === 'fr' ? `${h} h ${String(m).padStart(2, '0')}` : `${h}h${String(m).padStart(2, '0')}`
}

// Le temps de travail, pas le temps écoulé : un trou de plus de 20 min est une pause (une nuit,
// un repas) et ne compte pas.
export const BREAK_MS = 20 * 60_000
export function activeTime(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b)
  let total = 0
  for (let i = 1; i < sorted.length; i++) total += Math.min(sorted[i]! - sorted[i - 1]!, BREAK_MS)
  return total
}

export function clockTime(at: number) {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Les points où l'on peut faire démarrer la vidéo (le « rewind ») : chaque commit et chaque capture.
export function startPoints(session: Session) {
  return [session.startedAt, ...session.moments.filter(m => m.kind === 'commit' || m.kind === 'capture').map(m => m.at)]
    .filter((at, i, all) => all.indexOf(at) === i)
    .sort((a, b) => a - b)
}

function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  return Array.from({ length: count }, (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]!)
}

// Choisit les plans à partir du journal. Le montage final applique ensuite les choix de la table de montage.
export function buildScenes(
  session: Session,
  from: number | null,
  lang: Lang = 'fr',
  to: number | null = null,
  picks: string[] | null = null,
): Scene[] {
  const w = WORDS[lang]
  const start = from ?? session.startedAt
  const moments = session.moments.filter(m => m.at >= start && (to === null || m.at <= to))
  const end = moments.at(-1)?.at ?? start
  const worked = activeTime([start, ...moments.map(m => m.at)])
  const shots = moments.filter(m => m.kind === 'capture' && m.image && !/^Merge /.test(m.label))
  const commits = moments.filter(m => m.kind === 'commit' && !/^Merge /.test(m.label))
  const files = new Set(moments.filter(m => m.kind === 'edit').map(m => m.file))
  const scenes: Scene[] = []

  scenes.push({
    id: 'hook',
    kind: 'hook',
    at: start,
    caption: w.hook(`${session.project.charAt(0).toUpperCase()}${session.project.slice(1)}`, formatDuration(worked, lang)),
    highlight: formatDuration(worked, lang),
  })

  // Les captures choisies par Claude si elles existent, sinon réparties sur la session.
  const chosen = picks?.length ? shots.filter(s => picks.includes(s.id)) : null
  const last = chosen?.length ? chosen.at(-1) : shots.at(-1)
  const middle = chosen?.length ? chosen.slice(0, -1) : spread(shots.slice(0, -1), 5)
  middle.forEach((shot, i) => {
    const commit = [...commits].reverse().find(c => c.at <= shot.at && c.at >= (middle[i - 1]?.at ?? 0))
    scenes.push({
      id: shot.id,
      kind: 'shot',
      at: shot.at,
      chip: clockTime(shot.at),
      image: shot.image,
      thumb: shot.thumb,
      clip: shot.clip,
      caption: i === 0 ? w.start : commit ? shorten(commit.label) : w.shape,
    })
  })

  const red = moments.find(m => m.kind === 'test' && m.ok === false && (m.failed ?? 0) > 0)
  const green = red && moments.find(m => m.kind === 'test' && m.ok === true && m.at > red.at)
  if (red && green) {
    const n = red.failed ?? 1
    scenes.push({
      id: 'bug-red',
      kind: 'bug-red',
      at: red.at,
      chip: clockTime(red.at),
      caption: w.red(n),
      lines: Array.from({ length: Math.min(n, 4) }, (_, i) => `✗ test ${i + 1}`),
    })
    scenes.push({
      id: 'bug-green',
      kind: 'bug-green',
      at: green.at,
      chip: clockTime(green.at),
      caption: w.green((green.passed ?? 0) >= n ? (green.passed ?? 0) : 0),
      lines: Array.from({ length: Math.min(n, 4) }, (_, i) => `✓ test ${i + 1}`),
    })
  }

  // Entre l'accroche et les chiffres, les plans suivent l'ordre de la session.
  const [hook, ...middleScenes] = scenes
  scenes.splice(0, scenes.length, hook!, ...middleScenes.sort((a, b) => a.at - b.at))

  scenes.push({
    id: 'stats',
    kind: 'stats',
    at: end,
    caption: w.stats,
    stats: [
      { label: w.files, value: String(files.size) },
      { label: w.edits, value: String(moments.filter(m => m.kind === 'edit').length) },
      { label: w.commits, value: String(commits.length) },
      { label: w.tests, value: String(moments.filter(m => m.kind === 'test').length) },
    ],
  })

  if (last) {
    scenes.push({
      id: 'final',
      kind: 'final',
      at: last.at,
      chip: clockTime(last.at),
      image: last.image,
      thumb: last.thumb,
      clip: last.clip,
      caption: w.final,
      highlight: 'Claude Code',
    })
  }
  return scenes
}

// Nom de fichier lisible pour une coupe : « Le multijoueur ! » → « le-multijoueur ».
export function slug(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// Range la coupe en cours dans la liste : remplace celle qui a le même id, sinon l'ajoute.
export function saveCut(cuts: Cut[], edit: Edit, fallbackName: string, renderedAt: number | null): { cuts: Cut[]; cut: Cut } {
  const id = edit.cutId ?? `cut${cuts.length + 1}-${renderedAt ?? 0}`
  const name = edit.name?.trim() || fallbackName
  const previous = cuts.find(c => c.id === id)
  const cut: Cut = { ...edit, cutId: id, id, name, renderedAt: renderedAt ?? previous?.renderedAt ?? null }
  return { cuts: previous ? cuts.map(c => (c.id === id ? cut : c)) : [...cuts, cut], cut }
}

export function applyEdit(scenes: Scene[], edit: Edit) {
  return scenes
    .filter(s => !edit.dropped.includes(s.id))
    .map(s => ({ ...s, caption: edit.captions[s.id] ?? s.caption }))
}

export const SECONDS: Record<Scene['kind'], number> = {
  hook: 2.8,
  shot: 3.2,
  'bug-red': 1.8,
  'bug-green': 2.2,
  stats: 3,
  final: 3.6,
}

export function runtime(scenes: Scene[]) {
  return scenes.reduce((sum, s) => sum + SECONDS[s.kind], 0)
}

// ─── Recette de capture ──────────────────────────────────────────────────────
// Le Claude de la session connaît l'app qu'il construit : c'est lui qui dit comment la montrer.

export function defaultRecipe(url: string): Recipe {
  return { type: 'web', url, delay: 1500, steps: [], clip: { seconds: 2.5, steps: [] } }
}

export function recipePrompt(url: string) {
  return [
    'Buildreel (a mod in this session) is going to film the app you are building here, to cut a 30 s video.',
    'Write its capture recipe: how to get, from a fresh headless Chrome, to the most telling screen in 2 or 3 s',
    'and show it in action (start a game, open the main feature, move around, use the real controls).',
    `The dev server found is ${url}; fix the address or add the path of the right page if needed.`,
    'Reply ONLY with a JSON object, no text around it:',
    '{"type":"web","url":"…","delay":1500,"steps":[…],"clip":{"seconds":2.5,"steps":[…]},"why":"one sentence"}',
    'Steps: {"key":"Enter"} · {"hold":"ArrowRight","ms":700} · {"hold":["ArrowRight","Space"],"ms":500}',
    '· {"click":{"x":0.5,"y":0.5,"button":"left"}} (x and y from 0 to 1) · {"scroll":600} · {"wait":500}.',
    'Keys: Enter, Space, Escape, ArrowLeft/Right/Up/Down, a letter ("e"), ShiftLeft. Every step takes "wait" (ms) after it.',
    '"steps" run before the clip, "clip.steps" during the filmed seconds.',
    'If the app is not a web page (iOS app, Mac app, CLI, library), reply {"type":"ios"}, {"type":"mac"} or {"type":"none"}.',
  ].join('\n')
}

// Les premières recettes étaient écrites en français : on les lit toujours.
const FRENCH: Record<string, string> = {
  touche: 'key', maintenir: 'hold', clic: 'click', bouton: 'button', defiler: 'scroll', attendre: 'wait',
  attente: 'delay', etapes: 'steps', secondes: 'seconds', pourquoi: 'why', aucun: 'none',
}
function english(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(english)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [FRENCH[k] ?? k, english(v)]))
  }
  return typeof value === 'string' && FRENCH[value] ? FRENCH[value] : value
}

const STEP_KEYS = ['key', 'hold', 'click', 'scroll', 'wait']

export function parseRecipe(text: string, fallbackUrl: string): Recipe | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  let raw: unknown
  try {
    raw = english(JSON.parse(json))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type
  if (type !== 'web' && type !== 'ios' && type !== 'mac' && type !== 'none') return null
  if (type !== 'web') return { type }
  const steps = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .filter((s): s is RecipeStep => !!s && typeof s === 'object' && STEP_KEYS.some(k => k in s))
      .slice(0, 20)
  const clip = (r.clip ?? {}) as Record<string, unknown>
  const url = typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url : fallbackUrl
  return {
    type,
    url,
    delay: Math.min(10_000, Math.max(0, Number(r.delay ?? 1500) || 0)),
    steps: steps(r.steps),
    clip: { seconds: Math.min(4, Math.max(0, Number(clip.seconds ?? 2.5) || 0)), steps: steps(clip.steps) },
    why: typeof r.why === 'string' ? r.why.slice(0, 200) : undefined,
  }
}

// ─── Texte du post ───────────────────────────────────────────────────────────

export function postPrompt(lang: Lang, scenes: Scene[]) {
  const plan = scenes.map(s => `- ${s.caption}`).join('\n')
  return lang === 'fr'
    ? [
        "Buildreel vient de monter une vidéo verticale de 30 s de cette session, pour la poster sur X en build in public. Les plans :",
        plan,
        "Écris le texte du post qui l'accompagne : 280 caractères maximum, en français, à la première personne, ton naturel d'indie qui montre son avancée.",
        "Dis concrètement ce qui a été construit (tu le sais, c'est cette session), une seule idée forte, mentionne Claude Code une fois.",
        "Zéro ou un hashtag, pas d'émojis en série, pas de formule pub. Réponds UNIQUEMENT par le texte du post.",
      ].join('\n')
    : [
        'Buildreel just cut a 30 s vertical video of this session, to post on X as build in public. The shots:',
        plan,
        'Write the post that goes with it: 280 characters max, in English, first person, the natural voice of an indie dev sharing progress.',
        'Say concretely what got built (you know, it is this session), one strong idea, mention Claude Code once.',
        'Zero or one hashtag, no emoji strings, no ad copy. Reply ONLY with the post text.',
      ].join('\n')
}

export function cleanPost(text: string) {
  return text.trim().replace(/^```\w*\n?|```$/g, '').replace(/^["«]\s*|\s*["»]$/g, '').trim().slice(0, 280)
}

// ─── Ce que la session regarde ──────────────────────────────────────────────

const SHOT_TOOL = /screenshot|screen|snapshot|simulator|simctl|computer|browser|chrome|playwright|puppeteer|xcode|ios|preview|capture/i
const SHOT_FILE = /screenshot|screen[ _-]?shot|capture|simulator|\bsim[-_]|shot|frame|\/tmp\/|\/var\/folders\/|scratchpad/i
const ASSET_FILE = /assets?\b|xcassets|\/public\/|\/docs\/|icon|logo|mockup|maquette|design/i

export function isShot(info: { tool: string; file?: string } | undefined, tool: string, dir: string) {
  const name = info?.tool ?? tool
  if (name === 'Read') {
    const file = info?.file ?? ''
    return !file.startsWith(dir) && SHOT_FILE.test(file) && !ASSET_FILE.test(file)
  }
  return SHOT_TOOL.test(name)
}

export function imagesOf(content: readonly { type: string; [field: string]: unknown }[]) {
  const found: { toolUseId?: string; data: string }[] = []
  const take = (block: { type: string; [field: string]: unknown }, toolUseId?: string) => {
    const source = block.source as { type?: string; data?: string } | undefined
    if (block.type === 'image' && source?.type === 'base64' && typeof source.data === 'string') {
      found.push({ toolUseId, data: source.data })
    }
  }
  for (const block of content) {
    if (block.type === 'tool_result' && Array.isArray(block.content)) {
      for (const inner of block.content as { type: string; [field: string]: unknown }[]) take(inner, String(block.tool_use_id))
    } else {
      take(block)
    }
  }
  return found
}


// ─── Le choix des moments par Claude ─────────────────────────────────────────
// Les règles répartissent les captures sur la durée ; le Claude de la session sait lesquelles
// montrent un vrai progrès, et sait le dire avec des mots de spectateur.

export type Direction = { hook?: string; shots: { id: string; caption: string }[]; bug: boolean }

export function directorPrompt(lang: Lang, session: Session, from: number | null, to: number | null) {
  const start = from ?? session.startedAt
  const moments = session.moments.filter(m => m.at >= start && (to === null || m.at <= to))
  const worked = formatDuration(activeTime([start, ...moments.map(m => m.at)]), lang)
  const lines = moments
    .filter(m => m.kind !== 'edit' && !/^Merge /.test(m.label))
    .map(m => {
      const at = clockTime(m.at)
      if (m.kind === 'capture') return `- capture id=${m.id} at ${at}${m.clip ? ' (with a short clip)' : ''}`
      if (m.kind === 'commit') return `- commit at ${at}: ${m.label}`
      if (m.kind === 'test') return `- tests at ${at}: ${m.ok ? `green (${m.passed ?? '?'} passing)` : `red (${m.failed ?? '?'} failing)`}`
      return `- ${m.kind} at ${at}: ${m.label}`
    })
    .join('\n')
  return [
    `Buildreel is cutting a 30 s vertical build-in-public video of this session (${worked} of work on ${session.project}). Here is what it logged, in order:`,
    lines,
    'Pick the shots, as the person who did the work. Choose 3 to 6 captures (by id) that show visible progress or the most striking state of the app, in chronological order, and write each caption for a viewer who does not know the code: plain words, 50 characters max, no commit jargon.',
    `Write the hook: what got built, 60 characters max, and keep the duration "${worked}" in it.`,
    'Say whether the failing-then-passing tests are worth a shot ("bug": true or false).',
    `Write in ${lang === 'fr' ? 'French' : 'English'}. Reply ONLY with JSON: {"hook":"…","shots":[{"id":"…","caption":"…"}],"bug":true}`,
  ].join('\n')
}

export function parseDirection(text: string, captureIds: string[]): Direction | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  let raw: { hook?: unknown; shots?: unknown; bug?: unknown }
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const shots = (Array.isArray(raw.shots) ? raw.shots : [])
    .filter((s): s is { id: string; caption?: unknown } => !!s && typeof s === 'object' && captureIds.includes(String((s as { id?: unknown }).id)))
    .map(s => ({ id: String(s.id), caption: typeof s.caption === 'string' ? s.caption.trim().slice(0, 70) : '' }))
    .filter((s, i, all) => all.findIndex(o => o.id === s.id) === i)
    .slice(0, 6)
  if (shots.length === 0) return null
  return {
    hook: typeof raw.hook === 'string' && raw.hook.trim() ? raw.hook.trim().slice(0, 80) : undefined,
    shots,
    bug: raw.bug !== false,
  }
}

// Applique le choix de Claude à la coupe : ses captures, ses textes, le bug gardé ou non.
export function applyDirection(edit: Edit, direction: Direction): Edit {
  const captions: Record<string, string> = { ...edit.captions }
  if (direction.hook) captions.hook = direction.hook
  for (const shot of direction.shots) if (shot.caption) captions[shot.id] = shot.caption
  const bugIds = ['bug-red', 'bug-green']
  const dropped = edit.dropped.filter(id => !bugIds.includes(id) && !direction.shots.some(s => s.id === id))
  return { ...edit, picks: direction.shots.map(s => s.id), captions, dropped: direction.bug ? dropped : [...dropped, ...bugIds] }
}
