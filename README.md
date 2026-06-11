# VANTAGE

A turn-based, hex-based **combined-arms tactics** game with one unusual premise:
**you never command the main effort.** The mechs — the heaviest units on the
field — fight their own battle, run by an autonomous, legible, *fallible* AI
commander with a name, a temperament, and a growing (or collapsing) trust in
you. You command everything around them: the scouts, the guns, the engineers,
the supply trucks, the air sorties. You win by *enabling* a battle you don't
control.

Built from scratch in TypeScript + Three.js. Pure deterministic simulation,
procedural art and audio, no asset pipeline.

## Play it

**In the browser (no install):** https://kindlyengineer.github.io/ClaudeProjects/
— published automatically from `main` by the deploy workflow.

**Locally:**

```bash
npm install
npm run dev        # → http://localhost:5173
```

That's it. The title menu offers the handcrafted operation (*Eastern Gate*),
seeded generated campaigns, and one-off skirmishes. "How to play" on the menu
covers the rules; the short version:

- **Orders** — select one of *your* units; press-hold a hex and drag to move
  with a chosen final facing (BattleTech-style); click an enemy to fire, an
  ally to resupply.
- **The commander panel** is the mechs talking to you. Feed what they ask for
  and they fight better — and learn to trust you.
- **Seeing is everything.** Nobody fires on what nobody sees.

Other useful runs:

```bash
npm run preview    # serve the production build from dist/ (port 4173)
npm run build      # typecheck + production bundle → dist/
```

## The harness

Everything is verified headlessly — the sim is pure and fully separate from
the renderer:

```bash
npm test           # vitest unit suite (sim logic, no GPU)
npm run typecheck  # tsc --noEmit
npm run selfplay   # AI-vs-AI balance/termination sweep across all scenarios
npm run uitest     # real mouse-gesture e2e in headless Chromium
npm run screenshot # render a board state to tools/shots/latest.png
```

## Repo map

| Path | What it is |
|------|------------|
| `src/sim/` | The pure, deterministic, seeded simulation — combat, logistics, vision/fog, the commander AI, the operation layer. No THREE imports, ever. |
| `src/data/` | All content as data tables: units, weapons, terrain, maps, operations, temperaments. Add a row to add content. |
| `src/render/` | Three.js presentation — reads sim state, never mutates it. |
| `src/ui/` | The interactive shell: orders, screens, settings, persistence, procedural audio. |
| `src/main.ts` | The boot router (menu / operations / skirmishes / headless verification routes). |
| `test/`, `tools/` | The vitest suite and the headless harnesses. |
| `docs/brief.md` | The founding design spec — the source of truth. |
| `docs/game/endstate.md` | The ratified roadmap (the Horizons) and design rulings. |
| `docs/game/architecture.md` | The build log, slice by slice. |

## Development notes

This repo is set up for [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web):
`CLAUDE.md` carries the project context, `.claude/` holds session hooks and
rules, and `scripts/install_deps.sh` runs at session start. Environment-side
configuration lives in `docs/cloud-environment.md`.
