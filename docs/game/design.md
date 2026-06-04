# VANTAGE — Design (summary)

> The full, authoritative design is **[`../brief.md`](../brief.md)**. This file
> is a short orientation; the brief governs.

## The one idea
A turn-based, hex-based combined-arms tactics game where **you command the
support effort and the supply line — never the mechs.** The mechs (the main
effort) are run by an autonomous, legible, objective-seeking utility AI. You win
by *enabling* it: supply, vision, fire support, and shaping the battlefield it
reasons over. You never order it.

## Why it's interesting
- The opponent-and-ally model is the game: a transparent utility AI you *shape*
  rather than command, which will overcommit on the mission's will and force you
  to sustain advances you didn't pick.
- Depth is in the *system* (combined arms, facing, sustainment), not in any one
  unit's stat block. Every unit shares one combat model.
- Logistics is tactical and on-map: ammo, fuel, supply-line tracing, dry-out.

## Locked decisions (resolved with the owner)
- **Win/Loss:** blue wins on objective; loses on objective failure, all mechs
  destroyed, or all support units lost.
- **v0** ships both an interactive UI and a headless scripted harness.
- **Heightmap is visual in v0** (cover/exposure from terrain type); elevation
  becomes mechanical in v1.

## The hypothesis v0 must prove
A support-only player can *legibly and measurably* change a battle's outcome —
same seed fails without support, succeeds with it. If that can't be shown, the
design needs revision before more is built (brief §4, criterion 1).
