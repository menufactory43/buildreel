import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cut, Edit, Lang, Moment, Recipe, Scene, Session } from '../types'
import {
  CODE_FILE,
  activeTime,
  applyDirection,
  applyEdit,
  buildScenes,
  classifyBash,
  cleanPost,
  clockTime,
  defaultRecipe,
  directorPrompt,
  emptyEdit,
  formatDuration,
  parseDirection,
  parseRecipe,
  pickLang,
  postPrompt,
  recipePrompt,
  relative,
  runsElsewhere,
  imagesOf,
  isShot,
  runtime,
  saveCut,
  slug,
  startPoints,
} from './journal'

const PANE = 'buildreel-table'
const sessionRef = atom({ plugin: 'buildreel', key: 'session' } as const, null)
const editRef = atom({ plugin: 'buildreel', key: 'edit' } as const, emptyEdit)
const cutsRef = atom({ plugin: 'buildreel', key: 'cuts' } as const, [] as Cut[])
const renderingRef = atom({ plugin: 'buildreel', key: 'rendering' } as const, false)

const CAPTURE_GAP_MS = 45_000

// Textes de l'interface, en français et en anglais.
const UI = {
  fr: {
    kind: { hook: 'Accroche', shot: 'Capture', 'bug-red': 'Bug', 'bug-green': 'Réparé', stats: 'Chiffres', final: 'Fin' },
    description: 'Buildreel : table de montage de la vidéo de ta session (/reel monter, import, capture, recette, url <adresse>)',
    moments: 'moments',
    shots: (n: number) => `${n} capture${n > 1 ? 's' : ''}`,
    toEdit: '/reel pour monter',
    noSession: 'Aucune session enregistrée.',
    plans: (n: number, s: number) => `${n} plans · ${s} s`,
    local: (dir: string) => `Rien n'est partagé : tout reste dans ${dir}.`,
    start: 'Départ',
    end: 'Fin',
    sessionStart: 'début de la session',
    sessionEnd: 'fin de la session',
    cuts: 'Coupes',
    newCut: '+ Nouvelle coupe',
    cutName: 'Nom de la coupe',
    untitled: (n: number) => `Coupe ${n}`,
    rendered: 'vidéo prête',
    capture: 'capture',
    captionOf: (i: number) => `Texte ${i}`,
    keep: 'garder',
    render: 'Monter la vidéo',
    open: 'Ouvrir',
    finder: 'Dans le Finder',
    copy: 'Copier le post',
    copied: 'Post copié.',
    post: 'Post pour X',
    rendering: (n: number) => `Montage de ${n} plans en cours (environ 30 s)…`,
    writingPost: 'Vidéo montée, Claude écrit le post…',
    directing: 'Claude choisit les plans…',
    directed: (n: number) => `Claude a choisi ${n} plans et écrit leurs textes.`,
    directFailed: "Claude n'a pas pu choisir : les plans sont répartis sur la session.",
    direct: '↻ Claude choisit',
    busyRender: 'Montage en cours…',
    alreadyRendering: 'Un montage est déjà en cours.',
    ready: (out: string) => `Vidéo prête : ${out}`,
    failed: (why: string) => `Le montage a échoué : ${why}`,
    opened: 'Table de montage ouverte.',
    importing: 'Buildreel rattrape la session (une capture par commit, ça peut prendre une minute)…',
    recipeBy: (f: string) => `Buildreel : recette de capture écrite par Claude (${f})`,
    noType: (t: string) => `pas encore de capture pour une app de type « ${t} »`,
    busy: 'capture déjà en cours',
    unchanged: 'écran identique, capture ignorée',
    taken: 'capture prise',
    caught: (n: number, at: string, shots: number) =>
      `${n} moments rattrapés depuis ${at}, dont ${shots} capture${shots > 1 ? 's' : ''} de commits`,
    newRecipe: (why: string, file: string) => `nouvelle recette (${why}). Elle se modifie à la main dans ${file}.`,
    nowUrl: (url: string) => `Buildreel capture désormais ${url}.`,
    serverOff: (url: string) =>
      `Buildreel : rien ne répond sur ${url}. Lance ton serveur de dev pour les captures, ou indique la bonne adresse avec /reel url <adresse>.`,
    none: 'aucune session',
    notProject: "Buildreel n'enregistre que dans un projet (un dépôt git). Lance Claude Code dans le dossier de ton app.",
  },
  en: {
    kind: { hook: 'Hook', shot: 'Shot', 'bug-red': 'Bug', 'bug-green': 'Fixed', stats: 'Numbers', final: 'Ending' },
    description: 'Buildreel: editing table for the video of your session (/reel render, import, shot, recipe, url <address>)',
    moments: 'moments',
    shots: (n: number) => `${n} shot${n > 1 ? 's' : ''}`,
    toEdit: '/reel to edit',
    noSession: 'No session recorded yet.',
    plans: (n: number, s: number) => `${n} shots · ${s} s`,
    local: (dir: string) => `Nothing is shared: everything stays in ${dir}.`,
    start: 'Start',
    end: 'End',
    sessionStart: 'start of the session',
    sessionEnd: 'end of the session',
    cuts: 'Cuts',
    newCut: '+ New cut',
    cutName: 'Name of the cut',
    untitled: (n: number) => `Cut ${n}`,
    rendered: 'video ready',
    capture: 'shot',
    captionOf: (i: number) => `Text ${i}`,
    keep: 'keep',
    render: 'Render the video',
    open: 'Open',
    finder: 'Show in Finder',
    copy: 'Copy the post',
    copied: 'Post copied.',
    post: 'Post for X',
    rendering: (n: number) => `Rendering ${n} shots (about 30 s)…`,
    writingPost: 'Video cut, Claude is writing the post…',
    directing: 'Claude is picking the shots…',
    directed: (n: number) => `Claude picked ${n} shots and wrote their captions.`,
    directFailed: 'Claude could not pick: shots are spread over the session.',
    direct: '↻ Let Claude pick',
    busyRender: 'Rendering…',
    alreadyRendering: 'A render is already running.',
    ready: (out: string) => `Video ready: ${out}`,
    failed: (why: string) => `Rendering failed: ${why}`,
    opened: 'Editing table opened.',
    importing: 'Buildreel is catching up on the session (one shot per commit, this can take a minute)…',
    recipeBy: (f: string) => `Buildreel: capture recipe written by Claude (${f})`,
    noType: (t: string) => `no capture yet for a "${t}" app`,
    busy: 'a capture is already running',
    unchanged: 'same screen, shot skipped',
    taken: 'shot taken',
    caught: (n: number, at: string, shots: number) =>
      `${n} moments caught up since ${at}, including ${shots} commit shot${shots > 1 ? 's' : ''}`,
    newRecipe: (why: string, file: string) => `new recipe (${why}). Edit it by hand in ${file}.`,
    nowUrl: (url: string) => `Buildreel now films ${url}.`,
    serverOff: (url: string) =>
      `Buildreel: nothing answers on ${url}. Start your dev server to get shots, or point to the right address with /reel url <address>.`,
    none: 'no session',
    notProject: 'Buildreel only records inside a project (a git repository). Start Claude Code in your app folder.',
  },
} as const

