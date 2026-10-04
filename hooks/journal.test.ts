import { expect, test } from 'claude-code/testing'

import type { Session } from '../types'
import { applyEdit, buildScenes, classifyBash, emptyEdit, parseRecipe, shorten } from './journal'

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
  expect(recipe?.etapes?.length).toBe(1)
  expect(recipe?.clip?.secondes).toBe(4)
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
