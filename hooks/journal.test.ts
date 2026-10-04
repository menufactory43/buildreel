import { expect, test } from 'claude-code/testing'

import type { Session } from '../types'
import { runsElsewhere, activeTime, applyDirection, applyEdit, directorPrompt, parseDirection, buildScenes, classifyBash, emptyEdit, imagesOf, isShot, parseRecipe, saveCut, shorten, slug } from './journal'

const session: Session = {
  project: 'couleur',
  dir: '/tmp/reel',
  url: 'http://localhost:5190',
  startedAt: 1000,
  moments: [
    { id: 'c1', at: 2000, kind: 'capture', label: 'capture', image: '/tmp/1.png', thumb: '/tmp/1t.png' },
    { id: 'e1', at: 2500, kind: 'edit', label: 'src/a.ts', file: 'src/a.ts' },
    { id: 'k1', at: 3000, kind: 'commit', label: 'Graphismes encrés' },
    { id: 'c2', at: 3500, kind: 'capture', label: 'capture', image: '/tmp/2.png' },
    { id: 't1', at: 4000, kind: 'test', label: 'tests rouges', ok: false, failed: 3, passed: 21 },
    { id: 't2', at: 5000, kind: 'test', label: 'tests verts', ok: true, failed: 0, passed: 24 },
    { id: 'c3', at: 6000, kind: 'capture', label: 'capture', image: '/tmp/3.png' },
  ],
}

test('reconnaît un commit, des tests rouges et un build', async () => {
  const commit = classifyBash('git commit -m "Ajoute la teinture safran"', '[main 4268cf2] Ajoute la teinture safran\n 3 files changed', false, 1)
  expect(commit?.kind).toBe('commit')
  expect(commit?.label).toBe('Ajoute la teinture safran')
  const red = classifyBash('pnpm test', ' Tests  3 failed | 21 passed (24)', true, 2)
  expect(red?.ok).toBe(false)
  expect(red?.failed).toBe(3)
  expect(classifyBash('pnpm build', 'built in 1.2s', false, 3)?.kind).toBe('build')
  expect(classifyBash('ls -la', '', false, 4)).toBe(null)
})

test('monte accroche, captures, bug réparé, chiffres et fin', async () => {
  const kinds = buildScenes(session, null, "fr").map(s => s.kind)
  expect(kinds).toEqual(['hook', 'shot', 'shot', 'bug-red', 'bug-green', 'stats', 'final'])
  const early = { ...session, moments: [{ id: 't0', at: 1500, kind: 'test' as const, label: 'r', ok: false, failed: 2 }, { id: 't9', at: 1600, kind: 'test' as const, label: 'v', ok: true, passed: 19 }, ...session.moments.filter(m => m.kind !== 'test')] }
  expect(buildScenes(early, null, 'fr').map(s => s.kind)).toEqual(['hook', 'bug-red', 'bug-green', 'shot', 'shot', 'stats', 'final'])
})

test('le rewind coupe ce qui précède le point de départ', async () => {
  const scenes = buildScenes(session, 3500, "fr")
  expect(scenes.filter(s => s.kind === 'shot').map(s => s.id)).toEqual(['c2'])
})

test('la table de montage retire des plans et réécrit les textes', async () => {
  const scenes = applyEdit(buildScenes(session, null, "fr"), {
    ...emptyEdit,
    dropped: ['stats'],
    captions: { hook: 'Mon jeu de teinture en une soirée' },
  })
  expect(scenes.some(s => s.kind === 'stats')).toBe(false)
  expect(scenes[0]?.caption).toBe('Mon jeu de teinture en une soirée')
})

test('lit la recette écrite par Claude, même entourée de texte', async () => {
  const text = 'Voici :\n```json\n{"type":"web","url":"http://localhost:5190","etapes":[{"touche":"Enter"},{"bidon":1}],"clip":{"secondes":9,"etapes":[{"maintenir":"ArrowRight","ms":700}]}}\n```'
  const recipe = parseRecipe(text, 'http://localhost:5173')
  expect(recipe?.url).toBe('http://localhost:5190')
  expect(recipe?.steps?.length).toBe(1)
  expect(recipe?.clip?.seconds).toBe(4)
  const fresh = parseRecipe('{"type":"web","steps":[{"key":"Enter"}],"clip":{"seconds":2,"steps":[{"hold":"ArrowRight","ms":500}]}}', 'http://localhost:5173')
  expect(fresh?.steps).toEqual([{ key: 'Enter' }])
  expect(fresh?.clip?.steps?.length).toBe(1)
  expect(parseRecipe('{"type":"ios"}', 'x')).toEqual({ type: 'ios' })
  expect(parseRecipe('pas de json', 'x')).toBe(null)
  expect(parseRecipe('{"type":"web","url":"javascript:alert(1)"}', 'http://localhost:5173')?.url).toBe('http://localhost:5173')
})