let root = ''
let home = ''
// Hors d'un dépôt git (le dossier personnel, /tmp…), il n'y a pas d'app à raconter : le mod se tait.
let active = false
let lang: Lang = 'en'
let busy = false
let lastCaptureAt = 0
let lastHash = ''
let pending: { cancel: () => void } | null = null
// On ne prévient qu'une fois par adresse que le serveur de dev ne répond pas.
let warnedUrl = ''

function tilde(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

async function save($: EngineInterface, session: Session) {
  await $.fs.write(`${session.dir}/journal.json`, JSON.stringify(session, null, 1))
}

async function record($: EngineInterface, moment: Moment) {
  const held = await read($, sessionRef)
  if (!held) return
  const next = { ...held, moments: [...held.moments, moment] }
  await update($, sessionRef, () => next)
  await save($, next)
}

function recipeFile(session: Session) {
  return `${session.dir.replace(/\/[^/]+$/, '')}/recipe.json`
}

// Une recette par projet, écrite une fois par le Claude de la session (qui connaît l'app),
// redemandée si la précédente n'était que celle par défaut. Modifiable à la main.
async function ensureRecipe($: EngineInterface, session: Session, renew = false): Promise<Recipe> {
  const file = recipeFile(session)
  if (!renew && (await $.fs.exists(file))) {
    const held = parseRecipe(await $.fs.read(file), session.url)
    if (held && held.why !== 'default') return held
  }
  // D'abord le Claude de la session, qui a l'historique en tête. Au tout début d'une session
  // reprise il n'a encore rien échangé : on lui montre alors les fichiers du projet.
  const forked = await $.model.fork({ prompt: recipePrompt(session.url) })
  let written = forked.isAnswered ? parseRecipe(forked.text, session.url) : null
  if (!written) {
    const reply = await $.model.complete({
      model: 'sonnet',
      prompt: `${recipePrompt(session.url)}\n\nThe project's files:\n${await projectContext($)}`,
      maxTokens: 1200,
      timeoutMs: 90_000,
    })
    written = reply.isAnswered ? parseRecipe(reply.text, session.url) : null
  }
  const recipe = written ?? { ...defaultRecipe(session.url), why: 'default' }
  await $.fs.write(file, JSON.stringify(recipe, null, 2))
  if (written) $.ui.toast(UI[lang].recipeBy(tilde(file)))
  return recipe
}

const CONTEXT_FILES = /^(package\.json|readme\.md|design\.md|claude\.md|index\.html|vite\.config\.\w+)$/i
const CONTEXT_CODE = /^(main|app|index|input|keys|controls|game|router|routes)\.(ts|tsx|js|jsx|mjs|vue|svelte)$/i

// Ce qu'il faut pour deviner comment montrer l'app : la doc, le point d'entrée et la gestion des touches.
async function projectContext($: EngineInterface) {
  const picked: string[] = []
  const walk = async (dir: string, depth: number) => {
    let entries: Awaited<ReturnType<typeof $.fs.list>> = []
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.kind === 'dir' && depth < 2 && !/^(node_modules|dist|build|\.git|\.next)$/.test(entry.name)) {
        await walk(path, depth + 1)
      } else if (entry.kind === 'file' && (CONTEXT_FILES.test(entry.name) || CONTEXT_CODE.test(entry.name))) {
        picked.push(path)
      }
    }
  }
  await walk(root, 0)
  const parts: string[] = []
  for (const path of picked.slice(0, 10)) {
    try {
      parts.push(`--- ${relative(path, root)}\n${(await $.fs.read(path)).slice(0, 6000)}`)
    } catch {
      // fichier illisible : on passe
    }
  }
  return parts.join('\n\n')
}

