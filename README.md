# Buildreel

**Your Claude Code session, cut into a 30-second build-in-public video.**

Buildreel is a mod for [Claude Code](https://claude.com/claude-code). While you build, it quietly logs the moments that matter (files written, tests going red then green, commits) and films your app as it takes shape. When you are done, `/reel` opens an editing table in your terminal: pick the shots, rewrite the captions, move the start point, then render a vertical video and a ready-to-paste post for X.

Nothing leaves your machine until you post it yourself.

<p align="center">
  <img src="docs/demo.gif" width="270" alt="A 26-second vertical reel of a browser platformer being built: grey prototype, inked cartoon art, ghosts, multiplayer, level generator, session numbers, made with Claude Code">
</p>

<p align="center"><sub>One evening of building <i>Couleur</i>, a browser platformer, cut by Buildreel. <a href="docs/demo.mp4">Full-quality MP4</a>.</sub></p>

The post it wrote for that video:

> I built Couleur with Claude Code in 1h42: a browser platformer where paint rewrites the surface it touches. Red bounces, yellow grips walls, water erases. 5 levels, ghosts of your past runs, live rooms for 6, and a level generator that only assembles chunks it has verified.

## Install

In Claude Code:

```
/plugin marketplace add menufactory43/buildreel
/plugin install buildreel@buildreel
```

Or from a clone, for one session:

```sh
git clone https://github.com/menufactory43/buildreel
claude --plugin-dir ./buildreel
```

**Needs:** macOS, Google Chrome (or Chromium, or Brave), [ffmpeg](https://ffmpeg.org) with libx264 (`brew install ffmpeg`), Node.js 22.4 or newer, and a Claude Code build with mods (function hooks). Built and tested on Claude Code 2.1.288.

## Use it

Work as usual. A `● REC` band above the prompt shows the session time, the moments logged and the shots taken.

| Command | What it does |
|---|---|
| `/reel` | Opens the editing table. |
| `/reel import` | Catches up on everything that happened before Buildreel loaded: replays the session history, then checks out each commit, runs its dev server and films it. |
| `/reel shot` | Takes a shot now. |
| `/reel render` | Renders the video and writes the post, with the table's current choices. |
| `/reel recipe` | Asks Claude to rewrite the capture recipe (see below). |
| `/reel url <address>` | Films another address. |

### The editing table

- **Cuts**: one session can give several videos. Each cut keeps its own name, bounds, shots, captions, video and post. **+ New cut** starts another, a click on a cut brings it back to retouch and render again.
- **Start ◀ ▶** and **End ◀ ▶** frame the moment you want, from commit to commit: just the art pass, just the multiplayer evening.
- **`[x]` / `[ ]`** keeps or drops a shot: hook, app shots, the failing tests that went green, the numbers, the ending.
- **Text of shot N** rewrites the caption of the selected shot. Captions come from your commit messages, never from file paths.
- **Render the video**, then **Open**, **Show in Finder** and **Copy the post**.

Everything lands in `~/Movies/buildreel/<project>/<date>/`: the journal, every shot and clip, each render (named after its cut, like `couleur-multiplayer-21h40.mp4`) with its post as a `.txt`, and `cuts.json`.

## How it films any app

A fresh, invisible Chrome opens your app for every shot, so it would always land on the start screen. Buildreel asks the Claude of your session how to show the app instead: it built the app, so it knows the page to open, the key that starts a game, the main feature to use. The answer is a **capture recipe**, written once per project in `~/Movies/buildreel/<project>/recipe.json`:

```json
{
  "type": "web",
  "url": "http://localhost:5190",
  "attente": 1500,
  "etapes": [{ "touche": "Enter", "attendre": 600 }],
  "clip": {
    "secondes": 2.5,
    "etapes": [
      { "clic": { "x": 0.62, "y": 0.64, "bouton": "right" } },
      { "maintenir": ["ArrowRight", "Space"], "ms": 500 }
    ]
  }
}
```

`etapes` run before filming, `clip.etapes` while a short clip is recorded. Steps are `touche` (press a key), `maintenir` (hold one or more keys for `ms`), `clic` (x and y from 0 to 1, left or right button), `defiler` (scroll) and `attendre` (wait). Edit the file by hand whenever you like. Shots with a clip play it in the video instead of a still.

Buildreel also keeps the screenshots your session already takes to check its work (a browser tool, `screencapture`, a simulator screenshot it opens). Those show the app in the state that matters, right after a change. Mockups, icons and assets are left out, and so are Buildreel's own files.

The dev server address is read from `vite.config.*` (Next.js and Astro defaults otherwise). If Claude is not reachable, Buildreel falls back to a plain recipe and keeps going.

## Privacy

- The journal, shots, clips and videos stay on your Mac. Buildreel uploads nothing.
- Writing the recipe and the post uses your own Claude Code session, like any other prompt.
- `/reel import` reads this project's session history from `~/.claude/projects/` on your machine.
- Old commits are filmed from a temporary `git worktree`, removed right after. Your working tree is never touched.

## Settings

- **Language** (`auto`, `en`, `fr`): the editing table and the video captions. `auto` follows your system. Change it with `/plugin configure buildreel@buildreel`.
- **`BUILDREEL_HOME`**: where everything is written, instead of `~/Movies/buildreel`.

## Limits

- Buildreel films web apps itself. For native apps (iOS, Mac) it only keeps the screenshots your session takes while testing. It never starts a simulator or builds anything. With no screenshot at all (CLI, library, back end), the video is built from the session itself: tests, commits and numbers.
- macOS only for now (it uses `sips` and `open`).
- No music: add a trending sound when you post, as the platforms prefer.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

The pure logic (reading tool calls, picking shots, parsing recipes) lives in `hooks/journal.ts` with its tests. `hooks/register.tsx` wires it to Claude Code. The Node scripts in `bin/` drive Chrome over the DevTools protocol (`shoot.mjs`), replay old commits (`backfill.mjs`), read the session history (`import.mjs`) and cut the video with ffmpeg (`montage.mjs`).

## License

MIT, see [LICENSE](LICENSE). En français : [README.fr.md](README.fr.md).