test('compte les tests, pas les fichiers de test, et coupe les commits trop longs', async () => {
  const out = ' Test Files  1 passed (1)\n      Tests  19 passed (19)\n   Start at  00:23:26'
  expect(classifyBash('pnpm test', out, false, 1)?.passed).toBe(19)
  const red = classifyBash('pnpm test', ' Test Files  1 failed (1)\n      Tests  2 failed | 10 passed (12)', true, 2)
  expect(red?.failed).toBe(2)
  expect(shorten('Étapes 3 et 4 : dangers, fantômes, pigments, menus et niveaux 2 à 5').length <= 53).toBe(true)
  expect(shorten('Court')).toBe('Court')
})

test('une coupe a sa fin, son nom de fichier, et se range sans écraser les autres', async () => {
  const scenes = buildScenes(session, null, 'fr', 3500)
  expect(scenes.filter(s => s.kind === 'shot').map(s => s.id)).toEqual(['c1'])
  expect(scenes.some(s => s.kind === 'bug-red')).toBe(false)
  expect(slug('Le multijoueur, enfin !')).toBe('le-multijoueur-enfin')
  const first = saveCut([], { ...emptyEdit, name: 'Graphismes', to: 3500 }, 'Coupe 1', 10)
  const second = saveCut(first.cuts, { ...emptyEdit, name: 'Multijoueur', from: 3500 }, 'Coupe 2', 20)
  expect(second.cuts.map(c => c.name)).toEqual(['Graphismes', 'Multijoueur'])
  const again = saveCut(second.cuts, { ...first.cut, name: 'Les graphismes' }, 'x', 30)
  expect(again.cuts.map(c => c.name)).toEqual(['Les graphismes', 'Multijoueur'])
})

test("garde les captures que la session regarde, pas les maquettes ni ses propres fichiers", async () => {
  expect(isShot({ tool: 'Read', file: '/tmp/woofdoku-shot.png' }, 'Read', '/Users/x/Movies/buildreel/w')).toBe(true)
  expect(isShot({ tool: 'Read', file: '/Users/x/app/Assets.xcassets/AppIcon.png' }, 'Read', '/m')).toBe(false)
  expect(isShot({ tool: 'Read', file: '/Users/x/Movies/buildreel/w/shot-1.png' }, 'Read', '/Users/x/Movies/buildreel/w')).toBe(false)
  expect(isShot(undefined, 'mcp__claude-in-chrome__computer', '/m')).toBe(true)
  expect(isShot(undefined, 'mcp__notion__fetch', '/m')).toBe(false)
  const found = imagesOf([
    { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', data: 'AAA' } }] },
    { type: 'text', text: 'rien' },
  ])
  expect(found).toEqual([{ toolUseId: 't1', data: 'AAA' }])
})

test('compte le temps de travail, pas la nuit entre deux séances', async () => {
  const min = 60_000
  expect(activeTime([0, 10 * min, 30 * min])).toBe(30 * min)
  expect(activeTime([0, 10 * min, 10 * min + 9 * 60 * min, 10 * min + 9 * 60 * min + 5 * min])).toBe(35 * min)
})

test('Claude choisit les plans et les textes, les règles restent en secours', async () => {
  const reply = 'Voilà : {"hook":"Mon jeu de teinture en 1 h","shots":[{"id":"c3","caption":"La version finale"},{"id":"c1","caption":"Le départ"},{"id":"pirate","caption":"x"}],"bug":false}'
  const direction = parseDirection(reply, ['c1', 'c2', 'c3'])
  expect(direction?.shots.map(s => s.id)).toEqual(['c3', 'c1'])
  const edit = applyDirection(emptyEdit, direction!)
  const scenes = applyEdit(buildScenes(session, null, 'fr', null, edit.picks), edit)
  expect(scenes.filter(s => s.kind === 'shot').map(s => s.caption)).toEqual(['Le départ'])
  // Le dernier plan garde la signature, sur l'image choisie par Claude.
  expect(scenes.find(s => s.kind === 'final')?.caption).toBe('Fait avec Claude Code')
  expect(scenes.find(s => s.kind === 'final')?.image).toBe('/tmp/3.png')
  expect(scenes[0]?.caption).toBe('Mon jeu de teinture en 1 h')
  expect(scenes.some(s => s.kind === 'bug-red')).toBe(false)
  expect(parseDirection('{"shots":[{"id":"inconnu"}]}', ['c1'])).toBe(null)
  expect(directorPrompt('fr', session, null, null)).toContain('capture id=c2')
})

test("ignore les commandes qui travaillent dans un autre dossier", async () => {
  const root = '/Users/x/couleur'
  expect(runsElsewhere('cd ~/buildreel && git commit -m "x"', root, '/Users/x')).toBe(true)
  expect(runsElsewhere('git -C /Users/x/autre log', root, '/Users/x')).toBe(true)
  expect(runsElsewhere('cd /Users/x/couleur/src && pnpm test', root, '/Users/x')).toBe(false)
  expect(runsElsewhere('cd src && pnpm test', root, '/Users/x')).toBe(false)
  expect(runsElsewhere('git commit -m "Ajoute le safran"', root, '/Users/x')).toBe(false)
})