async function capture($: EngineInterface, force = false) {
  const t = UI[lang]
  const session = await read($, sessionRef)
  const now = await $.clock.now()
  if (!session) return t.none
  if (busy || (!force && now - lastCaptureAt < CAPTURE_GAP_MS)) return t.busy
  busy = true
  try {
    const recipe = await ensureRecipe($, session)
    if (recipe.type !== 'web') return t.noType(recipe.type)
    const base = `${session.dir}/shot-${now}`
    const ran = await $.process.run(['node', `${$.plugin.root}/bin/shoot.mjs`, recipeFile(session), base, lastHash], {
      timeoutMs: 90_000,
    })
    const answer = JSON.parse(ran.stdout || '{"ok":false,"reason":"no answer"}')
    if (answer.unreachable && warnedUrl !== recipe.url) {
      warnedUrl = recipe.url ?? ''
      $.ui.toast(t.serverOff(recipe.url ?? session.url), { timeoutMs: 10_000 })
    }
    if (!answer.ok) return answer.reason as string
    lastHash = answer.hash
    if (answer.dup) return t.unchanged
    lastCaptureAt = now
    await record($, {
      id: `c${now}`,
      at: now,
      kind: 'capture',
      label: 'capture',
      image: answer.image,
      thumb: answer.thumb,
      clip: answer.clip ?? undefined,
    })
    return t.taken
  } catch (error) {
    return String(error)
  } finally {
    busy = false
  }
}

// ─── Ce que la session regarde ──────────────────────────────────────────────
// Quand Claude teste son travail, l'app est dans l'état qui vaut le coup : on garde les captures
// qu'il prend pour vérifier son travail.

const SESSION_GAP_MS = 15_000

const toolInputs = new Map<string, { tool: string; file?: string }>()
let lastKeptAt = 0
let lastKeptHash = ''

async function keepImage($: EngineInterface, data: string) {
  const session = await read($, sessionRef)
  const now = await $.clock.now()
  if (!session || now - lastKeptAt < SESSION_GAP_MS) return
  lastKeptAt = now
  const base = `${session.dir}/seen-${now}`
  const ran = await $.process.run(['node', `${$.plugin.root}/bin/keep.mjs`, base, lastKeptHash], { stdin: data, timeoutMs: 30_000 })
  const answer = JSON.parse(ran.stdout || '{"ok":false}')
  if (!answer.ok) return
  lastKeptHash = answer.hash
  await record($, { id: `v${now}`, at: now, kind: 'capture', label: 'seen', image: answer.image, thumb: answer.thumb })
}

