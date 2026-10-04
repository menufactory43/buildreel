export type Lang = 'fr' | 'en'

export type MomentKind = 'edit' | 'test' | 'commit' | 'build' | 'capture'

export type Moment = {
  id: string
  at: number
  kind: MomentKind
  label: string
  ok?: boolean
  passed?: number
  failed?: number
  file?: string
  image?: string
  thumb?: string
  clip?: string
}

export type Session = {
  project: string
  dir: string
  url: string
  startedAt: number
  moments: Moment[]
}

export type SceneKind = 'hook' | 'shot' | 'bug-red' | 'bug-green' | 'stats' | 'final'

export type Scene = {
  id: string
  kind: SceneKind
  at: number
  caption: string
  highlight?: string
  chip?: string
  image?: string
  thumb?: string
  clip?: string
  stats?: { label: string; value: string }[]
  lines?: string[]
}

export type Edit = {
  cutId: string | null
  name: string | null
  from: number | null
  to: number | null
  // Les captures choisies par Claude, dans l'ordre ; null tant qu'il n'a pas choisi.
  picks: string[] | null
  title: string | null
  selected: string | null
  captions: Record<string, string>
  dropped: string[]
  status: string | null
  output: string | null
  post: string | null
}

// Une coupe : une vidéo de la session, avec ses propres bornes, plans et textes.
export type Cut = Edit & { id: string; name: string; renderedAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    buildreel: { session: Session | null; edit: Edit; cuts: Cut[]; rendering: boolean }
  }
}

export type RecipeStep =
  | { key: string; wait?: number }
  | { hold: string | string[]; ms?: number; wait?: number }
  | { click: { x?: number; y?: number; button?: 'left' | 'right'; ms?: number }; wait?: number }
  | { scroll: number; wait?: number }
  | { wait: number }

export type Recipe = {
  type: 'web' | 'ios' | 'mac' | 'none'
  url?: string
  delay?: number
  steps?: RecipeStep[]
  clip?: { seconds: number; steps?: RecipeStep[] }
  why?: string
}
