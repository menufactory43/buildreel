// Logique pure de Buildreel : lire les actions de Claude, choisir les plans de la vidéo.
// Pas de `$` ici, pour pouvoir tout tester sans moteur.
import type { Cut, Edit, Lang, Moment, Recipe, Scene, Session } from '../types'

const TEST_CMD = /\b(vitest|jest|pytest|(pnpm|npm|yarn|bun)( run)? test|swift test|cargo test|xcodebuild\b.*\btest)\b/
const BUILD_CMD = /\b((pnpm|npm|yarn|bun)( run)? build|vite build|xcodebuild|swift build|cargo build)\b/
const COMMIT_CMD = /\bgit\b[^|;&]*\bcommit\b/
export const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|css|scss|html|svelte|vue|swift|txt|json)$/

export const emptyEdit: Edit = {
  cutId: null,
  name: null,
  from: null,
  to: null,
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
export function buildScenes(session: Session, from: number | null, lang: Lang = 'fr', to: number | null = null): Scene[] {
  const w = WORDS[lang]
  const start = from ?? session.startedAt
  const moments = session.moments.filter(m => m.at >= start && (to === null || m.at <= to))
  const end = moments.at(-1)?.at ?? start
  const shots = moments.filter(m => m.kind === 'capture' && m.image && !/^Merge /.test(m.label))
  const commits = moments.filter(m => m.kind === 'commit' && !/^Merge /.test(m.label))
  const files = new Set(moments.filter(m => m.kind === 'edit').map(m => m.file))
  const scenes: Scene[] = []

  scenes.push({
    id: 'hook',
    kind: 'hook',
    at: start,
    caption: w.hook(`${session.project.charAt(0).toUpperCase()}${session.project.slice(1)}`, formatDuration(end - start, lang)),
    highlight: formatDuration(end - start, lang),
  })

  const last = shots.at(-1)
  const middle = spread(shots.slice(0, -1), 5)
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
  return { type: 'web', url, attente: 1500, etapes: [], clip: { secondes: 2.5, etapes: [] } }
}

export function recipePrompt(url: string) {
  return [
    "Buildreel (un mod de cette session) va filmer l'app que tu construis ici pour en faire une vidéo de 30 s.",
    "Écris sa recette de capture : comment, depuis un Chrome neuf et sans fenêtre, arriver en 2 ou 3 s sur l'écran le plus parlant",
    "et le montrer en action (entrer dans une partie, ouvrir la vraie fonction phare, bouger, utiliser les vraies commandes).",
    `Le serveur de dev détecté est ${url} ; corrige l'adresse ou ajoute le chemin de la bonne page si besoin.`,
    "Réponds UNIQUEMENT par un objet JSON, sans texte autour :",
    '{"type":"web","url":"…","attente":1500,"etapes":[…],"clip":{"secondes":2.5,"etapes":[…]},"pourquoi":"une phrase"}',
    'Étapes possibles : {"touche":"Enter"} · {"maintenir":"ArrowRight","ms":700} · {"maintenir":["ArrowRight","Space"],"ms":500}',
    '· {"clic":{"x":0.5,"y":0.5,"bouton":"left"}} (x et y de 0 à 1) · {"defiler":600} · {"attendre":500}.',
    'Touches : Enter, Space, Escape, ArrowLeft/Right/Up/Down, une lettre ("e"), ShiftLeft. Chaque étape accepte "attendre" (ms) après elle.',
    '"etapes" se joue avant le clip, "clip.etapes" pendant les secondes filmées.',
    'Si l\'app n\'est pas une page web (app iOS, app Mac, CLI, bibliothèque), réponds {"type":"ios"}, {"type":"mac"} ou {"type":"aucun"}.',
  ].join('\n')
}

const STEP_KEYS = ['touche', 'maintenir', 'clic', 'defiler', 'attendre']

export function parseRecipe(text: string, fallbackUrl: string): Recipe | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type
  if (type !== 'web' && type !== 'ios' && type !== 'mac' && type !== 'aucun') return null
  if (type !== 'web') return { type }
  const steps = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter(
      (s): s is Recipe['etapes'] extends (infer T)[] | undefined ? T : never =>
        !!s && typeof s === 'object' && STEP_KEYS.some(k => k in s),
    ).slice(0, 20)
  const clip = (r.clip ?? {}) as Record<string, unknown>
  const url = typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url : fallbackUrl
  return {
    type,
    url,
    attente: Math.min(10_000, Math.max(0, Number(r.attente ?? 1500) || 0)),
    etapes: steps(r.etapes),
    clip: { secondes: Math.min(4, Math.max(0, Number(clip.secondes ?? 2.5) || 0)), etapes: steps(clip.etapes) },
    pourquoi: typeof r.pourquoi === 'string' ? r.pourquoi.slice(0, 200) : undefined,
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