async function lastCommitSubject($: EngineInterface) {
  try {
    const ran = await $.process.run(['git', '-C', root, 'log', '-1', '--format=%s'], { timeoutMs: 5000 })
    return ran.exitCode === 0 && ran.stdout.trim() ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

function scheduleCapture($: EngineInterface, delay: number) {
  pending?.cancel()
  pending = $.clock.after(delay, () => void capture($))
}

type RawEvent = { at: number; tool: string; file?: string; command?: string; output: string; isError: boolean }
type CommitShot = { at: number; sha: string; label: string; image?: string; thumb?: string; clip?: string | null }

// Rattrape ce qui s'est passé avant le chargement du mod : l'historique de la session
// (modifications, tests, commits) et une capture de chaque commit depuis son début.
async function importSession($: EngineInterface) {
  const t = UI[lang]
  const session = await read($, sessionRef)
  if (!session) return t.none
  const home = (await $.env.get('HOME')) ?? ''
  const folder = `${home}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}`
  if (!(await $.fs.exists(folder))) return `no history in ${folder}`
  const newest = (await $.fs.list(folder))
    .filter(f => f.name.endsWith('.jsonl'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!newest) return `no history in ${folder}`

  const read1 = await $.process.run(['node', `${$.plugin.root}/bin/import.mjs`, `${folder}/${newest.name}`], {
    timeoutMs: 60_000,
  })
  const events: RawEvent[] = JSON.parse(read1.stdout || '[]')
  const moments: Moment[] = []
  for (const ev of events) {
    const id = `i${ev.at}`
    if ((ev.tool === 'Edit' || ev.tool === 'Write') && ev.file && !ev.isError) {
      const file = relative(ev.file, root)
      moments.push({ id, at: ev.at, kind: 'edit', label: file, file })
    } else if (ev.tool === 'Bash' && ev.command && !runsElsewhere(ev.command, root, home)) {
      // Les commits viennent de git, plus bas : c'est la seule liste sûre.
      const moment = classifyBash(ev.command, ev.output, ev.isError, ev.at)
      if (moment && moment.kind !== 'commit') moments.push({ ...moment, id })
    }
  }
  const since = Math.min(events[0]?.at ?? session.startedAt, session.startedAt)

  const log = await $.process.run(
    ['git', '-C', root, 'log', '--no-merges', '--reverse', '--format=%H %ct %s', `--since=@${Math.floor(since / 1000)}`],
    { timeoutMs: 10_000 },
  )
  for (const line of log.exitCode === 0 ? log.stdout.split('\n').filter(Boolean) : []) {
    const [sha = '', ct = '0', ...subject] = line.split(' ')
    moments.push({ id: `g${sha.slice(0, 7)}`, at: Number(ct) * 1000, kind: 'commit', label: subject.join(' ') })
  }

  const recipe = await ensureRecipe($, session)
  let commits: CommitShot[] = []
  if (recipe.type === 'web') {
    const read2 = await $.process.run(
      ['node', `${$.plugin.root}/bin/backfill.mjs`, root, session.dir, String(since), recipeFile(session)],
      { timeoutMs: 600_000 },
    )
    commits = JSON.parse(read2.stdout || '[]')
  }
  for (const c of commits) {
    if (c.image) {
      moments.push({
        id: `s${c.sha.slice(0, 7)}`,
        at: c.at + 1,
        kind: 'capture',
        label: c.label,
        image: c.image,
        thumb: c.thumb,
        clip: c.clip ?? undefined,
      })
    }
  }

  const known = new Set(session.moments.map(m => m.id))
  const merged = [...session.moments, ...moments.filter(m => !known.has(m.id))].sort((a, b) => a.at - b.at)
  const next = { ...session, startedAt: Math.min(since, merged[0]?.at ?? since), moments: merged }
  await update($, sessionRef, () => next)
  await save($, next)
  return t.caught(moments.length, clockTime(next.startedAt), commits.filter(c => c.image).length)
}

// Claude choisit les captures qui montrent un vrai progrès et écrit les textes pour un spectateur.
// Les règles (captures réparties sur la session) restent là s'il ne répond pas.
let directing = false
async function direct($: EngineInterface) {
  const t = UI[lang]
  const session = await read($, sessionRef)
  if (!session || directing) return
  directing = true
  try {
    const edit = await read($, editRef)
    const ids = session.moments.filter(m => m.kind === 'capture' && m.image).map(m => m.id)
    if (ids.length === 0) return
    await update($, editRef, ed => ({ ...ed, status: t.directing }))
    const prompt = directorPrompt(lang, session, edit.from, edit.to)
    const forked = await $.model.fork({ prompt })
    let direction = forked.isAnswered ? parseDirection(forked.text, ids) : null
    if (!direction) {
      const reply = await $.model.complete({ model: 'sonnet', prompt, maxTokens: 900, timeoutMs: 90_000 })
      direction = reply.isAnswered ? parseDirection(reply.text, ids) : null
    }
    const found = direction
    await update($, editRef, ed =>
      found ? { ...applyDirection(ed, found), status: t.directed(found.shots.length) } : { ...ed, picks: [], status: t.directFailed },
    )
  } finally {
    directing = false
  }
}

// Monte la vidéo avec les choix de la table de montage, puis demande au Claude de la session
// le texte du post qui l'accompagne.
async function renderReel($: EngineInterface) {
  const t = UI[lang]
  const session = await read($, sessionRef)
  if (!session) return t.none
  // Un seul montage à la fois : un deuxième clic pendant le montage ne relance rien.
  let claimed = false
  await update($, renderingRef, busy => {
    claimed = !busy
    return true
  })
  if (!claimed) {
    $.ui.toast(t.alreadyRendering)
    return t.alreadyRendering
  }
  try {
    return await renderOnce($, session)
  } finally {
    await update($, renderingRef, () => false)
  }
}

async function renderOnce($: EngineInterface, session: Session) {
  const t = UI[lang]
  if ((await read($, editRef)).picks === null) await direct($)
  const edit = await read($, editRef)
  const cuts = await read($, cutsRef)
  const kept = applyEdit(buildScenes(session, edit.from, lang, edit.to, edit.picks), edit)
  const now = await $.clock.now()
  const name = edit.name?.trim() || t.untitled(cuts.length + (edit.cutId ? 0 : 1))
  const out = `${session.dir}/${session.project}-${slug(name) || 'reel'}-${clockTime(now).replace(':', 'h')}.mp4`
  const planPath = out.replace(/\.mp4$/, '.plan.json')
  await $.fs.write(planPath, JSON.stringify({ project: session.project, lang, scenes: kept }, null, 1))
  await update($, editRef, ed => ({ ...ed, status: t.rendering(kept.length), output: null, post: null }))
  $.ui.toast(t.rendering(kept.length))
  const ran = await $.process.run(['node', `${$.plugin.root}/bin/montage.mjs`, planPath, out], { timeoutMs: 600_000 })
  if (ran.exitCode !== 0) {
    const status = t.failed((ran.stderr || ran.stdout).slice(-240))
    await update($, editRef, ed => ({ ...ed, status }))
    return status
  }
  await update($, editRef, ed => ({ ...ed, status: t.writingPost }))
  const forked = await $.model.fork({ prompt: postPrompt(lang, kept) })
  let post = forked.isAnswered ? cleanPost(forked.text) : null
  if (!post) {
    const commits = session.moments.filter(m => m.kind === 'commit').map(m => `- ${m.label}`).join('\n')
    const reply = await $.model.complete({
      model: 'sonnet',
      prompt: `${postPrompt(lang, kept)}\n\nCommits of the session:\n${commits}\n\nThe project's files:\n${await projectContext($)}`,
      maxTokens: 600,
      timeoutMs: 90_000,
    })
    post = reply.isAnswered ? cleanPost(reply.text) : null
  }
  if (post) await $.fs.write(out.replace(/\.mp4$/, '.txt'), post + '\n')
  const done = { ...(await read($, editRef)), name, status: t.ready(tilde(out)), output: out, post }
  const saved = saveCut(await read($, cutsRef), done, name, now)
  await update($, cutsRef, () => saved.cuts)
  await update($, editRef, () => ({ ...done, cutId: saved.cut.id }))
  await $.fs.write(`${session.dir}/cuts.json`, JSON.stringify(saved.cuts, null, 1))
  $.ui.toast(t.ready(tilde(out)), { timeoutMs: 10_000 })
  return post ? `${t.ready(tilde(out))}\n\n${post}` : t.ready(tilde(out))
}

async function detectUrl($: EngineInterface, cwd: string) {
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    if (!(await $.fs.exists(`${cwd}/${name}`))) continue
    const port = (await $.fs.read(`${cwd}/${name}`)).match(/port:\s*(\d+)/)?.[1]
    return `http://localhost:${port ?? 5173}`
  }
  for (const name of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
    if (await $.fs.exists(`${cwd}/${name}`)) return 'http://localhost:3000'
  }
  if (await $.fs.exists(`${cwd}/astro.config.mjs`)) return 'http://localhost:4321'
  return 'http://localhost:5173'
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    lang = pickLang(options.lang, await $.env.get('LANG'))
    await $.command.register({ name: 'reel', description: UI[lang].description })
    const cwd = await $.session.cwd()
    const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 }).catch(() => null)
    root = top?.exitCode === 0 ? top.stdout.trim() : ''
    active = root !== '' && root !== home
    if (active && !(await read($, sessionRef))) {
      const home = (await $.env.get('HOME')) ?? '/tmp'
      const project = root.split('/').pop() || 'project'
      const now = await $.clock.now()
      const d = new Date(now)
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const base = (await $.env.get('BUILDREEL_HOME')) ?? `${home}/Movies/buildreel`
      const dir = `${base}/${project}/${day}`
      const file = `${dir}/journal.json`
      const session: Session = (await $.fs.exists(file))
        ? JSON.parse(await $.fs.read(file))
        : { project, dir, url: await detectUrl($, root), startedAt: now, moments: [] }
      await update($, sessionRef, () => session)
      await save($, session)
      if (await $.fs.exists(`${dir}/cuts.json`)) {
        const cuts: Cut[] = JSON.parse(await $.fs.read(`${dir}/cuts.json`))
        await update($, cutsRef, () => cuts)
      }
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!active) return next(e)
    toolInputs.set(e.tool_use_id, { tool: String(e.tool), file: e.tool === 'Read' ? e.file_path : undefined })
    if (toolInputs.size > 200) toolInputs.delete(toolInputs.keys().next().value!)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const at = await $.clock.now()
    if (e.tool === 'Edit' || e.tool === 'Write') {
      if (ran.isError) return ran
      const file = relative(e.file_path, root)
      await record($, { id: `e${at}`, at, kind: 'edit', label: file, file })
      if (CODE_FILE.test(file)) scheduleCapture($, 4000)
    } else if (e.tool === 'Bash') {
      if (runsElsewhere(e.command, root, home)) return ran
      const found = classifyBash(e.command, ran.text ?? '', ran.isError === true, at)
      // Le message d'un commit se lit dans git : ça marche quelle que soit la façon de l'écrire.
      const moment = found?.kind === 'commit' ? { ...found, label: (await lastCommitSubject($)) ?? found.label } : found
      if (moment) {
        await record($, moment)
        if (moment.kind === 'commit' || moment.ok) scheduleCapture($, 1500)
      }
    }
    return ran
  })

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (!active) return stored
    if (e.origin.kind === 'tool' && e.door === 'tool-result') {
      const session = await read($, sessionRef)
      const origin = e.origin.tool
      const shots = session
        ? imagesOf(e.message.content).filter(img => isShot(img.toolUseId ? toolInputs.get(img.toolUseId) : undefined, origin, session.dir))
        : []
      const last = shots.at(-1)
      if (last) $.clock.after(0, () => void keepImage($, last.data))
    }
    return stored
  })

  on('command.run', { command: 'reel' }, async ($, e) => {
    const t = UI[lang]
    if (!active) return { text: t.notProject }
    const args = (e.args ?? '').trim()
    if (args === 'import') {
      $.ui.toast(t.importing)
      const said = await importSession($)
      const shot = await capture($, true)
      return { text: `Buildreel: ${said} · ${shot}.` }
    }
    if (args === 'capture' || args === 'shot') return { text: `Buildreel: ${await capture($, true)}.` }
    if (args === 'monter' || args === 'render') return { text: await renderReel($) }
    if (args === 'recette' || args === 'recipe') {
      const session = await read($, sessionRef)
      if (!session) return { text: t.none }
      const recipe = await ensureRecipe($, session, true)
      return { text: `Buildreel: ${t.newRecipe(recipe.why ?? recipe.type, tilde(recipeFile(session)))}` }
    }
    if (args.startsWith('url ')) {
      const url = args.slice(4).trim()
      const session = await read($, sessionRef)
      if (!session) return { text: t.none }
      await update($, sessionRef, s => (s ? { ...s, url } : s))
      const recipe = await ensureRecipe($, session)
      await $.fs.write(recipeFile(session), JSON.stringify({ ...recipe, url }, null, 2))
      return { text: t.nowUrl(url) }
    }
    await $.ui.open({ id: PANE, title: 'Buildreel', focus: true })
    if ((await read($, editRef)).picks === null) $.clock.after(0, () => void direct($))
    return { text: t.opened }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const session = await read($, sessionRef)
    if (!active || !session || session.moments.length === 0 || e.props.hasSurvey) return next(e)
    const t = UI[lang]
    const { Box, Text } = $.ui.resolve(e)
    const shots = session.moments.filter(m => m.kind === 'capture').length
    return (
      <Box>
        <Text color="red" bold>
          ● REC{' '}
        </Text>
        <Text dimColor>
          {formatDuration(activeTime([session.startedAt, ...session.moments.map(m => m.at)]), lang)} · {session.moments.length} {t.moments} · {t.shots(shots)} ·{' '}
        </Text>
        <Text>{t.toEdit}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = UI[lang]
    const { Box, Text, Button } = $.ui.resolve(e)
    const Input = e.surface !== 'mobile' ? $.ui.resolve(e).Input : null
    const Image = e.surface === 'terminal' ? $.ui.resolve(e).Image : null
    const session = await read($, sessionRef)
    const edit = await read($, editRef)
    if (!active) return <Text dimColor>{t.notProject}</Text>
    if (!session) return <Text dimColor>{t.noSession}</Text>

    const cuts = await read($, cutsRef)
    const rendering = await read($, renderingRef)
    const scenes = buildScenes(session, edit.from, lang, edit.to, edit.picks)
    const kept = applyEdit(scenes, edit)
    const selected = scenes.find(s => s.id === edit.selected) ?? scenes[0]!
    const points = startPoints(session)
    const start = edit.from ?? session.startedAt
    const startMoment = session.moments.find(m => m.at === start)
    const set = (fn: (edit: Edit) => Edit) => update($, editRef, fn)

    const lastAt = session.moments.at(-1)?.at ?? session.startedAt
    const moveStart = (step: number) =>
      set(ed => {
        const allowed = points.filter(p => ed.to === null || p < ed.to)
        const i = Math.max(0, allowed.indexOf(ed.from ?? session.startedAt))
        const at = allowed[Math.min(allowed.length - 1, Math.max(0, i + step))] ?? session.startedAt
        return { ...ed, from: at === session.startedAt ? null : at }
      })
    // La fin se règle sur les mêmes repères ; tout au bout, c'est « fin de la session » (null).
    const moveEnd = (step: number) =>
      set(ed => {
        const begin = ed.from ?? session.startedAt
        const allowed = [...points.filter(p => p > begin), lastAt].filter((p, i, all) => all.indexOf(p) === i)
        const i = ed.to === null ? allowed.length - 1 : Math.max(0, allowed.indexOf(ed.to))
        const at = allowed[Math.min(allowed.length - 1, Math.max(0, i + step))] ?? lastAt
        return { ...ed, to: at === lastAt ? null : at }
      })
    const endMoment = edit.to === null ? null : session.moments.find(m => m.at === edit.to)

    let thumb: string | null = null
    if (selected.thumb && Image) {
      try {
        thumb = ((await $.fs.read(selected.thumb, { as: 'bytes' })) as { base64: string }).base64
      } catch {
        thumb = null
      }
    }

    const label = (scene: Scene, i: number) =>
      `${scene.id === selected.id ? '›' : ' '} ${i + 1}. ${t.kind[scene.kind]}${scene.chip ? ` ${scene.chip}` : ''} · ${
        edit.captions[scene.id] ?? scene.caption
      }`

    const startLabel =
      startMoment?.kind === 'commit'
        ? `· ${startMoment.label}`
        : start === session.startedAt
          ? `· ${t.sessionStart}`
          : `· ${t.capture}`

    return (
      <Box flexDirection="column">
        <Text bold>
          {session.project} · {t.plans(kept.length, Math.round(runtime(kept)))}
        </Text>
        <Text dimColor>{t.local(tilde(session.dir))}</Text>
        {edit.status && <Text color={rendering ? 'yellow' : edit.output ? 'green' : undefined}>{edit.status}</Text>}
        <Text> </Text>
        <Box>
          <Text>{t.cuts} </Text>
          {cuts.map(cut => (
            <Box key={`cutbox-${cut.id}`}>
              <Button
                key={`cut-${cut.id}`}
                variant={cut.id === edit.cutId ? 'primary' : 'secondary'}
                label={`${cut.name}${cut.output ? ' ✓' : ''}`}
                onPress={() => set(() => ({ ...cut, cutId: cut.id, status: cut.output ? t.ready(tilde(cut.output)) : null }))}
              />
              <Text> </Text>
            </Box>
          ))}
          <Button
            key="new-cut"
            label={t.newCut}
            onPress={async () => {
              await set(() => ({ ...emptyEdit }))
              void direct($)
            }}
          />
          <Text> </Text>
          <Button key="direct" label={t.direct} onPress={() => void direct($)} />
        </Box>
        {Input && (
          <Input
            key="cut-name"
            label={t.cutName}
            value={edit.name ?? t.untitled(cuts.length + (edit.cutId ? 0 : 1))}
            submitLabel={t.keep}
            onSubmit={(value: string) => set(ed => ({ ...ed, name: value.trim() || null }))}
          />
        )}
        <Text> </Text>
        <Box>
          <Text>{t.start} </Text>
          <Button key="from-prev" label="◀" onPress={() => moveStart(-1)} />
          <Text>
            {' '}
            {clockTime(start)} {startLabel}{' '}
          </Text>
          <Button key="from-next" label="▶" onPress={() => moveStart(1)} />
        </Box>
        <Box>
          <Text>{t.end} </Text>
          <Button key="to-prev" label="◀" onPress={() => moveEnd(-1)} />
          <Text>
            {' '}
            {clockTime(edit.to ?? lastAt)}{' '}
            {edit.to === null
              ? `· ${t.sessionEnd}`
              : endMoment?.kind === 'commit'
                ? `· ${endMoment.label}`
                : `· ${t.capture}`}{' '}
          </Text>
          <Button key="to-next" label="▶" onPress={() => moveEnd(1)} />
        </Box>
        <Text> </Text>
        {scenes.map((scene, i) => {
          const isKept = !edit.dropped.includes(scene.id)
          return (
            <Box key={`row-${scene.id}`}>
              <Button
                key={`keep-${scene.id}`}
                plain
                label={isKept ? '[x]' : '[ ]'}
                onPress={() =>
                  set(ed => ({
                    ...ed,
                    dropped: isKept ? [...ed.dropped, scene.id] : ed.dropped.filter(id => id !== scene.id),
                  }))
                }
              />
              <Button
                key={`sel-${scene.id}`}
                plain
                label={label(scene, i)}
                onPress={() => set(ed => ({ ...ed, selected: scene.id }))}
              />
            </Box>
          )
        })}
        <Text> </Text>
        {Input && (
          <Input
            key="caption"
            label={t.captionOf(scenes.indexOf(selected) + 1)}
            value={edit.captions[selected.id] ?? selected.caption}
            submitLabel={t.keep}
            onSubmit={(value: string) =>
              set(ed => ({ ...ed, captions: { ...ed.captions, [selected.id]: value.trim() } }))
            }
          />
        )}
        {thumb && Image && <Image key="thumb" source={{ png: thumb }} columns={40} rows={11} alt={selected.caption} />}
        <Text> </Text>
        <Box>
          <Button
            key="render"
            variant="primary"
            label={rendering ? t.busyRender : t.render}
            onPress={() => void renderReel($)}
          />
          <Text> </Text>
          {edit.output && <Button key="open" label={t.open} onPress={() => void $.process.run(['open', edit.output!])} />}
          <Text> </Text>
          {edit.output && (
            <Button key="finder" label={t.finder} onPress={() => void $.process.run(['open', '-R', edit.output!])} />
          )}
        </Box>
        {edit.post && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>{t.post}</Text>
            <Text>{edit.post}</Text>
            <Button
              key="copy"
              label={t.copy}
              onPress={async () => {
                const done = await $.ui.copy({ text: edit.post!, surface: e.surface })
                if (done.isCopied) $.ui.toast(t.copied)
              }}
            />
          </Box>
        )}
      </Box>
    )
  })
}
