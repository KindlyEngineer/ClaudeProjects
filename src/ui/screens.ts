import { OPERATIONS } from "../data/operations";
import { unitType } from "../data/units";
import type { GameEvent } from "../sim/events";
import {
  assignSorties,
  createOperation,
  finishInterlude,
  operationDef,
  requisitionMech,
  requisitionSupport,
  spendOnSupport,
  type OperationState,
} from "../sim/operation";
import type { GameState } from "../sim/state";
import { clearOperation, loadOperation, saveOperation } from "./persist";

// The game shell (M1): title menu, the Interlude (the between-battles logistics
// stage — the player provisions, the commander refits), the After-Action Report
// and the operation-end summary. Plain DOM screens; navigation is URL-based so
// each page boots deterministically (and the verification harness is untouched).

function nav(query: string): void {
  location.href = `${location.pathname}${query}`;
}

function el(tag: string, cls: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function btn(label: string, cls: string, onClick: () => void): HTMLElement {
  const b = el("button", cls, label);
  b.addEventListener("click", onClick);
  return b;
}

// ── Title menu ────────────────────────────────────────────────────────────────

export function renderMenu(root: HTMLElement): void {
  const screen = el("div", "screen");
  screen.appendChild(el("div", "title", "VANTAGE"));
  screen.appendChild(
    el("div", "tagline", "You run the depot, the eyes and the guns.<br>The mechs fight their own battle."),
  );

  const box = el("div", "menu-box");
  const save = loadOperation();
  if (save && save.outcome === "ongoing") {
    const def = OPERATIONS[save.defId];
    box.appendChild(
      btn(`Resume ${def?.name ?? "operation"} — battle ${save.battleIndex + 1}`, "btn menu-btn", () => {
        nav(save.phase === "interlude" ? `?op=${save.defId}&interlude=1` : `?op=${save.defId}&battle=${save.battleIndex}`);
      }),
    );
  }
  box.appendChild(
    btn("New Operation — Eastern Gate", "btn menu-btn", () => {
      const op = createOperation("op01", ((Date.now() / 60000) | 0) % 10000 || 1); // a fresh, loggable seed
      saveOperation(op);
      nav(`?op=op01&interlude=1`);
    }),
  );
  for (const [label, query] of [
    ["Skirmish — Ridge Approach", "?map=ridge&seed=1"],
    ["Skirmish — Open Steppe", "?map=steppe&seed=1"],
    ["Skirmish — The Gap", "?map=gap&seed=1"],
  ] as const) {
    box.appendChild(btn(label, "btn menu-btn menu-alt", () => nav(query)));
  }
  screen.appendChild(box);
  screen.appendChild(
    el(
      "div",
      "menu-foot",
      OPERATIONS.op01.blurb,
    ),
  );
  root.appendChild(screen);
}

// ── The Interlude (provision, never task) ─────────────────────────────────────

export function renderInterlude(root: HTMLElement, op: OperationState): void {
  const def = operationDef(op);
  const battle = def.battles[op.battleIndex];
  const screen = el("div", "screen screen-wide");

  const render = (): void => {
    screen.replaceChildren();
    screen.appendChild(el("div", "title-sm", def.name.toUpperCase()));
    screen.appendChild(el("div", "subtitle", `Interlude — preparing ${battle.title}`));
    screen.appendChild(el("div", "briefing", battle.briefing));

    if (op.history.length > 0) {
      const last = op.history[op.history.length - 1];
      screen.appendChild(
        el(
          "div",
          `verdict ${last.won ? "verdict-win" : "verdict-loss"}`,
          `${last.title}: ${last.won ? "VICTORY" : "DEFEAT — carried forward"}` +
            (last.mechsLost.length ? ` · lost: ${last.mechsLost.join(", ")}` : ""),
        ),
      );
    }

    // The stockpile strip.
    const s = op.stockpile;
    screen.appendChild(
      el(
        "div",
        "stockpile",
        `DEPOT — ammo <b>${s.ammo}</b> · fuel <b>${s.fuel}</b> · repair <b>${s.repair}</b> · ` +
          `strike sorties <b>${s.strikes}</b> · overflights <b>${s.recon}</b> · credits <b>${s.credits}</b>` +
          `<div class="hint">Whatever you don't spend on your echelon stays in the depot — the commander refits its mechs from it.</div>`,
      ),
    );

    // The roster: the player's echelon is provisionable; the mechs are read-only.
    const grid = el("div", "roster");
    op.roster.forEach((r, i) => {
      const t = unitType(r.typeId);
      const isMech = t.cls === "mech";
      const card = el("div", "roster-card" + (r.alive ? "" : " roster-dead") + (isMech ? " roster-mech" : ""));
      const name = r.callSign ? `${r.callSign} <span class="sub">${t.name}</span>` : t.name;
      const ammoNow = r.ammo.reduce((a, b) => a + b, 0);
      const ammoMax = t.weapons.reduce((a, w) => a + w.ammoMax, 0);
      card.appendChild(
        el(
          "div",
          "roster-line",
          `<b>${name}</b>${r.alive ? "" : " — DESTROYED"}<br>` +
            (r.alive
              ? `hull ${r.structure}/${t.structure} · ammo ${ammoNow}/${ammoMax} · fuel ${r.fuel}/${t.fuelMax}` +
                (r.crits.length ? ` · <span class="warn">${r.crits.join(", ")}</span>` : "")
              : ""),
        ),
      );
      if (r.alive && !isMech) {
        const row = el("div", "roster-actions");
        row.appendChild(btn("+5 repair", "btn tiny", () => (spendOnSupport(op, i, { repair: 5 }), save(), render())));
        row.appendChild(btn("+5 ammo", "btn tiny", () => (spendOnSupport(op, i, { ammo: 5 }), save(), render())));
        row.appendChild(btn("+10 fuel", "btn tiny", () => (spendOnSupport(op, i, { fuel: 10 }), save(), render())));
        card.appendChild(row);
      }
      if (!r.alive && !isMech) {
        const price = def.prices.support[t.cls] ?? 0;
        card.appendChild(
          btn(`Replace (${price} cr)`, "btn tiny btn-alt", () => (requisitionSupport(op, i), save(), render())),
        );
      }
      if (isMech && r.alive) card.appendChild(el("div", "hint", "Refitted by the commander, from the depot."));
      grid.appendChild(card);
    });
    screen.appendChild(grid);

    // Requisitions + sortie assignment.
    const ops = el("div", "interlude-row");
    const mechSlots = op.roster.filter((r) => unitType(r.typeId).cls === "mech");
    if (mechSlots.some((r) => !r.alive)) {
      ops.appendChild(
        btn(`Requisition a new mech (${def.prices.mech} cr)`, "btn btn-alt", () => {
          const r = requisitionMech(op);
          if (r.ok) (save(), render());
        }),
      );
    }
    ops.appendChild(btn("Assign strike sortie ▸ next battle", "btn tiny btn-alt", () => (assignSorties(op, 1, 0), save(), render())));
    ops.appendChild(btn("Assign overflight ▸ next battle", "btn tiny btn-alt", () => (assignSorties(op, 0, 1), save(), render())));
    ops.appendChild(
      el("div", "hint", `Assigned to ${battle.title}: ✈ ${op.nextOffmap.strike} strike · 👁 ${op.nextOffmap.recon} overflight (fly this battle or not at all)`),
    );
    screen.appendChild(ops);

    screen.appendChild(
      btn(`Begin ${battle.title} ▸`, "btn begin", () => {
        finishInterlude(op); // the commander draws from what's left
        save();
        nav(`?op=${op.defId}&battle=${op.battleIndex}`);
      }),
    );
    screen.appendChild(btn("Abandon operation", "btn tiny ghost", () => {
      clearOperation();
      nav("");
    }));
  };

  const save = (): void => saveOperation(op);
  render();
  root.appendChild(screen);
}

// ── After-Action Report (the player's invisible work, made visible) ───────────

interface Contribution {
  label: string;
  n: number;
}

/** Pull the PLAYER's contributions out of the event stream (pure). */
export function contributions(state: GameState, playerSide: "blue" | "red"): Contribution[] {
  const playerIds = new Set(state.units.filter((u) => u.side === playerSide && u.controller === "player").map((u) => u.id));
  const c = { resupplies: 0, rounds: 0, suppress: 0, smoke: 0, forts: 0, kills: 0, strikes: 0, flights: 0 };
  for (const ev of state.events as GameEvent[]) {
    if (ev.kind === "resupply" && playerIds.has(ev.id)) (c.resupplies++, (c.rounds += ev.ammo));
    else if (ev.kind === "mission" && playerIds.has(ev.id)) ev.mission === "suppress" ? c.suppress++ : c.smoke++;
    else if (ev.kind === "build" && playerIds.has(ev.id)) c.forts++;
    else if (ev.kind === "fire" && playerIds.has(ev.id) && ev.destroyed) c.kills++;
    else if (ev.kind === "offmap" && ev.side === playerSide) ev.asset === "strike" ? c.strikes++ : c.flights++;
  }
  return [
    { label: "resupply runs delivered", n: c.resupplies },
    { label: "rounds passed forward", n: c.rounds },
    { label: "suppression missions fired", n: c.suppress },
    { label: "smoke screens laid", n: c.smoke },
    { label: "positions fortified", n: c.forts },
    { label: "kills by your echelon", n: c.kills },
    { label: "air strikes called", n: c.strikes },
    { label: "recon overflights flown", n: c.flights },
  ].filter((x) => x.n > 0);
}

/** The AAR overlay content for an operation battle. `onContinue` records the
 *  battle and moves the operation along. */
export function buildAAR(state: GameState, op: OperationState, onContinue: () => void): HTMLElement {
  const def = operationDef(op);
  const battle = def.battles[op.battleIndex];
  const won = state.outcome === "blue";
  const box = el("div", `end-box ${won ? "end-win" : "end-loss"} aar`);
  box.appendChild(el("div", "end-title", won ? "OBJECTIVE TAKEN" : "REPULSED"));
  box.appendChild(el("div", "end-stats", `${battle.title} · turn ${Math.min(state.turn, state.objective.turnLimit)} of ${state.objective.turnLimit}`));

  const lost = state.units.filter((u) => u.side === "blue" && u.structure <= 0 && u.callSign).map((u) => u.callSign!);
  const contrib = contributions(state, "blue");
  const lines = el("div", "aar-lines");
  lines.appendChild(el("div", "aar-head", "YOUR SUPPORTING EFFORT"));
  if (contrib.length === 0) lines.appendChild(el("div", "aar-line", "— the echelon never made its weight felt —"));
  for (const x of contrib) lines.appendChild(el("div", "aar-line", `▸ ${x.n} ${x.label}`));

  // The commander's word — the relationship, closing the loop.
  const mechs = state.units.filter((u) => u.callSign);
  const speaker = mechs.find((u) => u.structure > 0)?.callSign ?? "Command";
  const voice = won
    ? contrib.length > 0
      ? `${speaker}: "We made it because the rounds kept coming and the guns ahead of us went quiet. That was you."`
      : `${speaker}: "We took it alone this time. Don't make a habit of it."`
    : lost.length > 0
      ? `${speaker}: "We lost ${lost.join(" and ")} out there. We needed more than we had."`
      : `${speaker}: "They held. Get us refit — we're not done."`;
  lines.appendChild(el("div", "aar-voice", voice));
  if (lost.length) lines.appendChild(el("div", "aar-lost", `Lost in action: ${lost.join(", ")} — permanent.`));
  box.appendChild(lines);

  const row = el("div", "end-row");
  row.appendChild(btn("Continue ▸", "btn", onContinue));
  box.appendChild(row);
  return box;
}

// ── Operation end ─────────────────────────────────────────────────────────────

export function renderOperationEnd(root: HTMLElement, op: OperationState): void {
  const def = operationDef(op);
  const screen = el("div", "screen");
  const complete = op.outcome === "complete";
  screen.appendChild(el("div", "title-sm", def.name.toUpperCase()));
  screen.appendChild(el("div", `title ${complete ? "title-win" : "title-loss"}`, complete ? "OPERATION COMPLETE" : "OPERATION FAILED"));
  const hist = el("div", "menu-box");
  for (const h of op.history) {
    hist.appendChild(
      el("div", "aar-line", `${h.title} — ${h.won ? "victory" : "defeat"} (turn ${h.turns})${h.mechsLost.length ? ` · lost ${h.mechsLost.join(", ")}` : ""}`),
    );
  }
  const survivors = op.roster.filter((r) => r.alive && r.callSign).map((r) => r.callSign!);
  hist.appendChild(el("div", "aar-voice", survivors.length ? `${survivors.join(", ")} came home.` : "Nobody came home."));
  screen.appendChild(hist);
  screen.appendChild(
    btn("Return to menu", "btn begin", () => {
      clearOperation();
      nav("");
    }),
  );
  root.appendChild(screen);
}
